import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function toNotificationResponse(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    message: n.message,
    relatedUserId: n.relatedUserId ?? null,
    relatedPostId: n.relatedPostId ?? null,
    relatedCommentId: n.relatedCommentId ?? null,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  };
}

router.get("/notifications", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);
  res.json(rows.map(toNotificationResponse));
});

router.get("/notifications/unread-count", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)));
  res.json({ count: row.c });
});

router.post("/notifications/read-all", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, user.id));
  res.json({ message: "All notifications marked as read" });
});

router.post("/notifications/:id/read", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(toNotificationResponse(updated));
});

export default router;
