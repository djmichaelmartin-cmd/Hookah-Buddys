import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, plansTable, creditPackagesTable } from "@workspace/db";
import { CreateCheckoutBody } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { getStripeClient } from "../lib/stripe";

const router: IRouter = Router();

/**
 * POST /checkout
 *
 * Creates a real Stripe Checkout Session and returns the hosted-page URL.
 * The frontend should redirect the user to `response.url`.
 *
 * Membership activation and credit grants happen only after Stripe fires the
 * `checkout.session.completed` webhook — never from this endpoint directly.
 *
 * When STRIPE_SECRET_KEY is not set the endpoint returns 503 so failures are
 * explicit (no silent free-credit backdoor).
 *
 * Line items use the plan/package's stored `stripePriceId` when it is a real
 * Stripe ID (not a placeholder). Otherwise `price_data` is used as a fallback
 * for development environments before the seed-stripe-products script has been
 * run.
 */
router.post("/checkout", requireAuth("member", "doll"), async (req, res): Promise<void> => {
  const parsed = CreateCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({
      error:
        "Payment processing is not configured on this server. Set STRIPE_SECRET_KEY to enable checkout.",
    });
    return;
  }

  const user = req.currentUser!;
  const { purpose, referenceId } = parsed.data;

  const origin = `https://${
    process.env.REPLIT_DOMAINS?.split(",")[0] ??
    process.env.REPLIT_DEV_DOMAIN ??
    "localhost"
  }`;

  // ── Membership checkout ──────────────────────────────────────────────────
  if (purpose === "membership") {
    if (!referenceId) {
      res.status(400).json({ error: "referenceId (planId) is required for membership checkout" });
      return;
    }
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, referenceId));
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    if (plan.price === 0) {
      res.status(400).json({
        error: "Free plans do not require checkout. Use POST /subscriptions directly.",
      });
      return;
    }

    const isRealPriceId =
      plan.stripePriceId && !plan.stripePriceId.startsWith("price_placeholder");

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = isRealPriceId
      ? [{ price: plan.stripePriceId!, quantity: 1 }]
      : [
          {
            price_data: {
              currency: "usd",
              unit_amount: Math.round(plan.price * 100),
              recurring: { interval: "month" },
              product_data: { name: `${plan.name} Membership` },
            },
            quantity: 1,
          },
        ];

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: String(user.id),
        metadata: { purpose: "membership", planId: String(plan.id) },
        line_items: lineItems,
        success_url: `${origin}/?checkout=success`,
        cancel_url: `${origin}/pricing?checkout=cancelled`,
      });
    } catch (err) {
      req.log.error({ err }, "Stripe checkout session creation failed (membership)");
      res.status(502).json({ error: "Failed to create Stripe checkout session" });
      return;
    }

    res.status(201).json({
      id: session.id,
      status: "open",
      amount: plan.price,
      purpose: "membership",
      url: session.url,
    });
    return;
  }

  // ── Credits checkout ─────────────────────────────────────────────────────
  if (purpose === "credits") {
    if (!referenceId) {
      res.status(400).json({ error: "referenceId (packageId) is required for credits checkout" });
      return;
    }
    const [pkg] = await db
      .select()
      .from(creditPackagesTable)
      .where(eq(creditPackagesTable.id, referenceId));
    if (!pkg || !pkg.active) {
      res.status(404).json({ error: "Credit package not found" });
      return;
    }

    const isRealPriceId =
      pkg.stripePriceId && !pkg.stripePriceId.startsWith("price_placeholder");

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = isRealPriceId
      ? [{ price: pkg.stripePriceId!, quantity: 1 }]
      : [
          {
            price_data: {
              currency: "usd",
              unit_amount: pkg.priceCents,
              product_data: { name: `${pkg.name} Credits (${pkg.credits} credits)` },
            },
            quantity: 1,
          },
        ];

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: String(user.id),
        metadata: { purpose: "credits", packageId: String(pkg.id) },
        line_items: lineItems,
        success_url: `${origin}/?checkout=success&type=credits`,
        cancel_url: `${origin}/?checkout=cancelled`,
      });
    } catch (err) {
      req.log.error({ err }, "Stripe checkout session creation failed (credits)");
      res.status(502).json({ error: "Failed to create Stripe checkout session" });
      return;
    }

    res.status(201).json({
      id: session.id,
      status: "open",
      amount: pkg.priceCents / 100,
      purpose: "credits",
      url: session.url,
    });
    return;
  }

  // Other purposes are not yet wired to Stripe.
  res.status(503).json({
    error: `Checkout for purpose '${purpose}' is not yet configured.`,
  });
});

export default router;
