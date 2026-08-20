import { and, asc, eq, lt, lte, or, sql } from "drizzle-orm";
import {
  businessesTable,
  businessSpotlightLocationsTable,
  cityGeocodesTable,
  db as defaultDb,
  geocodeProviderThrottleTable,
} from "@workspace/db";
import {
  addressFingerprint,
  geocodeBusinessAddress,
  geocodeCity,
  type BusinessAddress,
  type GeocodeStatus,
} from "./geocoder";
import { logger } from "./logger";

type Db = typeof defaultDb;
type Fetcher = typeof fetch;

const FAILED_CITY_RETRY_MS = 24 * 60 * 60 * 1_000;
const PENDING_CITY_RETRY_MS = 5 * 60 * 1_000;
const PROVIDER_INTERVAL_MS = 1_100;
const CITY_MAX_SLOT_WAIT_MS = 3_000;
const BUSINESS_MAX_SLOT_WAIT_MS = 30_000;
const BUSINESS_RETRY_DELAY_MS = 5 * 60 * 1_000;
const BUSINESS_SLOT_RETRY_MS = 60 * 1_000;
const BUSINESS_PROCESSING_LEASE_MS = 5 * 60 * 1_000;
const BUSINESS_SWEEP_INTERVAL_MS = 60 * 1_000;
const BUSINESS_SWEEP_BATCH_SIZE = 10;
const BUSINESS_MAX_ATTEMPTS = 5;

export interface PrivateCoordinates {
  lat: number;
  lng: number;
}

function validCoordinates(
  lat: unknown,
  lng: unknown,
): lat is number {
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

function cityRetryDue(
  cached: { status: string; attemptedAt: Date },
  now: Date,
): boolean {
  const retryMs =
    cached.status === "pending" ? PENDING_CITY_RETRY_MS : FAILED_CITY_RETRY_MS;
  return now.getTime() - cached.attemptedAt.getTime() >= retryMs;
}

async function reserveProviderSlot(
  db: Db,
  now: Date,
  maxWaitMs: number,
): Promise<boolean> {
  const scheduledAt = await db.transaction(async (tx) => {
    await tx
      .insert(geocodeProviderThrottleTable)
      .values({ provider: "nominatim", nextAllowedAt: now })
      .onConflictDoNothing({ target: geocodeProviderThrottleTable.provider });

    const [row] = await tx
      .select({ nextAllowedAt: geocodeProviderThrottleTable.nextAllowedAt })
      .from(geocodeProviderThrottleTable)
      .where(eq(geocodeProviderThrottleTable.provider, "nominatim"))
      .for("update");

    const slotTime = Math.max(now.getTime(), row?.nextAllowedAt.getTime() ?? 0);
    if (slotTime - now.getTime() > maxWaitMs) return null;

    await tx
      .update(geocodeProviderThrottleTable)
      .set({
        nextAllowedAt: new Date(slotTime + PROVIDER_INTERVAL_MS),
        updatedAt: now,
      })
      .where(eq(geocodeProviderThrottleTable.provider, "nominatim"));
    return slotTime;
  });

  if (scheduledAt === null) return false;
  const waitMs = Math.max(0, scheduledAt - Date.now());
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return true;
}

export async function resolvePrivateCityGeocode(
  cityKey: string,
  stateKey: string,
  options: { db?: Db; fetcher?: Fetcher; now?: Date } = {},
): Promise<PrivateCoordinates | null> {
  const db = options.db ?? defaultDb;
  const now = options.now ?? new Date();
  const [cached] = await db
    .select()
    .from(cityGeocodesTable)
    .where(
      and(
        eq(cityGeocodesTable.cityKey, cityKey),
        eq(cityGeocodesTable.stateKey, stateKey),
      ),
    )
    .limit(1);

  if (cached?.status === "ready" && validCoordinates(cached.lat, cached.lng)) {
    return { lat: cached.lat, lng: cached.lng as number };
  }
  if (cached && !cityRetryDue(cached, now)) return null;

  const claimed = cached
    ? await db
        .update(cityGeocodesTable)
        .set({
          lat: null,
          lng: null,
          status: "pending",
          provider: "nominatim",
          attemptedAt: now,
          resolvedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(cityGeocodesTable.cityKey, cityKey),
            eq(cityGeocodesTable.stateKey, stateKey),
            eq(cityGeocodesTable.status, cached.status),
            eq(cityGeocodesTable.attemptedAt, cached.attemptedAt),
          ),
        )
        .returning({ id: cityGeocodesTable.id })
    : await db
        .insert(cityGeocodesTable)
        .values({
          cityKey,
          stateKey,
          lat: null,
          lng: null,
          status: "pending",
          provider: "nominatim",
          attemptedAt: now,
          resolvedAt: null,
        })
        .onConflictDoNothing({
          target: [cityGeocodesTable.cityKey, cityGeocodesTable.stateKey],
        })
        .returning({ id: cityGeocodesTable.id });

  if (claimed.length === 0) return null;
  if (
    options.fetcher === undefined &&
    !(await reserveProviderSlot(db, now, CITY_MAX_SLOT_WAIT_MS))
  ) {
    return null;
  }

  const outcome = await geocodeCity(cityKey, stateKey, options.fetcher);
  const storedStatus = outcome.status === "retryable" ? "pending" : outcome.status;
  const resolvedAt = storedStatus === "ready" ? now : null;
  const finalized = await db
    .update(cityGeocodesTable)
    .set({
      lat: outcome.lat,
      lng: outcome.lng,
      status: storedStatus,
      provider: "nominatim",
      attemptedAt: now,
      resolvedAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(cityGeocodesTable.cityKey, cityKey),
        eq(cityGeocodesTable.stateKey, stateKey),
        eq(cityGeocodesTable.status, "pending"),
        eq(cityGeocodesTable.attemptedAt, now),
      ),
    )
    .returning({ id: cityGeocodesTable.id });

  return finalized.length > 0 &&
    storedStatus === "ready" &&
    validCoordinates(outcome.lat, outcome.lng)
    ? { lat: outcome.lat, lng: outcome.lng as number }
    : null;
}

export async function queueBusinessSpotlightLocation(
  business: BusinessAddress & { id: number },
  db: Db = defaultDb,
  options: { preserveExistingCoordinates?: boolean } = {},
): Promise<string> {
  const fingerprint = addressFingerprint(business);
  const now = new Date();
  const preserve = options.preserveExistingCoordinates === true;
  await db
    .insert(businessSpotlightLocationsTable)
    .values({
      businessId: business.id,
      lat: null,
      lng: null,
      addressFingerprint: fingerprint,
      status: "pending",
      provider: "nominatim",
      attemptedAt: now,
      attemptCount: 0,
      nextAttemptAt: now,
      resolvedAt: null,
    })
    .onConflictDoUpdate({
      target: businessSpotlightLocationsTable.businessId,
      set: {
        lat: preserve
          ? sql`case when ${businessSpotlightLocationsTable.addressFingerprint} = ${fingerprint} then ${businessSpotlightLocationsTable.lat} else null end`
          : null,
        lng: preserve
          ? sql`case when ${businessSpotlightLocationsTable.addressFingerprint} = ${fingerprint} then ${businessSpotlightLocationsTable.lng} else null end`
          : null,
        addressFingerprint: fingerprint,
        status: "pending",
        provider: "nominatim",
        attemptedAt: now,
        attemptCount: 0,
        nextAttemptAt: now,
        resolvedAt: null,
        updatedAt: now,
      },
    });
  return fingerprint;
}

export async function processBusinessSpotlightLocation(
  business: BusinessAddress & { id: number },
  fingerprint: string,
  options: { db?: Db; fetcher?: Fetcher; now?: Date } = {},
): Promise<{ status: GeocodeStatus | "skipped" | "stale" }> {
  const db = options.db ?? defaultDb;
  const now = options.now ?? new Date();
  const claimed = await db
    .update(businessSpotlightLocationsTable)
    .set({
      status: "processing",
      attemptedAt: now,
      attemptCount: sql`${businessSpotlightLocationsTable.attemptCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(businessSpotlightLocationsTable.businessId, business.id),
        eq(businessSpotlightLocationsTable.addressFingerprint, fingerprint),
        eq(businessSpotlightLocationsTable.status, "pending"),
        lte(businessSpotlightLocationsTable.nextAttemptAt, now),
      ),
    )
    .returning({
      id: businessSpotlightLocationsTable.id,
      attemptCount: businessSpotlightLocationsTable.attemptCount,
      lat: businessSpotlightLocationsTable.lat,
      lng: businessSpotlightLocationsTable.lng,
      resolvedAt: businessSpotlightLocationsTable.resolvedAt,
    });
  if (claimed.length === 0) return { status: "stale" };

  const hasCompleteAddress =
    Boolean(business.address?.trim()) &&
    Boolean(business.city?.trim()) &&
    Boolean(business.state?.trim());
  if (
    hasCompleteAddress &&
    options.fetcher === undefined &&
    !(await reserveProviderSlot(db, now, BUSINESS_MAX_SLOT_WAIT_MS))
  ) {
    await db
      .update(businessSpotlightLocationsTable)
      .set({
        status: "pending",
        nextAttemptAt: new Date(now.getTime() + BUSINESS_SLOT_RETRY_MS),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(businessSpotlightLocationsTable.businessId, business.id),
          eq(businessSpotlightLocationsTable.addressFingerprint, fingerprint),
          eq(businessSpotlightLocationsTable.status, "processing"),
        ),
      );
    return { status: "skipped" };
  }

  const outcome = await geocodeBusinessAddress(business, options.fetcher);
  const hasPriorCoordinates = validCoordinates(
    claimed[0].lat,
    claimed[0].lng,
  );
  const exhausted =
    outcome.status === "retryable" &&
    claimed[0].attemptCount >= BUSINESS_MAX_ATTEMPTS;
  const storedStatus = hasPriorCoordinates && outcome.status !== "ready"
    ? outcome.status === "retryable" && !exhausted
      ? "pending"
      : "ready"
    : outcome.status === "retryable"
      ? exhausted
        ? "unavailable"
        : "pending"
      : outcome.status;
  const storedLat =
    outcome.status === "ready" ? outcome.lat : hasPriorCoordinates ? claimed[0].lat : null;
  const storedLng =
    outcome.status === "ready" ? outcome.lng : hasPriorCoordinates ? claimed[0].lng : null;
  const finalized = await db
    .update(businessSpotlightLocationsTable)
    .set({
      lat: storedLat,
      lng: storedLng,
      status: storedStatus,
      provider: "nominatim",
      attemptedAt: now,
      nextAttemptAt:
        storedStatus === "pending"
          ? new Date(now.getTime() + BUSINESS_RETRY_DELAY_MS)
          : now,
      resolvedAt:
        outcome.status === "ready"
          ? now
          : hasPriorCoordinates
            ? claimed[0].resolvedAt
            : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(businessSpotlightLocationsTable.businessId, business.id),
        eq(businessSpotlightLocationsTable.addressFingerprint, fingerprint),
        eq(businessSpotlightLocationsTable.status, "processing"),
      ),
    )
    .returning({ id: businessSpotlightLocationsTable.id });

  return finalized.length > 0
    ? { status: exhausted ? "unavailable" : outcome.status }
    : { status: "stale" };
}

export async function sweepBusinessSpotlightLocations(
  db: Db = defaultDb,
  now: Date = new Date(),
  fetcher?: Fetcher,
): Promise<number> {
  const leaseCutoff = new Date(now.getTime() - BUSINESS_PROCESSING_LEASE_MS);
  const rows = await db
    .select({
      businessId: businessSpotlightLocationsTable.businessId,
      addressFingerprint: businessSpotlightLocationsTable.addressFingerprint,
      status: businessSpotlightLocationsTable.status,
      attemptedAt: businessSpotlightLocationsTable.attemptedAt,
      address: businessesTable.address,
      city: businessesTable.city,
      state: businessesTable.state,
      zip: businessesTable.zip,
      country: businessesTable.country,
    })
    .from(businessSpotlightLocationsTable)
    .innerJoin(
      businessesTable,
      eq(businessesTable.id, businessSpotlightLocationsTable.businessId),
    )
    .where(
      or(
        and(
          eq(businessSpotlightLocationsTable.status, "pending"),
          lte(businessSpotlightLocationsTable.nextAttemptAt, now),
        ),
        and(
          eq(businessSpotlightLocationsTable.status, "processing"),
          lt(businessSpotlightLocationsTable.attemptedAt, leaseCutoff),
        ),
      ),
    )
    .orderBy(asc(businessSpotlightLocationsTable.attemptedAt))
    .limit(BUSINESS_SWEEP_BATCH_SIZE);

  let processed = 0;
  for (const row of rows) {
    const business = {
      id: row.businessId,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      country: row.country,
    };
    let fingerprint = row.addressFingerprint;

    if (addressFingerprint(business) !== fingerprint) {
      fingerprint = await queueBusinessSpotlightLocation(business, db);
    } else if (row.status === "processing") {
      const reclaimed = await db
        .update(businessSpotlightLocationsTable)
        .set({
          status: "pending",
          nextAttemptAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(businessSpotlightLocationsTable.businessId, row.businessId),
            eq(businessSpotlightLocationsTable.status, "processing"),
            eq(businessSpotlightLocationsTable.attemptedAt, row.attemptedAt),
          ),
        )
        .returning({ id: businessSpotlightLocationsTable.id });
      if (reclaimed.length === 0) continue;
    }

    await processBusinessSpotlightLocation(business, fingerprint, {
      db,
      fetcher,
    }).catch(
      () => {
        logger.warn(
          { businessId: row.businessId },
          "Queued Business Spotlight geocode attempt failed",
        );
      },
    );
    processed += 1;
  }
  return processed;
}

export function startBusinessSpotlightGeocodeScheduler(): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sweepBusinessSpotlightLocations();
    } catch {
      logger.error("Business Spotlight geocode sweep failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, BUSINESS_SWEEP_INTERVAL_MS);
  timer.unref();
}