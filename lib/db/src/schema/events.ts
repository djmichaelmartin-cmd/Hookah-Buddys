import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  // Optional link to a lounge from the directory; venue fields cover ad-hoc venues.
  loungeId: integer("lounge_id"),
  venueName: text("venue_name"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  imageUrl: text("image_url"),
  status: text("status").notNull().default("active"), // active | cancelled
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const eventRsvpsTable = pgTable(
  "event_rsvps",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("event_rsvps_event_user_idx").on(t.eventId, t.userId)],
);

export const eventSavesTable = pgTable(
  "event_saves",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("event_saves_event_user_idx").on(t.eventId, t.userId)],
);

// Dedupe ledger for event notifications (reminders + cancellations).
// One row per (event, user, kind); insert with onConflictDoNothing and only
// send the notification when the insert actually returned a row.
export const eventReminderSendsTable = pgTable(
  "event_reminder_sends",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    userId: integer("user_id").notNull(),
    kind: text("kind").notNull(), // 24h | 1h | cancelled
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_reminder_sends_event_user_kind_idx").on(t.eventId, t.userId, t.kind),
  ],
);

export type Event = typeof eventsTable.$inferSelect;
export type InsertEvent = typeof eventsTable.$inferInsert;
export type EventRsvp = typeof eventRsvpsTable.$inferSelect;
export type EventSave = typeof eventSavesTable.$inferSelect;
