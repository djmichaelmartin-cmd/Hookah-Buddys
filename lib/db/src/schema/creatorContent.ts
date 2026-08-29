import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Creator albums intentionally live beside (rather than inside) the legacy
 * social-photo album tables.  The latter remain per-photo visibility albums;
 * these are permanent, product-level unlocks with a small fixed type set.
 */
export const creatorAlbumsTable = pgTable(
  "creator_albums",
  {
    id: serial("id").primaryKey(),
    creatorUserId: integer("creator_user_id").notNull(),
    dollId: integer("doll_id").notNull(),
    albumType: text("album_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("creator_albums_creator_type_unique").on(t.creatorUserId, t.albumType),
    check("creator_albums_type_check", sql`${t.albumType} in ('free_preview', 'cloud_vibes', 'smokin_hot')`),
  ],
);

export const creatorAlbumMediaTable = pgTable(
  "creator_album_media",
  {
    id: serial("id").primaryKey(),
    albumId: integer("album_id").notNull(),
    creatorUserId: integer("creator_user_id").notNull(),
    objectPath: text("object_path").notNull(),
    mediaType: text("media_type").notNull(),
    thumbnailObjectPath: text("thumbnail_object_path"),
    posterObjectPath: text("poster_object_path"),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("pending_review"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("creator_album_media_object_unique").on(t.albumId, t.objectPath),
    check("creator_album_media_type_check", sql`${t.mediaType} in ('image', 'video')`),
    check("creator_album_media_status_check", sql`${t.status} in ('pending_review', 'active', 'hidden', 'removed')`),
  ],
);

/** Permanent entitlement; an album can only be charged/unlocked once per member. */
export const creatorAlbumUnlocksTable = pgTable(
  "creator_album_unlocks",
  {
    id: serial("id").primaryKey(),
    memberUserId: integer("member_user_id").notNull(),
    creatorUserId: integer("creator_user_id").notNull(),
    albumId: integer("album_id").notNull(),
    albumType: text("album_type").notNull(),
    priceCredits: integer("price_credits").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("creator_album_unlocks_member_album_unique").on(t.memberUserId, t.albumId),
    check("creator_album_unlocks_type_check", sql`${t.albumType} in ('cloud_vibes', 'smokin_hot')`),
  ],
);

export const creatorRequestSettingsTable = pgTable(
  "creator_request_settings",
  {
    id: serial("id").primaryKey(),
    creatorUserId: integer("creator_user_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    photoPriceCredits: integer("photo_price_credits").notNull().default(50),
    videoPriceCredits: integer("video_price_credits").notNull().default(150),
    photoVideoPriceCredits: integer("photo_video_price_credits").notNull().default(200),
    instructions: text("instructions"),
    allowReuse: boolean("allow_reuse").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("creator_request_settings_creator_unique").on(t.creatorUserId),
    check("creator_request_settings_prices_check", sql`${t.photoPriceCredits} >= 0 and ${t.videoPriceCredits} >= 0 and ${t.photoVideoPriceCredits} >= 0`),
  ],
);

/**
 * The two held-bucket fields make refunds deterministic even after membership
 * credit renewal: refund membership first to the amount actually held, then
 * purchased. `holdStatus` is the idempotent settlement/refund guard.
 */
export const customContentRequestsTable = pgTable(
  "custom_content_requests",
  {
    id: serial("id").primaryKey(),
    customerUserId: integer("customer_user_id").notNull(),
    creatorUserId: integer("creator_user_id").notNull(),
    dollId: integer("doll_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestText: text("request_text").notNull(),
    requestType: text("request_type").notNull(),
    customerAllowsReuse: boolean("customer_allows_reuse").notNull().default(false),
    creatorAgreesReuse: boolean("creator_agrees_reuse"),
    priceCredits: integer("price_credits").notNull(),
    heldMembershipCredits: integer("held_membership_credits").notNull(),
    heldPurchasedCredits: integer("held_purchased_credits").notNull(),
    status: text("status").notNull().default("pending_creator_response"),
    holdStatus: text("hold_status").notNull().default("held"),
    responseDeadlineAt: timestamp("response_deadline_at", { withTimezone: true }).notNull(),
    deliveryDeadlineAt: timestamp("delivery_deadline_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    disputeReason: text("dispute_reason"),
    adminResolution: text("admin_resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("custom_content_requests_customer_idempotency_unique").on(t.customerUserId, t.idempotencyKey),
    check("custom_content_requests_type_check", sql`${t.requestType} in ('custom_photo', 'custom_video', 'custom_photo_video')`),
    check("custom_content_requests_status_check", sql`${t.status} in ('pending_creator_response', 'accepted', 'in_progress', 'declined', 'expired_no_response', 'delivered', 'completed', 'refunded', 'cancelled', 'disputed', 'failed_delivery')`),
    check("custom_content_requests_hold_check", sql`${t.holdStatus} in ('held', 'settled', 'refunded')`),
    check("custom_content_requests_held_amount_check", sql`${t.heldMembershipCredits} >= 0 and ${t.heldPurchasedCredits} >= 0 and ${t.heldMembershipCredits} + ${t.heldPurchasedCredits} = ${t.priceCredits}`),
  ],
);

export const customContentDeliveriesTable = pgTable(
  "custom_content_deliveries",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").notNull(),
    creatorUserId: integer("creator_user_id").notNull(),
    message: text("message"),
    imageObjectPath: text("image_object_path"),
    videoObjectPath: text("video_object_path"),
    videoPosterObjectPath: text("video_poster_object_path"),
    reusable: boolean("reusable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_content_deliveries_request_unique").on(t.requestId),
    check(
      "custom_content_deliveries_media_check",
      sql`${t.imageObjectPath} is not null or ${t.videoObjectPath} is not null`,
    ),
  ],
);

export type CreatorAlbum = typeof creatorAlbumsTable.$inferSelect;
export type CreatorAlbumMedia = typeof creatorAlbumMediaTable.$inferSelect;
export type CreatorAlbumUnlock = typeof creatorAlbumUnlocksTable.$inferSelect;
export type CreatorRequestSettings = typeof creatorRequestSettingsTable.$inferSelect;
export type CustomContentRequest = typeof customContentRequestsTable.$inferSelect;
export type CustomContentDelivery = typeof customContentDeliveriesTable.$inferSelect;