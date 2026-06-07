import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  contentUnlocksTable,
  mediaTable,
  dollsTable,
  creditTransactionsTable,
} from "@workspace/db";
import { UnlockContentBody } from "@workspace/api-zod";
import { unlockCreditCost } from "@workspace/pricing";
import { requireAuth } from "../lib/auth";
import { toMediaResponse } from "../lib/mappers";
import { spendCredits, AbortSpendError } from "../lib/credits";

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
  // Fail closed: only approved, paywalled media is unlockable. This prevents
  // charging for free content and blocks unlocking (and thereby viewing the URL
  // of) pending/rejected media by enumerating IDs.
  if (!media.premium) {
    res.status(400).json({ error: "This content is free and does not require an unlock." });
    return;
  }
  if (media.status !== "approved") {
    res.status(404).json({ error: "Content not found" });
    return;
  }
  const findExisting = () =>
    db
      .select()
      .from(contentUnlocksTable)
      .where(
        and(
          eq(contentUnlocksTable.memberUserId, user.id),
          eq(contentUnlocksTable.mediaId, media.id),
        ),
      );

  let unlock = (await findExisting())[0];
  if (!unlock) {
    // First-time unlock: atomically charge credits and create the unlock row in
    // one transaction. A DB unique constraint plus onConflictDoNothing makes
    // this idempotent under concurrent requests (no double-charge).
    const cost = unlockCreditCost(media.type, media.tier);
    try {
      const spend = await spendCredits(user.id, cost, async (tx) => {
        const [created] = await tx
          .insert(contentUnlocksTable)
          .values({
            memberUserId: user.id,
            mediaId: media.id,
            dollId: media.dollId,
            price: media.price,
          })
          .onConflictDoNothing({
            target: [contentUnlocksTable.memberUserId, contentUnlocksTable.mediaId],
          })
          .returning();
        if (!created) {
          // A concurrent request already unlocked this; roll back the charge.
          throw new AbortSpendError();
        }
        await tx.insert(creditTransactionsTable).values({
          userId: user.id,
          amount: -cost,
          type: "spend",
          description: "Unlocked premium content",
          dollId: media.dollId,
          mediaId: media.id,
        });
        return created;
      });
      if (!spend.ok) {
        // A concurrent request may have unlocked this while we were short on
        // credits; if so, return it rather than a misleading 402.
        const already = (await findExisting())[0];
        if (already) {
          unlock = already;
        } else {
          res.status(402).json({
            error: `Not enough credits — unlocking this content costs ${cost} credits. Please buy credits.`,
          });
          return;
        }
      } else {
        unlock = spend.result;
      }
    } catch (err) {
      if (err instanceof AbortSpendError) {
        unlock = (await findExisting())[0];
      } else {
        throw err;
      }
    }
  }
  if (!unlock) {
    res.status(500).json({ error: "Unlock could not be completed" });
    return;
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
