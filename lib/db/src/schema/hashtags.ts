import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// Canonical hashtag registry. `tag` is stored lowercase without the leading '#'.
// `displayTag` preserves the casing from the first use (e.g. "DoubleApple").
export const hashtagsTable = pgTable(
  "hashtags",
  {
    id: serial("id").primaryKey(),
    tag: text("tag").notNull(),
    displayTag: text("display_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hashtags_tag_idx").on(t.tag)],
);

export const postHashtagsTable = pgTable(
  "post_hashtags",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    hashtagId: integer("hashtag_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("post_hashtags_pair_idx").on(t.postId, t.hashtagId),
    index("post_hashtags_hashtag_idx").on(t.hashtagId),
  ],
);

export type Hashtag = typeof hashtagsTable.$inferSelect;
export type PostHashtag = typeof postHashtagsTable.$inferSelect;
