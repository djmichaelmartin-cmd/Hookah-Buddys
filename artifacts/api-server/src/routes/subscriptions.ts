import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, subscriptionsTable, plansTable, dollsTable, type Subscription, type Plan } from "@workspace/db";
import { CreateSubscriptionBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { activateMembership } from "../lib/membership";

const router: IRouter = Router();

function serializeSubscription(
  sub: Subscription,
  plan: Pick<Plan, "name" | "audience" | "price" | "monthlyCredits"> | null,
  dollName: string | null,
) {
  return {
    id: sub.id,
    planId: sub.planId,
    planName: plan?.name ?? "",
    audience: plan?.audience ?? "member",
    monthlyCredits: plan?.monthlyCredits ?? 0,
    dollId: sub.dollId ?? null,
    dollName,
    price: plan?.price ?? 0,
    status: sub.status as "active" | "canceled",
    startedAt: sub.startedAt ? sub.startedAt.toISOString() : undefined,
    currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
  };
}

router.get("/subscriptions", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select({ sub: subscriptionsTable, plan: plansTable, doll: dollsTable })
    .from(subscriptionsTable)
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .leftJoin(dollsTable, eq(subscriptionsTable.dollId, dollsTable.id))
    .where(eq(subscriptionsTable.memberUserId, user.id))
    .orderBy(sql`${subscriptionsTable.startedAt} desc`);
  res.json(rows.map((r) => serializeSubscription(r.sub, r.plan, r.doll?.stageName ?? null)));
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
  if (plan.audience !== "member") {
    res.status(400).json({ error: "Members can only subscribe to member plans" });
    return;
  }

  // Content subscription to a specific Doll (requires a Premium membership tier).
  // These are not the recurring membership plan and do not grant monthly credits.
  if (parsed.data.dollId) {
    if (plan.tier !== "premium") {
      res.status(400).json({ error: "A Premium membership is required to unlock a Doll's premium content" });
      return;
    }
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({ memberUserId: user.id, planId: plan.id, dollId: parsed.data.dollId, status: "active" })
      .returning();
    const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, sub.dollId!));
    res.status(201).json(serializeSubscription(sub, plan, doll?.stageName ?? null));
    return;
  }

  // Recurring membership plan: switch the active membership and grant the
  // plan's monthly membership credits for the new billing cycle.
  const sub = await activateMembership(user.id, plan);
  res.status(201).json(serializeSubscription(sub, plan, null));
});

export default router;
