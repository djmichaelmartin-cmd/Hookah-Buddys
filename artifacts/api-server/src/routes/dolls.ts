import { Router, type IRouter } from "express";
import { eq, and, ilike, gte, lte, sql } from "drizzle-orm";
import {
  db,
  dollsTable,
  mediaTable,
  favoritesTable,
  verificationsTable,
  subscriptionsTable,
  contentUnlocksTable,
  plansTable,
} from "@workspace/db";
import { ListDollsQueryParams, GetDollParams, UpdateMyDollProfileBody } from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import { DOLL_SUBSCRIPTION_TIERS } from "@workspace/pricing";
import { toDollResponse, toMediaResponse } from "../lib/mappers";
import { getDollCounts, dollWithCounts, computeDollEarnings } from "../lib/dollHelpers";

const router: IRouter = Router();

router.get("/dolls", async (req, res): Promise<void> => {
  const parsed = ListDollsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const q = parsed.data;
  const conditions = [eq(dollsTable.applicationStatus, "approved")];
  if (q.city) conditions.push(ilike(dollsTable.city, `%${q.city}%`));
  if (q.state) conditions.push(ilike(dollsTable.state, `%${q.state}%`));
  if (q.flavor) conditions.push(ilike(dollsTable.favoriteFlavor, `%${q.flavor}%`));
  if (q.experience) conditions.push(ilike(dollsTable.experienceLevel, `%${q.experience}%`));
  if (q.verified !== undefined) conditions.push(eq(dollsTable.verified, q.verified));
  if (q.featured !== undefined) conditions.push(eq(dollsTable.featured, q.featured));
  if (q.online !== undefined) conditions.push(eq(dollsTable.online, q.online));
  if (q.videoChat !== undefined) conditions.push(eq(dollsTable.availableForVideoChat, q.videoChat));
  if (q.minAge !== undefined) conditions.push(gte(dollsTable.age, q.minAge));
  if (q.maxAge !== undefined) conditions.push(lte(dollsTable.age, q.maxAge));
  if (q.search) conditions.push(ilike(dollsTable.stageName, `%${q.search}%`));

  const rows = await db
    .select()
    .from(dollsTable)
    .where(and(...conditions))
    .orderBy(sql`${dollsTable.featured} desc, ${dollsTable.elite} desc, ${dollsTable.profileViews} desc`);

  let result = await Promise.all(rows.map((d) => dollWithCounts(d)));
  if (q.premium) {
    result = result.filter((d) => d.premiumPhotoCount > 0 || d.premiumVideoCount > 0);
  }
  res.json(result);
});

router.get("/dolls/featured", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(dollsTable)
    .where(and(eq(dollsTable.applicationStatus, "approved"), eq(dollsTable.featured, true)))
    .orderBy(sql`${dollsTable.elite} desc, ${dollsTable.profileViews} desc`)
    .limit(8);
  const result = await Promise.all(rows.map((d) => dollWithCounts(d)));
  res.json(result);
});

router.get("/dolls/me", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Buddy profile not found" });
    return;
  }
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, user.dollId));
  if (!doll) {
    res.status(404).json({ error: "Buddy profile not found" });
    return;
  }
  const counts = await getDollCounts(doll.id);
  res.json(toDollResponse(doll, counts));
});

router.patch("/dolls/me", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Buddy profile not found" });
    return;
  }
  const parsed = UpdateMyDollProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [doll] = await db
    .update(dollsTable)
    .set(parsed.data)
    .where(eq(dollsTable.id, user.dollId))
    .returning();
  const counts = await getDollCounts(doll.id);
  res.json(toDollResponse(doll, counts));
});

router.get("/dolls/me/analytics", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Buddy profile not found" });
    return;
  }
  const dollId = user.dollId;
  const counts = await getDollCounts(dollId);
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, dollId));

  const { messageRevenue, videoChatRevenue, subscriptionRevenue, totalEarnings } =
    computeDollEarnings(doll ?? {}, counts);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const viewsTrend = months.map((label, i) => ({
    label,
    value: Math.round((doll?.profileViews ?? 50) * (0.5 + i * 0.12)),
  }));
  const earningsTrend = months.map((label, i) => ({
    label,
    value: Math.round((totalEarnings / 6) * (0.6 + i * 0.14)),
  }));

  res.json({
    profileViews: doll?.profileViews ?? 0,
    favorites: counts.favoriteCount,
    contentUnlocks: counts.premiumPhotoCount + counts.premiumVideoCount,
    messageRevenue: Math.round(messageRevenue * 100) / 100,
    videoChatRevenue: Math.round(videoChatRevenue * 100) / 100,
    subscriptionRevenue: Math.round(subscriptionRevenue * 100) / 100,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    pendingPayout: Math.round(totalEarnings * 0.4 * 100) / 100,
    viewsTrend,
    earningsTrend,
  });
});

router.get("/dolls/:id", async (req, res): Promise<void> => {
  const params = GetDollParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, id));
  if (!doll || doll.applicationStatus !== "approved") {
    res.status(404).json({ error: "Buddy not found" });
    return;
  }

  await db
    .update(dollsTable)
    .set({ profileViews: doll.profileViews + 1 })
    .where(eq(dollsTable.id, id));

  const counts = await getDollCounts(id);
  const base = toDollResponse(doll, counts);

  const sessionUser = await getSessionUser(req);

  let viewerSubscribed = false;
  const unlockedMediaIds = new Set<number>();
  if (sessionUser && sessionUser.role === "member") {
    const subs = await db
      .select({ tier: plansTable.tier, audience: plansTable.audience })
      .from(subscriptionsTable)
      .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
      .where(
        and(
          eq(subscriptionsTable.memberUserId, sessionUser.id),
          eq(subscriptionsTable.dollId, id),
          eq(subscriptionsTable.status, "active"),
        ),
      );
    viewerSubscribed = subs.some(
      (s) =>
        s.audience === "member" &&
        DOLL_SUBSCRIPTION_TIERS.includes(s.tier as (typeof DOLL_SUBSCRIPTION_TIERS)[number]),
    );

    const unlocks = await db
      .select({ mediaId: contentUnlocksTable.mediaId })
      .from(contentUnlocksTable)
      .where(
        and(
          eq(contentUnlocksTable.memberUserId, sessionUser.id),
          eq(contentUnlocksTable.dollId, id),
        ),
      );
    for (const u of unlocks) unlockedMediaIds.add(u.mediaId);
  }

  const isOwner = sessionUser?.role === "doll" && sessionUser.id === doll.userId;
  const isAdmin = sessionUser?.role === "admin";
  const hasFullAccess = isOwner || isAdmin || viewerSubscribed;

  const mediaRows = await db
    .select()
    .from(mediaTable)
    .where(and(eq(mediaTable.dollId, id), eq(mediaTable.status, "approved")));
  const media = mediaRows
    .filter((m) => m.type !== "verification")
    .map((m) => {
      const locked = m.premium && !hasFullAccess && !unlockedMediaIds.has(m.id);
      return toMediaResponse(m, doll.stageName, locked);
    });

  const [verification] = await db
    .select()
    .from(verificationsTable)
    .where(eq(verificationsTable.dollId, id))
    .orderBy(sql`${verificationsTable.createdAt} desc`)
    .limit(1);
  const verificationStatus = doll.verified
    ? "approved"
    : verification
      ? (verification.status as "pending" | "approved" | "rejected")
      : "unverified";

  let isFavorited = false;
  if (sessionUser && sessionUser.role === "member") {
    const [fav] = await db
      .select()
      .from(favoritesTable)
      .where(and(eq(favoritesTable.memberUserId, sessionUser.id), eq(favoritesTable.dollId, id)));
    isFavorited = !!fav;
  }

  res.json({ ...base, verificationStatus, isFavorited, viewerSubscribed, media });
});

export default router;
