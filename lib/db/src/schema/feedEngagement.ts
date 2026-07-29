import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const postLikesTable = pgTable(
  "post_likes",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("post_likes_post_user_idx").on(t.postId, t.userId)],
);

export const postCommentsTable = pgTable("post_comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  userId: integer("user_id").notNull(),
  commentText: text("comment_text").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const postSavesTable = pgTable(
  "post_saves",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("post_saves_post_user_idx").on(t.postId, t.userId)],
);

export const followsTable = pgTable(
  "follows",
  {
    id: serial("id").primaryKey(),
    followerId: integer("follower_id").notNull(),
    followingId: integer("following_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("follows_pair_idx").on(t.followerId, t.followingId)],
);

export const postReportsTable = pgTable("post_reports", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull().default("post"),
  postId: integer("post_id"),
  commentId: integer("comment_id"),
  reporterId: integer("reporter_id").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export type PostLike = typeof postLikesTable.$inferSelect;
export type PostComment = typeof postCommentsTable.$inferSelect;
export type PostSave = typeof postSavesTable.$inferSelect;
export type Follow = typeof followsTable.$inferSelect;
export type PostReport = typeof postReportsTable.$inferSelect;
