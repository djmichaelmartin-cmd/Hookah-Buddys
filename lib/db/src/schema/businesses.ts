import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  real,
  timestamp,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Core Business Page
// ─────────────────────────────────────────────────────────────────────────────

export const businessesTable = pgTable("businesses", {
  id: serial("id").primaryKey(),
  // Owner user (must have a personal profile)
  ownerUserId: integer("owner_user_id").notNull(),
  // Unique public handle (e.g. "my-lounge")
  handle: text("handle").notNull().unique(),
  // Identity
  name: text("name").notNull(),
  businessType: text("business_type").notNull(), // lounge | brand | shop | service | event_venue | other
  // Optional primary category (hookah_lounge | tobacco_shop | event_venue | ...); nullable.
  category: text("category"),
  tagline: text("tagline"),
  description: text("description"),
  mission: text("mission"),
  foundedDate: text("founded_date"),            // YYYY-MM-DD string
  // Images
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  // Location
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").notNull().default("US"),
  lat: real("lat"),
  lng: real("lng"),
  serviceArea: text("service_area"),            // free-form geographic description
  // Contact
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  // Social links: { instagram, twitter, facebook, tiktok, youtube }
  socials: jsonb("socials").$type<Record<string, string>>(),
  // IANA timezone for correct openNow computation, e.g. "America/New_York"
  timezone: text("timezone"),
  // Hours: { mon: "10:00-22:00", ... , sun: null } (null = closed)
  hours: jsonb("hours").$type<Record<string, string | null>>(),
  // Special/holiday hours: [{ date: "2025-12-25", label: "Christmas", hours: "12:00-18:00" | null }]
  specialHours: jsonb("special_hours").$type<Array<{ date: string; label: string; hours: string | null }>>(),
  // Business attributes (all optional free text / enum values)
  parkingInfo: text("parking_info"),
  priceRange: text("price_range"),              // $ | $$ | $$$ | $$$$
  amenities: text("amenities").array(),          // e.g. ["WiFi","Valet","Private Rooms"]
  paymentMethods: text("payment_methods").array(), // e.g. ["Cash","Credit Card","Crypto"]
  accessibility: text("accessibility"),
  ageRequirement: text("age_requirement"),       // e.g. "18+" | "21+"
  // Status / visibility
  // draft = not yet published; active = publicly live; suspended = admin action; closed = owner closed
  status: text("status").notNull().default("draft"),
  isOpenNowOverride: boolean("is_open_now_override"),  // null=auto, true=forced open, false=forced closed
  isPublished: boolean("is_published").notNull().default(false),
  // Badges: e.g. ["verified","featured","premium"]
  badges: text("badges").array(),
  // CTA button config: { label: "Book Now", url: "https://...", type: "booking" }
  ctaConfig: jsonb("cta_config").$type<{ label: string; url: string; type: string } | null>(),
  // Tab enablement: { posts, services, products, offers, appointments, reviews }
  tabsEnabled: jsonb("tabs_enabled").$type<Record<string, boolean>>(),
  // Whether to show owner name/profile publicly
  showOwner: boolean("show_owner").notNull().default(false),
  // Promotion flags (admin-controlled; see admin actions feature/sponsor).
  isFeatured: boolean("is_featured").notNull().default(false),
  isSponsored: boolean("is_sponsored").notNull().default(false),
  // Admin-controlled suitability flag for the Local Lounge Spotlight feature.
  // Public concept: when true (default) the page may be selected as a nearby
  // spotlight card if it also satisfies the ranking/candidate rules. Admins may
  // disable an individual page without touching status/publish state.
  eligibleForLoungeSpotlight: boolean("eligible_for_lounge_spotlight")
    .notNull()
    .default(true),
  featuredUntil: timestamp("featured_until", { withTimezone: true }),
  sponsoredUntil: timestamp("sponsored_until", { withTimezone: true }),
  // Verification status: unverified | pending | verified | rejected
  verificationStatus: text("verification_status").notNull().default("unverified"),
  // Free-form community/interest tags surfaced in directory outputs, e.g. ["lgbtq_friendly","live_music"]
  tags: text("tags").array(),
  // Community-interest fields (free-form): e.g. { vibe: "chill", crowd: "mixed" }
  communityInterests: text("community_interests").array(),
  // Appointment/booking settings.
  bookingEnabled: boolean("booking_enabled").notNull().default(false),
  // Availability windows keyed by weekday, mirroring `hours` shape:
  // { mon: "09:00-17:00", ..., sun: null } — slots outside these are rejected.
  bookingAvailability: jsonb("booking_availability").$type<Record<string, string | null>>(),
  // Minimum lead time (minutes) before a slot can be booked.
  bookingLeadTimeMinutes: integer("booking_lead_time_minutes"),
  // Slot granularity in minutes (e.g. 30). Requested slots must align to this.
  bookingSlotIntervalMinutes: integer("booking_slot_interval_minutes").notNull().default(30),
  // Maximum advance window (minutes) a slot may be booked ahead of now.
  bookingMaxAdvanceMinutes: integer("booking_max_advance_minutes"),
  // Buffer (minutes) enforced around each appointment when checking overlaps.
  bookingBufferMinutes: integer("booking_buffer_minutes").notNull().default(0),
  // Default appointment duration (minutes) when the request omits one.
  bookingDefaultDurationMinutes: integer("booking_default_duration_minutes").notNull().default(60),
  // IANA timezone used for booking availability windows (falls back to `timezone`).
  bookingTimezone: text("booking_timezone"),
  // Whether business @-mentions in feed/business-post text are allowed and
  // whether they require page-team approval before display.
  allowMentions: boolean("allow_mentions").notNull().default(true),
  mentionsRequireApproval: boolean("mentions_require_approval").notNull().default(false),
  // Denormalized counts (maintained by application logic, updated conditionally on actual row change)
  followerCount: integer("follower_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  checkInCount: integer("check_in_count").notNull().default(0),
  postCount: integer("post_count").notNull().default(0),
  averageRating: real("average_rating"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Business = typeof businessesTable.$inferSelect;
export type InsertBusiness = typeof businessesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Page Team Roles
// Roles (least-privilege, ordered most → least privileged):
//   owner         – full control, cannot be removed
//   admin         – manage team, settings, content, conversations, moderation
//   editor        – create/edit/delete posts, services, products, offers
//   moderator     – hide/remove content, manage reviews
//   advertiser    – manage offers only
//   analyst       – read-only dashboard + insights
//   support_agent – read + send business conversations only
// ─────────────────────────────────────────────────────────────────────────────

export const businessPageRolesTable = pgTable(
  "business_page_roles",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    userId: integer("user_id").notNull(),
    // owner | admin | editor | moderator | advertiser | analyst | support_agent
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("biz_page_roles_biz_user_idx").on(t.businessId, t.userId)],
);

export type BusinessPageRole = typeof businessPageRolesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Followers & Saves
// ─────────────────────────────────────────────────────────────────────────────

export const businessFollowsTable = pgTable(
  "business_follows",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("biz_follows_biz_user_idx").on(t.businessId, t.userId)],
);

export const businessSavesTable = pgTable(
  "business_saves",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("biz_saves_biz_user_idx").on(t.businessId, t.userId)],
);

export type BusinessFollow = typeof businessFollowsTable.$inferSelect;
export type BusinessSave = typeof businessSavesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Check-Ins
// ─────────────────────────────────────────────────────────────────────────────

export const businessCheckInsTable = pgTable("business_check_ins", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  userId: integer("user_id").notNull(),
  note: text("note"),
  // private | public — private check-ins are excluded from public recent lists.
  visibility: text("visibility").notNull().default("public"),
  // Whether the user opted to share this check-in to their personal feed.
  shareToFeed: boolean("share_to_feed").notNull().default(false),
  // Optional managed (storage-finalized) photo attached to the check-in.
  photoUrl: text("photo_url"),
  // Tagged friend user IDs (validated against the actual connections table).
  taggedUserIds: integer("tagged_user_ids").array(),
  // Canonical feed linkage created when shareToFeed=true on a public check-in.
  feedPostId: integer("feed_post_id"),
  // Engagement counters (maintained conditionally on real row changes).
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessCheckIn = typeof businessCheckInsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Business Posts
// ─────────────────────────────────────────────────────────────────────────────

export const businessPostsTable = pgTable("business_posts", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  authorUserId: integer("author_user_id").notNull(),
  text: text("text").notNull(),
  mediaUrl: text("media_url"),
  posterUrl: text("poster_url"),
  // none | image | video — must match what is stored in mediaUrl
  mediaType: text("media_type").notNull().default("none"),
  // active | hidden | removed
  // hidden = soft-hidden; removed = permanently removed (terminal)
  // team toggles may only switch active↔hidden AND only when moderationLocked=false
  status: text("status").notNull().default("active"),
  // When true, the post was hidden/removed by a platform admin (moderation).
  // Team members CANNOT unhide/restore a moderation-locked post — only an admin
  // (via reinstate) can clear the lock. Distinguishes owner-hide from admin-hide.
  moderationLocked: boolean("moderation_locked").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  // Canonical feed linkage: when an active business post is published it creates
  // a feed_posts row attributed to the Business Page (owner identity hidden).
  // Hiding/removing/moderating the business post transactionally hides this feed item.
  feedPostId: integer("feed_post_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type BusinessPost = typeof businessPostsTable.$inferSelect;
export type InsertBusinessPost = typeof businessPostsTable.$inferInsert;

export const businessPostLikesTable = pgTable(
  "business_post_likes",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("biz_post_likes_post_user_idx").on(t.postId, t.userId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Reviews & Replies
// Unique constraint: one review per (businessId, userId)
// Unique constraint: one reply per reviewId
// ─────────────────────────────────────────────────────────────────────────────

export const businessReviewsTable = pgTable(
  "business_reviews",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    userId: integer("user_id").notNull(),
    rating: integer("rating").notNull(), // 1–5
    text: text("text"),
    // active | hidden | removed
    status: text("status").notNull().default("active"),
    // When true, the review was removed/hidden by a platform admin.
    // Team members cannot restore a moderation-locked review.
    moderationLocked: boolean("moderation_locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("biz_reviews_biz_user_idx").on(t.businessId, t.userId)],
);

export const businessReviewRepliesTable = pgTable(
  "business_review_replies",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id").notNull().unique(), // enforced: one reply per review
    ownerUserId: integer("owner_user_id").notNull(),   // business owner/admin who replied
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type BusinessReview = typeof businessReviewsTable.$inferSelect;
export type BusinessReviewReply = typeof businessReviewRepliesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Services, Products, Offers
// ─────────────────────────────────────────────────────────────────────────────

export const businessServicesTable = pgTable("business_services", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  priceLabel: text("price_label"), // free-form e.g. "From $25"
  priceCents: integer("price_cents"),
  // Optional sale price; when set and < priceCents, indicates a discount.
  salePriceCents: integer("sale_price_cents"),
  durationMinutes: integer("duration_minutes"),
  imageUrl: text("image_url"),
  // Managed external booking URL (validated http/https; not a storage object).
  bookingUrl: text("booking_url"),
  isActive: boolean("is_active").notNull().default(true),
  // active | draft | archived — public sees only active.
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const businessProductsTable = pgTable("business_products", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  priceCents: integer("price_cents"),
  salePriceCents: integer("sale_price_cents"),
  priceLabel: text("price_label"),
  imageUrl: text("image_url"),
  // Additional storage-finalized images beyond the primary imageUrl.
  imageUrls: text("image_urls").array(),
  // Managed external purchase URL (validated http/https).
  purchaseUrl: text("purchase_url"),
  sku: text("sku"),
  isAvailable: boolean("is_available").notNull().default(true),
  // active | draft | archived | out_of_stock | hidden | removed.
  // Public sees only active + available.
  status: text("status").notNull().default("active"),
  // Engagement counters (maintained conditionally on real row changes).
  likeCount: integer("like_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const businessOffersTable = pgTable("business_offers", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  discountLabel: text("discount_label"), // e.g. "20% off" | "BOGO"
  code: text("code"),
  imageUrl: text("image_url"),           // storage-finalized image only
  // Offer terms & conditions text.
  terms: text("terms"),
  // Managed external redemption URL (validated http/https).
  redeemUrl: text("redeem_url"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  // Engagement counters (maintained conditionally on real row changes).
  likeCount: integer("like_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type BusinessService = typeof businessServicesTable.$inferSelect;
export type BusinessProduct = typeof businessProductsTable.$inferSelect;
export type BusinessOffer = typeof businessOffersTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Appointments
// ─────────────────────────────────────────────────────────────────────────────

export const businessAppointmentsTable = pgTable("business_appointments", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  serviceId: integer("service_id"),  // FK→business_services; validated to belong to same business
  userId: integer("user_id").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  // pending | confirmed | cancelled | completed
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type BusinessAppointment = typeof businessAppointmentsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Business Messaging — fully separate from paid member↔Buddy messaging
// Access: owner | admin | support_agent roles for inbox operations
// ─────────────────────────────────────────────────────────────────────────────

export const businessConversationsTable = pgTable(
  "business_conversations",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    userId: integer("user_id").notNull(), // the non-business participant
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    unreadByBusiness: integer("unread_by_business").notNull().default(0),
    unreadByUser: integer("unread_by_user").notNull().default(0),
    // active | archived
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("biz_convos_biz_user_idx").on(t.businessId, t.userId)],
);

export const businessMessagesTable = pgTable("business_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderUserId: integer("sender_user_id").notNull(),
  // "user" = external user, "business" = team member acting as the business
  senderType: text("sender_type").notNull(),
  body: text("body").notNull(),
  // No arbitrary mediaUrl in messages — team members may share storage object paths
  // but mediaUrl is informational only (no auto-finalization on message send)
  mediaUrl: text("media_url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessConversation = typeof businessConversationsTable.$inferSelect;
export type BusinessMessage = typeof businessMessagesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Business Notifications (to business team members)
// ─────────────────────────────────────────────────────────────────────────────

export const businessNotificationsTable = pgTable("business_notifications", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  recipientUserId: integer("recipient_user_id").notNull(),
  // new_review | new_follower | new_checkin | new_message | new_appointment
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  relatedEntityId: integer("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessNotification = typeof businessNotificationsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Insights / Analytics Events
// ─────────────────────────────────────────────────────────────────────────────

export const businessInsightEventsTable = pgTable("business_insight_events", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  // profile_view | post_view | follow | checkin | review | save | cta_click
  eventType: text("event_type").notNull(),
  userId: integer("user_id"),              // null = anonymous
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessInsightEvent = typeof businessInsightEventsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Page Moderation / Audit Log
// ─────────────────────────────────────────────────────────────────────────────

export const businessModerationLogsTable = pgTable("business_moderation_logs", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  actorUserId: integer("actor_user_id").notNull(),
  // suspend | reinstate | remove_review | hide_post | warn | badge_grant | badge_revoke
  action: text("action").notNull(),
  targetEntityType: text("target_entity_type"), // business | review | post
  targetEntityId: integer("target_entity_id"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessModerationLog = typeof businessModerationLogsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Business Media — Albums & Media Items
// Albums group photos/videos/reels. Media items carry finalized internal
// storage URLs (image/video) + optional poster for video/reel.
// ─────────────────────────────────────────────────────────────────────────────

export const businessAlbumsTable = pgTable("business_albums", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  coverUrl: text("cover_url"),
  // active | hidden — public sees only active; team sees all.
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const businessMediaItemsTable = pgTable("business_media_items", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  // Optional album grouping; null = ungrouped page media.
  albumId: integer("album_id"),
  // photo | video | reel
  kind: text("kind").notNull(),
  title: text("title"),
  caption: text("caption"),
  // Category + hashtags for reels/videos discovery.
  category: text("category"),
  hashtags: text("hashtags").array(),
  // Finalized internal storage URLs only.
  mediaUrl: text("media_url").notNull(),
  posterUrl: text("poster_url"),
  // Who uploaded it: page team (team) or a visitor customer submission (customer).
  submittedByUserId: integer("submitted_by_user_id"),
  source: text("source").notNull().default("team"), // team | customer
  // active | hidden | pending | rejected | removed.
  // Customer submissions start pending and require page approval to become active.
  status: text("status").notNull().default("active"),
  // Engagement counters.
  likeCount: integer("like_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type BusinessAlbum = typeof businessAlbumsTable.$inferSelect;
export type BusinessMediaItem = typeof businessMediaItemsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Business Events & RSVPs
// ─────────────────────────────────────────────────────────────────────────────

export const businessEventsTable = pgTable("business_events", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  // Finalized internal storage image URLs.
  imageUrls: text("image_urls").array(),
  // Managed external ticket URL (validated http/https).
  ticketUrl: text("ticket_url"),
  // Managed external online/virtual event link (validated http/https).
  onlineUrl: text("online_url"),
  // draft | active | cancelled | completed | hidden | removed
  status: text("status").notNull().default("active"),
  // public | private (team preview only)
  visibility: text("visibility").notNull().default("public"),
  rsvpCount: integer("rsvp_count").notNull().default(0),
  likeCount: integer("like_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  // Canonical feed linkage for shared events.
  feedPostId: integer("feed_post_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const businessEventRsvpsTable = pgTable(
  "business_event_rsvps",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    userId: integer("user_id").notNull(),
    // going | interested
    status: text("status").notNull().default("going"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("biz_event_rsvps_event_user_idx").on(t.eventId, t.userId)],
);

export type BusinessEvent = typeof businessEventsTable.$inferSelect;
export type BusinessEventRsvp = typeof businessEventRsvpsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Post Engagement — Comments, Saves, Reports
// (post likes already defined above as businessPostLikesTable)
// ─────────────────────────────────────────────────────────────────────────────

export const businessPostCommentsTable = pgTable("business_post_comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  userId: integer("user_id").notNull(),
  text: text("text").notNull(),
  // active | hidden | removed
  status: text("status").notNull().default("active"),
  // Admin-moderation lock: team cannot restore an admin-removed comment.
  moderationLocked: boolean("moderation_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businessPostSavesTable = pgTable(
  "business_post_saves",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("biz_post_saves_post_user_idx").on(t.postId, t.userId)],
);

export const businessPostReportsTable = pgTable(
  "business_post_reports",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    userId: integer("user_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    // open | reviewed | dismissed
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One active report per (post, user) — prevents spam duplicates.
  (t) => [uniqueIndex("biz_post_reports_post_user_idx").on(t.postId, t.userId)],
);

export type BusinessPostComment = typeof businessPostCommentsTable.$inferSelect;
export type BusinessPostSave = typeof businessPostSavesTable.$inferSelect;
export type BusinessPostReport = typeof businessPostReportsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Verification Submissions
// Owner submits documents (managed uploads only); admin reviews.
// Document references are NEVER exposed to the public.
// ─────────────────────────────────────────────────────────────────────────────

export const businessVerificationSubmissionsTable = pgTable(
  "business_verification_submissions",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    submittedByUserId: integer("submitted_by_user_id").notNull(),
    // Business/legal details supporting the claim.
    legalName: text("legal_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    // Finalized internal storage object paths for documents (private).
    documentUrls: text("document_urls").array(),
    // pending | approved | rejected | changes_requested
    status: text("status").notNull().default("pending"),
    // Admin review fields.
    reviewedByUserId: integer("reviewed_by_user_id"),
    reviewNotes: text("review_notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type BusinessVerificationSubmission =
  typeof businessVerificationSubmissionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Unified child engagement (likes / saves) for public business child entities:
//   entityType ∈ media | event | product | offer | checkin
// One row per (entityType, entityId, userId, kind) where kind ∈ like | save.
// Counters live on the target rows and are updated conditionally on real row
// changes (INSERT/DELETE ... RETURNING). Post likes/saves keep their own tables.
// ─────────────────────────────────────────────────────────────────────────────

export const businessEngagementsTable = pgTable(
  "business_engagements",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    entityType: text("entity_type").notNull(), // media | event | product | offer | checkin
    entityId: integer("entity_id").notNull(),
    userId: integer("user_id").notNull(),
    kind: text("kind").notNull(),              // like | save | view
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("biz_engagements_unique_idx").on(t.entityType, t.entityId, t.userId, t.kind),
  ],
);

export type BusinessEngagement = typeof businessEngagementsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Unified comments for business child entities.
//   entityType ∈ media | event | product | offer | checkin
//   (business post comments continue to use businessPostCommentsTable).
// ─────────────────────────────────────────────────────────────────────────────

export const businessChildCommentsTable = pgTable("business_child_comments", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  entityType: text("entity_type").notNull(), // media | event | product | offer | checkin
  entityId: integer("entity_id").notNull(),
  userId: integer("user_id").notNull(),
  text: text("text").notNull(),
  // active | hidden | removed
  status: text("status").notNull().default("active"),
  moderationLocked: boolean("moderation_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessChildComment = typeof businessChildCommentsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Unified reports for business content (post, comment, media, event, product,
// offer, checkin). Feeds the admin report queue. One row per (type, id, user).
// ─────────────────────────────────────────────────────────────────────────────

export const businessContentReportsTable = pgTable(
  "business_content_reports",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    entityType: text("entity_type").notNull(), // post | comment | media | event | product | offer | checkin
    entityId: integer("entity_id").notNull(),
    reporterUserId: integer("reporter_user_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    // open | dismissed | actioned
    status: text("status").notNull().default("open"),
    reviewedByUserId: integer("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("biz_content_reports_unique_idx").on(t.entityType, t.entityId, t.reporterUserId),
  ],
);

export type BusinessContentReport = typeof businessContentReportsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Business @-mentions parsed from canonical feed / business-post text.
// When the mentioned page requires approval, records start pending and the
// page team may approve/reject. Notifies the page team on creation.
// ─────────────────────────────────────────────────────────────────────────────

export const businessMentionsTable = pgTable(
  "business_mentions",
  {
    id: serial("id").primaryKey(),
    // The page that was mentioned.
    businessId: integer("business_id").notNull(),
    // Source of the mention.
    sourceType: text("source_type").notNull(), // feed_post | business_post
    sourceId: integer("source_id").notNull(),
    // Actor who authored the mentioning text.
    authorUserId: integer("author_user_id").notNull(),
    // pending | approved | rejected
    status: text("status").notNull().default("approved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("biz_mentions_unique_idx").on(t.businessId, t.sourceType, t.sourceId),
  ],
);

export type BusinessMention = typeof businessMentionsTable.$inferSelect;
