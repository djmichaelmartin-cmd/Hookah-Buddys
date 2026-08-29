import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  dollsTable,
  creatorAlbumsTable,
  mediaTable,
  favoritesTable,
  verificationsTable,
  reportsTable,
} from "@workspace/db";
import { ReviewDollApplicationParams, ReviewDollApplicationBody, ListUsersQueryParams, UpdateUserStatusParams, UpdateUserStatusBody, UpdateUserBuddyTypeParams, UpdateUserBuddyTypeBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { computeDollEarnings } from "../lib/dollHelpers";

const router: IRouter = Router();

router.get("/admin/stats", requireAuth("admin"), async (_req, res): Promise<void> => {
  const [totalDolls] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dollsTable)
    .where(eq(dollsTable.applicationStatus, "approved"));
  const [totalMembers] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(eq(usersTable.role, "member"));
  const [verifiedDolls] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dollsTable)
    .where(eq(dollsTable.verified, true));
  const [pendingApplications] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dollsTable)
    .where(eq(dollsTable.applicationStatus, "pending"));
  const [pendingMedia] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(mediaTable)
    .where(eq(mediaTable.status, "pending_review"));
  const [pendingVerifications] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(verificationsTable)
    .where(eq(verificationsTable.status, "pending"));
  const [openReports] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reportsTable)
    .where(eq(reportsTable.status, "open"));
  const [featuredDolls] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dollsTable)
    .where(eq(dollsTable.featured, true));

  const memberCount = totalMembers?.c ?? 0;
  const dollCount = totalDolls?.c ?? 0;
  const MEMBER_PLAN_PRICE = 39.99;
  const DOLL_PLAN_PRICE = 24.99;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const revenueBreakdown = [
    {
      label: "Member subscriptions",
      count: memberCount,
      unitPrice: MEMBER_PLAN_PRICE,
      amount: round2(memberCount * MEMBER_PLAN_PRICE),
    },
    {
      label: "Buddy subscriptions",
      count: dollCount,
      unitPrice: DOLL_PLAN_PRICE,
      amount: round2(dollCount * DOLL_PLAN_PRICE),
    },
  ];

  const totalRevenue = revenueBreakdown.reduce((sum, item) => sum + item.amount, 0);
  const monthlyRevenue = totalRevenue * 0.18;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const revenueTrend = months.map((label, i) => ({
    label,
    value: Math.round(monthlyRevenue * (0.55 + i * 0.12)),
  }));

  res.json({
    totalDolls: totalDolls?.c ?? 0,
    totalMembers: totalMembers?.c ?? 0,
    verifiedDolls: verifiedDolls?.c ?? 0,
    pendingApplications: pendingApplications?.c ?? 0,
    pendingMedia: pendingMedia?.c ?? 0,
    pendingVerifications: pendingVerifications?.c ?? 0,
    openReports: openReports?.c ?? 0,
    featuredDolls: featuredDolls?.c ?? 0,
    totalRevenue: round2(totalRevenue),
    monthlyRevenue: round2(monthlyRevenue),
    revenueTrend,
    revenueBreakdown,
  });
});

router.get("/admin/revenue/dolls", requireAuth("admin"), async (_req, res): Promise<void> => {
  const dolls = await db
    .select()
    .from(dollsTable)
    .where(eq(dollsTable.applicationStatus, "approved"));

  const mediaCounts = await db
    .select({ dollId: mediaTable.dollId, type: mediaTable.type, c: sql<number>`count(*)::int` })
    .from(mediaTable)
    .where(eq(mediaTable.status, "approved"))
    .groupBy(mediaTable.dollId, mediaTable.type);

  const favCounts = await db
    .select({ dollId: favoritesTable.dollId, c: sql<number>`count(*)::int` })
    .from(favoritesTable)
    .groupBy(favoritesTable.dollId);

  const premiumPhotoByDoll = new Map<number, number>();
  const premiumVideoByDoll = new Map<number, number>();
  for (const row of mediaCounts) {
    if (row.type === "premium_photo") premiumPhotoByDoll.set(row.dollId, row.c);
    else if (row.type === "premium_video") premiumVideoByDoll.set(row.dollId, row.c);
  }
  const favByDoll = new Map<number, number>();
  for (const row of favCounts) favByDoll.set(row.dollId, row.c);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const withRevenue = dolls.map((d) => {
    const { totalEarnings } = computeDollEarnings(d, {
      favoriteCount: favByDoll.get(d.id) ?? 0,
      premiumPhotoCount: premiumPhotoByDoll.get(d.id) ?? 0,
      premiumVideoCount: premiumVideoByDoll.get(d.id) ?? 0,
    });
    return { doll: d, revenue: round2(totalEarnings) };
  });

  const totalRevenue = withRevenue.reduce((sum, r) => sum + r.revenue, 0);

  const result = withRevenue
    .map((r) => ({
      dollId: r.doll.id,
      stageName: r.doll.stageName,
      profilePhotoUrl: r.doll.profilePhotoUrl ?? "",
      verified: r.doll.verified,
      revenue: r.revenue,
      share: totalRevenue > 0 ? Math.round((r.revenue / totalRevenue) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json(result);
});

router.get("/admin/applications", requireAuth("admin"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({ doll: dollsTable, email: usersTable.email })
    .from(dollsTable)
    .leftJoin(usersTable, eq(dollsTable.userId, usersTable.id))
    .where(eq(dollsTable.applicationStatus, "pending"))
    .orderBy(sql`${dollsTable.createdAt} asc`);
  res.json(
    rows.map((r) => ({
      id: r.doll.id,
      userId: r.doll.userId,
      legalName: r.doll.legalName ?? "",
      stageName: r.doll.stageName,
      email: r.email ?? "",
      city: r.doll.city,
      state: r.doll.state,
      favoriteFlavor: r.doll.favoriteFlavor ?? "",
      experienceLevel: r.doll.experienceLevel ?? "",
      bio: r.doll.bio ?? "",
      profilePhotoUrl: r.doll.profilePhotoUrl ?? "",
      verificationPhotoUrl: r.doll.verificationPhotoUrl ?? "",
      verificationVideoUrl: r.doll.verificationVideoUrl ?? "",
      governmentIdUrl: r.doll.governmentIdUrl ?? "",
      status: r.doll.applicationStatus as "pending" | "approved" | "rejected",
      createdAt: r.doll.createdAt ? r.doll.createdAt.toISOString() : undefined,
    })),
  );
});

router.patch("/admin/applications/:id/review", requireAuth("admin"), async (req, res): Promise<void> => {
  const params = ReviewDollApplicationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReviewDollApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.decision === "approve" ? "approved" : "rejected";
  const doll = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(dollsTable)
      .set({ applicationStatus: status })
      .where(eq(dollsTable.id, params.data.id))
      .returning();
    if (!updated) return null;
    await tx
      .update(usersTable)
      .set({ accountStatus: status === "approved" ? "active" : "suspended" })
      .where(eq(usersTable.id, updated.userId));
    if (status === "approved") {
      await tx
        .insert(creatorAlbumsTable)
        .values([
          {
            creatorUserId: updated.userId,
            dollId: updated.id,
            albumType: "free_preview",
            title: "Free Preview Album",
            description: "Up to five free preview images.",
          },
          {
            creatorUserId: updated.userId,
            dollId: updated.id,
            albumType: "cloud_vibes",
            title: "Cloud Vibes Album",
            description: "Permanent access for 25 credits.",
          },
          {
            creatorUserId: updated.userId,
            dollId: updated.id,
            albumType: "smokin_hot",
            title: "Smokin Hot Album",
            description: "Includes Cloud Vibes with permanent access.",
          },
        ])
        .onConflictDoNothing();
    }
    return updated;
  });
  if (!doll) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  res.json({
    id: doll.id,
    userId: doll.userId,
    stageName: doll.stageName,
    status: doll.applicationStatus as "pending" | "approved" | "rejected",
  });
});

router.get("/admin/users", requireAuth("admin"), async (req, res): Promise<void> => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = [];
  if (parsed.data.role) conditions.push(eq(usersTable.role, parsed.data.role));
  if (parsed.data.buddyType === "missing") {
    conditions.push(isNull(usersTable.buddyType));
    conditions.push(inArray(usersTable.role, ["member", "doll"]));
  }
  else if (parsed.data.buddyType) conditions.push(eq(usersTable.buddyType, parsed.data.buddyType));
  const rows = conditions.length
    ? await db.select().from(usersTable).where(and(...conditions)).orderBy(sql`${usersTable.createdAt} desc`)
    : await db.select().from(usersTable).orderBy(sql`${usersTable.createdAt} desc`);

  const result = await Promise.all(
    rows.map(async (u) => {
      let verified = false;
      if (u.dollId) {
        const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, u.dollId));
        verified = doll?.verified ?? false;
      }
      return {
        id: u.id,
        role: u.role as "doll" | "member" | "admin",
        email: u.email,
        name: u.name,
        accountStatus: u.accountStatus as "active" | "pending" | "suspended" | "banned",
        buddyType: u.buddyType ?? null,
        dollId: u.dollId ?? null,
        verified,
        createdAt: u.createdAt ? u.createdAt.toISOString() : undefined,
      };
    }),
  );
  res.json(result);
});

router.post("/admin/users/:id/status", requireAuth("admin"), async (req, res): Promise<void> => {
  const params = UpdateUserStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [u] = await db
    .update(usersTable)
    .set({ accountStatus: parsed.data.accountStatus })
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!u) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: u.id,
    role: u.role as "doll" | "member" | "admin",
    email: u.email,
    name: u.name,
    accountStatus: u.accountStatus as "active" | "pending" | "suspended" | "banned",
    buddyType: u.buddyType ?? null,
    dollId: u.dollId ?? null,
    verified: false,
    createdAt: u.createdAt ? u.createdAt.toISOString() : undefined,
  });
});

router.patch("/admin/users/:id/buddy-type", requireAuth("admin"), async (req, res): Promise<void> => {
  const params = UpdateUserBuddyTypeParams.safeParse(req.params);
  const body = UpdateUserBuddyTypeBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (existing.role !== "member" && existing.role !== "doll") {
    res.status(400).json({ error: "Buddy type can only be set for personal accounts" });
    return;
  }
  const [u] = await db
    .update(usersTable)
    .set({ buddyType: body.data.buddyType })
    .where(eq(usersTable.id, existing.id))
    .returning();
  let verified = false;
  if (u.dollId) {
    const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, u.dollId));
    verified = doll?.verified ?? false;
  }
  res.json({
    id: u.id,
    role: u.role as "doll" | "member" | "admin",
    email: u.email,
    name: u.name,
    accountStatus: u.accountStatus as "active" | "pending" | "suspended" | "banned",
    buddyType: u.buddyType,
    dollId: u.dollId ?? null,
    verified,
    createdAt: u.createdAt.toISOString(),
  });
});

export default router;
