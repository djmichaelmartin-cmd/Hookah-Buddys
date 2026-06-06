import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";

export const boostsTable = pgTable("boosts", {
  id: serial("id").primaryKey(),
  dollId: integer("doll_id").notNull(),
  type: text("type").notNull(),
  price: real("price").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Boost = typeof boostsTable.$inferSelect;
