import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, boostsTable } from "@workspace/db";
import { PurchaseBoostBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const BOOST_CONFIG: Record<string, { label: string; price: number; hours: number }> = {
  boost_24h: { label: "24-Hour Spotlight", price: 9.99, hours: 24 },
  boost_3d: { label: "3-Day Spotlight", price: 24.99, hours: 72 },
  boost_7d: { label: "7-Day Spotlight", price: 49.99, hours: 168 },
};

function toBoost(b: typeof boostsTable.$inferSelect) {
  const cfg = BOOST_CONFIG[b.type];
  return {
    id: b.id,
    dollId: b.dollId,
    type: b.type as "boost_24h" | "boost_3d" | "boost_7d",
    label: cfg?.label ?? b.type,
    price: b.price,
    expiresAt: b.expiresAt.toISOString(),
    createdAt: b.createdAt ? b.createdAt.toISOString() : undefined,
  };
}

router.get("/boosts", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Doll profile not found" });
    return;
  }
  const rows = await db
    .select()
    .from(boostsTable)
    .where(eq(boostsTable.dollId, user.dollId))
    .orderBy(sql`${boostsTable.createdAt} desc`);
  res.json(rows.map(toBoost));
});

router.post("/boosts", requireAuth("doll"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (!user.dollId) {
    res.status(404).json({ error: "Doll profile not found" });
    return;
  }
  const parsed = PurchaseBoostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const cfg = BOOST_CONFIG[parsed.data.type];
  if (!cfg) {
    res.status(400).json({ error: "Invalid boost type" });
    return;
  }
  const expiresAt = new Date(Date.now() + cfg.hours * 60 * 60 * 1000);
  const [b] = await db
    .insert(boostsTable)
    .values({ dollId: user.dollId, type: parsed.data.type, price: cfg.price, expiresAt })
    .returning();
  res.status(201).json(toBoost(b));
});

export default router;
