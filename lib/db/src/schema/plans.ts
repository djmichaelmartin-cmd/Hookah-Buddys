import { pgTable, serial, text, real, boolean } from "drizzle-orm/pg-core";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  audience: text("audience").notNull(),
  price: real("price").notNull().default(0),
  interval: text("interval"),
  tier: text("tier").notNull().default("free"),
  description: text("description"),
  features: text("features").array(),
  highlighted: boolean("highlighted").notNull().default(false),
});

export type Plan = typeof plansTable.$inferSelect;
export type InsertPlan = typeof plansTable.$inferInsert;
