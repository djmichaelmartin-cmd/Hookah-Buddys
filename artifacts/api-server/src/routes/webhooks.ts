import { Router, type IRouter } from "express";
import { renewMembership } from "../lib/membership";

const router: IRouter = Router();

const RENEWAL_EVENTS = new Set(["invoice.payment_succeeded", "invoice.paid"]);

/**
 * Placeholder Stripe webhook. In a real integration Stripe POSTs billing events
 * here and the handler verifies the `Stripe-Signature` header against
 * STRIPE_WEBHOOK_SECRET before acting. We have no live Stripe, so:
 *   - If STRIPE_WEBHOOK_SECRET is set, require it via the `x-webhook-secret`
 *     header (a stand-in for real signature verification).
 *   - If it is not set, only process in non-production (dev/testing). Production
 *     fails closed so an unauthenticated endpoint can never grant credits.
 *
 * On a successful subscription renewal event we refresh (reset) the member's
 * monthly membership credits for the new billing cycle and advance the period.
 * Payload shape (placeholder): { type, data: { memberUserId } }.
 */
router.post("/webhooks/stripe", async (req, res): Promise<void> => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    if (req.header("x-webhook-secret") !== secret) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
  } else if (process.env.NODE_ENV === "production") {
    res.status(503).json({ error: "Stripe webhook not configured" });
    return;
  }

  const body = (req.body ?? {}) as { type?: string; data?: { memberUserId?: number } };
  const type = body.type ?? "";
  if (!RENEWAL_EVENTS.has(type)) {
    // Acknowledge unrelated events so Stripe does not retry them.
    res.json({ received: true, handled: false });
    return;
  }

  const memberUserId = Number(body.data?.memberUserId);
  if (!Number.isInteger(memberUserId) || memberUserId <= 0) {
    res.status(400).json({ error: "Missing memberUserId" });
    return;
  }

  const result = await renewMembership(memberUserId);
  if (!result) {
    req.log.warn({ memberUserId }, "stripe renewal: no active membership");
    res.json({ received: true, handled: false });
    return;
  }
  req.log.info(
    { memberUserId, plan: result.plan.name, credits: result.plan.monthlyCredits },
    "stripe renewal: membership credits refreshed",
  );
  res.json({ received: true, handled: true });
});

export default router;
