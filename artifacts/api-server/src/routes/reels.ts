import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, asc, sql, inArray, or, ilike, ne } from "drizzle-orm";
import {
  db,
  reelsTable,
  reelLikesTable,
  reelSavesTable,
  reelCommentsTable,
  userTagsTable,
  postReportsTable,
  feedPostsTable,
  photosTable,
  photoAlbumsTable,
  usersTable,
  businessesTable,
  businessPageRolesTable,
  dollsTable,
  type Reel,
} from "@workspace/db";
import {
  CreateReelBody,
  CreateReelCommentBody,
  ReportReelBody,
  CreateUserTagBody,
  ReviewUserTagBody,
} from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import { requireCompleteBuddyProfile } from "../lib/buddyProfile";
import {
  assertOwnedStorageObject,
  getValidatedSparkUpload,
  InvalidUploadError,
  publishSparkUpload,
  toObjectEntityPath,
} from "../lib/imageUploads";
import { loadAuthors, feedPostBusinessVisible } from "../lib/feedHelpers";
import {
  getRelationship,
  canView,
  parseJsonArray,
  getOrCreatePrivacySettings,
  loadAudienceSets,
  canViewAudience,
  type Relationship,
} from "../lib/socialHelpers";
import { createNotification } from "../lib/notify";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { streamValidatedObject } from "./storage";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

async function reelsToResponse(reels: Reel[], viewerId: number | null) {
  const authorIds = [...new Set(reels.map((r) => r.userId))];
  const businessIds = [...new Set(reels.flatMap((r) => (r.businessId == null ? [] : [r.businessId])))];
  const authors = await loadAuthors(authorIds);
  const likedSet = new Set<number>();
  const savedSet = new Set<number>();
  const followSet = new Set<number>();
  const approvedPeopleTags = new Map<number, number[]>();
  const activeBusinesses = new Map<number, {
    name: string;
    handle: string;
    logoUrl: string | null;
  }>();
  if (businessIds.length) {
    const rows = await db
      .select({
        id: businessesTable.id,
        name: businessesTable.name,
        handle: businessesTable.handle,
        logoUrl: businessesTable.logoUrl,
      })
      .from(businessesTable)
      .where(and(inArray(businessesTable.id, businessIds), eq(businessesTable.status, "active")));
    rows.forEach((business) => activeBusinesses.set(business.id, business));
  }
  if (reels.length) {
    const tags = await db
      .select()
      .from(userTagsTable)
      .where(
        and(
          eq(userTagsTable.relatedType, "reel"),
          eq(userTagsTable.status, "approved"),
          inArray(userTagsTable.relatedId, reels.map((reel) => reel.id)),
        ),
      );
    for (const tag of tags) {
      const ids = approvedPeopleTags.get(tag.relatedId) ?? [];
      ids.push(tag.taggedUserId);
      approvedPeopleTags.set(tag.relatedId, ids);
    }
  }
  if (viewerId != null && reels.length) {
    const ids = reels.map((r) => r.id);
    const [likes, saves] = await Promise.all([
      db
        .select()
        .from(reelLikesTable)
        .where(and(eq(reelLikesTable.userId, viewerId), inArray(reelLikesTable.reelId, ids))),
      db
        .select()
        .from(reelSavesTable)
        .where(and(eq(reelSavesTable.userId, viewerId), inArray(reelSavesTable.reelId, ids))),
    ]);
    likes.forEach((l) => likedSet.add(l.reelId));
    saves.forEach((s) => savedSet.add(s.reelId));
    const { followsTable } = await import("@workspace/db");
    const follows = await db
      .select()
      .from(followsTable)
      .where(and(eq(followsTable.followerId, viewerId), inArray(followsTable.followingId, authorIds)));
    follows.forEach((f) => followSet.add(f.followingId));
  }
  return reels.map((r) => {
    const a = authors.get(r.userId);
    const business = r.businessId == null ? undefined : activeBusinesses.get(r.businessId);
    return {
      id: r.id,
      userId: r.userId,
      userRole: r.userRole,
      userName: a?.user?.name ?? "Unknown",
      username: a?.user?.username ?? null,
      userPhotoUrl: a?.user?.profilePhotoUrl ?? null,
      buddyType: a?.user?.buddyType ?? null,
      userVerified: a?.dollVerified ?? false,
      dollId: a?.user?.dollId ?? null,
      videoUrl:
        r.visibility === "public" || !toObjectEntityPath(r.videoUrl)
          ? r.videoUrl
          : `/api/reels/${r.id}/media/video`,
      thumbnailUrl:
        !r.thumbnailUrl || r.visibility === "public" || !toObjectEntityPath(r.thumbnailUrl)
          ? r.thumbnailUrl ?? null
          : `/api/reels/${r.id}/media/poster`,
      caption: r.caption ?? null,
      category: r.category,
      hashtags: parseJsonArray(r.hashtags),
      peopleTags: approvedPeopleTags.get(r.id) ?? [],
      businessId: r.businessId ?? null,
      businessName: business?.name ?? null,
      businessHandle: business?.handle ?? null,
      businessLogoUrl: business?.logoUrl ?? null,
      location: r.location ?? null,
      feeling: r.feeling ?? null,
      visibility: r.visibility,
      commentsEnabled: r.commentsEnabled,
      sharingEnabled: r.sharingEnabled,
      status: r.status,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
      saveCount: r.saveCount,
      reportCount: r.reportCount,
      viewerLiked: likedSet.has(r.id),
      viewerSaved: savedSet.has(r.id),
      viewerFollowsAuthor: followSet.has(r.userId),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

router.get("/reels", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : null;
  const rawDollId = typeof req.query.dollId === "string" ? req.query.dollId : null;
  const dollId = rawDollId && /^\d+$/.test(rawDollId) ? Number(rawDollId) : null;
  const businessId = typeof req.query.businessId === "string" ? parseInt(req.query.businessId, 10) : null;
  const category = typeof req.query.category === "string" ? req.query.category : null;
  const visibility = typeof req.query.visibility === "string" ? req.query.visibility : null;
  const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
  if (rawSearch.length > 100) {
    res.status(400).json({ error: "search must be 100 characters or fewer" });
    return;
  }
  if (visibility && !["public", "friends", "only_me"].includes(visibility)) {
    res.status(400).json({ error: "visibility must be public, friends, or only_me" });
    return;
  }
  if (rawDollId !== null && (dollId == null || dollId < 1)) {
    res.status(400).json({ error: "dollId must be a positive integer" });
    return;
  }
  const search = rawSearch.trim();
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    100,
  );
  const conditions = [eq(reelsTable.status, "active")];
  if (userId != null && !Number.isNaN(userId)) conditions.push(eq(reelsTable.userId, userId));
  if (dollId != null) {
    // Filter through the approved Doll profile's user ownership relation rather
    // than exposing or trusting a generic userId on a Doll response.
    conditions.push(
      inArray(
        reelsTable.userId,
        db
          .select({ userId: dollsTable.userId })
          .from(dollsTable)
          .where(
            and(
              eq(dollsTable.id, dollId),
              eq(dollsTable.applicationStatus, "approved"),
            ),
          ),
      ),
    );
  }
  if (businessId != null && !Number.isNaN(businessId)) conditions.push(eq(reelsTable.businessId, businessId));
  if (category) conditions.push(eq(reelsTable.category, category));
  // This narrows candidates only. The relationship/block/canView checks below
  // remain mandatory, including for Lounge's visibility=public widgets.
  if (visibility) conditions.push(eq(reelsTable.visibility, visibility));
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(reelsTable.caption, pattern),
        ilike(reelsTable.hashtags, pattern),
      )!,
    );
  }
  const reels = await db
    .select()
    .from(reelsTable)
    .where(and(...conditions))
    .orderBy(desc(reelsTable.createdAt))
    .limit(limit * 2);
  // Visibility filtering per author
  const relCache = new Map<number, Awaited<ReturnType<typeof getRelationship>>>();
  const visible: Reel[] = [];
  for (const r of reels) {
    if (visible.length >= limit) break;
    if (r.visibility === "public" && viewer?.role === "admin") {
      visible.push(r);
      continue;
    }
    let rel = relCache.get(r.userId);
    if (!rel) {
      rel = await getRelationship(viewer ?? null, r.userId);
      relCache.set(r.userId, rel);
    }
    if (rel.targetBlockedViewer || rel.viewerBlockedTarget) continue;
    if (canView(r.visibility, rel)) visible.push(r);
  }
  res.json(await reelsToResponse(visible, viewer?.id ?? null));
});

router.post("/reels", requireAuth(), requireCompleteBuddyProfile, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateReelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.businessId != null) {
    const [[business], [role]] = await Promise.all([
      db.select().from(businessesTable).where(eq(businessesTable.id, parsed.data.businessId)),
      db
        .select()
        .from(businessPageRolesTable)
        .where(
          and(
            eq(businessPageRolesTable.businessId, parsed.data.businessId),
            eq(businessPageRolesTable.userId, user.id),
          ),
        ),
    ]);
    if (!business || business.status !== "active") {
      res.status(400).json({ error: "Business Page not found or inactive" });
      return;
    }
    if (!role || !["owner", "admin", "editor"].includes(role.role)) {
      res.status(403).json({ error: "You cannot create Sparks for this Business Page" });
      return;
    }
  }

  const peopleTags = parsed.data.peopleTags ?? [];
  const preparedTags: Array<{ taggedUserId: number; status: "pending" | "approved" }> = [];
  if (peopleTags.length) {
    const tagTargets = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.id, peopleTags));
    if (tagTargets.length !== peopleTags.length) {
      res.status(400).json({ error: "One or more tagged users do not exist" });
      return;
    }
    for (const taggedUserId of peopleTags) {
      const rel = await getRelationship(user, taggedUserId);
      if (rel.viewerBlockedTarget || rel.targetBlockedViewer) {
        res.status(400).json({ error: "Unable to tag this user" });
        return;
      }
      const settings = await getOrCreatePrivacySettings(taggedUserId);
      if (settings.allowTagging === "no_one" && !rel.isSelf) {
        res.status(400).json({ error: "One or more users do not allow tagging" });
        return;
      }
      if (settings.allowTagging === "friends" && !rel.isFriend && !rel.isSelf) {
        res.status(400).json({ error: "One or more users only allow tags from Buddys" });
        return;
      }
      preparedTags.push({
        taggedUserId,
        status: settings.requireTagReview === "true" && !rel.isSelf ? "pending" : "approved",
      });
    }
  }
  let videoUrl: string;
  let thumbnailUrl: string;
  try {
    // Only canonical endpoint uploads carry the server-written duration
    // marker and paired poster reference. Generic/raw/external URLs cannot
    // become new Sparks.
    const upload = await getValidatedSparkUpload(parsed.data.videoUrl, user.id);
    videoUrl = upload.videoUrl;
    thumbnailUrl = upload.posterUrl;
    if (parsed.data.thumbnailUrl) {
      await assertOwnedStorageObject(parsed.data.thumbnailUrl, user.id);
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const [reel] = await db
    .insert(reelsTable)
    .values({
      userId: user.id,
      userRole: user.role,
      videoUrl,
      thumbnailUrl,
      caption: parsed.data.caption ?? null,
      category: parsed.data.category ?? "other",
      hashtags: parsed.data.hashtags ? JSON.stringify(parsed.data.hashtags) : null,
      peopleTags: peopleTags.length ? JSON.stringify(peopleTags) : null,
      businessId: parsed.data.businessId ?? null,
      location: parsed.data.location ?? null,
      feeling: parsed.data.feeling ?? null,
      visibility: parsed.data.visibility ?? "public",
      commentsEnabled: parsed.data.commentsEnabled ?? true,
      sharingEnabled: parsed.data.sharingEnabled ?? true,
    })
    .returning();
  if (reel.visibility === "public") {
    await publishSparkUpload(videoUrl, thumbnailUrl, user.id);
  }
  if (preparedTags.length) {
    await db.insert(userTagsTable).values(
      preparedTags.map((tag) => ({
        ...tag,
        taggedByUserId: user.id,
        relatedType: "reel",
        relatedId: reel.id,
      })),
    );
    await Promise.all(
      preparedTags
        .filter((tag) => tag.taggedUserId !== user.id)
        .map((tag) =>
          createNotification({
            userId: tag.taggedUserId,
            type: "tag",
            title: tag.status === "pending" ? "Tag pending your review" : "You were tagged",
            message: `${user.name} tagged you in a Spark`,
            relatedUserId: user.id,
            relatedReelId: reel.id,
          }),
        ),
    );
  }
  const [result] = await reelsToResponse([reel], user.id);
  res.status(201).json(result);
});

// These literal selector routes must remain before /reels/:id so Express never
// treats their names as a legacy reel identifier.
router.get("/reels/taggable-users", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
  if (rawSearch.length > 100) {
    res.status(400).json({ error: "search must be 100 characters or fewer" });
    return;
  }
  const search = rawSearch.trim();
  const conditions = [
    eq(usersTable.accountStatus, "active"),
    ne(usersTable.id, user.id),
  ];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(usersTable.name, pattern), ilike(usersTable.username, pattern))!);
  }
  const candidates = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
      profilePhotoUrl: usersTable.profilePhotoUrl,
    })
    .from(usersTable)
    .where(and(...conditions))
    .orderBy(asc(usersTable.name), asc(usersTable.id))
    .limit(100);

  const taggable: Array<{
    id: number;
    name: string;
    username: string | null;
    profilePhotoUrl: string | null;
  }> = [];
  for (const candidate of candidates) {
    const relationship = await getRelationship(user, candidate.id);
    if (relationship.viewerBlockedTarget || relationship.targetBlockedViewer) continue;
    const settings = await getOrCreatePrivacySettings(candidate.id);
    if (settings.allowTagging === "no_one") continue;
    if (settings.allowTagging === "friends" && !relationship.isFriend) continue;
    taggable.push(candidate);
    if (taggable.length === 50) break;
  }
  res.json(taggable);
});

router.get("/reels/editable-businesses", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rawSearch = typeof req.query.search === "string" ? req.query.search : "";
  if (rawSearch.length > 100) {
    res.status(400).json({ error: "search must be 100 characters or fewer" });
    return;
  }
  const search = rawSearch.trim();
  const conditions = [
    eq(businessesTable.status, "active"),
    eq(businessPageRolesTable.userId, user.id),
    inArray(businessPageRolesTable.role, ["owner", "admin", "editor"]),
  ];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(businessesTable.name, pattern), ilike(businessesTable.handle, pattern))!);
  }
  const businesses = await db
    .select({
      id: businessesTable.id,
      name: businessesTable.name,
      handle: businessesTable.handle,
      logoUrl: businessesTable.logoUrl,
      isPublished: businessesTable.isPublished,
    })
    .from(businessesTable)
    .innerJoin(
      businessPageRolesTable,
      eq(businessPageRolesTable.businessId, businessesTable.id),
    )
    .where(and(...conditions))
    .orderBy(asc(businessesTable.name), asc(businessesTable.id))
    .limit(50);
  res.json(businesses);
});

const reelMediaObjectStorage = new ObjectStorageService();

async function serveReelMedia(
  req: Request,
  res: Response,
  field: "videoUrl" | "thumbnailUrl",
): Promise<void> {
  const viewer = await getSessionUser(req);
  const id = parseId(req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active" || !(await viewerCanSeeReel(reel, viewer ?? null))) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  const objectPath = toObjectEntityPath(reel[field] ?? "");
  if (!objectPath) {
    res.status(404).json({ error: "Spark media not found" });
    return;
  }
  try {
    const objectFile = await reelMediaObjectStorage.getObjectEntityFile(objectPath);
    await streamValidatedObject(objectFile, req, res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Spark media not found" });
      return;
    }
    throw error;
  }
}

router.get("/reels/:id/media/video", async (req, res): Promise<void> => {
  await serveReelMedia(req, res, "videoUrl");
});

router.get("/reels/:id/media/poster", async (req, res): Promise<void> => {
  await serveReelMedia(req, res, "thumbnailUrl");
});

router.get("/reels/:id", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const id = parseId(req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active") {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  const rel = await getRelationship(viewer ?? null, reel.userId);
  if (((rel.targetBlockedViewer || rel.viewerBlockedTarget) && !rel.isSelf && !rel.isAdmin) || !canView(reel.visibility, rel)) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  const [result] = await reelsToResponse([reel], viewer?.id ?? null);
  res.json(result);
});

router.delete("/reels/:id", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  if (reel.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only delete your own Sparks" });
    return;
  }
  await db.delete(reelLikesTable).where(eq(reelLikesTable.reelId, id));
  await db.delete(reelSavesTable).where(eq(reelSavesTable.reelId, id));
  await db.delete(reelCommentsTable).where(eq(reelCommentsTable.reelId, id));
  await db.delete(reelsTable).where(eq(reelsTable.id, id));
  res.sendStatus(204);
});

export function relationshipCanSeeReel(
  reel: { visibility: string },
  rel: Relationship,
): boolean {
  if (rel.isSelf || rel.isAdmin) return true;
  if (rel.viewerBlockedTarget || rel.targetBlockedViewer) return false;
  return canView(reel.visibility, rel);
}

async function viewerCanSeeReel(
  reel: { userId: number; visibility: string },
  viewer: { id: number; role: string } | null,
): Promise<boolean> {
  return relationshipCanSeeReel(reel, await getRelationship(viewer, reel.userId));
}

router.post("/reels/:id/like", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active" || !(await viewerCanSeeReel(reel, user))) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(reelLikesTable)
    .where(and(eq(reelLikesTable.reelId, id), eq(reelLikesTable.userId, user.id)));
  let liked: boolean;
  if (existing) {
    const deleted = await db.delete(reelLikesTable).where(eq(reelLikesTable.id, existing.id)).returning();
    if (deleted.length > 0) {
      await db
        .update(reelsTable)
        .set({ likeCount: sql`greatest(${reelsTable.likeCount} - 1, 0)` })
        .where(eq(reelsTable.id, id));
    }
    liked = false;
  } else {
    const inserted = await db
      .insert(reelLikesTable)
      .values({ reelId: id, userId: user.id })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      await db
        .update(reelsTable)
        .set({ likeCount: sql`${reelsTable.likeCount} + 1` })
        .where(eq(reelsTable.id, id));
      if (reel.userId !== user.id) {
        await createNotification({
          userId: reel.userId,
          type: "reel_like",
          title: "New like",
          message: `${user.name} liked your Spark`,
          relatedUserId: user.id,
          relatedReelId: reel.id,
        });
      }
    }
    liked = true;
  }
  const [updated] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  res.json({ liked, likeCount: updated.likeCount });
});

router.post("/reels/:id/save", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active" || !(await viewerCanSeeReel(reel, user))) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(reelSavesTable)
    .where(and(eq(reelSavesTable.reelId, id), eq(reelSavesTable.userId, user.id)));
  let saved: boolean;
  if (existing) {
    const deleted = await db.delete(reelSavesTable).where(eq(reelSavesTable.id, existing.id)).returning();
    if (deleted.length > 0) {
      await db
        .update(reelsTable)
        .set({ saveCount: sql`greatest(${reelsTable.saveCount} - 1, 0)` })
        .where(eq(reelsTable.id, id));
    }
    saved = false;
  } else {
    const inserted = await db
      .insert(reelSavesTable)
      .values({ reelId: id, userId: user.id })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      await db
        .update(reelsTable)
        .set({ saveCount: sql`${reelsTable.saveCount} + 1` })
        .where(eq(reelsTable.id, id));
    }
    saved = true;
  }
  const [updated] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  res.json({ saved, saveCount: updated.saveCount });
});

router.post("/reels/:id/view", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!Number.isNaN(id)) {
    const viewer = await getSessionUser(req);
    const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
    if (reel && reel.status === "active" && (await viewerCanSeeReel(reel, viewer ?? null))) {
      await db
        .update(reelsTable)
        .set({ viewCount: sql`${reelsTable.viewCount} + 1` })
        .where(eq(reelsTable.id, id));
    }
  }
  res.sendStatus(204);
});

router.post("/reels/:id/report", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = ReportReelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || !(await viewerCanSeeReel(reel, user))) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  await db.insert(postReportsTable).values({
    targetType: "reel",
    postId: null,
    commentId: null,
    reporterId: user.id,
    reason: parsed.data.reason,
    notes: `reelId=${id}${parsed.data.notes ? ` — ${parsed.data.notes}` : ""}`,
  });
  await db
    .update(reelsTable)
    .set({ reportCount: sql`${reelsTable.reportCount} + 1` })
    .where(eq(reelsTable.id, id));
  res.status(201).json({ message: "Report submitted" });
});

router.get("/reels/:id/comments", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const viewer = await getSessionUser(req);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active" || !(await viewerCanSeeReel(reel, viewer ?? null))) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  const comments = await db
    .select()
    .from(reelCommentsTable)
    .where(and(eq(reelCommentsTable.reelId, id), eq(reelCommentsTable.status, "active")))
    .orderBy(reelCommentsTable.createdAt);
  const authors = await loadAuthors([...new Set(comments.map((c) => c.userId))]);
  res.json(
    comments.map((c) => {
      const a = authors.get(c.userId);
      return {
        id: c.id,
        postId: c.reelId,
        userId: c.userId,
        userName: a?.user?.name ?? "Unknown",
        username: a?.user?.username ?? null,
        userPhotoUrl: a?.user?.profilePhotoUrl ?? null,
        buddyType: a?.user?.buddyType ?? null,
        userRole: a?.user?.role ?? "member",
        userVerified: a?.dollVerified ?? false,
        commentText: c.commentText,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      };
    }),
  );
});

router.post("/reels/:id/comments", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = CreateReelCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active" || !(await viewerCanSeeReel(reel, user))) {
    res.status(404).json({ error: "Spark not found" });
    return;
  }
  if (!reel.commentsEnabled) {
    res.status(403).json({ error: "Comments are disabled for this Spark" });
    return;
  }
  const [comment] = await db
    .insert(reelCommentsTable)
    .values({ reelId: id, userId: user.id, commentText: parsed.data.commentText })
    .returning();
  await db
    .update(reelsTable)
    .set({ commentCount: sql`${reelsTable.commentCount} + 1` })
    .where(eq(reelsTable.id, id));
  if (reel.userId !== user.id) {
    await createNotification({
      userId: reel.userId,
      type: "reel_comment",
      title: "New comment",
      message: `${user.name} commented on your Spark`,
      relatedUserId: user.id,
      relatedReelId: reel.id,
    });
  }
  const authors = await loadAuthors([user.id]);
  const a = authors.get(user.id);
  res.status(201).json({
    id: comment.id,
    postId: comment.reelId,
    userId: comment.userId,
    userName: user.name,
    username: user.username ?? null,
    userPhotoUrl: user.profilePhotoUrl ?? null,
    buddyType: user.buddyType ?? null,
    userRole: user.role,
    userVerified: a?.dollVerified ?? false,
    commentText: comment.commentText,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
  });
});

router.delete("/reels/comments/:id", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [comment] = await db.select().from(reelCommentsTable).where(eq(reelCommentsTable.id, id));
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  if (comment.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only delete your own comments" });
    return;
  }
  await db.delete(reelCommentsTable).where(eq(reelCommentsTable.id, id));
  await db
    .update(reelsTable)
    .set({ commentCount: sql`greatest(${reelsTable.commentCount} - 1, 0)` })
    .where(eq(reelsTable.id, comment.reelId));
  res.sendStatus(204);
});

// ---- User tags ----

async function tagToResponse(t: typeof userTagsTable.$inferSelect) {
  const authors = await loadAuthors([t.taggedUserId, t.taggedByUserId]);
  return {
    id: t.id,
    taggedUserId: t.taggedUserId,
    taggedUserName: authors.get(t.taggedUserId)?.user?.name ?? "Unknown",
    taggedByUserId: t.taggedByUserId,
    taggedByUserName: authors.get(t.taggedByUserId)?.user?.name ?? "Unknown",
    relatedType: t.relatedType,
    relatedId: t.relatedId,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  };
}

router.get("/usertags", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : NaN;
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const tags = await db
    .select()
    .from(userTagsTable)
    .where(and(eq(userTagsTable.taggedUserId, userId), eq(userTagsTable.status, "approved")))
    .orderBy(desc(userTagsTable.createdAt));
  const audienceSets = await loadAudienceSets(viewer?.id ?? null);
  const visibleTags = [];
  for (const tag of tags) {
    if (await viewerCanSeeTaggedTarget(tag, viewer ?? null, audienceSets)) {
      visibleTags.push(tag);
    }
  }
  res.json(await Promise.all(visibleTags.map(tagToResponse)));
});

/**
 * User-tag discovery must not disclose a target that the current viewer could
 * not open directly. Keep these checks beside /usertags because this endpoint
 * can return tags for more than one private target type.
 */
async function viewerCanSeeTaggedTarget(
  tag: typeof userTagsTable.$inferSelect,
  viewer: { id: number; role: string } | null,
  audienceSets: Awaited<ReturnType<typeof loadAudienceSets>>,
): Promise<boolean> {
  if (tag.relatedType === "reel") {
    const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, tag.relatedId));
    return !!reel && reel.status === "active" && await viewerCanSeeReel(reel, viewer);
  }
  if (tag.relatedType === "post") {
    const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, tag.relatedId));
    if (!post || post.status === "removed") return false;
    if (post.status !== "active" && viewer?.id !== post.userId && viewer?.role !== "admin") {
      return false;
    }
    return (await feedPostBusinessVisible(post)) &&
      canViewAudience(post.audience, post.userId, viewer, audienceSets);
  }
  if (tag.relatedType === "photo") {
    const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, tag.relatedId));
    if (!photo || photo.status !== "active") return false;
    const relationship = await getRelationship(viewer, photo.userId);
    if (!relationship.isSelf && !relationship.isAdmin) {
      if (relationship.viewerBlockedTarget || relationship.targetBlockedViewer) return false;
      if (!canView(photo.visibility, relationship)) return false;
    }
    const [album] = await db
      .select()
      .from(photoAlbumsTable)
      .where(eq(photoAlbumsTable.id, photo.albumId));
    return canView(album?.visibility ?? "public", relationship);
  }
  return false;
}

router.post("/usertags", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateUserTagBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { taggedUserId, relatedType, relatedId } = parsed.data;
  const rel = await getRelationship(user, taggedUserId);
  if (rel.viewerBlockedTarget || rel.targetBlockedViewer) {
    res.status(400).json({ error: "Unable to tag this user" });
    return;
  }
  const settings = await getOrCreatePrivacySettings(taggedUserId);
  if (settings.allowTagging === "no_one" && !rel.isSelf) {
    res.status(400).json({ error: "This user does not allow tagging" });
    return;
  }
  if (settings.allowTagging === "friends" && !rel.isFriend && !rel.isSelf) {
    res.status(400).json({ error: "This user only allows tags from Buddys" });
    return;
  }
  // Verify target content exists
  let exists = false;
  if (relatedType === "post") {
    const [p] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, relatedId));
    exists = !!p;
  } else if (relatedType === "photo") {
    const [p] = await db.select().from(photosTable).where(eq(photosTable.id, relatedId));
    exists = !!p;
  } else {
    const [r] = await db.select().from(reelsTable).where(eq(reelsTable.id, relatedId));
    exists = !!r;
  }
  if (!exists) {
    res.status(400).json({ error: "Content not found" });
    return;
  }
  const requiresReview = settings.requireTagReview === "true" && !rel.isSelf;
  const [tag] = await db
    .insert(userTagsTable)
    .values({
      taggedUserId,
      taggedByUserId: user.id,
      relatedType,
      relatedId,
      status: requiresReview ? "pending" : "approved",
    })
    .returning();
  if (!rel.isSelf) {
    await createNotification({
      userId: taggedUserId,
      type: "tag",
      title: requiresReview ? "Tag pending your review" : "You were tagged",
      message: `${user.name} tagged you in a ${relatedType}`,
      relatedUserId: user.id,
    });
  }
  res.status(201).json(await tagToResponse(tag));
});

router.get("/usertags/pending", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const tags = await db
    .select()
    .from(userTagsTable)
    .where(and(eq(userTagsTable.taggedUserId, user.id), eq(userTagsTable.status, "pending")))
    .orderBy(desc(userTagsTable.createdAt));
  res.json(await Promise.all(tags.map(tagToResponse)));
});

router.patch("/usertags/:id", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = ReviewUserTagBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [tag] = await db.select().from(userTagsTable).where(eq(userTagsTable.id, id));
  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }
  if (tag.taggedUserId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only review tags on yourself" });
    return;
  }
  const [updated] = await db
    .update(userTagsTable)
    .set({ status: parsed.data.action === "approve" ? "approved" : "removed" })
    .where(eq(userTagsTable.id, id))
    .returning();
  res.json(await tagToResponse(updated));
});

export default router;
