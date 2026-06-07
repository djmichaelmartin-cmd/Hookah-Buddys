import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  dollsTable,
  mediaTable,
  verificationsTable,
  reportsTable,
} from "@workspace/db";
import { ReviewDollApplicationParams, ReviewDollApplicationBody, ListUsersQueryParams, UpdateUserStatusParams, UpdateUserStatusBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

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

  const totalRevenue = (totalMembers?.c ?? 0) * 39.99 + (totalDolls?.c ?? 0) * 24.99;
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
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    revenueTrend,
  });
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
  const [doll] = await db
    .update(dollsTable)
    .set({ applicationStatus: status })
    .where(eq(dollsTable.id, params.data.id))
    .returning();
  if (!doll) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  await db
    .update(usersTable)
    .set({ accountStatus: status === "approved" ? "active" : "suspended" })
    .where(eq(usersTable.id, doll.userId));
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
  const rows = parsed.data.role
    ? await db.select().from(usersTable).where(eq(usersTable.role, parsed.data.role)).orderBy(sql`${usersTable.createdAt} desc`)
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
    dollId: u.dollId ?? null,
    verified: false,
    createdAt: u.createdAt ? u.createdAt.toISOString() : undefined,
  });
});

export default router;
