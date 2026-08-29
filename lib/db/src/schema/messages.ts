import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const messageThreadsTable = pgTable("message_threads", {
  id: serial("id").primaryKey(),
  memberUserId: integer("member_user_id").notNull(),
  dollId: integer("doll_id").notNull(),
  lastMessage: text("last_message"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull(),
  senderRole: text("sender_role").notNull(),
  senderUserId: integer("sender_user_id").notNull(),
  body: text("body").notNull(),
  paid: boolean("paid").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Structured linkage for a delivery message; delivery messages are never paid. */
export const customMessageMetadataTable = pgTable(
  "custom_message_metadata",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").notNull(),
    requestId: integer("request_id").notNull(),
    deliveryId: integer("delivery_id").notNull(),
    imageObjectPath: text("image_object_path"),
    videoObjectPath: text("video_object_path"),
    reusable: boolean("reusable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("custom_message_metadata_message_unique").on(t.messageId)],
);

export type MessageThread = typeof messageThreadsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type CustomMessageMetadata = typeof customMessageMetadataTable.$inferSelect;
