import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const verificationsTable = pgTable("verifications", {
  id: serial("id").primaryKey(),
  dollId: integer("doll_id").notNull(),
  governmentIdUrl: text("government_id_url"),
  selfieUrl: text("selfie_url"),
  hookahPhotoUrl: text("hookah_photo_url"),
  hookahVideoUrl: text("hookah_video_url"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Verification = typeof verificationsTable.$inferSelect;
export type InsertVerification = typeof verificationsTable.$inferInsert;
