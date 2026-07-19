import { z } from 'zod';

export const tagSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  name: true,
  color: true,
  userId: true,
  files: {
    select: {
      id: true,
    },
  },
};

export const tagSelectNoFiles = {
  id: true,
  createdAt: true,
  updatedAt: true,
  name: true,
  color: true,
  userId: true,
};

export const tagSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  name: z.string(),
  color: z.string(),
  userId: z.string().nullable(),
  files: z
    .array(
      z.object({
        id: z.string(),
      }),
    )
    .optional(),
});

export type Tag = z.infer<typeof tagSchema>;
