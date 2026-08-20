import { describe, expect, it, vi } from "vitest";
import {
  processBusinessSpotlightLocation,
  sweepBusinessSpotlightLocations,
} from "../lib/privateGeocoding";
import { addressFingerprint } from "../lib/geocoder";

const business = {
  id: 77,
  address: "100 Congress Ave",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
};

const providerResult = {
  lat: "30.2672",
  lon: "-97.7431",
  type: "house",
  address: {
    house_number: "100",
    road: "Congress Avenue",
    city: "Austin",
    state: "Texas",
    postcode: "78701",
    country_code: "us",
    "ISO3166-2-lvl4": "US-TX",
  },
};

function providerFetch(status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(status === 200 ? JSON.stringify([providerResult]) : "", {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as typeof fetch;
}

function processDb(
  options: {
    finalizes?: boolean;
    attemptCount?: number;
    priorCoordinates?: { lat: number; lng: number; resolvedAt: Date };
  } = {},
) {
  const sets: Record<string, unknown>[] = [];
  let returningCall = 0;
  const db = {
    update: () => {
      const builder: Record<string, unknown> = {};
      builder.set = (value: Record<string, unknown>) => {
        sets.push(value);
        return builder;
      };
      builder.where = () => builder;
      builder.returning = () => {
        returningCall += 1;
        if (returningCall === 1) {
          return Promise.resolve([
            {
              id: 1,
              attemptCount: options.attemptCount ?? 1,
              lat: options.priorCoordinates?.lat ?? null,
              lng: options.priorCoordinates?.lng ?? null,
              resolvedAt: options.priorCoordinates?.resolvedAt ?? null,
            },
          ]);
        }
        return Promise.resolve(options.finalizes === false ? [] : [{ id: 1 }]);
      };
      return builder;
    },
  };
  return { db: db as never, sets };
}

describe("durable Business geocode processing", () => {
  it("finalizes an exact address without returning coordinates", async () => {
    const { db, sets } = processDb();
    const result = await processBusinessSpotlightLocation(
      business,
      "fingerprint-a",
      { db, fetcher: providerFetch(), now: new Date("2026-08-20T12:00:00Z") },
    );

    expect(result).toEqual({ status: "ready" });
    expect(Object.keys(result)).toEqual(["status"]);
    expect(sets.at(-1)).toMatchObject({
      status: "ready",
      lat: 30.2672,
      lng: -97.7431,
    });
  });

  it("cannot let an older completed lookup overwrite a newer fingerprint", async () => {
    const { db } = processDb({ finalizes: false });
    const result = await processBusinessSpotlightLocation(
      business,
      "stale-fingerprint",
      { db, fetcher: providerFetch(), now: new Date("2026-08-20T12:00:00Z") },
    );
    expect(result).toEqual({ status: "stale" });
  });

  it("requeues provider failures and stops after the bounded attempt count", async () => {
    const retry = processDb({ attemptCount: 2 });
    const retryResult = await processBusinessSpotlightLocation(
      business,
      "fingerprint-a",
      {
        db: retry.db,
        fetcher: providerFetch(503),
        now: new Date("2026-08-20T12:00:00Z"),
      },
    );
    expect(retryResult).toEqual({ status: "retryable" });
    expect(retry.sets.at(-1)).toMatchObject({ status: "pending" });

    const exhausted = processDb({ attemptCount: 5 });
    const exhaustedResult = await processBusinessSpotlightLocation(
      business,
      "fingerprint-a",
      {
        db: exhausted.db,
        fetcher: providerFetch(503),
        now: new Date("2026-08-20T12:00:00Z"),
      },
    );
    expect(exhaustedResult).toEqual({ status: "unavailable" });
    expect(exhausted.sets.at(-1)).toMatchObject({ status: "unavailable" });
  });

  it("keeps the last validated location when a same-address refresh fails", async () => {
    const resolvedAt = new Date("2026-08-19T12:00:00Z");
    const prior = processDb({
      attemptCount: 5,
      priorCoordinates: { lat: 30.31, lng: -97.68, resolvedAt },
    });
    const result = await processBusinessSpotlightLocation(
      business,
      "fingerprint-a",
      {
        db: prior.db,
        fetcher: providerFetch(503),
        now: new Date("2026-08-20T12:00:00Z"),
      },
    );

    expect(result).toEqual({ status: "unavailable" });
    expect(prior.sets.at(-1)).toMatchObject({
      status: "ready",
      lat: 30.31,
      lng: -97.68,
      resolvedAt,
    });
  });

  it("reclaims an expired processing lease during the durable sweep", async () => {
    const sets: Record<string, unknown>[] = [];
    let updateReturningCall = 0;
    const row = {
      businessId: business.id,
      addressFingerprint: addressFingerprint(business),
      status: "processing",
      attemptedAt: new Date("2026-08-20T11:00:00Z"),
      address: business.address,
      city: business.city,
      state: business.state,
      zip: business.zip,
      country: business.country,
    };
    const db = {
      select: () => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.from = chain;
        builder.innerJoin = chain;
        builder.where = chain;
        builder.orderBy = chain;
        builder.limit = () => Promise.resolve([row]);
        return builder;
      },
      update: () => {
        const builder: Record<string, unknown> = {};
        builder.set = (value: Record<string, unknown>) => {
          sets.push(value);
          return builder;
        };
        builder.where = () => builder;
        builder.returning = () => {
          updateReturningCall += 1;
          if (updateReturningCall === 2) {
            return Promise.resolve([{ id: 1, attemptCount: 2 }]);
          }
          return Promise.resolve([{ id: 1 }]);
        };
        return builder;
      },
      insert: () => {
        const builder: Record<string, unknown> = {};
        builder.values = () => builder;
        builder.onConflictDoUpdate = () => Promise.resolve([]);
        return builder;
      },
    };

    const processed = await sweepBusinessSpotlightLocations(
      db as never,
      new Date("2026-08-20T12:00:00Z"),
      providerFetch(),
    );
    expect(processed).toBe(1);
    expect(sets[0]).toMatchObject({ status: "pending" });
    expect(sets.at(-1)).toMatchObject({ status: "ready" });
  });
});