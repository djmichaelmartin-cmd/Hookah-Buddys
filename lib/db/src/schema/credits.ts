import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const creditBalancesTable = pgTable("credit_balances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  // Recurring membership credits for the current billing cycle. Reset on each
  // renewal and expire at cycle end (no rollover).
  membershipBalance: integer("membership_balance").notNull().default(0),
  // Purchased / admin-granted credits. Never expire.
  purchasedBalance: integer("purchased_balance").notNull().default(0),
});

export const creditPackagesTable = pgTable("credit_packages", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  credits: integer("credits").notNull(),
  label: text("label"),
  stripePriceId: text("stripe_price_id"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creditTransactionsTable = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  description: text("description"),
  amountCents: integer("amount_cents"),
  packageId: integer("package_id"),
  dollId: integer("doll_id"),
  mediaId: integer("media_id"),
  messageId: integer("message_id"),
  videoChatId: integer("video_chat_id"),
  // References for creator album and custom-request ledger entries.  They are
  // deliberately nullable so legacy ledger rows retain their existing shape.
  creatorAlbumUnlockId: integer("creator_album_unlock_id"),
  customContentRequestId: integer("custom_content_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreditBalance = typeof creditBalancesTable.$inferSelect;
export type CreditPackage = typeof creditPackagesTable.$inferSelect;
export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
