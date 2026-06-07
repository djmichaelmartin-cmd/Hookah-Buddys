import {
  pgTable,
  serial,
  text,
  real,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

// Lead-generation database of U.S. hookah businesses collected from Google Places.
export const businessLeadsTable = pgTable("business_leads", {
  id: serial("id").primaryKey(),
  placeId: text("place_id").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  primaryType: text("primary_type"),
  types: text("types"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  county: text("county"),
  phone: text("phone"),
  website: text("website"),
  googleMapsUrl: text("google_maps_url"),
  lat: real("lat"),
  lng: real("lng"),
  businessStatus: text("business_status"),
  rating: real("rating"),
  reviewCount: integer("review_count"),
  priceLevel: integer("price_level"),
  hours: text("hours"),
  instagram: text("instagram"),
  facebook: text("facebook"),
  sourceQuery: text("source_query"),
  confidence: integer("confidence").notNull().default(0),
  validationStatus: text("validation_status").notNull().default("needs_manual"),
  dateCollected: timestamp("date_collected").notNull().defaultNow(),
  lastVerified: timestamp("last_verified").notNull().defaultNow(),
});

// Records that were skipped during collection (duplicates, out-of-scope, non-hookah).
export const rejectedLeadsTable = pgTable("rejected_leads", {
  id: serial("id").primaryKey(),
  placeId: text("place_id"),
  name: text("name"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  phone: text("phone"),
  reason: text("reason").notNull(),
  matchedLeadId: integer("matched_lead_id"),
  sourceQuery: text("source_query"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BusinessLead = typeof businessLeadsTable.$inferSelect;
export type InsertBusinessLead = typeof businessLeadsTable.$inferInsert;
export type RejectedLead = typeof rejectedLeadsTable.$inferSelect;
export type InsertRejectedLead = typeof rejectedLeadsTable.$inferInsert;
