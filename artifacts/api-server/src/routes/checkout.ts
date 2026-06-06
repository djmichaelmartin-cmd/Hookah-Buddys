import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { CreateCheckoutBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.post("/checkout", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const parsed = CreateCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json({
    id: `cs_placeholder_${randomUUID()}`,
    status: "placeholder",
    amount: parsed.data.amount,
    purpose: parsed.data.purpose,
    message:
      "Stripe integration placeholder — no real charge was made. Connect a Stripe account to enable live payments.",
  });
});

export default router;
