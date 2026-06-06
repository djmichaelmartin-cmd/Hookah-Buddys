import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, subscriptionsTable, plansTable, dollsTable } from "@workspace/db";
import { CreateSubscriptionBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/subscriptions", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select({ sub: subscriptionsTable, plan: plansTable, doll: dollsTable })
    .from(subscriptionsTable)
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .leftJoin(dollsTable, eq(subscriptionsTable.dollId, dollsTable.id))
    .where(eq(subscriptionsTable.memberUserId, user.id))
    .orderBy(sql`${subscriptionsTable.startedAt} desc`);
  res.json(
    rows.map((r) => ({
      id: r.sub.id,
      planId: r.sub.planId,
      planName: r.plan?.name ?? "",
      audience: r.plan?.audience ?? "member",
      dollId: r.sub.dollId ?? null,
      dollName: r.doll?.stageName ?? null,
      price: r.plan?.price ?? 0,
      status: r.sub.status as "active" | "canceled",
      startedAt: r.sub.startedAt ? r.sub.startedAt.toISOString() : undefined,
    })),
  );
});

router.post("/subscriptions", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, parsed.data.planId));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  const [sub] = await db
    .insert(subscriptionsTable)
    .values({
      memberUserId: user.id,
      planId: parsed.data.planId,
      dollId: parsed.data.dollId ?? null,
      status: "active",
    })
    .returning();
  let dollName: string | null = null;
  if (sub.dollId) {
    const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, sub.dollId));
    dollName = doll?.stageName ?? null;
  }
  res.status(201).json({
    id: sub.id,
    planId: sub.planId,
    planName: plan.name,
    audience: plan.audience,
    dollId: sub.dollId ?? null,
    dollName,
    price: plan.price,
    status: sub.status as "active" | "canceled",
    startedAt: sub.startedAt ? sub.startedAt.toISOString() : undefined,
  });
});

export default router;
