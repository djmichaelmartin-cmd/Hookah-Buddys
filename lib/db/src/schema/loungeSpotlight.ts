import {
  pgTable,
  serial,
  integer,
  text,
  real,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Member Location — SERVER-PRIVATE one-to-one saved location per user.
//
// This table is NEVER included in any public or current-user serializer. It
// stores a member's resolved location used to power the Local Lounge Spotlight.
// The coordinates may be an exact device location OR a derived city-level
// centroid (see `source`). We keep enough city-key metadata to detect when a
// persisted city-centroid fallback has gone stale (user moved cities).
// ─────────────────────────────────────────────────────────────────────────────

export const memberLocationsTable = pgTable(
  "member_locations",
  {
    id: serial("id").primaryKey(),
    // One row per user — enforced unique.
    userId: integer("user_id").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    // IANA timezone if known (e.g. "America/New_York"); nullable.
    timezone: text("timezone"),
    // How this location was derived:
    //   device      — precise coordinates provided by the client
    //   city_centroid — derived deterministically from mapped Business Page /
    //                   legacy lounge-directory coords matching the user's
    //                   city/state (a coarse fallback).
    //   city_geocode  — resolved server-side from the user's saved city/state.
    source: text("source").notNull().default("city_centroid"),
    // City-key metadata used to detect a stale city-centroid fallback: if the
    // user's users.city/state no longer matches these, the fallback is
    // recomputed. Stored uppercase/trimmed at write time by the service.
    cityKey: text("city_key"),
    stateKey: text("state_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("member_locations_user_idx").on(t.userId)],
);

export type MemberLocation = typeof memberLocationsTable.$inferSelect;
export type InsertMemberLocation = typeof memberLocationsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// City Geocodes — SERVER-PRIVATE shared cache for saved city/state lookups.
//
// A member's saved city/state is never sent to a browser geocoder. Successful
// coordinates stay here and are copied only into that member's private location
// row. Failed and ambiguous lookups are cached so member requests do not hammer
// the provider or fabricate a location.
// ─────────────────────────────────────────────────────────────────────────────

export const cityGeocodesTable = pgTable(
  "city_geocodes",
  {
    id: serial("id").primaryKey(),
    cityKey: text("city_key").notNull(),
    stateKey: text("state_key").notNull(),
    lat: real("lat"),
    lng: real("lng"),
    // pending | ready | ambiguous | unavailable
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull().default("nominatim"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("city_geocodes_city_state_idx").on(t.cityKey, t.stateKey)],
);

export type CityGeocode = typeof cityGeocodesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Business Spotlight Locations — SERVER-PRIVATE geocodes for Business Pages.
//
// These coordinates are intentionally separate from the legacy public business
// lat/lng columns. Only the Spotlight service reads this table. The address
// fingerprint is a one-way SHA-256 hash used to detect stale geocodes without
// duplicating a business address in the private location domain.
// ─────────────────────────────────────────────────────────────────────────────

export const businessSpotlightLocationsTable = pgTable(
  "business_spotlight_locations",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    lat: real("lat"),
    lng: real("lng"),
    addressFingerprint: text("address_fingerprint").notNull(),
    // pending | processing | ready | ambiguous | unavailable
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull().default("nominatim"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("business_spotlight_locations_business_idx").on(t.businessId),
  ],
);

export type BusinessSpotlightLocation =
  typeof businessSpotlightLocationsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Geocode Provider Throttle — SERVER-PRIVATE distributed request reservation.
//
// The singleton provider row lets multiple API replicas reserve non-overlapping
// request slots. This protects the external geocoder's rate limit without
// putting addresses, cities, or coordinates into queue metadata.
// ─────────────────────────────────────────────────────────────────────────────

export const geocodeProviderThrottleTable = pgTable("geocode_provider_throttle", {
  provider: text("provider").primaryKey(),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type GeocodeProviderThrottle =
  typeof geocodeProviderThrottleTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Daily Lounge Spotlight — durable per-member cache of the day's chosen top-3
// winners, keyed uniquely by (memberUserId, coarseLocationKey, localDate).
//
// The cache is PER MEMBER: even two members inside the same coarse grid cell on
// the same local date get independent rows, so no member can ever inherit
// another member's winner ids. The coarse key is retained (hashed + quantized,
// server-only) to scope a member's row to the location that produced it, so a
// member who moves to a new coarse cell recomputes rather than reusing a stale
// pick.
//
// `coarseLocationKey` is a ONE-WAY hashed + quantized coordinate key — never a
// raw exact coordinate.
//
// `businessIds` stores the ordered top-3 winner ids as a comma-separated string
// of integers (deterministic daily rotation is applied at read time; the stored
// order is the ranked selection order).
// ─────────────────────────────────────────────────────────────────────────────

export const dailyLoungeSpotlightsTable = pgTable(
  "daily_lounge_spotlights",
  {
    id: serial("id").primaryKey(),
    // The member this cached selection belongs to. Server-only; never serialized.
    memberUserId: integer("member_user_id").notNull(),
    // One-way hashed + quantized coarse coordinate key. NOT raw coordinates.
    coarseLocationKey: text("coarse_location_key").notNull(),
    // Local calendar date (YYYY-MM-DD) in the member's resolved timezone.
    localDate: text("local_date").notNull(),
    // Ordered ranked winner business ids, comma-separated (e.g. "12,7,45").
    businessIds: text("business_ids").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("daily_lounge_spotlights_member_key_date_idx").on(
      t.memberUserId,
      t.coarseLocationKey,
      t.localDate,
    ),
  ],
);

export type DailyLoungeSpotlight = typeof dailyLoungeSpotlightsTable.$inferSelect;
export type InsertDailyLoungeSpotlight =
  typeof dailyLoungeSpotlightsTable.$inferInsert;
