import { eq, sql } from "drizzle-orm";
import {
  db,
  creditBalancesTable,
  creditTransactionsTable,
  type CreditTransaction,
} from "@workspace/db";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Thrown inside a `spendCredits` action to roll back the debit (e.g. when a
 * concurrent request already performed the underlying action). The charge is
 * undone because it shares the transaction.
 */
export class AbortSpendError extends Error {
  constructor(message = "spend aborted") {
    super(message);
    this.name = "AbortSpendError";
  }
}

async function ensureBalanceRow(tx: Tx, userId: number): Promise<void> {
  await tx
    .insert(creditBalancesTable)
    .values({ userId, membershipBalance: 0, purchasedBalance: 0 })
    .onConflictDoNothing({ target: creditBalancesTable.userId });
}

/**
 * Atomically debit `cost` credits from a user and run `action` in the same
 * transaction. Membership credits are spent first, then purchased credits.
 *
 * The debit uses a single conditional UPDATE guarded on the combined balance
 * (`membership + purchased >= cost`) so concurrent spends cannot overspend.
 * Postgres evaluates every SET right-hand side against the pre-update row, so
 * both columns drain from the original values consistently:
 *   - membership -> GREATEST(membership - cost, 0)   (drained first)
 *   - purchased  -> purchased - GREATEST(cost - membership, 0)  (covers the rest)
 *
 * The caller's `action` is responsible for inserting both the domain row
 * (message/unlock/video) and the credit transaction so reference ids stay
 * consistent. Returns `{ ok: false }` when the user has insufficient combined
 * credits (nothing is written).
 */
export async function spendCredits<T>(
  userId: number,
  cost: number,
  action: (tx: Tx) => Promise<T>,
): Promise<{ ok: true; balance: number; result: T } | { ok: false }> {
  return db.transaction(async (tx) => {
    await ensureBalanceRow(tx, userId);
    const [row] = await tx
      .update(creditBalancesTable)
      .set({
        membershipBalance: sql`GREATEST(${creditBalancesTable.membershipBalance} - ${cost}, 0)`,
        purchasedBalance: sql`${creditBalancesTable.purchasedBalance} - GREATEST(${cost} - ${creditBalancesTable.membershipBalance}, 0)`,
      })
      .where(
        sql`${creditBalancesTable.userId} = ${userId} AND (${creditBalancesTable.membershipBalance} + ${creditBalancesTable.purchasedBalance}) >= ${cost}`,
      )
      .returning();
    if (!row) return { ok: false as const };
    const result = await action(tx);
    return { ok: true as const, balance: row.membershipBalance + row.purchasedBalance, result };
  });
}

/**
 * Atomically add `amount` purchased (non-expiring) credits and record a
 * transaction in one transaction. Returns the new combined balance.
 */
export async function grantCredits(
  userId: number,
  amount: number,
  txnValues: { type: "purchase" | "adjustment"; description: string; amountCents?: number | null; packageId?: number | null },
): Promise<number> {
  return db.transaction(async (tx) => {
    await ensureBalanceRow(tx, userId);
    const [row] = await tx
      .update(creditBalancesTable)
      .set({ purchasedBalance: sql`${creditBalancesTable.purchasedBalance} + ${amount}` })
      .where(eq(creditBalancesTable.userId, userId))
      .returning();
    await tx.insert(creditTransactionsTable).values({ userId, amount, ...txnValues });
    return row.membershipBalance + row.purchasedBalance;
  });
}

/**
 * Atomically apply an admin adjustment to the user's purchased (non-expiring)
 * credits, clamping the purchased bucket at zero. The recorded transaction
 * stores the *applied* delta (post-clamp), so the ledger always reconciles even
 * when a deduction is clamped. Returns the new combined balance.
 */
export async function adjustCredits(
  userId: number,
  amount: number,
  description: string,
): Promise<{ balance: number; txn: CreditTransaction }> {
  return db.transaction(async (tx) => {
    await ensureBalanceRow(tx, userId);
    // Lock the balance row so concurrent adjustments serialize and cannot lose
    // updates (read-then-write last-write-wins). The lock is held until commit.
    const [before] = await tx
      .select()
      .from(creditBalancesTable)
      .where(eq(creditBalancesTable.userId, userId))
      .for("update");
    const newPurchased = Math.max(0, before.purchasedBalance + amount);
    const applied = newPurchased - before.purchasedBalance;
    await tx
      .update(creditBalancesTable)
      .set({ purchasedBalance: newPurchased })
      .where(eq(creditBalancesTable.userId, userId));
    const [txn] = await tx
      .insert(creditTransactionsTable)
      .values({ userId, amount: applied, type: "adjustment", description })
      .returning();
    return { balance: before.membershipBalance + newPurchased, txn };
  });
}

/**
 * Reset a user's membership credits for a new billing cycle. Any unused
 * membership credits from the previous cycle expire (logged as an `expiry`
 * transaction) — they do not roll over. The bucket is then set to
 * `monthlyCredits` (logged as a `membership` grant when positive). Purchased
 * credits are untouched. Returns the new combined balance.
 */
export async function refreshMembershipCredits(
  userId: number,
  monthlyCredits: number,
  planName: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    await ensureBalanceRow(tx, userId);
    const [before] = await tx
      .select()
      .from(creditBalancesTable)
      .where(eq(creditBalancesTable.userId, userId))
      .for("update");
    if (before.membershipBalance > 0) {
      await tx.insert(creditTransactionsTable).values({
        userId,
        amount: -before.membershipBalance,
        type: "expiry",
        description: "Unused membership credits expired",
      });
    }
    await tx
      .update(creditBalancesTable)
      .set({ membershipBalance: monthlyCredits })
      .where(eq(creditBalancesTable.userId, userId));
    if (monthlyCredits > 0) {
      await tx.insert(creditTransactionsTable).values({
        userId,
        amount: monthlyCredits,
        type: "membership",
        description: `Monthly membership credits — ${planName}`,
      });
    }
    return monthlyCredits + before.purchasedBalance;
  });
}
