import { verifyAccessToken } from '@/lib/accessToken';
import { ApiError } from '@/lib/api/errors';
import { parseRange } from '@/lib/api/range';
import { config } from '@/lib/config';
import { datasource } from '@/lib/datasource';
import { prisma } from '@/lib/db';
import { log } from '@/lib/logger';
import { guess } from '@/lib/mimes';
import { TimedCache } from '@/lib/timedCache';
import typedPlugin from '@/server/typedPlugin';
import { FastifyReply, FastifyRequest } from 'fastify';

const VIEW_WINDOW = 5 * 1000;
const viewsCache = new TimedCache<string, number>(VIEW_WINDOW);

type Params = {
  id: string;
};

type Querystring = {
  token?: string;
  download?: string;
};

const logger = log('routes').c('raw');

export const rawFileHandler = async (
  req: FastifyRequest<{
    Params: Params;
    Querystring: Querystring;
  }>,
  res: FastifyReply,
) => {
  const { id } = req.params;
  const { token, download } = req.query;

  if (id.startsWith('.thumbnail')) {
    const thumbnail = await prisma.thumbnail.findFirst({
      where: {
        path: id,
      },
    });

    if (!thumbnail) return res.callNotFound();

    const size = await datasource.size(thumbnail.path);
    if (!size) return res.callNotFound();

    const buf = await datasource.get(thumbnail.path);
    if (!buf) return res.callNotFound();

    return res
      .type(await guess(thumbnail.path.replace('.thumbnail-', '').split('.').pop() || 'jpg'))
      .headers({
        'Content-Length': size,
      })
      .status(200)
      .send(buf);
  }

  const wantsOriginal = (req.query as { original?: string }).original === '1';

  const file = await prisma.file.findFirst({
    where: {
      name: decodeURIComponent(id),
    },
    include: { compressed: true },
  });
  if (!file) return res.callNotFound();

  // If a successfully-compressed sibling exists and the caller didn't explicitly
  // ask for the original, transparently serve the compressed mp4 — same URL,
  // smaller payload, Discord-embeddable.
  const useCompressed = !wantsOriginal && file.compressed?.status === 'done';
  const servedPath = useCompressed ? file.compressed!.path : file.name;
  const servedType = useCompressed ? 'video/mp4' : file.type;
  const servedSize = useCompressed ? Number(file.compressed!.size) : Number(file.size);

  if (file?.deletesAt && file.deletesAt <= new Date()) {
    try {
      await datasource.delete(file.name);
      await datasource.delete(`.compressed.${file.id}.mp4`).catch(() => {});
      await prisma.file.delete({
        where: {
          id: file.id,
        },
      });
    } catch (e) {
      logger.error('failed to delete file on expiration', { id: file.id }).error(e as Error);
    }
    return res.callNotFound();
  }

  if (file?.password) {
    const valid = verifyAccessToken(token, 'file', file.id);
    if (!valid) throw new ApiError(3018);
  }

  const size = servedSize || (await datasource.size(servedPath));

  // view stuff
  const now = Date.now();
  const isView = !req.headers.range || req.headers.range.startsWith('bytes=0');
  const key = `${req.ip}-${req.headers['user-agent'] ?? 'unknown'}-${file.id}`;
  const last = viewsCache.get(key) || 0;

  const canCountView = isView && now - last > VIEW_WINDOW;
  const updatedViews = (file.views || 0) + (canCountView ? 1 : 0);

  // check using future values
  if (file.maxViews && updatedViews > file.maxViews) {
    if (config.features.deleteOnMaxViews) {
      try {
        await datasource.delete(file.name);
        await datasource.delete(`.compressed.${file.id}.mp4`).catch(() => {});
        await prisma.file.delete({
          where: { id: file.id },
        });
      } catch (e) {
        logger.error('failed to delete file on max views', { id: file.id }).error(e as Error);
      }
    }
    return res.callNotFound();
  }

  const countView = async () => {
    if (!file || !canCountView) return;
    viewsCache.set(key, now);

    try {
      await prisma.file.update({
        where: { id: file.id },
        data: { views: { increment: 1 } },
      });
    } catch (e) {
      logger.error('failed to increment view counter', { id: file.id }).error(e as Error);
    }
  };

  const fileType = servedType || 'application/octet-stream';
  const contentType = fileType.startsWith('text/') ? `${fileType}; charset=utf-8` : fileType;

  if (req.headers.range) {
    const [start, end] = parseRange(req.headers.range, size);
    if (start >= size || end >= size) {
      const buf = await datasource.get(servedPath);
      if (!buf) return res.callNotFound();

      await countView();

      return res
        .type(contentType)
        .headers({
          'Content-Length': size,
          ...(file?.originalName
            ? {
                'Content-Disposition': `${download ? 'attachment; ' : ''}filename*=utf-8''${encodeURIComponent(file.originalName)}`,
              }
            : download && { 'Content-Disposition': 'attachment;' }),
        })
        .status(416)
        .send(buf);
    }

    const buf = await datasource.range(servedPath, start || 0, end);
    if (!buf) return res.callNotFound();

    await countView();

    return res
      .type(contentType)
      .headers({
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        ...(file?.originalName
          ? {
              'Content-Disposition': `${download ? 'attachment; ' : ''}filename*=utf-8''${encodeURIComponent(file.originalName)}`,
            }
          : download && { 'Content-Disposition': 'attachment;' }),
      })
      .status(206)
      .send(buf);
  }

  const buf = await datasource.get(servedPath);
  if (!buf) return res.callNotFound();

  await countView();

  return res
    .type(contentType)
    .headers({
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      ...(file?.originalName
        ? {
            'Content-Disposition': `${download ? 'attachment; ' : ''}filename*=utf-8''${encodeURIComponent(file.originalName)}`,
          }
        : download && { 'Content-Disposition': 'attachment;' }),
    })
    .status(200)
    .send(buf);
};

export const PATH = '/raw/:id';
export default typedPlugin(
  async (server) => {
    server.get(PATH, rawFileHandler);
  },
  { name: PATH },
);
