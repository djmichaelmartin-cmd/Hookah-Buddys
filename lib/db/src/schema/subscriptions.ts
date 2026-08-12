import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  memberUserId: integer("member_user_id").notNull(),
  planId: integer("plan_id").notNull(),
  dollId: integer("doll_id"),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  // End of the current billing cycle = next membership-credit refresh date.
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  // Stripe identifiers stored after checkout.session.completed so renewal
  // webhooks (invoice.payment_succeeded) can look up the right member.
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  // Session ID stored for idempotency; prevents double-activation on retried
  // webhook deliveries.
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = typeof subscriptionsTable.$inferInsert;
