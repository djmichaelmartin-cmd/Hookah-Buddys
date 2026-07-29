import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const profileDetailsTable = pgTable(
  "profile_details",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    coverPhotoUrl: text("cover_photo_url"),
    livesInCity: text("lives_in_city"),
    livesInState: text("lives_in_state"),
    fromCity: text("from_city"),
    fromState: text("from_state"),
    birthMonth: integer("birth_month"),
    birthDay: integer("birth_day"),
    birthYear: integer("birth_year"),
    gender: text("gender"),
    languagesSpoken: text("languages_spoken"),
    hairColor: text("hair_color"),
    eyeColor: text("eye_color"),
    ethnicity: text("ethnicity"),
    bodyType: text("body_type"),
    height: text("height"),
    relationshipStatus: text("relationship_status"),
    occupation: text("occupation"),
    education: text("education"),
    description: text("description"),
    websiteUrl: text("website_url"),
    socialLinks: text("social_links"), // JSON string map
    favoriteHookahFlavor: text("favorite_hookah_flavor"),
    favoriteHookahLounge: text("favorite_hookah_lounge"),
    favoriteHookahBrand: text("favorite_hookah_brand"),
    favoriteHookahSetup: text("favorite_hookah_setup"),
    hookahExperienceLevel: text("hookah_experience_level"),
    preferredHookahStyle: text("preferred_hookah_style"),
    favoriteSmokeSessionVibe: text("favorite_smoke_session_vibe"),
    favoriteHookahAccessories: text("favorite_hookah_accessories"),
    openToLoungeMeetups: text("open_to_lounge_meetups"),
    favoriteLoungeCity: text("favorite_lounge_city"),
    interests: text("interests"), // JSON string array
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("profile_details_user_idx").on(t.userId)],
);

export const profileFieldPrivacyTable = pgTable(
  "profile_field_privacy",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    fieldName: text("field_name").notNull(),
    visibility: text("visibility").notNull().default("public"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("profile_field_privacy_user_field_idx").on(t.userId, t.fieldName)],
);

export const privacySettingsTable = pgTable(
  "privacy_settings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    defaultPostAudience: text("default_post_audience").notNull().default("public"),
    showFriendsList: text("show_friends_list").notNull().default("friends"),
    showFollowersList: text("show_followers_list").notNull().default("public"),
    allowFriendRequestsFrom: text("allow_friend_requests_from").notNull().default("everyone"),
    allowMessagesFrom: text("allow_messages_from").notNull().default("everyone"),
    allowTagging: text("allow_tagging").notNull().default("everyone"),
    requireTagReview: text("require_tag_review").notNull().default("true"),
    allowSearchByEmail: text("allow_search_by_email").notNull().default("no_one"),
    allowSearchByPhone: text("allow_search_by_phone").notNull().default("no_one"),
    allowExternalSearchIndexing: text("allow_external_search_indexing").notNull().default("false"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("privacy_settings_user_idx").on(t.userId)],
);

export const profileViewsTable = pgTable("profile_views", {
  id: serial("id").primaryKey(),
  viewerId: integer("viewer_id"),
  viewedUserId: integer("viewed_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProfileDetails = typeof profileDetailsTable.$inferSelect;
export type InsertProfileDetails = typeof profileDetailsTable.$inferInsert;
export type ProfileFieldPrivacy = typeof profileFieldPrivacyTable.$inferSelect;
export type PrivacySettings = typeof privacySettingsTable.$inferSelect;
export type ProfileView = typeof profileViewsTable.$inferSelect;
