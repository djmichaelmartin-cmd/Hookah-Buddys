/**
 * Local Lounge Spotlight — shared service.
 *
 * Session-derived, privacy-safe selection of a member's best nearby lounges.
 *
 * Privacy invariants (enforced throughout this module):
 *   - We NEVER log or return raw coordinates, the coarse location key, or any
 *     user coordinates. `resolveMemberLocation` returns coords for internal use
 *     only; the public response cards + envelope contain no lat/lng/locationKey.
 *   - The member's private saved location lives in `member_locations`, which is
 *     never part of any public or current-user serializer.
 *   - The daily durable cache is keyed by a ONE-WAY hashed + quantized coarse
 *     coordinate key — never raw exact coordinates.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db as defaultDb,
  usersTable,
  businessesTable,
  businessFollowsTable,
  loungesTable,
  memberLocationsTable,
  dailyLoungeSpotlightsTable,
} from "@workspace/db";

export const RADIUS_MILES = 25;
// Bayesian prior used by the weighted rating formula.
const PRIOR_WEIGHT = 5;
const PRIOR_MEAN = 4.0;
// Coarse quantization step for the location key (~0.05deg ≈ a few miles). This
// groups nearby members into one durable daily row without exposing precision.
const COARSE_STEP = 0.05;

// Minimal db surface we depend on — lets tests inject a fake.
type Db = typeof defaultDb;

export type SpotlightState =
  | "login_required"
  | "location_required"
  | "ready"
  | "partial"
  | "empty";

export interface SpotlightCard {
  id: number;
  handle: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  businessType: string;
  category: string | null;
  city: string | null;
  state: string | null;
  tagline: string | null;
  distanceMiles: number;
  averageRating: number | null;
  reviewCount: number;
  weightedRating: number;
  verified: boolean;
  featured: boolean;
  openNow: boolean | null;
  // Whether the authenticated viewer already follows this Business Page.
  // Computed per-viewer from business_follows; does NOT affect rank/cache
  // identity and never exposes any user id.
  followed: boolean;
  // The legacy lounges.id representing the SAME physical venue as this Business
  // Page, when there is exactly one unambiguous cross-source match (normalized
  // name+city+state and public coordinates within a tight threshold). Null when
  // there is no match OR the match is ambiguous. Lets the client suppress a
  // duplicate legacy directory entry safely, without guessing on natural keys.
  // Computed post-selection from PUBLIC business coordinates only — never member
  // coordinates — and does NOT affect ranking or the durable cache.
  legacyLoungeId: number | null;
}

export interface SpotlightResponse {
  date: string;
  radiusMiles: number;
  locationLabel: string | null;
  state: SpotlightState;
  message: string;
  businesses: SpotlightCard[];
}

// Internal-only resolved location. Never serialized to the client.
interface ResolvedLocation {
  lat: number;
  lng: number;
  timezone: string | null;
  city: string | null;
  state: string | null;
  label: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinate / date helpers
// ─────────────────────────────────────────────────────────────────────────────

export function isValidLat(lat: unknown): lat is number {
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLng(lng: unknown): lng is number {
  return typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/** Haversine distance in miles. */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Exact weighted rating formula: (avg*count + 4.0*5) / (count + 5). */
export function weightedRating(
  averageRating: number | null,
  reviewCount: number,
): number {
  const avg = averageRating ?? 0;
  return (avg * reviewCount + PRIOR_MEAN * PRIOR_WEIGHT) / (reviewCount + PRIOR_WEIGHT);
}

/**
 * One-way hashed + quantized coarse coordinate key. Coordinates are snapped to a
 * coarse grid then SHA-256 hashed (truncated) so the raw values cannot be
 * recovered from the key.
 */
export function coarseLocationKey(lat: number, lng: number): string {
  const qLat = Math.round(lat / COARSE_STEP) * COARSE_STEP;
  const qLng = Math.round(lng / COARSE_STEP) * COARSE_STEP;
  // Fixed precision so the pre-hash string is stable across float noise.
  const grid = `${qLat.toFixed(3)}:${qLng.toFixed(3)}`;
  return createHash("sha256").update(grid).digest("hex").slice(0, 32);
}

/**
 * Resolve the local calendar date (YYYY-MM-DD) for a timezone. Prefers a valid
 * private timezone; otherwise a valid business/state timezone; else UTC.
 */
export function resolveLocalDate(
  primaryTz: string | null | undefined,
  fallbackTz: string | null | undefined,
  now: Date = new Date(),
): string {
  for (const tz of [primaryTz, fallbackTz]) {
    if (tz && isValidTimezone(tz)) {
      try {
        const fmt = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        // en-CA yields YYYY-MM-DD.
        return fmt.format(now);
      } catch {
        // fall through
      }
    }
  }
  return now.toISOString().slice(0, 10);
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toUpperCase();
  return t.length ? t : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Location resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a signed-in member's location for the spotlight.
 *
 * Priority:
 *   1. Private saved coords in `member_locations` (device or fresh centroid).
 *   2. users.city/state fallback: derive a deterministic city centroid from
 *      active/public Business Page coords and/or legacy lounge-directory coords
 *      matching city/state; persist as a server-private city_centroid location.
 *
 * Returns null when no usable mapped centroid exists (=> location_required).
 */
export async function resolveMemberLocation(
  db: Db,
  user: { id: number; city: string | null; state: string | null },
): Promise<ResolvedLocation | null> {
  const userCity = normKey(user.city);
  const userState = normKey(user.state);

  const [saved] = await db
    .select()
    .from(memberLocationsTable)
    .where(eq(memberLocationsTable.userId, user.id))
    .limit(1);

  if (saved && isValidLat(saved.lat) && isValidLng(saved.lng)) {
    // A device-provided location is always trusted. A city_centroid fallback is
    // only reused when it still matches the user's current city/state (stale
    // detection). Otherwise we recompute below.
    const fresh =
      saved.source === "device" ||
      (saved.cityKey === userCity && saved.stateKey === userState);
    if (fresh) {
      return {
        lat: saved.lat,
        lng: saved.lng,
        timezone: saved.timezone ?? null,
        city: user.city,
        state: user.state,
        label: locationLabel(user.city, user.state),
      };
    }
  }

  // Fallback: derive a city centroid from mapped coords matching city/state.
  if (!userCity || !userState) return null;

  const centroid = await deriveCityCentroid(db, userCity, userState);
  if (!centroid) return null;

  // Persist as a server-private city-level location (upsert on unique userId).
  await db
    .insert(memberLocationsTable)
    .values({
      userId: user.id,
      lat: centroid.lat,
      lng: centroid.lng,
      timezone: centroid.timezone ?? null,
      source: "city_centroid",
      cityKey: userCity,
      stateKey: userState,
    })
    .onConflictDoUpdate({
      target: memberLocationsTable.userId,
      set: {
        lat: centroid.lat,
        lng: centroid.lng,
        timezone: centroid.timezone ?? null,
        source: "city_centroid",
        cityKey: userCity,
        stateKey: userState,
        updatedAt: new Date(),
      },
    });

  return {
    lat: centroid.lat,
    lng: centroid.lng,
    timezone: centroid.timezone ?? null,
    city: user.city,
    state: user.state,
    label: locationLabel(user.city, user.state),
  };
}

interface Centroid {
  lat: number;
  lng: number;
  timezone: string | null;
}

/**
 * Deterministic city centroid from active/public Business Page coords and/or
 * legacy lounge-directory coords matching city/state. Averages all valid
 * mapped points; deterministic since it does not depend on row order.
 */
async function deriveCityCentroid(
  db: Db,
  cityKey: string,
  stateKey: string,
): Promise<Centroid | null> {
  const points: { lat: number; lng: number; timezone: string | null }[] = [];

  const bizRows = await db
    .select({
      lat: businessesTable.lat,
      lng: businessesTable.lng,
      timezone: businessesTable.timezone,
    })
    .from(businessesTable)
    .where(
      and(
        eq(businessesTable.status, "active"),
        eq(businessesTable.isPublished, true),
        isNotNull(businessesTable.lat),
        isNotNull(businessesTable.lng),
        sql`upper(trim(${businessesTable.city})) = ${cityKey}`,
        sql`upper(trim(${businessesTable.state})) = ${stateKey}`,
      ),
    );
  for (const r of bizRows) {
    if (isValidLat(r.lat) && isValidLng(r.lng)) {
      points.push({ lat: r.lat, lng: r.lng, timezone: r.timezone ?? null });
    }
  }

  const loungeRows = await db
    .select({ lat: loungesTable.lat, lng: loungesTable.lng })
    .from(loungesTable)
    .where(
      and(
        sql`upper(trim(${loungesTable.city})) = ${cityKey}`,
        sql`upper(trim(${loungesTable.state})) = ${stateKey}`,
      ),
    );
  for (const r of loungeRows) {
    if (isValidLat(r.lat) && isValidLng(r.lng)) {
      points.push({ lat: r.lat, lng: r.lng, timezone: null });
    }
  }

  if (points.length === 0) return null;

  const sumLat = points.reduce((s, p) => s + p.lat, 0);
  const sumLng = points.reduce((s, p) => s + p.lng, 0);
  const lat = sumLat / points.length;
  const lng = sumLng / points.length;
  const timezone = points.find((p) => p.timezone)?.timezone ?? null;

  if (!isValidLat(lat) || !isValidLng(lng)) return null;
  return { lat, lng, timezone };
}

function locationLabel(city: string | null, state: string | null): string | null {
  const c = city?.trim();
  const s = state?.trim();
  if (c && s) return `${c}, ${s}`;
  if (c) return c;
  if (s) return s;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate ranking
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateBusiness {
  id: number;
  handle: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  businessType: string;
  category: string | null;
  city: string | null;
  state: string | null;
  tagline: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  averageRating: number | null;
  reviewCount: number;
  verificationStatus: string;
  isFeatured: boolean;
  featuredUntil: Date | null;
  isSponsored: boolean;
  sponsoredUntil: Date | null;
  timezone: string | null;
  hours: Record<string, string | null> | null;
  isOpenNowOverride: boolean | null;
  status: string;
  isPublished: boolean;
  eligibleForLoungeSpotlight: boolean;
}

interface RankedCandidate extends CandidateBusiness {
  distanceMiles: number;
  weighted: number;
  effFeatured: boolean;
  effSponsored: boolean;
}

/**
 * Apply candidate rules + ranking. Returns candidates within radius, ranked per
 * the exact deterministic tie-break spec. Does NOT restrict by businessType.
 */
export function rankCandidates(
  candidates: CandidateBusiness[],
  origin: { lat: number; lng: number },
  now: Date = new Date(),
): RankedCandidate[] {
  const nowMs = now.getTime();
  const eligible: RankedCandidate[] = [];

  for (const c of candidates) {
    if (c.status !== "active") continue;
    if (!c.isPublished) continue;
    if (!c.eligibleForLoungeSpotlight) continue;
    if (c.averageRating == null) continue;
    if (!(c.reviewCount > 0)) continue;
    if (!isValidLat(c.lat) || !isValidLng(c.lng)) continue;
    const distanceMiles = haversineMiles(origin.lat, origin.lng, c.lat, c.lng);
    if (distanceMiles > RADIUS_MILES) continue;

    const effFeatured =
      c.isFeatured &&
      (c.featuredUntil == null || c.featuredUntil.getTime() > nowMs);
    const effSponsored =
      c.isSponsored &&
      (c.sponsoredUntil == null || c.sponsoredUntil.getTime() > nowMs);

    eligible.push({
      ...c,
      distanceMiles,
      weighted: weightedRating(c.averageRating, c.reviewCount),
      effFeatured,
      effSponsored,
    });
  }

  eligible.sort((a, b) => {
    // weightedRating DESC
    if (b.weighted !== a.weighted) return b.weighted - a.weighted;
    // reviewCount DESC
    if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
    // verified DESC
    const av = a.verificationStatus === "verified" ? 1 : 0;
    const bv = b.verificationStatus === "verified" ? 1 : 0;
    if (bv !== av) return bv - av;
    // current isFeatured DESC (respect featuredUntil)
    if (a.effFeatured !== b.effFeatured) return a.effFeatured ? -1 : 1;
    // isSponsored (same promotion tie group, after featured)
    if (a.effSponsored !== b.effSponsored) return a.effSponsored ? -1 : 1;
    // distance ASC
    if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles;
    // id ASC
    return a.id - b.id;
  });

  return eligible;
}

/**
 * Deterministic daily rotation of the SAME top-3 (never substitutes rank 4+).
 * The rotation offset is derived from the local date so the order is stable for
 * a given day and rotates day to day.
 */
export function rotateDaily<T>(top: T[], localDate: string): T[] {
  if (top.length <= 1) return top.slice();
  // Deterministic day-derived offset from the date digits.
  const digits = localDate.replace(/\D/g, "");
  let acc = 0;
  for (const ch of digits) acc = (acc * 10 + Number(ch)) % 100000;
  const offset = acc % top.length;
  return top.slice(offset).concat(top.slice(0, offset));
}

// ─────────────────────────────────────────────────────────────────────────────
// openNow (mirrors the businesses route logic)
// ─────────────────────────────────────────────────────────────────────────────

export function computeOpenNow(biz: {
  hours: Record<string, string | null> | null;
  timezone: string | null;
  isOpenNowOverride: boolean | null;
}): boolean | null {
  if (biz.isOpenNowOverride !== null && biz.isOpenNowOverride !== undefined) {
    return biz.isOpenNowOverride;
  }
  if (!biz.hours) return null;
  const tz = biz.timezone || "UTC";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const weekday = parts.find((p) => p.type === "weekday")?.value.toLowerCase() ?? "";
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minStr = parts.find((p) => p.type === "minute")?.value ?? "00";
    const dayKey = weekday.slice(0, 3);
    const spec = biz.hours[dayKey];
    if (!spec) return false;
    const nowMinutes = parseInt(hourStr, 10) * 60 + parseInt(minStr, 10);
    for (const range of spec.split(",")) {
      const [open, close] = range.trim().split("-");
      const [oh, om] = open.split(":").map((v) => parseInt(v, 10));
      const [ch, cm] = close.split(":").map((v) => parseInt(v, 10));
      if ([oh, om, ch, cm].some((n) => isNaN(n))) continue;
      const openM = oh * 60 + om;
      let closeM = ch * 60 + cm;
      if (closeM <= openM) closeM += 24 * 60;
      const nm = nowMinutes < openM ? nowMinutes + 24 * 60 : nowMinutes;
      if (nm >= openM && nm < closeM) return true;
    }
    return false;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Card serialization — narrow + privacy-safe
// ─────────────────────────────────────────────────────────────────────────────

export function serializeCard(
  c: RankedCandidate,
  followed = false,
  legacyLoungeId: number | null = null,
): SpotlightCard {
  return {
    id: c.id,
    handle: c.handle,
    name: c.name,
    logoUrl: c.logoUrl ?? null,
    coverUrl: c.coverUrl ?? null,
    businessType: c.businessType,
    category: c.category ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    tagline: c.tagline ?? c.description ?? null,
    distanceMiles: Math.round(c.distanceMiles * 10) / 10,
    averageRating: c.averageRating ?? null,
    reviewCount: c.reviewCount,
    weightedRating: Math.round(c.weighted * 1000) / 1000,
    verified: c.verificationStatus === "verified",
    featured: c.effFeatured,
    openNow: computeOpenNow(c),
    followed,
    legacyLoungeId,
  };
}

/**
 * Which of the given business ids the viewer follows. Selects only the
 * businessId column (never any user id) filtered to the viewer, so no user id
 * can leak into the response. Returns an empty set for no ids.
 */
async function loadFollowedIds(
  db: Db,
  viewerId: number,
  businessIds: number[],
): Promise<Set<number>> {
  if (businessIds.length === 0) return new Set();
  const rows = await db
    .select({ businessId: businessFollowsTable.businessId })
    .from(businessFollowsTable)
    .where(
      and(
        eq(businessFollowsTable.userId, viewerId),
        inArray(businessFollowsTable.businessId, businessIds),
      ),
    );
  return new Set(rows.map((r) => r.businessId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-source legacy Lounge matching (privacy-safe, post-selection)
// ─────────────────────────────────────────────────────────────────────────────

// Tight coordinate threshold for treating a legacy Lounge as the SAME physical
// venue as a Business Page (~0.1 miles).
const LEGACY_MATCH_MILES = 0.1;

/** Normalize a free-text natural-key part for exact cross-source comparison. */
function normName(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // collapse punctuation to spaces
    .trim()
    .replace(/\s+/g, " ");
  return t.length ? t : null;
}

/**
 * For each winning Business Page, find the legacy lounges.id of the SAME
 * physical venue — but ONLY when the match is unambiguous:
 *   - normalized name AND normalized city AND normalized state all match, and
 *   - the legacy Lounge's PUBLIC coordinates are within LEGACY_MATCH_MILES of
 *     the Business Page's PUBLIC coordinates.
 * If zero legacy rows qualify, or MORE THAN ONE qualifies (ambiguous, e.g. two
 * same-named venues in the city), the business maps to null.
 *
 * Uses only PUBLIC business coordinates — never member coordinates — and runs
 * after selection, so it never affects ranking or the durable cache.
 * Efficient for the max-3 winners: one indexed-ish city/state scan.
 */
async function loadLegacyLoungeMatches(
  db: Db,
  winners: RankedCandidate[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const usable = winners.filter(
    (w) =>
      normName(w.name) &&
      normName(w.city) &&
      normName(w.state) &&
      isValidLat(w.lat) &&
      isValidLng(w.lng),
  );
  if (usable.length === 0) return out;

  // Fetch only legacy lounges in the winners' city/state set (small candidate
  // pool), selecting just the fields needed for matching.
  const cityKeys = Array.from(
    new Set(usable.map((w) => normName(w.city) as string)),
  );
  const stateKeys = Array.from(
    new Set(usable.map((w) => normName(w.state) as string)),
  );
  const rows = await db
    .select({
      id: loungesTable.id,
      name: loungesTable.name,
      city: loungesTable.city,
      state: loungesTable.state,
      lat: loungesTable.lat,
      lng: loungesTable.lng,
    })
    .from(loungesTable)
    .where(
      and(
        inArray(sql`lower(trim(${loungesTable.city}))`, cityKeys),
        inArray(sql`lower(trim(${loungesTable.state}))`, stateKeys),
      ),
    );

  const legacy = rows
    .filter((r) => isValidLat(r.lat) && isValidLng(r.lng))
    .map((r) => ({
      id: r.id,
      name: normName(r.name),
      city: normName(r.city),
      state: normName(r.state),
      lat: r.lat as number,
      lng: r.lng as number,
    }));

  for (const w of usable) {
    const wName = normName(w.name);
    const wCity = normName(w.city);
    const wState = normName(w.state);
    const matches = legacy.filter(
      (l) =>
        l.name === wName &&
        l.city === wCity &&
        l.state === wState &&
        haversineMiles(w.lat as number, w.lng as number, l.lat, l.lng) <=
          LEGACY_MATCH_MILES,
    );
    // Exactly one unambiguous match, or nothing.
    if (matches.length === 1) out.set(w.id, matches[0].id);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages / envelope
// ─────────────────────────────────────────────────────────────────────────────

const MESSAGES = {
  login_required:
    "Sign in to see today's best hookah lounges near you.",
  location_required:
    "Add your city and state to your profile to see today's best local lounges.",
  ready: "Here are today's best hookah lounges near you.",
  partial:
    "We found a couple of great local lounges today — more spots are on the way as pages get verified nearby.",
  empty:
    "No eligible local lounges to spotlight yet. Check back soon as more nearby pages join.",
} as const;

export function buildEnvelope(
  state: SpotlightState,
  opts: {
    date: string;
    locationLabel: string | null;
    businesses: SpotlightCard[];
  },
): SpotlightResponse {
  return {
    date: opts.date,
    radiusMiles: RADIUS_MILES,
    locationLabel: opts.locationLabel,
    state,
    message: MESSAGES[state],
    businesses: opts.businesses,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate DB query
// ─────────────────────────────────────────────────────────────────────────────

const CANDIDATE_COLUMNS = {
  id: businessesTable.id,
  handle: businessesTable.handle,
  name: businessesTable.name,
  logoUrl: businessesTable.logoUrl,
  coverUrl: businessesTable.coverUrl,
  businessType: businessesTable.businessType,
  category: businessesTable.category,
  city: businessesTable.city,
  state: businessesTable.state,
  tagline: businessesTable.tagline,
  description: businessesTable.description,
  lat: businessesTable.lat,
  lng: businessesTable.lng,
  averageRating: businessesTable.averageRating,
  reviewCount: businessesTable.reviewCount,
  verificationStatus: businessesTable.verificationStatus,
  isFeatured: businessesTable.isFeatured,
  featuredUntil: businessesTable.featuredUntil,
  isSponsored: businessesTable.isSponsored,
  sponsoredUntil: businessesTable.sponsoredUntil,
  timezone: businessesTable.timezone,
  hours: businessesTable.hours,
  isOpenNowOverride: businessesTable.isOpenNowOverride,
  status: businessesTable.status,
  isPublished: businessesTable.isPublished,
  eligibleForLoungeSpotlight: businessesTable.eligibleForLoungeSpotlight,
};

async function loadCandidates(db: Db): Promise<CandidateBusiness[]> {
  const rows = await db
    .select(CANDIDATE_COLUMNS)
    .from(businessesTable)
    .where(
      and(
        eq(businessesTable.status, "active"),
        eq(businessesTable.isPublished, true),
        eq(businessesTable.eligibleForLoungeSpotlight, true),
        // Rejected pages are never eligible. active+published is the
        // approval/lifecycle gate; an unverified (pending) page remains eligible
        // — only an explicitly rejected verification excludes it.
        sql`${businessesTable.verificationStatus} <> 'rejected'`,
        isNotNull(businessesTable.averageRating),
        sql`${businessesTable.reviewCount} > 0`,
        isNotNull(businessesTable.lat),
        isNotNull(businessesTable.lng),
      ),
    );
  return rows as CandidateBusiness[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entrypoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the local spotlight for a session. `user` is null for signed-out.
 *
 * Concurrency-safe: the daily durable row is created with an
 * insert-on-conflict-do-nothing followed by a re-select, so parallel requests
 * converge on one winner order.
 */
export async function getLocalSpotlight(
  user: { id: number; city: string | null; state: string | null } | null,
  opts: { db?: Db; now?: Date } = {},
): Promise<SpotlightResponse> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();

  if (!user) {
    const date = resolveLocalDate(null, null, now);
    return buildEnvelope("login_required", {
      date,
      locationLabel: null,
      businesses: [],
    });
  }

  const location = await resolveMemberLocation(db, user);
  if (!location) {
    const date = resolveLocalDate(null, null, now);
    return buildEnvelope("location_required", {
      date,
      locationLabel: locationLabel(user.city, user.state),
      businesses: [],
    });
  }

  const allCandidates = await loadCandidates(db);
  const ranked = rankCandidates(allCandidates, location, now);

  // Pick the local date using private tz first, then a nearby business tz.
  const businessTz = ranked.find((r) => r.timezone)?.timezone ?? null;
  const localDate = resolveLocalDate(location.timezone, businessTz, now);
  const key = coarseLocationKey(location.lat, location.lng);

  // Read-or-create the durable daily row. Scoped PER MEMBER so no member can
  // inherit another member's winner ids, even in the same coarse cell. The
  // stored winner ids are the ranked top-3 selection order (rotation at read).
  let storedIds = await readDailyIds(db, user.id, key, localDate);
  if (storedIds === null) {
    const top3 = ranked.slice(0, 3).map((r) => r.id);
    storedIds = await persistDailyIds(db, user.id, key, localDate, top3);
  }

  // Revalidate cached ids against CURRENT candidate safety (active/public/
  // eligible/rating/coords/radius). Admin disabling may yield fewer immediately
  // rather than leaking stale ineligible pages.
  const freshById = new Map(ranked.map((r) => [r.id, r]));
  const safe: RankedCandidate[] = [];
  for (const id of storedIds) {
    const r = freshById.get(id);
    if (r) safe.push(r);
  }

  // Deterministic daily rotation of the SAME (validated) top-3.
  const rotated = rotateDaily(safe, localDate);

  // Per-viewer Follow state. Computed AFTER selection/rotation so it never
  // affects rank or the durable cache identity. Only surfaced to the
  // authenticated viewer (`user` is always non-null here).
  const followedIds = await loadFollowedIds(
    db,
    user.id,
    rotated.map((r) => r.id),
  );

  // Privacy-safe cross-source legacy Lounge match for the (max 3) winners.
  // Uses only PUBLIC business coordinates; computed post-selection so it never
  // affects ranking or the durable cache. Ambiguous/no-match => null.
  const legacyByBiz = await loadLegacyLoungeMatches(db, rotated);

  const cards = rotated.map((r) =>
    serializeCard(r, followedIds.has(r.id), legacyByBiz.get(r.id) ?? null),
  );

  let state: SpotlightState;
  if (cards.length >= 3) state = "ready";
  else if (cards.length >= 1) state = "partial";
  else state = "empty";

  return buildEnvelope(state, {
    date: localDate,
    locationLabel: location.label,
    businesses: cards,
  });
}

/** Returns stored ordered ids for this member, or null when no row exists yet. */
async function readDailyIds(
  db: Db,
  memberUserId: number,
  key: string,
  localDate: string,
): Promise<number[] | null> {
  const [row] = await db
    .select({ businessIds: dailyLoungeSpotlightsTable.businessIds })
    .from(dailyLoungeSpotlightsTable)
    .where(
      and(
        eq(dailyLoungeSpotlightsTable.memberUserId, memberUserId),
        eq(dailyLoungeSpotlightsTable.coarseLocationKey, key),
        eq(dailyLoungeSpotlightsTable.localDate, localDate),
      ),
    )
    .limit(1);
  if (!row) return null;
  return parseIds(row.businessIds);
}

/**
 * Concurrency-safe persist: insert-on-conflict-do-nothing, then re-select so
 * every racer returns the single winning order that actually landed. Scoped
 * per (memberUserId, coarseLocationKey, localDate).
 */
async function persistDailyIds(
  db: Db,
  memberUserId: number,
  key: string,
  localDate: string,
  ids: number[],
): Promise<number[]> {
  await db
    .insert(dailyLoungeSpotlightsTable)
    .values({
      memberUserId,
      coarseLocationKey: key,
      localDate,
      businessIds: ids.join(","),
    })
    .onConflictDoNothing({
      target: [
        dailyLoungeSpotlightsTable.memberUserId,
        dailyLoungeSpotlightsTable.coarseLocationKey,
        dailyLoungeSpotlightsTable.localDate,
      ],
    });
  const existing = await readDailyIds(db, memberUserId, key, localDate);
  return existing ?? ids;
}

function parseIds(raw: string): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache invalidation (admin moderation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invalidate durable daily caches that reference a business id. Used after an
 * admin toggles spotlight eligibility so a disabled page cannot leak from cache.
 * Never logs coordinates or the coarse key.
 */
export async function invalidateDailyCachesForBusiness(
  businessId: number,
  db: Db = defaultDb,
): Promise<void> {
  // Match rows whose comma-joined id list contains this id (as a whole token).
  await db
    .delete(dailyLoungeSpotlightsTable)
    .where(
      sql`',' || ${dailyLoungeSpotlightsTable.businessIds} || ',' LIKE ${"%," + businessId + ",%"}`,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Member location save (authenticated device location)
// ─────────────────────────────────────────────────────────────────────────────

export type SaveLocationError = "invalid_coordinates" | "invalid_timezone";

export interface SaveLocationInput {
  latitude: unknown;
  longitude: unknown;
  timezone?: unknown;
}

/**
 * Validate + upsert a member's SERVER-PRIVATE device location.
 *
 * Privacy: this NEVER returns coordinates and NEVER logs any coordinate/tz
 * value. On success it saves source="device" and clears the city-key metadata
 * (a device fix supersedes any stale city-centroid fallback) and returns
 * `{ ok: true }`; the route echoes only `{ saved: true }`.
 *
 * Validation:
 *   - latitude/longitude must be finite numbers in valid ranges.
 *   - timezone, if provided, must be a non-empty IANA zone accepted by Intl.
 */
export async function saveMemberLocation(
  userId: number,
  input: SaveLocationInput,
  db: Db = defaultDb,
): Promise<{ ok: true } | { ok: false; error: SaveLocationError }> {
  const { latitude, longitude, timezone } = input;
  if (!isValidLat(latitude) || !isValidLng(longitude)) {
    return { ok: false, error: "invalid_coordinates" };
  }

  let tz: string | null = null;
  if (timezone !== undefined && timezone !== null) {
    if (typeof timezone !== "string") {
      return { ok: false, error: "invalid_timezone" };
    }
    const trimmed = timezone.trim();
    if (trimmed.length === 0 || !isValidTimezone(trimmed)) {
      return { ok: false, error: "invalid_timezone" };
    }
    tz = trimmed;
  }

  // A device fix supersedes any prior city-centroid fallback: mark source
  // "device" and null out the stale city-key metadata so it is never reused.
  await db
    .insert(memberLocationsTable)
    .values({
      userId,
      lat: latitude,
      lng: longitude,
      timezone: tz,
      source: "device",
      cityKey: null,
      stateKey: null,
    })
    .onConflictDoUpdate({
      target: memberLocationsTable.userId,
      set: {
        lat: latitude,
        lng: longitude,
        timezone: tz,
        source: "device",
        cityKey: null,
        stateKey: null,
        updatedAt: new Date(),
      },
    });

  return { ok: true };
}

// Re-export for admin serializer use.
export { normKey as _normKey };
