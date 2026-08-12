import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, plansTable } from "@workspace/db";
import { ListPlansQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/plans", async (req, res): Promise<void> => {
  const parsed = ListPlansQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = parsed.data.audience
    ? await db.select().from(plansTable).where(eq(plansTable.audience, parsed.data.audience))
    : await db.select().from(plansTable);
  res.json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug ?? "",
      stripePriceId: p.stripePriceId ?? "",
      audience: p.audience as "member" | "doll",
      price: p.price,
      interval: p.interval ?? "",
      tier: p.tier,
      monthlyCredits: p.monthlyCredits ?? 0,
      description: p.description ?? "",
      features: p.features ?? [],
      highlighted: p.highlighted,
    })),
  );
});

export default router;
