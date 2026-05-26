import { IntervalTask, WorkerTask } from '..';

export function runVideoCompressWorkers(workers: WorkerTask[], files: string[]) {
  const fileToWorker: { id: string; worker: number }[] = [];

  let workerIndex = 0;
  const unique = new Set(files);
  for (const file of unique) {
    fileToWorker.push({ id: file, worker: workerIndex });
    workerIndex = (workerIndex + 1) % workers.length;
  }

  const ids = workers.map((_, i) => fileToWorker.filter((x) => x.worker === i).map((x) => x.id));

  for (let i = 0; i !== workers.length; ++i) {
    if (!ids[i].length) continue;
    workers[i].worker!.postMessage({ type: 0, data: ids[i] });
  }
}

export default function videoCompress(prisma: typeof globalThis.__db__) {
  return async function (this: IntervalTask, rerun = false) {
    const workers = this.tasks.tasks.filter(
      (x) => 'worker' in x && x.id.startsWith('videoCompress'),
    ) as unknown as WorkerTask[];

    if (!workers.length) return;

    if (rerun) this.logger.debug('re-running compression scan for all videos');

    const needed = await prisma.file.findMany({
      where: {
        ...(rerun ? {} : { compressed: { is: null } }),
        type: { startsWith: 'video/' },
        size: { gt: 0 },
      },
      select: { id: true },
    });

    if (!needed.length) return;

    this.logger.debug(`found ${needed.length} videos needing compression`);
    runVideoCompressWorkers(
      workers,
      needed.map((x) => x.id),
    );
  };
}
