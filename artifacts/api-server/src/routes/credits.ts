import { Router, type IRouter } from "express";
import { eq, sql, and, desc, isNull } from "drizzle-orm";
import {
  db,
  creditBalancesTable,
  creditTransactionsTable,
  creditPackagesTable,
  usersTable,
  subscriptionsTable,
  plansTable,
} from "@workspace/db";
import {
  PurchaseCreditsBody,
  UpdateCreditPackageBody,
  UpdateCreditPackageParams,
  CreateCreditAdjustmentBody,
  ListAdminCreditTransactionsQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { grantCredits, adjustCredits } from "../lib/credits";

const router: IRouter = Router();

type TxnType = "purchase" | "spend" | "adjustment" | "membership" | "expiry";

async function ensureBalance(userId: number) {
  const [bal] = await db.select().from(creditBalancesTable).where(eq(creditBalancesTable.userId, userId));
  if (bal) return bal;
  const [created] = await db
    .insert(creditBalancesTable)
    .values({ userId, membershipBalance: 0, purchasedBalance: 0 })
    .returning();
  return created;
}

/**
 * Membership context for the member's active (non-doll) membership: included
 * monthly credits, the next refresh date, and the plan name. Empty when the
 * member has no active membership.
 */
async function getMembershipInfo(userId: number) {
  const [row] = await db
    .select({ sub: subscriptionsTable, plan: plansTable })
    .from(subscriptionsTable)
    .leftJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(
      and(
        eq(subscriptionsTable.memberUserId, userId),
        eq(subscriptionsTable.status, "active"),
        isNull(subscriptionsTable.dollId),
      ),
    )
    .orderBy(desc(subscriptionsTable.startedAt))
    .limit(1);
  return {
    monthlyMembershipCredits: row?.plan?.monthlyCredits ?? 0,
    nextRefreshAt: row?.sub.currentPeriodEnd ? row.sub.currentPeriodEnd.toISOString() : null,
    membershipPlanName: row?.plan?.name ?? null,
  };
}

function serializeTxn(t: typeof creditTransactionsTable.$inferSelect) {
  return {
    id: t.id,
    amount: t.amount,
    type: t.type as TxnType,
    description: t.description ?? "",
    amountCents: t.amountCents ?? null,
    createdAt: t.createdAt ? t.createdAt.toISOString() : undefined,
  };
}

function serializePackage(p: typeof creditPackagesTable.$inferSelect) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    priceCents: p.priceCents,
    credits: p.credits,
    label: p.label ?? null,
    active: p.active,
    sortOrder: p.sortOrder,
  };
}

async function balancePayload(userId: number) {
  const bal = await ensureBalance(userId);
  const [txns, membership] = await Promise.all([
    db
      .select()
      .from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.userId, userId))
      .orderBy(desc(creditTransactionsTable.createdAt)),
    getMembershipInfo(userId),
  ]);
  return {
    balance: bal.membershipBalance + bal.purchasedBalance,
    membershipBalance: bal.membershipBalance,
    purchasedBalance: bal.purchasedBalance,
    monthlyMembershipCredits: membership.monthlyMembershipCredits,
    nextRefreshAt: membership.nextRefreshAt,
    membershipPlanName: membership.membershipPlanName,
    transactions: txns.map(serializeTxn),
  };
}

// Public: packages available to purchase.
router.get("/credit-packages", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(creditPackagesTable)
    .where(eq(creditPackagesTable.active, true))
    .orderBy(creditPackagesTable.sortOrder);
  res.json(rows.map(serializePackage));
});

router.get("/credits", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  res.json(await balancePayload(user.id));
});

router.post("/credits/purchase", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = PurchaseCreditsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [pkg] = await db
    .select()
    .from(creditPackagesTable)
    .where(and(eq(creditPackagesTable.id, parsed.data.packageId), eq(creditPackagesTable.active, true)));
  if (!pkg) {
    res.status(404).json({ error: "Credit package not found" });
    return;
  }
  // Placeholder checkout: no real charge. Credits granted immediately, applied
  // atomically together with the ledger entry.
  await grantCredits(user.id, pkg.credits, {
    type: "purchase",
    description: `Purchased ${pkg.name} pack (${pkg.credits} credits)`,
    amountCents: pkg.priceCents,
    packageId: pkg.id,
  });
  res.status(201).json(await balancePayload(user.id));
});

// ----- Admin -----

router.get("/admin/credit-packages", requireAuth("admin"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(creditPackagesTable).orderBy(creditPackagesTable.sortOrder);
  res.json(rows.map(serializePackage));
});

router.patch("/admin/credit-packages/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const params = UpdateCreditPackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCreditPackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(creditPackagesTable)
    .set(updates)
    .where(eq(creditPackagesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Credit package not found" });
    return;
  }
  res.json(serializePackage(updated));
});

router.get("/admin/credit-transactions", requireAuth("admin"), async (req, res): Promise<void> => {
  const q = ListAdminCreditTransactionsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const { userId, type, limit, offset } = q.data;
  const filters = [];
  if (userId !== undefined) filters.push(eq(creditTransactionsTable.userId, userId));
  if (type !== undefined) filters.push(eq(creditTransactionsTable.type, type));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const take = Math.min(limit ?? 50, 200);
  const skip = offset ?? 0;

  const rows = await db
    .select({ txn: creditTransactionsTable, name: usersTable.name, email: usersTable.email })
    .from(creditTransactionsTable)
    .leftJoin(usersTable, eq(creditTransactionsTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(creditTransactionsTable.createdAt))
    .limit(take)
    .offset(skip);

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(creditTransactionsTable)
    .where(where);

  res.json({
    items: rows.map((r) => ({
      ...serializeTxn(r.txn),
      userId: r.txn.userId,
      userName: r.name ?? "",
      userEmail: r.email ?? "",
    })),
    total: count,
  });
});

router.post("/admin/credit-adjustments", requireAuth("admin"), async (req, res): Promise<void> => {
  const parsed = CreateCreditAdjustmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, amount, note } = parsed.data;
  if (amount === 0) {
    res.status(400).json({ error: "Adjustment amount cannot be zero" });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const description = note?.trim()
    ? note.trim()
    : `Admin ${amount > 0 ? "granted" : "deducted"} ${Math.abs(amount)} credits`;
  // Apply atomically; the ledger records the post-clamp applied delta so balance
  // and history always reconcile.
  const { txn } = await adjustCredits(userId, amount, description);
  res.status(201).json({
    ...serializeTxn(txn),
    userId,
    userName: target.name ?? "",
    userEmail: target.email ?? "",
  });
});

export default router;
