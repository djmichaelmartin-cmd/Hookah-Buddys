import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, subscriptionsTable, plansTable, dollsTable, type Subscription, type Plan } from "@workspace/db";
import { CreateSubscriptionBody } from "@workspace/api-zod";
import { DOLL_SUBSCRIPTION_TIERS } from "@workspace/pricing";
import { requireAuth } from "../lib/auth";
import { activateMembership, getActiveMembership } from "../lib/membership";

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

  // Content subscription to a specific Doll. Gated on the member's CURRENT
  // active membership tier (not the client-submitted plan) so a Bronze member
  // cannot self-select a Gold plan id to bypass the gate. These are not the
  // recurring membership plan and do not grant monthly credits.
  //
  // Doll subscriptions are already transitively payment-gated because the
  // required Gold/Platinum membership itself must have been activated via a
  // verified Stripe webhook.
  if (parsed.data.dollId) {
    const active = await getActiveMembership(user.id);
    if (
      !active ||
      !DOLL_SUBSCRIPTION_TIERS.includes(active.plan.tier as (typeof DOLL_SUBSCRIPTION_TIERS)[number])
    ) {
      res.status(403).json({ error: "A Gold or Platinum membership is required to unlock a Buddy's premium content" });
      return;
    }
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({ memberUserId: user.id, planId: active.plan.id, dollId: parsed.data.dollId, status: "active" })
      .returning();
    const [doll] = await db.select().from(dollsTable).where(eq(dollsTable.id, sub.dollId!));
    res.status(201).json(serializeSubscription(sub, active.plan, doll?.stageName ?? null));
    return;
  }

  // Recurring membership plan subscription.
  //
  // Free plans (price = 0, e.g. Bronze) can be activated directly — no
  // payment is needed. Paid plans must go through Stripe: the client should
  // call POST /checkout with purpose="membership", redirect the user to the
  // returned Stripe URL, and let the checkout.session.completed webhook
  // activate the membership server-side. Allowing direct paid-plan activation
  // here would let any authenticated user gain Silver/Gold/Platinum credits
  // without paying.
  if (plan.price > 0) {
    res.status(402).json({
      error:
        "Paid memberships require payment. Use POST /checkout with purpose='membership' " +
        "to create a Stripe checkout session and redirect the user to the returned URL.",
      checkoutRequired: true,
    });
    return;
  }

  // Free plan (price === 0): activate directly.
  const sub = await activateMembership(user.id, plan);
  res.status(201).json(serializeSubscription(sub, plan, null));
});

export default router;
