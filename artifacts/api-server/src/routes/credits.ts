import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, creditBalancesTable, creditTransactionsTable } from "@workspace/db";
import { PurchaseCreditsBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

async function ensureBalance(userId: number) {
  const [bal] = await db.select().from(creditBalancesTable).where(eq(creditBalancesTable.userId, userId));
  if (bal) return bal;
  const [created] = await db.insert(creditBalancesTable).values({ userId, balance: 0 }).returning();
  return created;
}

router.get("/credits", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const bal = await ensureBalance(user.id);
  const txns = await db
    .select()
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.userId, user.id))
    .orderBy(sql`${creditTransactionsTable.createdAt} desc`);
  res.json({
    balance: bal.balance,
    transactions: txns.map((t) => ({
      id: t.id,
      amount: t.amount,
      type: t.type as "purchase" | "spend",
      description: t.description ?? "",
      createdAt: t.createdAt ? t.createdAt.toISOString() : undefined,
    })),
  });
});

router.post("/credits/purchase", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = PurchaseCreditsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const bal = await ensureBalance(user.id);
  const [updated] = await db
    .update(creditBalancesTable)
    .set({ balance: bal.balance + parsed.data.credits })
    .where(eq(creditBalancesTable.userId, user.id))
    .returning();
  await db.insert(creditTransactionsTable).values({
    userId: user.id,
    amount: parsed.data.credits,
    type: "purchase",
    description: `Purchased ${parsed.data.credits} credits`,
  });
  const txns = await db
    .select()
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.userId, user.id))
    .orderBy(sql`${creditTransactionsTable.createdAt} desc`);
  res.status(201).json({
    balance: updated.balance,
    transactions: txns.map((t) => ({
      id: t.id,
      amount: t.amount,
      type: t.type as "purchase" | "spend",
      description: t.description ?? "",
      createdAt: t.createdAt ? t.createdAt.toISOString() : undefined,
    })),
  });
});

export default router;
