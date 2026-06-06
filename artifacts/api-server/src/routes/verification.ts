import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, verificationsTable, dollsTable } from "@workspace/db";
import { SubmitVerificationBody, ReviewVerificationParams, ReviewVerificationBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function toVerification(v: typeof verificationsTable.$inferSelect, dollName?: string) {
  return {
    id: v.id,
    dollId: v.dollId,
    dollName: dollName ?? "",
    governmentIdUrl: v.governmentIdUrl ?? "",
    selfieUrl: v.selfieUrl ?? "",
    hookahPhotoUrl: v.hookahPhotoUrl ?? "",
    hookahVideoUrl: v.hookahVideoUrl ?? "",
    status: v.status as "pending" | "approved" | "rejected",
    notes: v.notes ?? null,
    createdAt: v.createdAt ? v.createdAt.toISOString() : undefined,
  };
}

router.post("/verification", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Doll profile not found" });
    return;
  }
  const parsed = SubmitVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [v] = await db
    .insert(verificationsTable)
    .values({
      dollId: user.dollId,
      governmentIdUrl: parsed.data.governmentIdUrl,
      selfieUrl: parsed.data.selfieUrl,
      hookahPhotoUrl: parsed.data.hookahPhotoUrl,
      hookahVideoUrl: parsed.data.hookahVideoUrl,
      status: "pending",
    })
    .returning();
  res.status(201).json(toVerification(v, user.name));
});

router.get("/verification/mine", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Doll profile not found" });
    return;
  }
  const [v] = await db
    .select()
    .from(verificationsTable)
    .where(eq(verificationsTable.dollId, user.dollId))
    .orderBy(sql`${verificationsTable.createdAt} desc`)
    .limit(1);
  if (!v) {
    res.json({ status: "unverified" });
    return;
  }
  res.json(toVerification(v, user.name));
});

router.get("/admin/verifications/pending", requireAuth("admin"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({ v: verificationsTable, dollName: dollsTable.stageName })
    .from(verificationsTable)
    .leftJoin(dollsTable, eq(verificationsTable.dollId, dollsTable.id))
    .where(eq(verificationsTable.status, "pending"))
    .orderBy(sql`${verificationsTable.createdAt} asc`);
  res.json(rows.map((r) => toVerification(r.v, r.dollName ?? "")));
});

router.post("/admin/verifications/:id/review", requireAuth("admin"), async (req, res): Promise<void> => {
  const params = ReviewVerificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReviewVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const status = parsed.data.decision === "approve" ? "approved" : "rejected";
  const [v] = await db
    .update(verificationsTable)
    .set({ status, notes: parsed.data.notes ?? null })
    .where(eq(verificationsTable.id, params.data.id))
    .returning();
  if (!v) {
    res.status(404).json({ error: "Verification not found" });
    return;
  }
  if (status === "approved") {
    await db.update(dollsTable).set({ verified: true }).where(eq(dollsTable.id, v.dollId));
  }
  res.json(toVerification(v));
});

export default router;
