import { pgTable, serial, text, integer, boolean, timestamp, real, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const mediaTable = pgTable(
  "media",
  {
    id: serial("id").primaryKey(),
    dollId: integer("doll_id").notNull(),
    type: text("type").notNull(),
    url: text("url"),
    thumbnailUrl: text("thumbnail_url"),
    caption: text("caption"),
    status: text("status").notNull().default("pending_review"),
    containsHookah: boolean("contains_hookah").notNull().default(false),
    premium: boolean("premium").notNull().default(false),
    tier: text("tier"),
    price: real("price").notNull().default(0),
    moderationNotes: text("moderation_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // tier must be null or one of the four valid pricing tiers
    check("media_tier_valid", sql`${t.tier} IS NULL OR ${t.tier} IN ('photo', 'bundle', 'video', 'exclusive')`),
    // non-premium media must never carry a tier; premium media must always carry one
    check(
      "media_premium_tier_consistency",
      sql`(${t.premium} = false AND ${t.tier} IS NULL) OR (${t.premium} = true AND ${t.tier} IS NOT NULL)`,
    ),
  ],
);

export type Media = typeof mediaTable.$inferSelect;
export type InsertMedia = typeof mediaTable.$inferInsert;
