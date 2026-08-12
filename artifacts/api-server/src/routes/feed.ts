import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  feedPostsTable,
  postLikesTable,
  postCommentsTable,
  postSavesTable,
  postReportsTable,
  followsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateFeedPostBody,
  CreateFeedCommentBody,
  ReportFeedPostBody,
  ReportFeedCommentBody,
  ModerateFeedPostBody,
  ReviewFeedReportBody,
} from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import { finalizeMediaUrl, InvalidUploadError } from "../lib/imageUploads";
import { hydratePosts, loadAuthors } from "../lib/feedHelpers";
import { createNotification } from "../lib/notify";
import {
  loadAudienceSets,
  canViewAudience,
  getOrCreatePrivacySettings,
} from "../lib/socialHelpers";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

// ---------- Browse feed (public preview) ----------
router.get("/feed/posts", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const filter = typeof req.query.filter === "string" ? req.query.filter : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const userId = typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : undefined;
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    100,
  );

  const conditions = [eq(feedPostsTable.status, "active")];
  if (category) conditions.push(eq(feedPostsTable.category, category));
  if (userId != null && !Number.isNaN(userId)) conditions.push(eq(feedPostsTable.userId, userId));
  if (filter === "dolls") conditions.push(eq(feedPostsTable.userRole, "doll"));
  if (filter === "bros") conditions.push(eq(feedPostsTable.userRole, "member"));
  if (filter === "lounges") conditions.push(eq(feedPostsTable.category, "lounge"));
  if (filter === "events") conditions.push(eq(feedPostsTable.category, "event"));

  const orderBy =
    filter === "trending"
      ? [desc(sql`${feedPostsTable.likeCount} + ${feedPostsTable.commentCount} * 2 + ${feedPostsTable.saveCount} * 2`), desc(feedPostsTable.createdAt)]
      : [desc(feedPostsTable.createdAt)];

  let query = db
    .select()
    .from(feedPostsTable)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit * 2);

  let posts = await query;

  // Audience enforcement: non-public posts only for the right relationships
  const audienceSets = await loadAudienceSets(viewer?.id ?? null);
  posts = posts
    .filter((p) => canViewAudience(p.audience, p.userId, viewer ?? null, audienceSets))
    .slice(0, limit);

  // "nearby": prioritize posts from the viewer's city/state when known
  if (filter === "nearby" && viewer && (viewer.city || viewer.state)) {
    const authorIds = [...new Set(posts.map((p) => p.userId))];
    const authors = authorIds.length
      ? await db.select().from(usersTable).where(inArray(usersTable.id, authorIds))
      : [];
    const near = new Set(
      authors
        .filter(
          (a) =>
            (viewer.city && a.city && a.city.toLowerCase() === viewer.city.toLowerCase()) ||
            (viewer.state && a.state && a.state.toLowerCase() === viewer.state.toLowerCase()),
        )
        .map((a) => a.id),
    );
    posts = [...posts].sort((a, b) => Number(near.has(b.userId)) - Number(near.has(a.userId)));
  }

  res.json(await hydratePosts(posts, viewer?.id ?? null));
});

// ---------- Create post ----------
router.post("/feed/posts", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateFeedPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.isHookahRelatedConfirmed) {
    res.status(400).json({ error: "You must confirm the post is hookah-related" });
    return;
  }
  let mediaUrl = parsed.data.mediaUrl ?? null;
  let posterUrl = parsed.data.posterUrl ?? null;
  try {
    if (mediaUrl) {
      mediaUrl = await finalizeMediaUrl(mediaUrl, user.id);
    }
    if (posterUrl && mediaUrl) {
      posterUrl = await finalizeMediaUrl(posterUrl, user.id);
    } else {
      posterUrl = null;
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  let audience: string | undefined = parsed.data.audience;
  if (!audience) {
    const settings = await getOrCreatePrivacySettings(user.id);
    audience = settings.defaultPostAudience;
  }
  const [post] = await db
    .insert(feedPostsTable)
    .values({
      userId: user.id,
      userRole: user.role,
      text: parsed.data.text,
      mediaUrl,
      posterUrl,
      mediaType: parsed.data.mediaType ?? (mediaUrl ? "image" : "none"),
      category: parsed.data.category,
      isHookahRelatedConfirmed: true,
      status: "active",
      audience: audience ?? "public",
    })
    .returning();
  const [result] = await hydratePosts([post], user.id);
  res.status(201).json(result);
});

// ---------- Saved / liked / mine / stats (before /feed/posts/:id) ----------
router.get("/feed/saved", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const saves = await db
    .select()
    .from(postSavesTable)
    .where(eq(postSavesTable.userId, user.id))
    .orderBy(desc(postSavesTable.createdAt));
  const ids = saves.map((s) => s.postId);
  const posts = ids.length
    ? await db
        .select()
        .from(feedPostsTable)
        .where(and(inArray(feedPostsTable.id, ids), eq(feedPostsTable.status, "active")))
    : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  res.json(await hydratePosts(posts, user.id));
});

router.get("/feed/liked", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const likes = await db
    .select()
    .from(postLikesTable)
    .where(eq(postLikesTable.userId, user.id))
    .orderBy(desc(postLikesTable.createdAt));
  const ids = likes.map((l) => l.postId);
  const posts = ids.length
    ? await db
        .select()
        .from(feedPostsTable)
        .where(and(inArray(feedPostsTable.id, ids), eq(feedPostsTable.status, "active")))
    : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  res.json(await hydratePosts(posts, user.id));
});

router.get("/feed/mine", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const posts = await db
    .select()
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, user.id), sql`${feedPostsTable.status} != 'removed'`))
    .orderBy(desc(feedPostsTable.createdAt));
  res.json(await hydratePosts(posts, user.id));
});

router.get("/feed/my-stats", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const [postCountRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, user.id), sql`${feedPostsTable.status} != 'removed'`));
  const [followerRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.followingId, user.id));
  const [followingRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.followerId, user.id));
  const [likesReceivedRow] = await db
    .select({ c: sql<number>`coalesce(sum(${feedPostsTable.likeCount}), 0)::int` })
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, user.id), sql`${feedPostsTable.status} != 'removed'`));
  const [commentsReceivedRow] = await db
    .select({ c: sql<number>`coalesce(sum(${feedPostsTable.commentCount}), 0)::int` })
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, user.id), sql`${feedPostsTable.status} != 'removed'`));
  const [savedRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postSavesTable)
    .where(eq(postSavesTable.userId, user.id));
  const [likesGivenRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .where(eq(postLikesTable.userId, user.id));
  res.json({
    postCount: postCountRow.c,
    followerCount: followerRow.c,
    followingCount: followingRow.c,
    likesReceived: likesReceivedRow.c,
    commentsReceived: commentsReceivedRow.c,
    savedCount: savedRow.c,
    likesGiven: likesGivenRow.c,
  });
});

// ---------- Single post ----------
async function viewerCanSeePost(
  post: { audience: string; userId: number },
  viewer: { id: number; role: string } | null,
): Promise<boolean> {
  const sets = await loadAudienceSets(viewer?.id ?? null);
  return canViewAudience(post.audience, post.userId, viewer, sets);
}

router.get("/feed/posts/:id", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const id = parseId(req.params.id);
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post || post.status === "removed") {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.status !== "active" && viewer?.id !== post.userId && viewer?.role !== "admin") {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const audienceSets = await loadAudienceSets(viewer?.id ?? null);
  if (!canViewAudience(post.audience, post.userId, viewer ?? null, audienceSets)) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const [result] = await hydratePosts([post], viewer?.id ?? null);
  res.json(result);
});

router.delete("/feed/posts/:id", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only delete your own posts" });
    return;
  }
  await db.delete(postLikesTable).where(eq(postLikesTable.postId, id));
  await db.delete(postCommentsTable).where(eq(postCommentsTable.postId, id));
  await db.delete(postSavesTable).where(eq(postSavesTable.postId, id));
  await db.delete(feedPostsTable).where(eq(feedPostsTable.id, id));
  res.sendStatus(204);
});

// ---------- Like / save ----------
router.post("/feed/posts/:id/like", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post || post.status !== "active" || !(await viewerCanSeePost(post, user))) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(postLikesTable)
    .where(and(eq(postLikesTable.postId, id), eq(postLikesTable.userId, user.id)));
  let liked: boolean;
  if (existing) {
    const deleted = await db.delete(postLikesTable).where(eq(postLikesTable.id, existing.id)).returning();
    if (deleted.length > 0) {
      await db
        .update(feedPostsTable)
        .set({ likeCount: sql`greatest(${feedPostsTable.likeCount} - 1, 0)` })
        .where(eq(feedPostsTable.id, id));
    }
    liked = false;
  } else {
    const insertedRows = await db
      .insert(postLikesTable)
      .values({ postId: id, userId: user.id })
      .onConflictDoNothing()
      .returning();
    if (insertedRows.length > 0) {
      await db
        .update(feedPostsTable)
        .set({ likeCount: sql`${feedPostsTable.likeCount} + 1` })
        .where(eq(feedPostsTable.id, id));
    }
    liked = true;
    if (insertedRows.length > 0 && post.userId !== user.id) {
      await createNotification({
        userId: post.userId,
        type: "new_like",
        title: "New like",
        message: `${user.name} liked your post`,
        relatedUserId: user.id,
        relatedPostId: id,
      });
    }
  }
  const [updated] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  res.json({ liked, likeCount: updated.likeCount });
});

router.post("/feed/posts/:id/save", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post || post.status !== "active" || !(await viewerCanSeePost(post, user))) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(postSavesTable)
    .where(and(eq(postSavesTable.postId, id), eq(postSavesTable.userId, user.id)));
  let saved: boolean;
  if (existing) {
    const deleted = await db.delete(postSavesTable).where(eq(postSavesTable.id, existing.id)).returning();
    if (deleted.length > 0) {
      await db
        .update(feedPostsTable)
        .set({ saveCount: sql`greatest(${feedPostsTable.saveCount} - 1, 0)` })
        .where(eq(feedPostsTable.id, id));
    }
    saved = false;
  } else {
    const insertedRows = await db
      .insert(postSavesTable)
      .values({ postId: id, userId: user.id })
      .onConflictDoNothing()
      .returning();
    if (insertedRows.length > 0) {
      await db
        .update(feedPostsTable)
        .set({ saveCount: sql`${feedPostsTable.saveCount} + 1` })
        .where(eq(feedPostsTable.id, id));
    }
    saved = true;
  }
  const [updated] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  res.json({ saved, saveCount: updated.saveCount });
});

// ---------- Reports ----------
router.post("/feed/posts/:id/report", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = ReportFeedPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post || !(await viewerCanSeePost(post, user))) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  await db.insert(postReportsTable).values({
    targetType: "post",
    postId: id,
    reporterId: user.id,
    reason: parsed.data.reason,
    notes: parsed.data.notes ?? null,
  });
  await db
    .update(feedPostsTable)
    .set({ reportCount: sql`${feedPostsTable.reportCount} + 1` })
    .where(eq(feedPostsTable.id, id));
  await createNotification({
    userId: post.userId,
    type: "post_reported",
    title: "Post reported",
    message: "One of your posts was reported and is pending review",
    relatedPostId: id,
  });
  res.status(201).json({ message: "Report submitted" });
});

router.post("/feed/comments/:id/report", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = ReportFeedCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [comment] = await db.select().from(postCommentsTable).where(eq(postCommentsTable.id, id));
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  await db.insert(postReportsTable).values({
    targetType: "comment",
    postId: comment.postId,
    commentId: id,
    reporterId: user.id,
    reason: parsed.data.reason,
    notes: parsed.data.notes ?? null,
  });
  res.status(201).json({ message: "Report submitted" });
});

// ---------- Comments ----------
router.get("/feed/posts/:id/comments", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const viewer = await getSessionUser(req);
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post || post.status !== "active" || !(await viewerCanSeePost(post, viewer ?? null))) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const comments = await db
    .select()
    .from(postCommentsTable)
    .where(and(eq(postCommentsTable.postId, id), eq(postCommentsTable.status, "active")))
    .orderBy(postCommentsTable.createdAt);
  const authors = await loadAuthors([...new Set(comments.map((c) => c.userId))]);
  res.json(
    comments.map((c) => {
      const a = authors.get(c.userId);
      return {
        id: c.id,
        postId: c.postId,
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

router.post("/feed/posts/:id/comments", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = CreateFeedCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post || post.status !== "active" || !(await viewerCanSeePost(post, user))) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const [comment] = await db
    .insert(postCommentsTable)
    .values({ postId: id, userId: user.id, commentText: parsed.data.commentText })
    .returning();
  await db
    .update(feedPostsTable)
    .set({ commentCount: sql`${feedPostsTable.commentCount} + 1` })
    .where(eq(feedPostsTable.id, id));
  if (post.userId !== user.id) {
    await createNotification({
      userId: post.userId,
      type: "new_comment",
      title: "New comment",
      message: `${user.name} commented on your post`,
      relatedUserId: user.id,
      relatedPostId: id,
      relatedCommentId: comment.id,
    });
  }
  const authors = await loadAuthors([user.id]);
  const a = authors.get(user.id);
  res.status(201).json({
    id: comment.id,
    postId: comment.postId,
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

router.delete("/feed/comments/:id", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [comment] = await db.select().from(postCommentsTable).where(eq(postCommentsTable.id, id));
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  if (comment.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only delete your own comments" });
    return;
  }
  await db.delete(postCommentsTable).where(eq(postCommentsTable.id, id));
  await db
    .update(feedPostsTable)
    .set({ commentCount: sql`greatest(${feedPostsTable.commentCount} - 1, 0)` })
    .where(eq(feedPostsTable.id, comment.postId));
  res.sendStatus(204);
});

export default router;
