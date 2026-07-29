import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const feedPostsTable = pgTable("feed_posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  userRole: text("user_role").notNull(),
  text: text("text").notNull(),
  mediaUrl: text("media_url"),
  mediaType: text("media_type").notNull().default("none"),
  category: text("category").notNull(),
  isHookahRelatedConfirmed: boolean("is_hookah_related_confirmed").notNull().default(false),
  status: text("status").notNull().default("active"),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  reportCount: integer("report_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type FeedPost = typeof feedPostsTable.$inferSelect;
export type InsertFeedPost = typeof feedPostsTable.$inferInsert;
