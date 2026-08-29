import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedUserId: integer("related_user_id"),
  relatedPostId: integer("related_post_id"),
  relatedCommentId: integer("related_comment_id"),
  relatedEventId: integer("related_event_id"),
  relatedGroupId: integer("related_group_id"),
  // Legacy reel identifier used by canonical Spark notifications to deep-link
  // without changing the established reel storage model.
  relatedReelId: integer("related_reel_id"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
