import { datasource } from '@/lib/datasource';
import { IntervalTask } from '..';

export default function cleanCompressed(prisma: typeof globalThis.__db__) {
  return async function (this: IntervalTask) {
    const fsCompressed = await datasource.list({ prefix: '.compressed.' });
    const dbCompressed = await prisma.compressedFile.findMany({
      select: { id: true, path: true },
    });

    const paths = new Set(dbCompressed.map((c) => c.path));
    const fsOrphaned = fsCompressed.filter((path) => !paths.has(path));

    for (const path of fsOrphaned) {
      try {
        await datasource.delete(path);
        this.logger.info('deleted orphaned compressed file', { path });
      } catch (err) {
        this.logger.error('failed to delete orphaned compressed file', { path, error: err });
      }
    }

    const fs = new Set(fsCompressed);
    const dbOrphaned = dbCompressed.filter((c) => !fs.has(c.path));

    for (const comp of dbOrphaned) {
      try {
        await prisma.compressedFile.delete({ where: { id: comp.id } });
        this.logger.info('deleted orphaned compressedFile row', { path: comp.path });
      } catch (err) {
        this.logger.error('failed to delete orphaned compressedFile row', {
          path: comp.path,
          error: err,
        });
      }
    }

    this.logger.debug('compressed cleanup complete', {
      fsChecked: fsCompressed.length,
      dbChecked: dbCompressed.length,
      fsDeleted: fsOrphaned.length,
      dbDeleted: dbOrphaned.length,
    });
  };
}
