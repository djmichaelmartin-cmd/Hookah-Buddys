import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, videoChatsTable, dollsTable, usersTable } from "@workspace/db";
import { RequestVideoChatBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function toSession(
  v: typeof videoChatsTable.$inferSelect,
  dollName: string,
  memberName: string,
) {
  return {
    id: v.id,
    dollId: v.dollId,
    dollName,
    memberId: v.memberUserId,
    memberName,
    scheduledAt: v.scheduledAt ? v.scheduledAt.toISOString() : undefined,
    status: v.status as "requested" | "confirmed" | "completed" | "canceled",
    ratePerMinute: v.ratePerMinute,
    durationMinutes: v.durationMinutes,
    createdAt: v.createdAt ? v.createdAt.toISOString() : undefined,
  };
}

router.get("/video-chats", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select({ v: videoChatsTable, dollName: dollsTable.stageName, memberName: usersTable.name })
    .from(videoChatsTable)
    .leftJoin(dollsTable, eq(videoChatsTable.dollId, dollsTable.id))
    .leftJoin(usersTable, eq(videoChatsTable.memberUserId, usersTable.id))
    .where(
      user.role === "doll" && user.dollId
        ? eq(videoChatsTable.dollId, user.dollId)
        : eq(videoChatsTable.memberUserId, user.id),
    )
    .orderBy(sql`${videoChatsTable.createdAt} desc`);
  res.json(rows.map((r) => toSession(r.v, r.dollName ?? "", r.memberName ?? "")));
});

router.post("/video-chats", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = RequestVideoChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, parsed.data.dollId));
  if (!doll) {
    res.status(404).json({ error: "Doll not found" });
    return;
  }
  const [v] = await db
    .insert(videoChatsTable)
    .values({
      memberUserId: user.id,
      dollId: parsed.data.dollId,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      durationMinutes: parsed.data.durationMinutes ?? 15,
      ratePerMinute: doll.videoChatRate,
      status: "requested",
    })
    .returning();
  res.status(201).json(toSession(v, doll.stageName, user.name));
});

export default router;
