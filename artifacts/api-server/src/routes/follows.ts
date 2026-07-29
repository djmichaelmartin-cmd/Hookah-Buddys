import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db, followsTable, usersTable, feedPostsTable } from "@workspace/db";
import { requireAuth, getSessionUser } from "../lib/auth";
import { loadAuthors, hydratePosts } from "../lib/feedHelpers";
import { createNotification } from "../lib/notify";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

router.post("/follows/:userId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const targetId = parseId(req.params.userId);
  if (Number.isNaN(targetId) || targetId === user.id) {
    res.status(400).json({ error: "Invalid user to follow" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!target || target.accountStatus === "banned") {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(followsTable)
    .where(and(eq(followsTable.followerId, user.id), eq(followsTable.followingId, targetId)));
  let following: boolean;
  if (existing) {
    await db.delete(followsTable).where(eq(followsTable.id, existing.id));
    following = false;
  } else {
    await db
      .insert(followsTable)
      .values({ followerId: user.id, followingId: targetId })
      .onConflictDoNothing();
    following = true;
    await createNotification({
      userId: targetId,
      type: "new_follower",
      title: "New follower",
      message: `${user.name} started following you`,
      relatedUserId: user.id,
    });
  }
  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.followingId, targetId));
  res.json({ following, followerCount: countRow.c });
});

router.get("/follows", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : NaN;
  const direction = req.query.direction;
  if (Number.isNaN(userId) || (direction !== "followers" && direction !== "following")) {
    res.status(400).json({ error: "userId and direction are required" });
    return;
  }
  const rows =
    direction === "followers"
      ? await db
          .select()
          .from(followsTable)
          .where(eq(followsTable.followingId, userId))
          .orderBy(desc(followsTable.createdAt))
      : await db
          .select()
          .from(followsTable)
          .where(eq(followsTable.followerId, userId))
          .orderBy(desc(followsTable.createdAt));
  const ids = rows.map((r) => (direction === "followers" ? r.followerId : r.followingId));
  const authors = await loadAuthors([...new Set(ids)]);
  const viewerFollowSet = new Set<number>();
  if (viewer && ids.length) {
    const vf = await db
      .select()
      .from(followsTable)
      .where(and(eq(followsTable.followerId, viewer.id), inArray(followsTable.followingId, ids)));
    vf.forEach((f) => viewerFollowSet.add(f.followingId));
  }
  res.json(
    ids
      .map((id) => authors.get(id))
      .filter((a) => a?.user)
      .map((a) => ({
        id: a!.user!.id,
        name: a!.user!.name,
        username: a!.user!.username ?? null,
        role: a!.user!.role,
        profilePhotoUrl: a!.user!.profilePhotoUrl ?? null,
        verified: a!.dollVerified,
        dollId: a!.user!.dollId ?? null,
        city: a!.user!.city ?? null,
        state: a!.user!.state ?? null,
        viewerFollows: viewerFollowSet.has(a!.user!.id),
      })),
  );
});

router.get("/bros/:id", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const id = parseId(req.params.id);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user || user.role !== "member" || user.accountStatus === "banned") {
    res.status(404).json({ error: "Bro not found" });
    return;
  }
  const [followerRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.followingId, id));
  const [followingRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.followerId, id));
  const posts = await db
    .select()
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, id), eq(feedPostsTable.status, "active")))
    .orderBy(desc(feedPostsTable.createdAt))
    .limit(50);

  // Followed Dolls: following users with role doll
  const followingRows = await db
    .select()
    .from(followsTable)
    .where(eq(followsTable.followerId, id));
  const followingIds = followingRows.map((f) => f.followingId);
  const followedAuthors = await loadAuthors(followingIds);
  const followedDolls = followingIds
    .map((fid) => followedAuthors.get(fid))
    .filter((a) => a?.user?.role === "doll")
    .map((a) => ({
      id: a!.user!.id,
      name: a!.user!.name,
      username: a!.user!.username ?? null,
      role: a!.user!.role,
      profilePhotoUrl: a!.user!.profilePhotoUrl ?? null,
      verified: a!.dollVerified,
      dollId: a!.user!.dollId ?? null,
      city: a!.user!.city ?? null,
      state: a!.user!.state ?? null,
      viewerFollows: false,
    }));

  let viewerFollows = false;
  if (viewer) {
    const [vf] = await db
      .select()
      .from(followsTable)
      .where(and(eq(followsTable.followerId, viewer.id), eq(followsTable.followingId, id)));
    viewerFollows = !!vf;
  }

  const badges: string[] = [];
  if (user.accountStatus === "active" && user.ageConfirmed) badges.push("verified_bro");
  if (followerRow.c >= 5) badges.push("vip_bro");
  if (posts.length >= 10) badges.push("top_supporter");

  res.json({
    id: user.id,
    name: user.name,
    username: user.username ?? null,
    city: user.city ?? null,
    state: user.state ?? null,
    bio: null,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    memberSince: user.createdAt.toISOString(),
    followerCount: followerRow.c,
    followingCount: followingRow.c,
    postCount: posts.length,
    badges,
    viewerFollows,
    followedDolls,
    posts: await hydratePosts(posts, viewer?.id ?? null),
  });
});

export default router;
