import { Router, type IRouter } from "express";
import { and, eq, or, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  friendRequestsTable,
  friendshipsTable,
  blocksTable,
  followsTable,
} from "@workspace/db";
import { SendFriendRequestBody, RespondFriendRequestBody } from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import { loadAuthors } from "../lib/feedHelpers";
import {
  friendPair,
  getRelationship,
  getOrCreatePrivacySettings,
  canView,
} from "../lib/socialHelpers";
import { createNotification } from "../lib/notify";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

async function friendIdsOf(userId: number): Promise<number[]> {
  const rows = await db
    .select()
    .from(friendshipsTable)
    .where(or(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, userId)));
  return rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
}

async function toRequestResponse(r: typeof friendRequestsTable.$inferSelect) {
  const authors = await loadAuthors([r.senderId, r.receiverId]);
  const sender = authors.get(r.senderId)?.user;
  const receiver = authors.get(r.receiverId)?.user;
  const [senderFriends, receiverFriends] = await Promise.all([
    friendIdsOf(r.senderId),
    friendIdsOf(r.receiverId),
  ]);
  const receiverSet = new Set(receiverFriends);
  const mutualFriendCount = senderFriends.filter((id) => receiverSet.has(id)).length;
  return {
    id: r.id,
    senderId: r.senderId,
    receiverId: r.receiverId,
    status: r.status,
    senderName: sender?.name ?? "Unknown",
    senderPhotoUrl: sender?.profilePhotoUrl ?? null,
    senderRole: sender?.role ?? "member",
    receiverName: receiver?.name ?? "Unknown",
    receiverPhotoUrl: receiver?.profilePhotoUrl ?? null,
    receiverRole: receiver?.role ?? "member",
    mutualFriendCount,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/friends/requests", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select()
    .from(friendRequestsTable)
    .where(
      and(
        eq(friendRequestsTable.status, "pending"),
        or(eq(friendRequestsTable.senderId, user.id), eq(friendRequestsTable.receiverId, user.id)),
      ),
    )
    .orderBy(desc(friendRequestsTable.createdAt));
  const incoming = rows.filter((r) => r.receiverId === user.id);
  const outgoing = rows.filter((r) => r.senderId === user.id);
  res.json({
    incoming: await Promise.all(incoming.map(toRequestResponse)),
    outgoing: await Promise.all(outgoing.map(toRequestResponse)),
  });
});

router.post("/friends/requests", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = SendFriendRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const receiverId = parsed.data.receiverId;
  if (receiverId === user.id) {
    res.status(400).json({ error: "You cannot add yourself as a Buddy" });
    return;
  }
  const [receiver] = await db.select().from(usersTable).where(eq(usersTable.id, receiverId));
  if (!receiver || receiver.accountStatus === "banned") {
    res.status(400).json({ error: "User not found" });
    return;
  }
  const rel = await getRelationship(user, receiverId);
  if (rel.viewerBlockedTarget || rel.targetBlockedViewer) {
    res.status(400).json({ error: "Unable to send Buddy request" });
    return;
  }
  if (rel.isFriend) {
    res.status(400).json({ error: "You are already Buddys" });
    return;
  }
  const settings = await getOrCreatePrivacySettings(receiverId);
  if (settings.allowFriendRequestsFrom === "no_one") {
    res.status(400).json({ error: "This user is not accepting Buddy requests" });
    return;
  }
  const [existing] = await db
    .select()
    .from(friendRequestsTable)
    .where(
      and(
        eq(friendRequestsTable.status, "pending"),
        or(
          and(eq(friendRequestsTable.senderId, user.id), eq(friendRequestsTable.receiverId, receiverId)),
          and(eq(friendRequestsTable.senderId, receiverId), eq(friendRequestsTable.receiverId, user.id)),
        ),
      ),
    );
  if (existing) {
    res.status(400).json({ error: "A Buddy request is already pending" });
    return;
  }
  const [request] = await db
    .insert(friendRequestsTable)
    .values({ senderId: user.id, receiverId })
    .returning();
  await createNotification({
    userId: receiverId,
    type: "friend_request",
    title: "New Buddy request",
    message: `${user.name} sent you a Buddy request`,
    relatedUserId: user.id,
  });
  res.status(201).json(await toRequestResponse(request));
});

router.patch("/friends/requests/:id", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = RespondFriendRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [request] = await db
    .select()
    .from(friendRequestsTable)
    .where(eq(friendRequestsTable.id, id));
  if (!request || request.status !== "pending") {
    res.status(404).json({ error: "Buddy request not found" });
    return;
  }
  const action = parsed.data.action;
  if (action === "cancel" && request.senderId !== user.id) {
    res.status(403).json({ error: "Only the sender can cancel a request" });
    return;
  }
  if ((action === "accept" || action === "decline") && request.receiverId !== user.id) {
    res.status(403).json({ error: "Only the receiver can respond to a request" });
    return;
  }
  const newStatus = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
  const [updated] = await db
    .update(friendRequestsTable)
    .set({ status: newStatus })
    .where(and(eq(friendRequestsTable.id, id), eq(friendRequestsTable.status, "pending")))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Buddy request not found" });
    return;
  }
  if (action === "accept") {
    const [a, b] = friendPair(request.senderId, request.receiverId);
    await db.insert(friendshipsTable).values({ userAId: a, userBId: b }).onConflictDoNothing();
    await createNotification({
      userId: request.senderId,
      type: "friend_request_accepted",
      title: "Buddy request accepted",
      message: `${user.name} accepted your Buddy request`,
      relatedUserId: user.id,
    });
  }
  res.json(await toRequestResponse(updated));
});

router.delete("/friends/:userId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const otherId = parseId(req.params.userId);
  const [a, b] = friendPair(user.id, otherId);
  const deleted = await db
    .delete(friendshipsTable)
    .where(and(eq(friendshipsTable.userAId, a), eq(friendshipsTable.userBId, b)))
    .returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "You are not Buddys with this user" });
    return;
  }
  res.sendStatus(204);
});

router.get("/friends", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : NaN;
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const rel = await getRelationship(viewer ?? null, userId);
  const settings = await getOrCreatePrivacySettings(userId);
  if (!rel.isSelf && !rel.isAdmin && !canView(settings.showFriendsList, rel)) {
    res.json([]);
    return;
  }
  const ids = await (async () => {
    const rows = await db
      .select()
      .from(friendshipsTable)
      .where(or(eq(friendshipsTable.userAId, userId), eq(friendshipsTable.userBId, userId)))
      .orderBy(desc(friendshipsTable.createdAt));
    return rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
  })();
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
      .filter((a) => a?.user && a.user.accountStatus !== "banned")
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

router.get("/friends/mutual/:userId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const otherId = parseId(req.params.userId);
  const friendsOf = async (id: number) => new Set(await friendIdsOf(id));
  const [mine, theirs] = await Promise.all([friendsOf(user.id), friendsOf(otherId)]);
  const mutual = [...mine].filter((id) => theirs.has(id));
  const authors = await loadAuthors(mutual);
  res.json(
    mutual
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
        viewerFollows: false,
      })),
  );
});

router.post("/blocks/:userId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const targetId = parseId(req.params.userId);
  if (targetId === user.id) {
    res.status(400).json({ error: "You cannot block yourself" });
    return;
  }
  const [existing] = await db
    .select()
    .from(blocksTable)
    .where(and(eq(blocksTable.blockerId, user.id), eq(blocksTable.blockedUserId, targetId)));
  if (existing) {
    await db.delete(blocksTable).where(eq(blocksTable.id, existing.id));
    res.json({ blocked: false });
    return;
  }
  await db
    .insert(blocksTable)
    .values({ blockerId: user.id, blockedUserId: targetId })
    .onConflictDoNothing();
  // Blocking severs friendship, pending requests, and follows both ways
  const [a, b] = friendPair(user.id, targetId);
  await db
    .delete(friendshipsTable)
    .where(and(eq(friendshipsTable.userAId, a), eq(friendshipsTable.userBId, b)));
  await db
    .update(friendRequestsTable)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(friendRequestsTable.status, "pending"),
        or(
          and(eq(friendRequestsTable.senderId, user.id), eq(friendRequestsTable.receiverId, targetId)),
          and(eq(friendRequestsTable.senderId, targetId), eq(friendRequestsTable.receiverId, user.id)),
        ),
      ),
    );
  await db
    .delete(followsTable)
    .where(
      or(
        and(eq(followsTable.followerId, user.id), eq(followsTable.followingId, targetId)),
        and(eq(followsTable.followerId, targetId), eq(followsTable.followingId, user.id)),
      ),
    );
  res.json({ blocked: true });
});

router.get("/blocks", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select()
    .from(blocksTable)
    .where(eq(blocksTable.blockerId, user.id))
    .orderBy(desc(blocksTable.createdAt));
  const authors = await loadAuthors(rows.map((r) => r.blockedUserId));
  res.json(
    rows
      .map((r) => authors.get(r.blockedUserId))
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
        viewerFollows: false,
      })),
  );
});

export default router;
