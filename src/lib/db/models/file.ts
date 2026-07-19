import { config } from '@/lib/config';
import { formatRootUrl } from '@/lib/url';
import { z } from 'zod';
import { tagSchema, tagSelectNoFiles } from './tag';

export const fileSelect = {
  createdAt: true,
  updatedAt: true,
  deletesAt: true,
  favorite: true,
  id: true,
  originalName: true,
  name: true,
  size: true,
  type: true,
  views: true,
  maxViews: true,
  folderId: true,
  anonymous: true,
  thumbnail: {
    select: {
      path: true,
    },
  },
  compressed: {
    select: {
      size: true,
      status: true,
    },
  },
  tags: {
    select: tagSelectNoFiles,
  },
};

export function cleanFile(file: File) {
  file.password = !!file.password;

  file.url = formatRootUrl(config.files.route, file.name);

  return file;
}

export function cleanFiles(files: File[], stringifyDates = false) {
  for (let i = 0; i !== files.length; ++i) {
    const file = files[i];
    if (file.password) file.password = true;

    if (stringifyDates) {
      if (file.createdAt instanceof Date) file.createdAt = file.createdAt.toISOString();
      if (file.updatedAt instanceof Date) file.updatedAt = file.updatedAt.toISOString();
      if (file.deletesAt && file.deletesAt instanceof Date) file.deletesAt = file.deletesAt.toISOString();
    }

    file.url = formatRootUrl(config.files.route, file.name);
  }

  return files;
}

export const fileSchema = z.object({
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()]),
  deletesAt: z.union([z.date(), z.string()]).nullable(),
  favorite: z.boolean(),
  id: z.string(),
  originalName: z.string().nullable(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
  views: z.number(),
  maxViews: z.number().nullish(),
  password: z.union([z.string(), z.boolean()]).nullish(),
  folderId: z.string().nullable(),
  anonymous: z.boolean().nullish(),

  User: z
    .object({
      id: z.string(),
      username: z.string(),
      role: z.enum(['USER', 'ADMIN', 'SUPERADMIN']),
    })
    .nullable()
    .optional(),

  thumbnail: z
    .object({
      path: z.string(),
    })
    .nullable(),

  compressed: z
    .object({
      size: z.number(),
      status: z.string(),
    })
    .nullable()
    .optional(),

  tags: z.array(tagSchema).optional(),

  url: z.string().optional(),
  similarity: z.number().optional(),
});

export type File = z.infer<typeof fileSchema>;
