import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  photosTable,
  reelsTable,
  blocksTable,
  profileDetailsTable,
} from "@workspace/db";
import { ModeratePhotoBody, ModerateReelBody, ClearProfileFieldsBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { loadAuthors } from "../lib/feedHelpers";
import { PROFILE_DETAIL_FIELDS } from "../lib/socialHelpers";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

router.get("/admin/photos", requireAuth("admin"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const photos = await db
    .select()
    .from(photosTable)
    .where(status ? eq(photosTable.status, status) : undefined)
    .orderBy(desc(photosTable.createdAt))
    .limit(200);
  const { photosToAdminResponse } = await import("./photosAdminShared");
  res.json(await photosToAdminResponse(photos));
});

router.patch("/admin/photos/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = ModeratePhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(photosTable)
    .set({ status: parsed.data.status })
    .where(eq(photosTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  const { photosToAdminResponse } = await import("./photosAdminShared");
  const [result] = await photosToAdminResponse([updated]);
  res.json(result);
});

router.get("/admin/reels", requireAuth("admin"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const reels = await db
    .select()
    .from(reelsTable)
    .where(status ? eq(reelsTable.status, status) : undefined)
    .orderBy(desc(reelsTable.createdAt))
    .limit(200);
  const { reelsToAdminResponse } = await import("./photosAdminShared");
  res.json(await reelsToAdminResponse(reels));
});

router.patch("/admin/reels/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = ModerateReelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(reelsTable)
    .set({ status: parsed.data.status })
    .where(eq(reelsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Reel not found" });
    return;
  }
  const { reelsToAdminResponse } = await import("./photosAdminShared");
  const [result] = await reelsToAdminResponse([updated]);
  res.json(result);
});

router.get("/admin/profiles/:userId", requireAuth("admin"), async (req, res): Promise<void> => {
  const userId = parseId(req.params.userId);
  const { buildMyProfileDataForAdmin } = await import("./photosAdminShared");
  const data = await buildMyProfileDataForAdmin(userId);
  if (!data) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(data);
});

router.patch("/admin/profiles/:userId", requireAuth("admin"), async (req, res): Promise<void> => {
  const userId = parseId(req.params.userId);
  const parsed = ClearProfileFieldsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const valid = new Set<string>(PROFILE_DETAIL_FIELDS);
  const updates: Record<string, null> = {};
  for (const field of parsed.data.clearFields) {
    if (valid.has(field)) updates[field] = null;
  }
  if (Object.keys(updates).length > 0) {
    await db.update(profileDetailsTable).set(updates).where(eq(profileDetailsTable.userId, userId));
  }
  const { buildMyProfileDataForAdmin } = await import("./photosAdminShared");
  const data = await buildMyProfileDataForAdmin(userId);
  if (!data) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(data);
});

router.get("/admin/blocks", requireAuth("admin"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(blocksTable).orderBy(desc(blocksTable.createdAt)).limit(500);
  const ids = [...new Set(rows.flatMap((r) => [r.blockerId, r.blockedUserId]))];
  const authors = await loadAuthors(ids);
  res.json(
    rows.map((r) => ({
      id: r.id,
      blockerId: r.blockerId,
      blockerName: authors.get(r.blockerId)?.user?.name ?? "Unknown",
      blockedUserId: r.blockedUserId,
      blockedUserName: authors.get(r.blockedUserId)?.user?.name ?? "Unknown",
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

export default router;
