import { ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db';

export async function validateUploadTags(tagIds?: string[], userId?: string) {
  if (!tagIds?.length) return [];
  if (!userId) throw new ApiError(2002);

  const tags = await prisma.tag.findMany({
    where: {
      id: { in: tagIds },
    },
    select: { id: true },
  });

  if (tags.length !== tagIds.length) throw new ApiError(1032);

  return tags;
}
