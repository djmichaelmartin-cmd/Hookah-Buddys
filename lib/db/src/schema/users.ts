import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  username: text("username"),
  accountStatus: text("account_status").notNull().default("active"),
  ageConfirmed: boolean("age_confirmed").notNull().default(false),
  rulesAccepted: boolean("rules_accepted").notNull().default(false),
  profilePhotoUrl: text("profile_photo_url"),
  dollId: integer("doll_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
