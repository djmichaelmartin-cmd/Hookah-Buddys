import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const feedPostsTable = pgTable("feed_posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  userRole: text("user_role").notNull(),
  text: text("text").notNull(),
  mediaUrl: text("media_url"),
  posterUrl: text("poster_url"),
  mediaType: text("media_type").notNull().default("none"),
  category: text("category").notNull(),
  // Business attribution (safe, no owner identity). When set, the feed item is
  // rendered as authored by the Business Page and links to /business/:handle.
  // source: null (personal) | business_post | business_checkin | business_event
  source: text("source"),
  sourceId: integer("source_id"),          // originating business child entity id
  businessId: integer("business_id"),      // attributed Business Page id
  isHookahRelatedConfirmed: boolean("is_hookah_related_confirmed").notNull().default(false),
  status: text("status").notNull().default("active"),
  audience: text("audience").notNull().default("public"), // public | friends | followers | only_me
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  reportCount: integer("report_count").notNull().default(0),
  // Share wrapper linkage: set when this feed post IS a share wrapper
  // source_type: feed_post | group_post
  shareSourceType: text("share_source_type"),
  shareSourcePostId: integer("share_source_post_id"),
  shareSourceGroupId: integer("share_source_group_id"),
  // Denormalized share counters — broken down by destination type
  shareCount: integer("share_count").notNull().default(0),          // total (public+lounge+friends+group)
  publicShareCount: integer("public_share_count").notNull().default(0),  // public+lounge wrappers
  privateShareCount: integer("private_share_count").notNull().default(0), // private recipient shares
  groupShareCount: integer("group_share_count").notNull().default(0),     // group wrapper shares
  linkShareCount: integer("link_share_count").notNull().default(0),       // copy-link events
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type FeedPost = typeof feedPostsTable.$inferSelect;
export type InsertFeedPost = typeof feedPostsTable.$inferInsert;
