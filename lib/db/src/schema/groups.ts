/**
 * Groups schema — first-class member-created Groups for HookahBuddys.
 *
 * NOTE: "Groups" were previously referred to as "Communities".
 * All user-facing language should use "Groups".
 *
 * Privacy model:
 *   Public  – anyone can find, see members, view posts/media/events.
 *   Private – only approved members see posts, members, media, events.
 *     Visible – discoverable in search (anyone can request to join).
 *     Hidden  – not discoverable; only invited users can find it.
 *
 * Lifecycle: active | hidden | suspended | deleted
 *
 * Role capability matrix (least-privilege):
 *   owner     – full control, cannot be removed, can delete group
 *   admin     – manage settings, team, rules, questions, moderation
 *   moderator – approve posts/comments, manage reports, remove content
 *   member    – post, comment, react, save, RSVP
 *
 * Business Page attribution:
 *   Group posts may be authored as a Business Page (businessId set).
 *   The ownerUserId of the business is NEVER surfaced in group post serializers.
 */

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Core Group
// ─────────────────────────────────────────────────────────────────────────────

export const groupsTable = pgTable("groups", {
  id: serial("id").primaryKey(),
  // Creator / owner
  creatorUserId: integer("creator_user_id").notNull(),
  // Identity
  name: text("name").notNull(),
  // Optional custom URL handle (e.g. "hookah-vibes")
  handle: text("handle").unique(),
  description: text("description"),
  // Category e.g. hookah_culture | local_events | business | nightlife | creator | hobby | other
  category: text("category"),
  customCategory: text("custom_category"),
  tags: text("tags").array(),
  // Privacy: public | private
  privacy: text("privacy").notNull().default("public"),
  // Discovery (private only): visible | hidden
  visibility: text("visibility").notNull().default("visible"),
  // Images (storage object paths only — no base64/external URLs)
  coverUrl: text("cover_url"),
  iconUrl: text("icon_url"),
  // Optional location
  location: text("location"),
  // Posting permissions: all_members | admins_only | approved_members
  postingPermission: text("posting_permission").notNull().default("all_members"),
  // Post approval: when true, all member posts require admin/mod approval before visible
  postApproval: boolean("post_approval").notNull().default(false),
  // Lifecycle: active | hidden | suspended | deleted
  status: text("status").notNull().default("active"),
  // Admin feature/promotion flags (set by platform admin)
  isFeatured: boolean("is_featured").notNull().default(false),
  featuredUntil: timestamp("featured_until", { withTimezone: true }),
  // Denormalized counts (maintained conditionally on real row changes)
  memberCount: integer("member_count").notNull().default(1),
  postCount: integer("post_count").notNull().default(0),
  eventCount: integer("event_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Group = typeof groupsTable.$inferSelect;
export type InsertGroup = typeof groupsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Members & Roles
// ─────────────────────────────────────────────────────────────────────────────

export const groupMembersTable = pgTable(
  "group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    // owner | admin | moderator | member
    role: text("role").notNull().default("member"),
    // How they joined: invite | request | direct (public group)
    joinedVia: text("joined_via").notNull().default("direct"),
    // active | suspended (group-level suspension, not platform ban)
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("group_members_group_user_idx").on(t.groupId, t.userId)],
);

export type GroupMember = typeof groupMembersTable.$inferSelect;
export type InsertGroupMember = typeof groupMembersTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Invites
// ─────────────────────────────────────────────────────────────────────────────

export const groupInvitesTable = pgTable(
  "group_invites",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    invitedByUserId: integer("invited_by_user_id").notNull(),
    invitedUserId: integer("invited_user_id").notNull(),
    // pending | accepted | declined | expired | cancelled
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("group_invites_group_user_idx").on(t.groupId, t.invitedUserId)],
);

export type GroupInvite = typeof groupInvitesTable.$inferSelect;
export type InsertGroupInvite = typeof groupInvitesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Join Requests
// ─────────────────────────────────────────────────────────────────────────────

export const groupJoinRequestsTable = pgTable(
  "group_join_requests",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    // pending | approved | declined | cancelled
    status: text("status").notNull().default("pending"),
    reviewedByUserId: integer("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("group_join_requests_group_user_idx").on(t.groupId, t.userId)],
);

export type GroupJoinRequest = typeof groupJoinRequestsTable.$inferSelect;
export type InsertGroupJoinRequest = typeof groupJoinRequestsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Membership Questions & Answers
// ─────────────────────────────────────────────────────────────────────────────

export const groupQuestionsTable = pgTable("group_questions", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  questionText: text("question_text").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupQuestionAnswersTable = pgTable("group_question_answers", {
  id: serial("id").primaryKey(),
  questionId: integer("question_id").notNull(),
  groupId: integer("group_id").notNull(),
  joinRequestId: integer("join_request_id"),
  userId: integer("user_id").notNull(),
  answerText: text("answer_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GroupQuestion = typeof groupQuestionsTable.$inferSelect;
export type GroupQuestionAnswer = typeof groupQuestionAnswersTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Group Rules
// ─────────────────────────────────────────────────────────────────────────────

export const groupRulesTable = pgTable("group_rules", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type GroupRule = typeof groupRulesTable.$inferSelect;
export type InsertGroupRule = typeof groupRulesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Group Posts
// Separate domain from feed_posts to avoid unsafe polymorphic changes.
// Business attribution is safe: businessId links to the Business Page;
// authorUserId is the team member but is NEVER exposed in public serializers.
// ─────────────────────────────────────────────────────────────────────────────

export const groupPostsTable = pgTable("group_posts", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  // The user who authored the post (always required)
  authorUserId: integer("author_user_id").notNull(),
  // Optional Business Page attribution. When set, the post is attributed to
  // the Business Page (not the individual author). ownerUserId is never exposed.
  businessId: integer("business_id"),
  // Post content
  text: text("text").notNull(),
  mediaUrl: text("media_url"),
  posterUrl: text("poster_url"),
  // none | image | video
  mediaType: text("media_type").notNull().default("none"),
  // Post type: text | photo | video | poll | question | feeling | reel | file
  postType: text("post_type").notNull().default("text"),
  // Poll data (JSON): { question, options: [{id, text}], closesAt }
  pollData: jsonb("poll_data").$type<{
    question: string;
    options: Array<{ id: string; text: string }>;
    closesAt?: string;
    multiChoice?: boolean;
  } | null>(),
  // active | pending_approval | hidden | removed
  // pending_approval: post awaiting admin/mod approval (when postApproval=true)
  status: text("status").notNull().default("active"),
  // When true, the post was hidden/removed by a platform admin; group admins cannot restore.
  moderationLocked: boolean("moderation_locked").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  // Denormalized engagement counters
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

export type GroupPost = typeof groupPostsTable.$inferSelect;
export type InsertGroupPost = typeof groupPostsTable.$inferInsert;

// Poll votes
export const groupPostPollVotesTable = pgTable(
  "group_post_poll_votes",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    optionId: text("option_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("group_poll_votes_post_user_idx").on(t.postId, t.userId, t.optionId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Group Post Reactions (like / heart / laugh / wow / sad / angry)
// ─────────────────────────────────────────────────────────────────────────────

export const groupPostReactionsTable = pgTable(
  "group_post_reactions",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    // like | heart | laugh | wow | sad | angry
    reactionType: text("reaction_type").notNull().default("like"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One reaction per user per post (any type; updating changes the type)
  (t) => [uniqueIndex("group_post_reactions_post_user_idx").on(t.postId, t.userId)],
);

export type GroupPostReaction = typeof groupPostReactionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Group Post Saves
// ─────────────────────────────────────────────────────────────────────────────

export const groupPostSavesTable = pgTable(
  "group_post_saves",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("group_post_saves_post_user_idx").on(t.postId, t.userId)],
);

export type GroupPostSave = typeof groupPostSavesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Group Post Comments
// ─────────────────────────────────────────────────────────────────────────────

export const groupPostCommentsTable = pgTable("group_post_comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  groupId: integer("group_id").notNull(),
  userId: integer("user_id").notNull(),
  // Optional parent for nested replies
  parentCommentId: integer("parent_comment_id"),
  commentText: text("comment_text").notNull(),
  // active | hidden | removed
  status: text("status").notNull().default("active"),
  moderationLocked: boolean("moderation_locked").notNull().default(false),
  likeCount: integer("like_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type GroupPostComment = typeof groupPostCommentsTable.$inferSelect;
export type InsertGroupPostComment = typeof groupPostCommentsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Group Media (photos, videos, files)
// Storage objects only — no base64 or external URLs persisted.
// ─────────────────────────────────────────────────────────────────────────────

export const groupMediaTable = pgTable("group_media", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  uploadedByUserId: integer("uploaded_by_user_id").notNull(),
  // Optional Business Page attribution
  businessId: integer("business_id"),
  // Optional post linkage
  postId: integer("post_id"),
  // photo | video | reel | file
  kind: text("kind").notNull(),
  caption: text("caption"),
  // Finalized internal storage object paths only
  mediaUrl: text("media_url").notNull(),
  posterUrl: text("poster_url"),
  // For files: original filename + mime type
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileSizeBytes: integer("file_size_bytes"),
  // active | hidden | removed | pending
  status: text("status").notNull().default("active"),
  moderationLocked: boolean("moderation_locked").notNull().default(false),
  likeCount: integer("like_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GroupMedia = typeof groupMediaTable.$inferSelect;
export type InsertGroupMedia = typeof groupMediaTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Featured Content (pinned posts / featured members)
// ─────────────────────────────────────────────────────────────────────────────

export const groupFeaturedContentTable = pgTable(
  "group_featured_content",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    // post | member | media
    contentType: text("content_type").notNull(),
    contentId: integer("content_id").notNull(),
    setByUserId: integer("set_by_user_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("group_featured_content_group_type_id_idx").on(
      t.groupId,
      t.contentType,
      t.contentId,
    ),
  ],
);

export type GroupFeaturedContent = typeof groupFeaturedContentTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Group Events & RSVPs
// ─────────────────────────────────────────────────────────────────────────────

export const groupEventsTable = pgTable("group_events", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  createdByUserId: integer("created_by_user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  onlineUrl: text("online_url"),
  imageUrl: text("image_url"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  // draft | active | cancelled | completed | hidden | removed
  status: text("status").notNull().default("active"),
  // public | private (private events only visible to group members for private groups)
  visibility: text("visibility").notNull().default("public"),
  // RSVP option labels (null = default going/interested)
  rsvpLabel: text("rsvp_label"),
  rsvpCount: integer("rsvp_count").notNull().default(0),
  // Whether RSVPs are visible to members
  hideAttendees: boolean("hide_attendees").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type GroupEvent = typeof groupEventsTable.$inferSelect;
export type InsertGroupEvent = typeof groupEventsTable.$inferInsert;

export const groupEventRsvpsTable = pgTable(
  "group_event_rsvps",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    // going | interested | not_going
    rsvpStatus: text("rsvp_status").notNull().default("going"),
    // Whether the user prefers not to appear in attendee lists
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("group_event_rsvps_event_user_idx").on(t.eventId, t.userId)],
);

export type GroupEventRsvp = typeof groupEventRsvpsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

export const groupReportsTable = pgTable("group_reports", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  reporterUserId: integer("reporter_user_id").notNull(),
  // group | post | comment | member | event | media
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  reason: text("reason").notNull(),
  details: text("details"),
  // pending | reviewed | dismissed | actioned
  status: text("status").notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GroupReport = typeof groupReportsTable.$inferSelect;
export type InsertGroupReport = typeof groupReportsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Keyword Alerts (admin-configurable moderation)
// ─────────────────────────────────────────────────────────────────────────────

export const groupKeywordAlertsTable = pgTable("group_keyword_alerts", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  keyword: text("keyword").notNull(),
  // flag | auto_hide | auto_remove
  action: text("action").notNull().default("flag"),
  createdByUserId: integer("created_by_user_id").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GroupKeywordAlert = typeof groupKeywordAlertsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Activity Log (admin audit trail)
// ─────────────────────────────────────────────────────────────────────────────

export const groupActivityLogTable = pgTable("group_activity_log", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  actorUserId: integer("actor_user_id").notNull(),
  // Actions: create_group | update_settings | add_rule | remove_rule |
  //   approve_member | decline_member | remove_member | ban_member |
  //   promote_member | demote_member | invite_member |
  //   approve_post | reject_post | pin_post | unpin_post | hide_post | remove_post |
  //   hide_comment | remove_comment | review_report | dismiss_report |
  //   add_keyword_alert | remove_keyword_alert | add_featured | remove_featured |
  //   create_event | cancel_event | update_group_status
  action: text("action").notNull(),
  targetType: text("target_type"),  // group | post | comment | member | event | report | rule
  targetId: integer("target_id"),
  note: text("note"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GroupActivityLog = typeof groupActivityLogTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Group Insights (analytics events)
// ─────────────────────────────────────────────────────────────────────────────

export const groupInsightEventsTable = pgTable("group_insight_events", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  // group_view | post_view | member_join | member_leave | event_rsvp | post_reaction
  eventType: text("event_type").notNull(),
  userId: integer("user_id"),  // null = anonymous
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GroupInsightEvent = typeof groupInsightEventsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Group Notifications (to group members/admins)
// ─────────────────────────────────────────────────────────────────────────────

export const groupNotificationsTable = pgTable("group_notifications", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  recipientUserId: integer("recipient_user_id").notNull(),
  // new_join_request | new_member | new_post | new_comment | new_event |
  // post_approved | post_rejected | join_approved | join_declined |
  // role_changed | member_removed | event_cancelled | report_actioned
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedEntityId: integer("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GroupNotification = typeof groupNotificationsTable.$inferSelect;
