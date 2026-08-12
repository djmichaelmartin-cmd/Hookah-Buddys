import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, plansTable, type Plan } from "@workspace/db";
import { UpdateAdminPlanBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function planToResponse(plan: Plan) {
  return {
    id: plan.id,
    name: plan.name,
    slug: plan.slug ?? "",
    stripePriceId: plan.stripePriceId ?? "",
    audience: plan.audience === "doll" ? ("doll" as const) : ("member" as const),
    price: plan.price,
    interval: plan.interval ?? "",
    tier: plan.tier,
    description: plan.description ?? "",
    features: plan.features ?? [],
    highlighted: plan.highlighted,
    monthlyCredits: plan.monthlyCredits ?? 0,
  };
}

router.get("/admin/plans", requireAuth("admin"), async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).orderBy(asc(plansTable.audience), asc(plansTable.price));
  res.json(plans.map(planToResponse));
});

router.get("/admin/plans/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(planToResponse(plan));
});

router.patch("/admin/plans/:id", requireAuth("admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const parsed = UpdateAdminPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, description, features } = parsed.data;
  const updates: Partial<Plan> = {};
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description;
  if (features !== undefined) updates.features = features.map((f) => f.trim()).filter((f) => f !== "");
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db.update(plansTable).set(updates).where(eq(plansTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(planToResponse(updated));
});

export default router;
