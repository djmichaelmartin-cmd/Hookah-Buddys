import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const friendRequestsTable = pgTable("friend_requests", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull(),
  receiverId: integer("receiver_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | accepted | declined | cancelled
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const friendshipsTable = pgTable(
  "friendships",
  {
    id: serial("id").primaryKey(),
    // Invariant: userAId < userBId (canonical ordering to prevent duplicates)
    userAId: integer("user_a_id").notNull(),
    userBId: integer("user_b_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("friendships_pair_idx").on(t.userAId, t.userBId)],
);

export const blocksTable = pgTable(
  "blocks",
  {
    id: serial("id").primaryKey(),
    blockerId: integer("blocker_id").notNull(),
    blockedUserId: integer("blocked_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("blocks_pair_idx").on(t.blockerId, t.blockedUserId)],
);

export type FriendRequest = typeof friendRequestsTable.$inferSelect;
export type Friendship = typeof friendshipsTable.$inferSelect;
export type Block = typeof blocksTable.$inferSelect;
