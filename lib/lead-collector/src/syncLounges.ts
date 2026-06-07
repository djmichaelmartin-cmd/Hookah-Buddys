import { isNotNull } from "drizzle-orm";
import { db, businessLeadsTable, loungesTable } from "@workspace/db";
import { normalizeNameAddress, normalizePhone } from "./classify";

export interface SyncLoungesResult {
  published: number;
}

// Categories from the lead classifier that belong in the public lounge directory.
const DIRECTORY_CATEGORIES = ["Hookah Lounge/Bar"];

// U.S. states + DC. Google Places occasionally returns foreign businesses for a
// city query (e.g. an "Arabian Nights" in Hyderabad, TS or a Tijuana, B.C. lounge);
// the public directory is U.S.-only, so anything with a non-U.S. state is excluded.
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

/**
 * Rebuilds the collected portion of the public `lounges` directory from the lead
 * database. Inside a single transaction it removes every previously-published row
 * (placeId IS NOT NULL) and re-inserts the current eligible set, so the operation
 * is idempotent, race-safe, and self-cleaning: leads that became closed or are no
 * longer directory-eligible simply drop out. Hand-seeded/editorial lounges
 * (placeId NULL) are never touched.
 *
 * Eligibility: category "Hookah Lounge/Bar", not closed, with coordinates (lat/lng
 * are required by the directory + map). Near-duplicate businesses that slipped past
 * lead dedup (same name+address or phone, different placeId) are collapsed here.
 */
export async function syncLoungesFromLeads(): Promise<SyncLoungesResult> {
  const leads = await db.select().from(businessLeadsTable);

  const candidates = leads.filter(
    (l) =>
      DIRECTORY_CATEGORIES.includes(l.category) &&
      l.validationStatus !== "closed" &&
      l.state !== null &&
      US_STATES.has(l.state) &&
      l.lat !== null &&
      l.lng !== null,
  );

  // Collapse near-duplicates (different placeId, same business) by a stable key.
  const seen = new Set<string>();
  const unique = candidates.filter((l) => {
    const key =
      normalizeNameAddress(l.name, l.address) ??
      normalizePhone(l.phone) ??
      l.placeId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rows = unique.map((l) => ({
    placeId: l.placeId,
    name: l.name,
    address: l.address ?? null,
    city: l.city ?? "",
    state: l.state ?? "",
    zip: l.zip ?? null,
    lat: l.lat as number,
    lng: l.lng as number,
    phone: l.phone ?? null,
    website: l.website ?? null,
    rating: l.rating ?? null,
    priceLevel: l.priceLevel ?? null,
    hours: l.hours ?? null,
  }));

  await db.transaction(async (tx) => {
    await tx.delete(loungesTable).where(isNotNull(loungesTable.placeId));
    if (rows.length > 0) {
      await tx.insert(loungesTable).values(rows);
    }
  });

  return { published: rows.length };
}
