import { pgTable, serial, text, real, integer } from "drizzle-orm/pg-core";

export const loungesTable = pgTable("lounges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip"),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  phone: text("phone"),
  website: text("website"),
  description: text("description"),
  rating: real("rating"),
  priceLevel: integer("price_level"),
  hours: text("hours"),
  imageUrl: text("image_url"),
});

export type Lounge = typeof loungesTable.$inferSelect;
export type InsertLounge = typeof loungesTable.$inferInsert;
