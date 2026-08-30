import { type Request, type Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  plansTable,
  creditPackagesTable,
  stripeProcessedEventsTable,
} from "@workspace/db";
import { getStripeClient } from "../lib/stripe";
import { activateMembership, renewMembership } from "../lib/membership";
import { grantCredits } from "../lib/credits";

// ---------------------------------------------------------------------------
// Internal handlers
// ---------------------------------------------------------------------------

type InvoiceWithLegacySubscription = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

export function resolveInvoiceSubscriptionId(
  invoice: Stripe.Invoice,
): string | null {
  // Stripe webhook endpoints keep the API version they were created with.
  // Newer invoice payloads expose the subscription through `parent`, while
  // older endpoints still send the top-level `subscription` field.
  const currentSubscription =
    invoice.parent?.subscription_details?.subscription;
  const legacySubscription = (invoice as InvoiceWithLegacySubscription)
    .subscription;
  const subscription = currentSubscription ?? legacySubscription;

  return typeof subscription === "string"
    ? subscription
    : (subscription?.id ?? null);
}

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  log: Request["log"],
): Promise<void> {
  if (session.payment_status !== "paid") {
    log.info(
      { sessionId: session.id, paymentStatus: session.payment_status },
      "Checkout completed before payment settled; waiting for payment success",
    );
    return;
  }
  const userId = Number(session.client_reference_id);
  const purpose = session.metadata?.purpose;

  if (!userId || !purpose) {
    log.warn(
      { sessionId: session.id },
      "checkout.session.completed: missing userId or purpose in metadata",
    );
    return;
  }

  // Idempotency: skip if we already processed this checkout session.
  const existing = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeCheckoutSessionId, session.id))
    .limit(1);
  if (existing.length > 0) {
    log.info(
      { sessionId: session.id },
      "checkout.session.completed: already processed, skipping",
    );
    return;
  }

  if (purpose === "membership") {
    const planId = Number(session.metadata?.planId);
    if (!planId) {
      log.warn(
        { sessionId: session.id },
        "checkout.session.completed: missing planId",
      );
      return;
    }
    const [plan] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.id, planId));
    if (!plan) {
      log.warn(
        { sessionId: session.id, planId },
        "checkout.session.completed: plan not found",
      );
      return;
    }
    const sub = await activateMembership(userId, plan);
    // Persist Stripe identifiers so renewal webhooks can locate this record.
    await db
      .update(subscriptionsTable)
      .set({
        stripeSubscriptionId:
          typeof session.subscription === "string"
            ? session.subscription
            : null,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : null,
        stripeCheckoutSessionId: session.id,
      })
      .where(eq(subscriptionsTable.id, sub.id));
    log.info(
      { userId, planId, subId: sub.id },
      "Membership activated via Stripe checkout",
    );
    return;
  }

  if (purpose === "credits") {
    const packageId = Number(session.metadata?.packageId);
    if (!packageId) {
      log.warn(
        { sessionId: session.id },
        "checkout.session.completed: missing packageId",
      );
      return;
    }
    const [pkg] = await db
      .select()
      .from(creditPackagesTable)
      .where(eq(creditPackagesTable.id, packageId));
    if (!pkg) {
      log.warn(
        { sessionId: session.id, packageId },
        "checkout.session.completed: package not found",
      );
      return;
    }
    await grantCredits(userId, pkg.credits, {
      type: "purchase",
      description: `Purchased ${pkg.name} pack (${pkg.credits} credits) via Stripe`,
      amountCents: pkg.priceCents,
      packageId: pkg.id,
    });
    log.info(
      { userId, packageId, credits: pkg.credits },
      "Credits granted via Stripe checkout",
    );
    return;
  }

  log.warn(
    { sessionId: session.id, purpose },
    "checkout.session.completed: unrecognised purpose",
  );
}

export async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  log: Request["log"],
): Promise<void> {
  const stripeSubscriptionId = resolveInvoiceSubscriptionId(invoice);
  if (!stripeSubscriptionId) {
    log.warn(
      { invoiceId: invoice.id },
      "invoice.payment_succeeded: missing subscription id in current and legacy payload fields",
    );
    return;
  }

  // Locate our subscription record to get the memberUserId.
  const [row] = await db
    .select({ memberUserId: subscriptionsTable.memberUserId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);

  if (!row) {
    // Expected on the very first invoice (covered by checkout.session.completed).
    log.info(
      { stripeSubscriptionId },
      "invoice.payment_succeeded: no matching sub yet, skipping renewal",
    );
    return;
  }

  const result = await renewMembership(row.memberUserId);
  if (result) {
    log.info(
      {
        userId: row.memberUserId,
        plan: result.plan.name,
        credits: result.plan.monthlyCredits,
      },
      "Membership renewed via Stripe invoice",
    );
  } else {
    log.warn(
      { userId: row.memberUserId },
      "invoice.payment_succeeded: no active membership to renew",
    );
  }
}

// ---------------------------------------------------------------------------
// Express route handler (mounted in app.ts BEFORE express.json() so the raw
// Buffer is preserved for Stripe signature verification).
// ---------------------------------------------------------------------------

export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const stripe = getStripeClient();

  if (!stripe) {
    if (process.env.NODE_ENV === "production") {
      res
        .status(503)
        .json({ error: "Stripe is not configured on this server" });
    } else {
      // Dev: no Stripe key — acknowledge silently so local curl tests don't break.
      res.json({
        received: true,
        handled: false,
        note: "Stripe not configured",
      });
    }
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET is not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing Stripe-Signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      Array.isArray(sig) ? sig[0] : sig,
      webhookSecret,
    );
  } catch (err) {
    req.log.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  try {
    const [claimed] = await db
      .insert(stripeProcessedEventsTable)
      .values({ eventId: event.id, eventType: event.type })
      .onConflictDoNothing({ target: stripeProcessedEventsTable.eventId })
      .returning({ eventId: stripeProcessedEventsTable.eventId });
    if (!claimed) {
      res.json({ received: true, duplicate: true });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
          req.log,
        );
        break;

      case "invoice.paid":
        await handleInvoicePaymentSucceeded(
          event.data.object as Stripe.Invoice,
          req.log,
        );
        break;

      default:
        // Acknowledge unrecognised events so Stripe does not retry them.
        break;
    }
  } catch (err) {
    await db
      .delete(stripeProcessedEventsTable)
      .where(eq(stripeProcessedEventsTable.eventId, event.id));
    req.log.error(
      { err, eventType: event.type },
      "Error processing Stripe webhook event",
    );
    res.status(500).json({ error: "Internal error processing webhook" });
    return;
  }

  res.json({ received: true });
}
