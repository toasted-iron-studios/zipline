import { Config } from '@/lib/config/validate';
import { File } from '@/lib/db/models/file';
import { User } from '@/lib/db/models/user';
import { ParseValue } from '@/lib/parser';
import { log } from '@/lib/logger';
import { onUpload } from './index';

const logger = log('webhooks').c('deferred');

type Pending = {
  config: Config;
  user: User;
  file: File;
  link: NonNullable<ParseValue['link']>;
};

const pending = new Map<string, Pending>();

export function defer(fileId: string, p: Pending) {
  pending.set(fileId, p);
  logger.debug('deferred onUpload for file', { fileId });
}

export async function fire(fileId: string) {
  const p = pending.get(fileId);
  if (!p) return;
  pending.delete(fileId);

  try {
    await onUpload(p.config, { user: p.user, file: p.file, link: p.link });
    logger.debug('fired deferred onUpload', { fileId });
  } catch (err) {
    logger.error('deferred onUpload failed', {
      fileId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export function discard(fileId: string) {
  pending.delete(fileId);
}
