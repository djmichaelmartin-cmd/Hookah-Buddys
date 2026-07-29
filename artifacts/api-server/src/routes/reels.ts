import { Router, type IRouter } from "express";
import { and, eq, desc, sql, inArray, or } from "drizzle-orm";
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
import { loadAuthors } from "../lib/feedHelpers";
import {
  getRelationship,
  canView,
  parseJsonArray,
  getOrCreatePrivacySettings,
} from "../lib/socialHelpers";
import { createNotification } from "../lib/notify";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

async function reelsToResponse(reels: Reel[], viewerId: number | null) {
  const authorIds = [...new Set(reels.map((r) => r.userId))];
  const authors = await loadAuthors(authorIds);
  const likedSet = new Set<number>();
  const savedSet = new Set<number>();
  const followSet = new Set<number>();
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
    return {
      id: r.id,
      userId: r.userId,
      userRole: r.userRole,
      userName: a?.user?.name ?? "Unknown",
      username: a?.user?.username ?? null,
      userPhotoUrl: a?.user?.profilePhotoUrl ?? null,
      userVerified: a?.dollVerified ?? false,
      dollId: a?.user?.dollId ?? null,
      videoUrl: r.videoUrl,
      thumbnailUrl: r.thumbnailUrl ?? null,
      caption: r.caption ?? null,
      category: r.category,
      hashtags: parseJsonArray(r.hashtags),
      visibility: r.visibility,
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
  const category = typeof req.query.category === "string" ? req.query.category : null;
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    100,
  );
  const conditions = [eq(reelsTable.status, "active")];
  if (userId != null && !Number.isNaN(userId)) conditions.push(eq(reelsTable.userId, userId));
  if (category) conditions.push(eq(reelsTable.category, category));
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

router.post("/reels", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateReelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.isHookahRelatedConfirmed) {
    res.status(400).json({ error: "Please confirm your reel is hookah lifestyle related" });
    return;
  }
  const [reel] = await db
    .insert(reelsTable)
    .values({
      userId: user.id,
      userRole: user.role,
      videoUrl: parsed.data.videoUrl,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
      caption: parsed.data.caption ?? null,
      category: parsed.data.category,
      hashtags: parsed.data.hashtags ? JSON.stringify(parsed.data.hashtags) : null,
      visibility: parsed.data.visibility ?? "public",
      isHookahRelatedConfirmed: true,
    })
    .returning();
  const [result] = await reelsToResponse([reel], user.id);
  res.status(201).json(result);
});

router.get("/reels/:id", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const id = parseId(req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active") {
    res.status(404).json({ error: "Reel not found" });
    return;
  }
  const rel = await getRelationship(viewer ?? null, reel.userId);
  if (((rel.targetBlockedViewer || rel.viewerBlockedTarget) && !rel.isSelf && !rel.isAdmin) || !canView(reel.visibility, rel)) {
    res.status(404).json({ error: "Reel not found" });
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
    res.status(404).json({ error: "Reel not found" });
    return;
  }
  if (reel.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only delete your own reels" });
    return;
  }
  await db.delete(reelLikesTable).where(eq(reelLikesTable.reelId, id));
  await db.delete(reelSavesTable).where(eq(reelSavesTable.reelId, id));
  await db.delete(reelCommentsTable).where(eq(reelCommentsTable.reelId, id));
  await db.delete(reelsTable).where(eq(reelsTable.id, id));
  res.sendStatus(204);
});

async function viewerCanSeeReel(
  reel: { userId: number; visibility: string },
  viewer: { id: number; role: string } | null,
): Promise<boolean> {
  const rel = await getRelationship(viewer, reel.userId);
  if (rel.isSelf || rel.isAdmin) return true;
  if (rel.viewerBlockedTarget || rel.targetBlockedViewer) return false;
  return canView(reel.visibility, rel);
}

router.post("/reels/:id/like", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel || reel.status !== "active" || !(await viewerCanSeeReel(reel, user))) {
    res.status(404).json({ error: "Reel not found" });
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
          message: `${user.name} liked your reel`,
          relatedUserId: user.id,
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
    res.status(404).json({ error: "Reel not found" });
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
    res.status(404).json({ error: "Reel not found" });
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
    res.status(404).json({ error: "Reel not found" });
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
    res.status(404).json({ error: "Reel not found" });
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
      message: `${user.name} commented on your reel`,
      relatedUserId: user.id,
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
  res.json(await Promise.all(tags.map(tagToResponse)));
});

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
    res.status(400).json({ error: "This user only allows tags from friends" });
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
