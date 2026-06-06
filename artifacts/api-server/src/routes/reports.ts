import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, reportsTable, usersTable } from "@workspace/db";
import { CreateReportBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/admin/reports", requireAuth("admin"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({ r: reportsTable, reporterName: usersTable.name })
    .from(reportsTable)
    .leftJoin(usersTable, eq(reportsTable.reporterUserId, usersTable.id))
    .orderBy(sql`${reportsTable.createdAt} desc`);
  res.json(
    rows.map((row) => ({
      id: row.r.id,
      reporterId: row.r.reporterUserId,
      reporterName: row.reporterName ?? "",
      targetType: row.r.targetType as "user" | "media" | "doll" | "message",
      targetId: row.r.targetId,
      reason: row.r.reason,
      details: row.r.details ?? "",
      status: row.r.status as "open" | "resolved" | "dismissed",
      createdAt: row.r.createdAt ? row.r.createdAt.toISOString() : undefined,
    })),
  );
});

router.post("/reports", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [r] = await db
    .insert(reportsTable)
    .values({
      reporterUserId: user.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason,
      details: parsed.data.details,
      status: "open",
    })
    .returning();
  res.status(201).json({
    id: r.id,
    reporterId: r.reporterUserId,
    reporterName: user.name,
    targetType: r.targetType as "user" | "media" | "doll" | "message",
    targetId: r.targetId,
    reason: r.reason,
    details: r.details ?? "",
    status: r.status as "open" | "resolved" | "dismissed",
    createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
  });
});

export default router;
