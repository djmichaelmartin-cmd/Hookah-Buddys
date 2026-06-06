import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const creditBalancesTable = pgTable("credit_balances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  balance: integer("balance").notNull().default(0),
});

export const creditTransactionsTable = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreditBalance = typeof creditBalancesTable.$inferSelect;
export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
