import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  real,
} from "drizzle-orm/pg-core";

export const dollsTable = pgTable("dolls", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  legalName: text("legal_name"),
  stageName: text("stage_name").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  age: integer("age"),
  bio: text("bio"),
  favoriteFlavor: text("favorite_flavor"),
  experienceLevel: text("experience_level"),
  preferences: text("preferences"),
  profilePhotoUrl: text("profile_photo_url"),
  verificationPhotoUrl: text("verification_photo_url"),
  verificationVideoUrl: text("verification_video_url"),
  governmentIdUrl: text("government_id_url"),
  verified: boolean("verified").notNull().default(false),
  featured: boolean("featured").notNull().default(false),
  elite: boolean("elite").notNull().default(false),
  online: boolean("online").notNull().default(false),
  availableForVideoChat: boolean("available_for_video_chat")
    .notNull()
    .default(false),
  tier: text("tier").notNull().default("free"),
  applicationStatus: text("application_status").notNull().default("pending"),
  requiredPlanId: integer("required_plan_id"),
  subscriptionPrice: real("subscription_price").notNull().default(0),
  messagePrice: real("message_price").notNull().default(0),
  videoChatRate: real("video_chat_rate").notNull().default(0),
  profileViews: integer("profile_views").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Doll = typeof dollsTable.$inferSelect;
export type InsertDoll = typeof dollsTable.$inferInsert;
