import { bytes } from '@/lib/bytes';
import { Config } from '@/lib/config/validate';
import { getDatasource } from '@/lib/datasource';
import { Datasource } from '@/lib/datasource/Datasource';
import type { File } from '@/lib/db/models/file';
import { log } from '@/lib/logger';
import { randomCharacters } from '@/lib/random';
import ffmpeg from 'fluent-ffmpeg';
import { createWriteStream, existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { isMainThread, parentPort, workerData } from 'worker_threads';
import { dbProxy, pending } from './proxiedDb';

export type VideoCompressWorkerData = {
  id: string;
  enabled: boolean;
  config: Config;
};

type CompressedRow = {
  id: string;
  fileId: string;
  path: string;
  size: bigint;
  status: string;
  error: string | null;
};

const { id, enabled, config } = workerData as VideoCompressWorkerData;

const logger = log('tasks').c(id);

if (isMainThread) {
  logger.error("video compression worker can't run on the main thread");
  process.exit(1);
}

if (!enabled) {
  logger.debug('video compression is disabled');
  process.exit(0);
}

logger.debug('started video compression worker');

const workerId = randomCharacters(8);

function compressedNameFor(file: { id: string }): string {
  return `.compressed.${file.id}.mp4`;
}

function compress(
  input: string,
  output: string,
  opts: {
    codec: string;
    crf: number;
    preset: string;
    maxHeight: number;
    maxBitrateKbps: number;
    audioBitrateKbps: number;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(input)
      .videoCodec(opts.codec)
      .audioCodec('aac')
      .audioBitrate(`${opts.audioBitrateKbps}k`)
      .outputOptions([
        `-crf ${opts.crf}`,
        `-preset ${opts.preset}`,
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        // scale to maxHeight while preserving aspect ratio; only downscale, never upscale
        `-vf scale='if(gt(ih,${opts.maxHeight}),-2,iw)':'if(gt(ih,${opts.maxHeight}),${opts.maxHeight},ih)'`,
      ])
      .format('mp4')
      .output(output);

    if (opts.maxBitrateKbps > 0) {
      cmd.outputOptions([`-maxrate ${opts.maxBitrateKbps}k`, `-bufsize ${opts.maxBitrateKbps * 2}k`]);
    }

    cmd
      .on('start', (line) => logger.debug('compressing video', { cmd: line }))
      .on('error', (err, _stdout, stderr) => {
        logger.error('compression failed', { err: err.message, stderr: stderr?.slice(-500) });
        reject(err);
      })
      .on('end', () => {
        if (!existsSync(output)) {
          return reject(new Error('compression finished but output file missing'));
        }
        resolve();
      })
      .run();
  });
}

async function processOne(config: Config, datasource: Datasource, fileId: string) {
  const file = await dbProxy<File>('file.findUnique', {
    where: { id: fileId },
    include: { compressed: true },
  });

  if (!file) return;
  if (!file.type.startsWith('video/')) {
    logger.debug('not a video, skipping', { id: file.id, type: file.type });
    return;
  }
  if (file.size === 0) {
    logger.debug('empty file, skipping', { id: file.id });
    return;
  }

  // skip if already done (idempotent re-runs)
  const existing = (file as any).compressed as CompressedRow | null | undefined;
  if (existing && existing.status === 'done') {
    logger.debug('already compressed, skipping', { id: file.id });
    return;
  }

  // stream original to tmp
  const stream = await datasource.get(file.name);
  if (!stream) {
    logger.debug('source not in datasource, skipping', { id: file.id });
    return;
  }

  const tmpIn = join(config.core.tempDirectory, `zvc_in_${file.id}_${workerId}`);
  const tmpOut = join(config.core.tempDirectory, `zvc_out_${file.id}_${workerId}.mp4`);

  const w = createWriteStream(tmpIn);
  await new Promise((resolve, reject) => {
    stream.pipe(w);
    stream.on('error', reject);
    w.on('error', reject);
    w.on('finish', resolve as any);
  });

  const vc = config.features.videoCompression;
  const compressedPath = compressedNameFor(file);

  // upsert pending row
  let row: CompressedRow | null;
  if (!existing) {
    row = await dbProxy<CompressedRow>('compressedFile.create', {
      data: { fileId: file.id, path: compressedPath, status: 'pending' },
    });
  } else {
    row = await dbProxy<CompressedRow>('compressedFile.update', {
      where: { id: existing.id },
      data: { status: 'pending', error: null, path: compressedPath },
    });
  }

  if (!row) {
    try {
      unlinkSync(tmpIn);
    } catch {
      // File was deleted while compression was starting.
    }
    return;
  }

  try {
    await compress(tmpIn, tmpOut, {
      codec: vc.codec,
      crf: vc.crf,
      preset: vc.preset,
      maxHeight: vc.maxHeight,
      maxBitrateKbps: vc.maxBitrateKbps,
      audioBitrateKbps: vc.audioBitrateKbps,
    });

    const stat = statSync(tmpOut);
    const buf = readFileSync(tmpOut);

    const sizeBefore = await datasource.size(compressedPath);
    if (sizeBefore || sizeBefore === 0) {
      await datasource.delete(compressedPath);
    }
    await datasource.put(compressedPath, buf, { mimetype: 'video/mp4' });

    const completed = await dbProxy<CompressedRow | null>('compressedFile.update', {
      where: { id: row.id },
      data: { size: BigInt(stat.size), status: 'done', error: null },
    });

    if (!completed) {
      await datasource.delete(compressedPath).catch(() => {});
      logger.debug('file deleted while compression was finishing', { id: file.id });
      return;
    }

    if (!vc.keepOriginal) {
      await datasource.delete(file.name);
      logger.debug('removed original (keepOriginal=false)', { id: file.id, path: file.name });
    }

    logger.info('compressed video', {
      id: file.id,
      original: bytes(Number(file.size)),
      compressed: bytes(stat.size),
      ratio: ((stat.size / Number(file.size)) * 100).toFixed(1) + '%',
    });
  } catch (err) {
    await dbProxy('compressedFile.update', {
      where: { id: row.id },
      data: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
    });
    logger.error('compression task failed', { id: file.id, err });
  } finally {
    for (const f of [tmpIn, tmpOut]) {
      try {
        unlinkSync(f);
      } catch {
        // already gone
      }
    }
  }
}

async function generate(config: Config, datasource: Datasource, ids: string[]) {
  for (const id of ids) {
    try {
      await processOne(config, datasource, id);
    } catch (err) {
      logger.error('processOne threw', { id, err: err instanceof Error ? err.message : String(err) });
    }
    // signal back to parent so it can fire deferred Discord webhook
    parentPort!.postMessage({ type: 'compressed', data: { id } });
  }
}

async function main() {
  getDatasource(config);
  const datasource = global.__datasource__;

  parentPort!.on('message', async (message) => {
    const { type, data } = message as { type: 0 | 1 | 'response'; data?: string[] };

    switch (type) {
      case 0:
        logger.debug('received compression request', { ids: data });
        try {
          await generate(config, datasource, data!);
        } catch (err) {
          logger.error('compression batch failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      case 1:
        logger.debug('received kill request');
        process.exit(0);
      case 'response':
        const { id, result } = message as { id: string; result: string };
        if (pending[id]) {
          try {
            pending[id](JSON.parse(result));
          } catch (e) {
            pending[id](null);
            console.error(e);
          }
          delete pending[id];
        }
        break;
      default:
        logger.error('unknown message type', { type, message });
        break;
    }
  });
}

main();
