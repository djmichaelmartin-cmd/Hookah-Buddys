import { sql } from "drizzle-orm";
import {
  db,
  businessLeadsTable,
  rejectedLeadsTable,
} from "@workspace/db";
import { searchText, getApiKey, type PlaceResult } from "./places";
import { getMarket, type Market } from "./markets";
import { KEYWORDS } from "./keywords";
import {
  normalize,
  isHookahRelevant,
  normalizePhone,
  normalizeNameAddress,
} from "./classify";

export interface CollectProgress {
  market: string;
  running: boolean;
  totalQueries: number;
  queriesRun: number;
  fetched: number;
  inserted: number;
  updated: number;
  rejected: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface CollectResult {
  market: string;
  fetched: number;
  inserted: number;
  updated: number;
  rejected: number;
}

export interface CollectOptions {
  marketId: string;
  maxPagesPerQuery?: number;
  throttleMs?: number;
  onProgress?: (p: CollectProgress) => void;
}

function inScope(
  market: Market,
  lead: { state: string | null; county: string | null },
): boolean {
  if (market.states.length > 0) {
    if (!lead.state || !market.states.includes(lead.state)) return false;
  }
  if (market.county) {
    if (!lead.county || lead.county !== market.county) return false;
  }
  return true;
}

/**
 * Collects hookah-business leads for a market: runs every keyword against every
 * city, dedupes (placeId -> phone -> name+address), scores confidence, classifies
 * validation status, upserts accepted leads, and records rejects.
 */
export async function collectMarket(
  opts: CollectOptions,
): Promise<CollectResult> {
  const market = getMarket(opts.marketId);
  if (!market) throw new Error(`Unknown market: ${opts.marketId}`);
  const apiKey = getApiKey();

  const progress: CollectProgress = {
    market: market.id,
    running: true,
    totalQueries: market.cities.length * KEYWORDS.length,
    queriesRun: 0,
    fetched: 0,
    inserted: 0,
    updated: 0,
    rejected: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  const report = () => opts.onProgress?.({ ...progress });
  report();

  // Load existing dedup keys so we dedupe across runs, not just within one.
  const existing = await db
    .select({
      id: businessLeadsTable.id,
      placeId: businessLeadsTable.placeId,
      phone: businessLeadsTable.phone,
      name: businessLeadsTable.name,
      address: businessLeadsTable.address,
    })
    .from(businessLeadsTable);

  const placeIds = new Set<string>(existing.map((e) => e.placeId));
  const phoneToId = new Map<string, number>();
  const nameAddrToId = new Map<string, number>();
  for (const e of existing) {
    const p = normalizePhone(e.phone);
    if (p) phoneToId.set(p, e.id);
    const na = normalizeNameAddress(e.name, e.address);
    if (na) nameAddrToId.set(na, e.id);
  }

  const recordReject = async (
    place: PlaceResult,
    reason: string,
    sourceQuery: string,
    matchedLeadId?: number,
  ) => {
    progress.rejected++;
    await db.insert(rejectedLeadsTable).values({
      placeId: place.id,
      name: place.displayName?.text ?? null,
      address: place.formattedAddress ?? null,
      city:
        place.addressComponents?.find((c) => c.types?.includes("locality"))
          ?.longText ?? null,
      state:
        place.addressComponents?.find((c) =>
          c.types?.includes("administrative_area_level_1"),
        )?.shortText ?? null,
      phone: place.nationalPhoneNumber ?? null,
      reason,
      matchedLeadId: matchedLeadId ?? null,
      sourceQuery,
    });
  };

  try {
    for (const { city, state } of market.cities) {
      for (const keyword of KEYWORDS) {
        const query = `${keyword} in ${city}, ${state}`;
        let places: PlaceResult[] = [];
        try {
          places = await searchText(query, {
            apiKey,
            maxPages: opts.maxPagesPerQuery ?? 2,
            throttleMs: opts.throttleMs ?? 250,
          });
        } catch (err) {
          // Log and continue; one failing query shouldn't abort the whole run.
          progress.error = err instanceof Error ? err.message : String(err);
        }
        progress.queriesRun++;
        progress.fetched += places.length;

        for (const place of places) {
          if (!place.id) continue;

          // Already in DB (any prior run): refresh it.
          if (placeIds.has(place.id)) {
            const lead = normalize(place, query);
            await db
              .update(businessLeadsTable)
              .set({
                category: lead.category,
                phone: lead.phone,
                website: lead.website,
                businessStatus: lead.businessStatus,
                rating: lead.rating,
                reviewCount: lead.reviewCount,
                priceLevel: lead.priceLevel,
                hours: lead.hours,
                confidence: lead.confidence,
                validationStatus: lead.validationStatus,
                lastVerified: new Date(),
              })
              .where(sql`${businessLeadsTable.placeId} = ${place.id}`);
            progress.updated++;
            continue;
          }

          if (!isHookahRelevant(place)) {
            await recordReject(place, "non_hookah", query);
            continue;
          }

          const lead = normalize(place, query);

          if (!inScope(market, lead)) {
            await recordReject(place, "out_of_scope", query);
            continue;
          }

          const phoneKey = normalizePhone(lead.phone);
          if (phoneKey && phoneToId.has(phoneKey)) {
            await recordReject(
              place,
              "duplicate_phone",
              query,
              phoneToId.get(phoneKey),
            );
            continue;
          }
          const naKey = normalizeNameAddress(lead.name, lead.address);
          if (naKey && nameAddrToId.has(naKey)) {
            await recordReject(
              place,
              "duplicate_name_address",
              query,
              nameAddrToId.get(naKey),
            );
            continue;
          }

          const [inserted] = await db
            .insert(businessLeadsTable)
            .values({ ...lead, sourceQuery: query })
            .onConflictDoNothing({ target: businessLeadsTable.placeId })
            .returning({ id: businessLeadsTable.id });

          if (inserted) {
            progress.inserted++;
            placeIds.add(place.id);
            if (phoneKey) phoneToId.set(phoneKey, inserted.id);
            if (naKey) nameAddrToId.set(naKey, inserted.id);
          }
        }
        report();
      }
    }
  } finally {
    progress.running = false;
    progress.finishedAt = new Date().toISOString();
    report();
  }

  return {
    market: market.id,
    fetched: progress.fetched,
    inserted: progress.inserted,
    updated: progress.updated,
    rejected: progress.rejected,
  };
}
