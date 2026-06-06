import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";

export const videoChatsTable = pgTable("video_chats", {
  id: serial("id").primaryKey(),
  memberUserId: integer("member_user_id").notNull(),
  dollId: integer("doll_id").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: text("status").notNull().default("requested"),
  ratePerMinute: real("rate_per_minute").notNull().default(0),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VideoChat = typeof videoChatsTable.$inferSelect;
