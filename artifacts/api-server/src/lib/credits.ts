import { and, eq, gte, sql } from "drizzle-orm";
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
    .values({ userId, balance: 0 })
    .onConflictDoNothing({ target: creditBalancesTable.userId });
}

/**
 * Atomically debit `cost` credits from a user and run `action` in the same
 * transaction. The debit uses a conditional UPDATE (`balance >= cost`) so
 * concurrent spends cannot overspend. The caller's `action` is responsible for
 * inserting both the domain row (message/unlock/video) and the credit
 * transaction so reference ids stay consistent. Returns `{ ok: false }` when
 * the user has insufficient credits (nothing is written).
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
      .set({ balance: sql`${creditBalancesTable.balance} - ${cost}` })
      .where(
        and(eq(creditBalancesTable.userId, userId), gte(creditBalancesTable.balance, cost)),
      )
      .returning();
    if (!row) return { ok: false as const };
    const result = await action(tx);
    return { ok: true as const, balance: row.balance, result };
  });
}

/** Atomically add `amount` credits and record a transaction in one transaction. */
export async function grantCredits(
  userId: number,
  amount: number,
  txnValues: { type: "purchase" | "adjustment"; description: string; amountCents?: number | null; packageId?: number | null },
): Promise<number> {
  return db.transaction(async (tx) => {
    await ensureBalanceRow(tx, userId);
    const [row] = await tx
      .update(creditBalancesTable)
      .set({ balance: sql`${creditBalancesTable.balance} + ${amount}` })
      .where(eq(creditBalancesTable.userId, userId))
      .returning();
    await tx.insert(creditTransactionsTable).values({ userId, amount, ...txnValues });
    return row.balance;
  });
}

/**
 * Atomically apply an admin adjustment, clamping the resulting balance at zero.
 * The recorded transaction stores the *applied* delta (post-clamp), so the
 * ledger always reconciles with the balance even when a deduction is clamped.
 */
export async function adjustCredits(
  userId: number,
  amount: number,
  description: string,
): Promise<{ balance: number; txn: CreditTransaction }> {
  return db.transaction(async (tx) => {
    await ensureBalanceRow(tx, userId);
    const [before] = await tx
      .select()
      .from(creditBalancesTable)
      .where(eq(creditBalancesTable.userId, userId));
    const newBalance = Math.max(0, before.balance + amount);
    const applied = newBalance - before.balance;
    await tx
      .update(creditBalancesTable)
      .set({ balance: newBalance })
      .where(eq(creditBalancesTable.userId, userId));
    const [txn] = await tx
      .insert(creditTransactionsTable)
      .values({ userId, amount: applied, type: "adjustment", description })
      .returning();
    return { balance: newBalance, txn };
  });
}
