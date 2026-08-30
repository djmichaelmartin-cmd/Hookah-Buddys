import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  check,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    role: text("role").notNull(),
    name: text("name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    phone: text("phone"),
    city: text("city"),
    state: text("state"),
    username: text("username"),
    buddyType: text("buddy_type"),
    accountStatus: text("account_status").notNull().default("active"),
    ageConfirmed: boolean("age_confirmed").notNull().default(false),
    rulesAccepted: boolean("rules_accepted").notNull().default(false),
    profilePhotoUrl: text("profile_photo_url"),
    dollId: integer("doll_id"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "users_buddy_type_check",
      sql`${table.buddyType} is null or ${table.buddyType} in ('female_buddy', 'male_buddy')`,
    ),
  ],
);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
