/**
 * Post Sharing — reference-based share wrappers for feed posts and group posts.
 *
 * Design principles:
 *  - Wrappers reference the original source by ID; they NEVER copy text, media, or identity.
 *  - Every read re-authorizes access to the original source; if access is lost the
 *    sharedPost preview returns available=false with blank text/media/identity.
 *  - Resharing an existing wrapper collapses back to the original source (no nesting).
 *  - Private shares create recipient records + notifications; no public wrapper is written.
 *  - Group shares go through the destination group's postApproval lifecycle.
 *  - Copy-link records analytics and increments linkShareCount atomically.
 *
 * Rate limits enforced at the service layer:
 *  - 20 shares / hour / user (global, includes copy-link)
 *  - 3 same-source shares / hour / user (includes copy-link)
 *
 * Source types: feed_post | group_post
 * Destination types: public | lounge | friends | private | group | copy_link
 *
 * Status:
 *  post_shares: active | hidden | removed
 *  sharing_suspensions: active | lifted
 *
 * Idempotency:
 *  dedupeKey is a deterministic string encoding sharer+canonical source+destination+
 *  destinationGroupId+sorted recipientIds. A unique index on dedupeKey prevents
 *  duplicate share rows. copy_link is always repeatable (no dedupeKey).
 */

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Core share record (one row per logical share action, excluding copy-link)
// ─────────────────────────────────────────────────────────────────────────────

export const postSharesTable = pgTable(
  "post_shares",
  {
    id: serial("id").primaryKey(),

    // Who shared
    sharerId: integer("sharer_id").notNull(),

    // Source post (always the canonical original — wrappers are not re-shared)
    // source_type: feed_post | group_post
    sourceType: text("source_type").notNull(),
    sourcePostId: integer("source_post_id").notNull(),
    // When sourceType=group_post, the source group is stored for lifecycle checks
    sourceGroupId: integer("source_group_id"),

    // Destination: public | lounge | friends | private | group
    destination: text("destination").notNull(),

    // For destination=group: wrapper group_post created in the destination group
    destinationGroupId: integer("destination_group_id"),
    destinationGroupPostId: integer("destination_group_post_id"),

    // For destination=public|lounge|friends: wrapper feed_post created
    wrapperFeedPostId: integer("wrapper_feed_post_id"),

    // Optional sharer comment (never copied from source)
    sharerComment: text("sharer_comment"),

    // Deterministic deduplication key (sharer+source+destination+destGroup+sortedRecipients)
    // NULL for copy_link (always repeatable). Unique index prevents duplicate rows.
    dedupeKey: text("dedupe_key").unique(),

    // Moderation: active | hidden | removed
    status: text("status").notNull().default("active"),
    // When true: hidden/removed by platform admin; sharer cannot restore
    moderationLocked: boolean("moderation_locked").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type PostShare = typeof postSharesTable.$inferSelect;
export type InsertPostShare = typeof postSharesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Private share recipients (destination=private only)
// ─────────────────────────────────────────────────────────────────────────────

export const postShareRecipientsTable = pgTable(
  "post_share_recipients",
  {
    id: serial("id").primaryKey(),
    shareId: integer("share_id").notNull(),
    recipientUserId: integer("recipient_user_id").notNull(),
    // Whether the recipient has viewed the share
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("post_share_recipients_share_user_idx").on(t.shareId, t.recipientUserId)],
);

export type PostShareRecipient = typeof postShareRecipientsTable.$inferSelect;
export type InsertPostShareRecipient = typeof postShareRecipientsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Copy-link analytics (analytics-only; linkShareCount incremented atomically)
// ─────────────────────────────────────────────────────────────────────────────

export const postShareCopyLinksTable = pgTable("post_share_copy_links", {
  id: serial("id").primaryKey(),
  sharerId: integer("sharer_id").notNull(),
  sourceType: text("source_type").notNull(), // feed_post | group_post
  sourcePostId: integer("source_post_id").notNull(),
  sourceGroupId: integer("source_group_id"),
  // Canonical relative URL (/posts/:id or /groups/:groupId?post=:id)
  canonicalUrl: text("canonical_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PostShareCopyLink = typeof postShareCopyLinksTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Sharing suspensions — admin-managed per-user suspension of sharing privilege
// ─────────────────────────────────────────────────────────────────────────────

export const sharingSuspensionsTable = pgTable("sharing_suspensions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // active | lifted
  status: text("status").notNull().default("active"),
  reason: text("reason"),
  suspendedByUserId: integer("suspended_by_user_id").notNull(),
  liftedByUserId: integer("lifted_by_user_id"),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SharingSuspension = typeof sharingSuspensionsTable.$inferSelect;
export type InsertSharingSuspension = typeof sharingSuspensionsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Per-post author sharing controls (granular per-destination flags)
// ─────────────────────────────────────────────────────────────────────────────

export const postSharingSettingsTable = pgTable(
  "post_sharing_settings",
  {
    id: serial("id").primaryKey(),
    // source_type: feed_post | group_post
    sourceType: text("source_type").notNull(),
    sourcePostId: integer("source_post_id").notNull(),
    // Global kill-switch: disables all sharing regardless of per-destination flags
    sharingDisabled: boolean("sharing_disabled").notNull().default(false),
    // Granular per-destination controls (privacy-safe defaults: true = allowed)
    allowPublicShares: boolean("allow_public_shares").notNull().default(true),
    allowFriendsShares: boolean("allow_friends_shares").notNull().default(true),
    allowPrivateShares: boolean("allow_private_shares").notNull().default(true),
    allowGroupShares: boolean("allow_group_shares").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("post_sharing_settings_source_idx").on(t.sourceType, t.sourcePostId),
  ],
);

export type PostSharingSettings = typeof postSharingSettingsTable.$inferSelect;
