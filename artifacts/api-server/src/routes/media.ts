import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, mediaTable, dollsTable } from "@workspace/db";
import { UploadMediaBody, ModerateMediaParams, ModerateMediaBody } from "@workspace/api-zod";
import { isPremiumMediaType } from "@workspace/pricing";
import { requireAuth } from "../lib/auth";
import { finalizeMediaUrl, InvalidUploadError } from "../lib/imageUploads";
import { toMediaResponse } from "../lib/mappers";

const router: IRouter = Router();

router.post("/media", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Doll profile not found" });
    return;
  }
  const parsed = UploadMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (!data.containsHookah) {
    res.status(400).json({ error: "All Doll content must include a visible hookah. No hookah, no approval." });
    return;
  }
  let url = data.url;
  let thumbnailUrl = data.thumbnailUrl;
  try {
    url = await finalizeMediaUrl(url, user.id);
    if (thumbnailUrl) {
      thumbnailUrl = await finalizeMediaUrl(thumbnailUrl, user.id);
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  // `premium` is derived authoritatively from the media type — never trusted
  // from the client — so a forged `premium: false` can't sneak a premium media
  // item past the paywall.
  const premium = isPremiumMediaType(data.type);
  // Premium media must carry an explicit pricing tier so it is never silently
  // under-priced by type inference at unlock time.
  if (premium && !data.tier) {
    res.status(400).json({
      error: "Premium content requires a pricing tier (photo, bundle, video, or exclusive).",
    });
    return;
  }
  const [media] = await db
    .insert(mediaTable)
    .values({
      dollId: user.dollId,
      type: data.type,
      url,
      thumbnailUrl,
      caption: data.caption,
      premium,
      price: data.price ?? 0,
      tier: premium ? data.tier : null,
      containsHookah: data.containsHookah,
      status: "pending_review",
    })
    .returning();
  res.status(201).json(toMediaResponse(media));
});

router.get("/media/mine", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Doll profile not found" });
    return;
  }
  const rows = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.dollId, user.dollId))
    .orderBy(sql`${mediaTable.createdAt} desc`);
  res.json(rows.map((m) => toMediaResponse(m)));
});

router.get("/media/pending", requireAuth("admin"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({ media: mediaTable, dollName: dollsTable.stageName })
    .from(mediaTable)
    .leftJoin(dollsTable, eq(mediaTable.dollId, dollsTable.id))
    .where(eq(mediaTable.status, "pending_review"))
    .orderBy(sql`${mediaTable.createdAt} asc`);
  res.json(rows.map((r) => toMediaResponse(r.media, r.dollName ?? "")));
});

router.patch("/media/:id/moderate", requireAuth("admin"), async (req, res): Promise<void> => {
  const params = ModerateMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ModerateMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.decision === "approve" ? "approved" : "rejected";
  const [media] = await db
    .update(mediaTable)
    .set({ status, moderationNotes: parsed.data.notes ?? null })
    .where(eq(mediaTable.id, params.data.id))
    .returning();
  if (!media) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  if (status === "approved" && media.type === "profile") {
    await db.update(dollsTable).set({ profilePhotoUrl: media.url }).where(eq(dollsTable.id, media.dollId));
  }
  res.json(toMediaResponse(media));
});

export default router;
