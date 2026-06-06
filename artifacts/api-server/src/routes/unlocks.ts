import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, contentUnlocksTable, mediaTable, dollsTable } from "@workspace/db";
import { UnlockContentBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { toMediaResponse } from "../lib/mappers";

const router: IRouter = Router();

router.get("/unlocks", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select({ unlock: contentUnlocksTable, media: mediaTable, dollName: dollsTable.stageName })
    .from(contentUnlocksTable)
    .leftJoin(mediaTable, eq(contentUnlocksTable.mediaId, mediaTable.id))
    .leftJoin(dollsTable, eq(contentUnlocksTable.dollId, dollsTable.id))
    .where(eq(contentUnlocksTable.memberUserId, user.id))
    .orderBy(sql`${contentUnlocksTable.createdAt} desc`);
  res.json(
    rows.map((r) => ({
      id: r.unlock.id,
      mediaId: r.unlock.mediaId,
      dollId: r.unlock.dollId,
      media: r.media ? toMediaResponse(r.media, r.dollName ?? "") : undefined,
      createdAt: r.unlock.createdAt ? r.unlock.createdAt.toISOString() : undefined,
    })),
  );
});

router.post("/unlocks", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = UnlockContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [media] = await db.select().from(mediaTable).where(eq(mediaTable.id, parsed.data.mediaId));
  if (!media) {
    res.status(404).json({ error: "Content not found" });
    return;
  }
  const existing = await db
    .select()
    .from(contentUnlocksTable)
    .where(
      and(eq(contentUnlocksTable.memberUserId, user.id), eq(contentUnlocksTable.mediaId, media.id)),
    );
  let unlock = existing[0];
  if (!unlock) {
    [unlock] = await db
      .insert(contentUnlocksTable)
      .values({ memberUserId: user.id, mediaId: media.id, dollId: media.dollId, price: media.price })
      .returning();
  }
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, media.dollId));
  res.status(201).json({
    id: unlock.id,
    mediaId: unlock.mediaId,
    dollId: unlock.dollId,
    media: toMediaResponse(media, doll?.stageName ?? ""),
    createdAt: unlock.createdAt ? unlock.createdAt.toISOString() : undefined,
  });
});

export default router;
