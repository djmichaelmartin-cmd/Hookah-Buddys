import { pgTable, serial, text, real, boolean, integer } from "drizzle-orm/pg-core";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Stable machine identifier (e.g. "bronze", "silver", "gold", "platinum").
  slug: text("slug"),
  // Placeholder Stripe recurring price id for paid plans.
  stripePriceId: text("stripe_price_id"),
  audience: text("audience").notNull(),
  price: real("price").notNull().default(0),
  interval: text("interval"),
  tier: text("tier").notNull().default("free"),
  description: text("description"),
  features: text("features").array(),
  highlighted: boolean("highlighted").notNull().default(false),
  // Recurring credits included with this plan each billing cycle (member plans).
  monthlyCredits: integer("monthly_credits").notNull().default(0),
});

export type Plan = typeof plansTable.$inferSelect;
export type InsertPlan = typeof plansTable.$inferInsert;
