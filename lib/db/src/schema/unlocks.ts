import { pgTable, serial, integer, real, timestamp } from "drizzle-orm/pg-core";

export const contentUnlocksTable = pgTable("content_unlocks", {
  id: serial("id").primaryKey(),
  memberUserId: integer("member_user_id").notNull(),
  mediaId: integer("media_id").notNull(),
  dollId: integer("doll_id").notNull(),
  price: real("price").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContentUnlock = typeof contentUnlocksTable.$inferSelect;
