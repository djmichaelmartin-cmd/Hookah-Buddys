import { db, notificationsTable } from "@workspace/db";

export async function createNotification(input: {
  userId: number;
  type: string;
  title: string;
  message: string;
  relatedUserId?: number | null;
  relatedPostId?: number | null;
  relatedCommentId?: number | null;
  relatedEventId?: number | null;
}): Promise<void> {
  await db.insert(notificationsTable).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    relatedUserId: input.relatedUserId ?? null,
    relatedPostId: input.relatedPostId ?? null,
    relatedCommentId: input.relatedCommentId ?? null,
    relatedEventId: input.relatedEventId ?? null,
  });
}
