import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const photoAlbumsTable = pgTable("photo_albums", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  visibility: text("visibility").notNull().default("public"),
  albumType: text("album_type").notNull().default("custom"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  albumId: integer("album_id").notNull(),
  imageUrl: text("image_url").notNull(),
  caption: text("caption"),
  visibility: text("visibility").notNull().default("public"),
  status: text("status").notNull().default("active"),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const photoLikesTable = pgTable(
  "photo_likes",
  {
    id: serial("id").primaryKey(),
    photoId: integer("photo_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("photo_likes_photo_user_idx").on(t.photoId, t.userId)],
);

export const photoCommentsTable = pgTable("photo_comments", {
  id: serial("id").primaryKey(),
  photoId: integer("photo_id").notNull(),
  userId: integer("user_id").notNull(),
  commentText: text("comment_text").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PhotoAlbum = typeof photoAlbumsTable.$inferSelect;
export type Photo = typeof photosTable.$inferSelect;
export type PhotoLike = typeof photoLikesTable.$inferSelect;
export type PhotoComment = typeof photoCommentsTable.$inferSelect;
