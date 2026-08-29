import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const reelsTable = pgTable("reels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  userRole: text("user_role").notNull(),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  category: text("category").notNull().default("other"),
  hashtags: text("hashtags"), // JSON string array
  peopleTags: text("people_tags"), // JSON integer array; legacy user_tags rows remain authoritative for review
  businessId: integer("business_id"),
  location: text("location"),
  feeling: text("feeling"),
  visibility: text("visibility").notNull().default("public"),
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
  sharingEnabled: boolean("sharing_enabled").notNull().default(true),
  // Legacy column retained for existing rows and compatibility. Spark creation
  // no longer requires or writes a client confirmation.
  isHookahRelatedConfirmed: boolean("is_hookah_related_confirmed").notNull().default(false),
  viewCount: integer("view_count").notNull().default(0),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  reportCount: integer("report_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const reelLikesTable = pgTable(
  "reel_likes",
  {
    id: serial("id").primaryKey(),
    reelId: integer("reel_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reel_likes_reel_user_idx").on(t.reelId, t.userId)],
);

export const reelSavesTable = pgTable(
  "reel_saves",
  {
    id: serial("id").primaryKey(),
    reelId: integer("reel_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reel_saves_reel_user_idx").on(t.reelId, t.userId)],
);

export const reelCommentsTable = pgTable("reel_comments", {
  id: serial("id").primaryKey(),
  reelId: integer("reel_id").notNull(),
  userId: integer("user_id").notNull(),
  commentText: text("comment_text").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userTagsTable = pgTable("user_tags", {
  id: serial("id").primaryKey(),
  taggedUserId: integer("tagged_user_id").notNull(),
  taggedByUserId: integer("tagged_by_user_id").notNull(),
  relatedType: text("related_type").notNull(), // post | photo | reel
  relatedId: integer("related_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | removed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Reel = typeof reelsTable.$inferSelect;
export type ReelLike = typeof reelLikesTable.$inferSelect;
export type ReelSave = typeof reelSavesTable.$inferSelect;
export type ReelComment = typeof reelCommentsTable.$inferSelect;
export type UserTag = typeof userTagsTable.$inferSelect;
