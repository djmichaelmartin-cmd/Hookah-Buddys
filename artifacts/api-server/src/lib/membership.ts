import { and, desc, eq, isNull } from "drizzle-orm";
import { db, subscriptionsTable, plansTable, type Plan, type Subscription } from "@workspace/db";
import { nextBillingDate } from "@workspace/pricing";
import { refreshMembershipCredits } from "./credits";

/**
 * The member's active membership = the most recent active subscription that is
 * not tied to a specific Doll (those are content subscriptions, not the
 * recurring membership plan that includes monthly credits).
 */
export async function getActiveMembership(
  userId: number,
): Promise<{ sub: Subscription; plan: Plan } | null> {
  const [row] = await db
    .select({ sub: subscriptionsTable, plan: plansTable })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(
      and(
        eq(subscriptionsTable.memberUserId, userId),
        eq(subscriptionsTable.status, "active"),
        isNull(subscriptionsTable.dollId),
      ),
    )
    .orderBy(desc(subscriptionsTable.startedAt))
    .limit(1);
  return row ? { sub: row.sub, plan: row.plan } : null;
}

/**
 * Activate (or switch) a member's recurring membership plan. Cancels any prior
 * active membership, sets the current billing period, and resets the member's
 * monthly membership credits to the plan's included amount. Returns the new
 * subscription row.
 */
export async function activateMembership(userId: number, plan: Plan): Promise<Subscription> {
  // Only one active membership at a time; cancel the previous one so "current
  // membership" stays unambiguous.
  await db
    .update(subscriptionsTable)
    .set({ status: "canceled" })
    .where(
      and(
        eq(subscriptionsTable.memberUserId, userId),
        eq(subscriptionsTable.status, "active"),
        isNull(subscriptionsTable.dollId),
      ),
    );

  const currentPeriodEnd = plan.monthlyCredits > 0 ? nextBillingDate() : null;
  const [sub] = await db
    .insert(subscriptionsTable)
    .values({ memberUserId: userId, planId: plan.id, status: "active", currentPeriodEnd })
    .returning();

  await refreshMembershipCredits(userId, plan.monthlyCredits, plan.name);
  return sub;
}

/**
 * Process a successful billing-cycle renewal for the member's active membership:
 * advance the billing period and refresh (reset) the monthly membership credits.
 * Returns the refreshed plan + new period end, or null if there is no active
 * membership. This is what a real Stripe `invoice.payment_succeeded` webhook
 * would trigger.
 */
export async function renewMembership(
  userId: number,
): Promise<{ plan: Plan; currentPeriodEnd: Date } | null> {
  const active = await getActiveMembership(userId);
  if (!active) return null;
  const { sub, plan } = active;
  const base =
    sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()
      ? sub.currentPeriodEnd
      : new Date();
  const currentPeriodEnd = nextBillingDate(base);
  await db
    .update(subscriptionsTable)
    .set({ currentPeriodEnd })
    .where(eq(subscriptionsTable.id, sub.id));
  await refreshMembershipCredits(userId, plan.monthlyCredits, plan.name);
  return { plan, currentPeriodEnd };
}
