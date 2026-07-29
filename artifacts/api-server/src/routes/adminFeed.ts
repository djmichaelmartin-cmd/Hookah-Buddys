import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray, gte } from "drizzle-orm";
import {
  db,
  feedPostsTable,
  postCommentsTable,
  postLikesTable,
  postReportsTable,
  usersTable,
} from "@workspace/db";
import { ModerateFeedPostBody, ReviewFeedReportBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { hydratePosts, loadAuthors } from "../lib/feedHelpers";
import { createNotification } from "../lib/notify";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

router.get("/admin/feed/posts", requireAuth("admin"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const posts = await db
    .select()
    .from(feedPostsTable)
    .where(status ? eq(feedPostsTable.status, status) : undefined)
    .orderBy(desc(feedPostsTable.createdAt))
    .limit(200);
  res.json(await hydratePosts(posts, user.id));
});

router.patch("/admin/feed/posts/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = ModerateFeedPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [post] = await db
    .update(feedPostsTable)
    .set({ status: parsed.data.status })
    .where(eq(feedPostsTable.id, id))
    .returning();
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (parsed.data.status === "removed") {
    await createNotification({
      userId: post.userId,
      type: "admin_removed_post",
      title: "Post removed",
      message: "An admin removed one of your posts for violating the content rules",
      relatedPostId: post.id,
    });
  } else if (parsed.data.status === "active") {
    await createNotification({
      userId: post.userId,
      type: "admin_approved_post",
      title: "Post approved",
      message: "Your post was reviewed and approved",
      relatedPostId: post.id,
    });
  }
  const [result] = await hydratePosts([post], user.id);
  res.json(result);
});

async function toReportResponse(r: typeof postReportsTable.$inferSelect) {
  let postText: string | null = null;
  let commentText: string | null = null;
  if (r.postId != null) {
    const [p] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, r.postId));
    postText = p?.text ?? null;
  }
  if (r.commentId != null) {
    const [c] = await db.select().from(postCommentsTable).where(eq(postCommentsTable.id, r.commentId));
    commentText = c?.commentText ?? null;
  }
  const [reporter] = await db.select().from(usersTable).where(eq(usersTable.id, r.reporterId));
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetType === "comment" ? (r.commentId ?? 0) : (r.postId ?? 0),
    postId: r.postId ?? null,
    reporterId: r.reporterId,
    reporterName: reporter?.name ?? "Unknown",
    reason: r.reason,
    notes: r.notes ?? null,
    status: r.status,
    postText,
    commentText,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  };
}

router.get("/admin/feed/reports", requireAuth("admin"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await db
    .select()
    .from(postReportsTable)
    .where(status ? eq(postReportsTable.status, status) : undefined)
    .orderBy(desc(postReportsTable.createdAt))
    .limit(200);
  res.json(await Promise.all(rows.map(toReportResponse)));
});

router.patch("/admin/feed/reports/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = ReviewFeedReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [report] = await db
    .update(postReportsTable)
    .set({ status: parsed.data.status, reviewedAt: new Date() })
    .where(eq(postReportsTable.id, id))
    .returning();
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(await toReportResponse(report));
});

router.get("/admin/feed/analytics", requireAuth("admin"), async (_req, res): Promise<void> => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalPostsRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(feedPostsTable);
  const [newTodayRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(feedPostsTable)
    .where(gte(feedPostsTable.createdAt, startOfToday));
  const [activeUsersRow] = await db
    .select({ c: sql<number>`count(distinct ${feedPostsTable.userId})::int` })
    .from(feedPostsTable);
  const [likesRow] = await db.select({ c: sql<number>`count(*)::int` }).from(postLikesTable);
  const [commentsRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postCommentsTable);
  const [reportsRow] = await db.select({ c: sql<number>`count(*)::int` }).from(postReportsTable);
  const [pendingReportsRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(postReportsTable)
    .where(eq(postReportsTable.status, "pending"));

  const activeByUser = await db
    .select({ userId: feedPostsTable.userId, role: feedPostsTable.userRole, c: sql<number>`count(*)::int` })
    .from(feedPostsTable)
    .where(eq(feedPostsTable.status, "active"))
    .groupBy(feedPostsTable.userId, feedPostsTable.userRole)
    .orderBy(desc(sql`count(*)`));
  const topDolls = activeByUser.filter((r) => r.role === "doll").slice(0, 5);
  const topBros = activeByUser.filter((r) => r.role === "member").slice(0, 5);
  const authorIds = [...new Set([...topDolls, ...topBros].map((r) => r.userId))];
  const authors = await loadAuthors(authorIds);
  const toPoster = (r: { userId: number; role: string; c: number }) => {
    const a = authors.get(r.userId);
    return {
      userId: r.userId,
      name: a?.user?.name ?? "Unknown",
      username: a?.user?.username ?? null,
      role: r.role,
      profilePhotoUrl: a?.user?.profilePhotoUrl ?? null,
      postCount: r.c,
      dollId: a?.user?.dollId ?? null,
    };
  };

  const categories = await db
    .select({ category: feedPostsTable.category, c: sql<number>`count(*)::int` })
    .from(feedPostsTable)
    .where(eq(feedPostsTable.status, "active"))
    .groupBy(feedPostsTable.category)
    .orderBy(desc(sql`count(*)`));

  res.json({
    totalPosts: totalPostsRow.c,
    newPostsToday: newTodayRow.c,
    activeUsers: activeUsersRow.c,
    totalLikes: likesRow.c,
    totalComments: commentsRow.c,
    totalReports: reportsRow.c,
    pendingReports: pendingReportsRow.c,
    mostActiveDolls: topDolls.map(toPoster),
    mostActiveBros: topBros.map(toPoster),
    trendingCategories: categories.map((c) => ({ category: c.category, count: c.c })),
  });
});

export default router;
