import { pgTable, serial, text, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";

export const mediaTable = pgTable("media", {
  id: serial("id").primaryKey(),
  dollId: integer("doll_id").notNull(),
  type: text("type").notNull(),
  url: text("url"),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  status: text("status").notNull().default("pending_review"),
  containsHookah: boolean("contains_hookah").notNull().default(false),
  premium: boolean("premium").notNull().default(false),
  price: real("price").notNull().default(0),
  moderationNotes: text("moderation_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Media = typeof mediaTable.$inferSelect;
export type InsertMedia = typeof mediaTable.$inferInsert;
