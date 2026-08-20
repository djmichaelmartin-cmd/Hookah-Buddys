/**
 * ROUTE-LEVEL integration tests for the Local Lounge Spotlight.
 *
 * Mounts the REAL `loungesRouter` in an in-memory Express app and drives it over
 * real HTTP. Only two boundaries are faked (no live Postgres in CI):
 *
 *   1. `@workspace/db` — `db` is replaced by a chainable fake whose awaited
 *      result is the next FIFO row-set queued for the queried table. The REAL
 *      Drizzle table objects are re-exported so route imports + table-identity
 *      keying keep working. Inserts capture written rows and support
 *      onConflictDoNothing/onConflictDoUpdate/delete as inert-but-recorded.
 *   2. `../lib/auth` — session user from an `x-test-user` header.
 *
 * Coverage: signed-out login_required, location_required (no saved loc + no
 * mappable centroid or geocode), city/state centroid/geocode persistence, ready
 * with top-3 ranking + rotation, partial, empty, daily persistence reuse, cache
 * safety after admin disables a page, and a privacy assertion proving no
 * lat/lng/locationKey/coarse-key/user coords appear anywhere in the response.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type IRouter } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => {
  const queues = new Map<unknown, unknown[][]>();
  const inserted: { table: unknown; values: unknown }[] = [];
  // Captures the SQL WHERE condition passed for each queried table (last wins),
  // so tests can assert on the generated filter (e.g. rejected exclusion).
  const whereByTable = new Map<unknown, unknown>();
  function enqueue(table: unknown, rows: unknown[]) {
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table)!.push(rows);
  }
  function reset() {
    queues.clear();
    inserted.length = 0;
    whereByTable.clear();
  }
  function nextRows(table: unknown): unknown[] {
    const q = queues.get(table);
    if (q && q.length) return q.shift()!;
    return [];
  }

  function makeSelectBuilder() {
    let fromTable: unknown = null;
    const builder: Record<string, unknown> = {};
    const chain = (fn?: (arg: unknown) => void) => (arg?: unknown) => {
      if (fn) fn(arg);
      return builder;
    };
    builder.from = chain((t) => {
      if (fromTable === null) fromTable = t;
    });
    builder.innerJoin = chain();
    builder.leftJoin = chain();
    builder.where = chain((cond) => {
      if (fromTable !== null) whereByTable.set(fromTable, cond);
    });
    builder.orderBy = chain();
    builder.limit = chain();
    builder.offset = chain();
    builder.groupBy = chain();
    builder.having = chain();
    builder.for = chain();
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(nextRows(fromTable)).then(resolve);
    builder.catch = () => builder;
    return builder;
  }

  function makeInsertBuilder(table: unknown) {
    const builder: Record<string, unknown> = {};
    const chain = () => () => builder;
    builder.values = (v: unknown) => {
      inserted.push({ table, values: v });
      return builder;
    };
    builder.onConflictDoNothing = chain();
    builder.onConflictDoUpdate = chain();
    builder.returning = chain();
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
    return builder;
  }

  function makeMutBuilder() {
    const builder: Record<string, unknown> = {};
    const chain = () => () => builder;
    builder.set = chain();
    builder.where = chain();
    builder.returning = chain();
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
    return builder;
  }

  const db = {
    select: (_c?: unknown) => makeSelectBuilder(),
    insert: (t: unknown) => makeInsertBuilder(t),
    update: () => makeMutBuilder(),
    delete: () => makeMutBuilder(),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  return { queues, enqueue, reset, nextRows, db, inserted, whereByTable };
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@workspace/db");
  return { ...actual, db: h.db };
});

vi.mock("../lib/auth", async () => {
  const getSessionUser = async (req: { headers: Record<string, unknown> }) => {
    const raw = req.headers["x-test-user"];
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw);
  };
  const requireAuth = () => async () => {};
  return { getSessionUser, requireAuth };
});

let loungesRouter: IRouter;
let server: Server;
let baseUrl: string;
let T: Record<string, unknown>;

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", loungesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
}

async function get(user?: unknown) {
  const headers: Record<string, string> = {};
  if (user) headers["x-test-user"] = JSON.stringify(user);
  const res = await fetch(`${baseUrl}/lounge-spotlight/local`, { headers });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  h.reset();
  if (!loungesRouter) {
    loungesRouter = (await import("../routes/lounges")).default as IRouter;
    T = await vi.importActual<Record<string, unknown>>("@workspace/db");
  }
  await startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ORIGIN = { lat: 30.2672, lng: -97.7431 };
const user = { id: 42, city: "Austin", state: "TX" };

function biz(over: Record<string, unknown>) {
  return {
    id: 1,
    handle: "lounge-1",
    name: "Lounge One",
    logoUrl: null,
    coverUrl: null,
    businessType: "lounge",
    category: "hookah_lounge",
    city: "Austin",
    state: "TX",
    tagline: "Chill vibes",
    description: null,
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    averageRating: 4.5,
    reviewCount: 10,
    verificationStatus: "verified",
    isFeatured: false,
    featuredUntil: null,
    isSponsored: false,
    sponsoredUntil: null,
    timezone: "America/Chicago",
    hours: null,
    isOpenNowOverride: null,
    status: "active",
    isPublished: true,
    eligibleForLoungeSpotlight: true,
    ...over,
  };
}

// Recursively collect string literals from a (possibly circular) Drizzle SQL
// condition tree, so tests can assert on the rendered filter without JSON.
function harvestStrings(node: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    if (node.length) out.push(node);
    return out;
  }
  if (typeof node !== "object") return out;
  if (seen.has(node)) return out;
  seen.add(node);
  for (const v of Object.values(node as Record<string, unknown>)) {
    harvestStrings(v, seen, out);
  }
  return out;
}

// Enqueue the saved private location so resolveMemberLocation short-circuits.
function enqueueSavedLocation() {
  h.enqueue(T.memberLocationsTable, [
    {
      id: 1,
      userId: user.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      timezone: "America/Chicago",
      source: "device",
      cityKey: "AUSTIN",
      stateKey: "TX",
    },
  ]);
}

describe("GET /lounge-spotlight/local", () => {
  it("signed-out → login_required with guidance and no businesses", async () => {
    const { body } = await get();
    expect(body.state).toBe("login_required");
    expect(body.businesses).toEqual([]);
    expect(typeof body.message).toBe("string");
    expect((body.message as string).length).toBeGreaterThan(0);
    expect(body.radiusMiles).toBe(25);
  });

  it("no saved location and no safe city result → location_required", async () => {
    // memberLocations empty; businesses+lounges centroid queries empty; a
    // recent failed city lookup prevents fabricated precision or another call.
    h.enqueue(T.memberLocationsTable, []); // saved
    h.enqueue(T.businessesTable, []); // centroid biz
    h.enqueue(T.loungesTable, []); // centroid lounges
    h.enqueue(T.cityGeocodesTable, [
      {
        status: "unavailable",
        lat: null,
        lng: null,
        attemptedAt: new Date(),
      },
    ]);
    const { body } = await get(user);
    expect(body.state).toBe("location_required");
    expect(body.businesses).toEqual([]);
    expect(body.locationLabel).toBe("Austin, TX");
  });

  it("derives + persists a city centroid when no saved location exists", async () => {
    h.enqueue(T.memberLocationsTable, []); // saved: none
    h.enqueue(T.businessesTable, [
      { lat: ORIGIN.lat, lng: ORIGIN.lng, timezone: "America/Chicago" },
    ]); // centroid biz
    h.enqueue(T.loungesTable, []); // centroid lounges
    // loadCandidates
    h.enqueue(T.businessesTable, [biz({ id: 1 })]);
    // readDailyIds (none) then persist re-select
    h.enqueue(T.dailyLoungeSpotlightsTable, []);
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1" }]);

    const { body } = await get(user);
    // A member_locations row was persisted from the centroid.
    const wrote = h.inserted.find((i) => i.table === T.memberLocationsTable);
    expect(wrote).toBeTruthy();
    expect((wrote!.values as Record<string, unknown>).source).toBe("city_centroid");
    expect(body.state).toBe("partial"); // one candidate only
  });

  it("uses a private server-side city geocode when the city has no mapped venues", async () => {
    h.enqueue(T.memberLocationsTable, []); // saved: none
    h.enqueue(T.businessesTable, []); // no mapped business in the saved city
    h.enqueue(T.loungesTable, []); // no mapped legacy lounge in the saved city
    h.enqueue(T.cityGeocodesTable, [
      {
        status: "ready",
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        attemptedAt: new Date(),
      },
    ]);
    // A business just outside the city can now rank from the real city origin.
    h.enqueue(T.businessesTable, [biz({ id: 1, city: "Round Rock" })]);
    h.enqueue(T.dailyLoungeSpotlightsTable, []);
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1" }]);

    const { body } = await get(user);
    const wrote = h.inserted.find((i) => i.table === T.memberLocationsTable);
    expect(wrote).toBeTruthy();
    expect((wrote!.values as Record<string, unknown>).source).toBe("city_geocode");
    expect(body.state).toBe("partial");
    expect((body.businesses as unknown[]).length).toBe(1);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(String(ORIGIN.lat));
    expect(serialized).not.toContain(String(ORIGIN.lng));
    expect(body).not.toHaveProperty("lat");
    expect(body).not.toHaveProperty("lng");
  });

  it("keeps the existing guidance for an ambiguous city geocode", async () => {
    h.enqueue(T.memberLocationsTable, []);
    h.enqueue(T.businessesTable, []);
    h.enqueue(T.loungesTable, []);
    h.enqueue(T.cityGeocodesTable, [
      {
        status: "ambiguous",
        lat: null,
        lng: null,
        attemptedAt: new Date(),
      },
    ]);

    const { body } = await get(user);
    expect(body.state).toBe("location_required");
    expect(body.locationLabel).toBe("Austin, TX");
    expect(body.businesses).toEqual([]);
    expect(h.inserted.find((i) => i.table === T.memberLocationsTable)).toBeFalsy();
  });

  it("ready → top-3 ranked winners, privacy-safe cards, no coords", async () => {
    enqueueSavedLocation();
    const candidates = [
      biz({ id: 1, averageRating: 5, reviewCount: 100 }),
      biz({ id: 2, handle: "l2", averageRating: 4.8, reviewCount: 80 }),
      biz({ id: 3, handle: "l3", averageRating: 4.6, reviewCount: 60 }),
      biz({ id: 4, handle: "l4", averageRating: 4.0, reviewCount: 5 }),
    ];
    h.enqueue(T.businessesTable, candidates); // loadCandidates
    h.enqueue(T.dailyLoungeSpotlightsTable, []); // readDailyIds none
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1,2,3" }]); // persist re-select
    h.enqueue(T.businessFollowsTable, []); // viewer follows none

    const { body } = await get(user);
    expect(body.state).toBe("ready");
    const cards = body.businesses as Record<string, unknown>[];
    const ids = cards.map((b) => b.id).sort();
    expect(ids).toEqual([1, 2, 3]); // rank 4 never appears
    // followed present + false when the viewer follows nothing.
    for (const card of cards) expect(card.followed).toBe(false);

    const serialized = JSON.stringify(body);
    // Privacy: no coordinate fields, no coarse key, no user coords/ids.
    for (const card of cards) {
      expect(card).not.toHaveProperty("lat");
      expect(card).not.toHaveProperty("lng");
      expect(card).not.toHaveProperty("ownerUserId");
      expect(card).not.toHaveProperty("userId");
      expect(card).not.toHaveProperty("locationKey");
      expect(card).not.toHaveProperty("coarseLocationKey");
      expect(card).toHaveProperty("distanceMiles");
      expect(card).toHaveProperty("weightedRating");
      expect(card).toHaveProperty("followed");
      // No legacy lounges enqueued → no cross-source match → null.
      expect(card.legacyLoungeId ?? null).toBeNull();
    }
    // Raw origin coordinates must not leak anywhere in the envelope.
    expect(serialized).not.toContain("30.2672");
    expect(serialized).not.toContain("-97.7431");
    // The viewer's own user id must not leak into the response.
    expect(serialized).not.toContain(String(user.id));
  });

  it("followed is viewer-specific: true only for pages the viewer follows", async () => {
    enqueueSavedLocation();
    const candidates = [
      biz({ id: 1, averageRating: 5, reviewCount: 100 }),
      biz({ id: 2, handle: "l2", averageRating: 4.8, reviewCount: 80 }),
      biz({ id: 3, handle: "l3", averageRating: 4.6, reviewCount: 60 }),
    ];
    h.enqueue(T.businessesTable, candidates); // loadCandidates
    h.enqueue(T.dailyLoungeSpotlightsTable, []); // readDailyIds none
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1,2,3" }]); // persist re-select
    // Viewer follows only business id 2 (row exposes businessId only — no userId).
    h.enqueue(T.businessFollowsTable, [{ businessId: 2 }]);

    const { body } = await get(user);
    const cards = body.businesses as Record<string, unknown>[];
    const byId = new Map(cards.map((c) => [c.id, c.followed]));
    expect(byId.get(1)).toBe(false);
    expect(byId.get(2)).toBe(true);
    expect(byId.get(3)).toBe(false);
    // No user id leaks even when a follow row was consulted.
    expect(JSON.stringify(body)).not.toContain(String(user.id));
  });

  it("empty → no eligible candidates", async () => {
    enqueueSavedLocation();
    h.enqueue(T.businessesTable, []); // loadCandidates none
    h.enqueue(T.dailyLoungeSpotlightsTable, []); // readDailyIds none
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "" }]); // persist re-select
    const { body } = await get(user);
    expect(body.state).toBe("empty");
    expect(body.businesses).toEqual([]);
  });

  it("reuses persisted daily winner ids (date persistence)", async () => {
    enqueueSavedLocation();
    // loadCandidates returns 3 in a DIFFERENT order than the stored winners.
    h.enqueue(T.businessesTable, [
      biz({ id: 3, handle: "l3", averageRating: 5, reviewCount: 100 }),
      biz({ id: 1, handle: "l1", averageRating: 4.9, reviewCount: 90 }),
      biz({ id: 2, handle: "l2", averageRating: 4.8, reviewCount: 80 }),
    ]);
    // A row already exists → readDailyIds returns it (no persist re-select).
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "2,1,3" }]);
    const { body } = await get(user);
    expect(body.state).toBe("ready");
    const ids = (body.businesses as Record<string, unknown>[]).map((b) => b.id).sort();
    expect(ids).toEqual([1, 2, 3]);
    // No new daily row was inserted (reuse path).
    expect(h.inserted.find((i) => i.table === T.dailyLoungeSpotlightsTable)).toBeFalsy();
  });

  it("cache safety: a cached id no longer eligible is dropped (fewer, not stale)", async () => {
    enqueueSavedLocation();
    // Current candidates: id 1 was disabled (ineligible) so it isn't returned by
    // loadCandidates; ids 2 & 3 remain eligible.
    h.enqueue(T.businessesTable, [
      biz({ id: 2, handle: "l2", averageRating: 4.8, reviewCount: 80 }),
      biz({ id: 3, handle: "l3", averageRating: 4.6, reviewCount: 60 }),
    ]);
    // Stale cache still lists id 1 first.
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1,2,3" }]);
    const { body } = await get(user);
    const ids = (body.businesses as Record<string, unknown>[]).map((b) => b.id).sort();
    expect(ids).toEqual([2, 3]); // id 1 dropped — never leaked
    expect(body.state).toBe("partial");
  });

  it("candidate load excludes verificationStatus='rejected' (unverified stays eligible)", async () => {
    enqueueSavedLocation();
    h.enqueue(T.businessesTable, [biz({ id: 1 })]);
    h.enqueue(T.dailyLoungeSpotlightsTable, []);
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1" }]);
    await get(user);
    // The generated candidate-load WHERE must contain the rejected exclusion.
    // Drizzle conditions are circular; harvest string literals recursively.
    const cond = h.whereByTable.get(T.businessesTable);
    const rendered = harvestStrings(cond).join(" | ");
    expect(rendered).toContain("rejected");
    // active + published lifecycle gate must still be present.
    expect(rendered).toContain("active");
  });

  it("per-member cache: two members in the same coarse cell get independent winners", async () => {
    const memberA = { id: 100, city: "Austin", state: "TX" };
    const memberB = { id: 200, city: "Austin", state: "TX" };
    const savedFor = (id: number) => ({
      id: 1,
      userId: id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      timezone: "America/Chicago",
      source: "device",
      cityKey: "AUSTIN",
      stateKey: "TX",
    });

    // Member A: candidate set {1,2,3} → own winner row "1,2,3".
    h.enqueue(T.memberLocationsTable, [savedFor(memberA.id)]);
    h.enqueue(T.businessesTable, [
      biz({ id: 1, averageRating: 5, reviewCount: 100 }),
      biz({ id: 2, handle: "l2", averageRating: 4.8, reviewCount: 80 }),
      biz({ id: 3, handle: "l3", averageRating: 4.6, reviewCount: 60 }),
    ]);
    h.enqueue(T.dailyLoungeSpotlightsTable, []); // A has no cached row yet
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1,2,3" }]); // A persist re-select
    const a = await get(memberA);
    const aIds = (a.body.businesses as Record<string, unknown>[]).map((b) => b.id).sort();
    expect(aIds).toEqual([1, 2, 3]);
    // A's persisted daily row is scoped to member A.
    const aInsert = h.inserted.find((i) => i.table === T.dailyLoungeSpotlightsTable);
    expect(aInsert).toBeTruthy();
    expect((aInsert!.values as Record<string, unknown>).memberUserId).toBe(memberA.id);

    // Member B: SAME coarse cell but a DIFFERENT candidate set {4,5,6}. B must
    // NOT inherit A's ids — B reads its own (absent) row and persists its own.
    h.enqueue(T.memberLocationsTable, [savedFor(memberB.id)]);
    h.enqueue(T.businessesTable, [
      biz({ id: 4, handle: "l4", averageRating: 5, reviewCount: 100 }),
      biz({ id: 5, handle: "l5", averageRating: 4.8, reviewCount: 80 }),
      biz({ id: 6, handle: "l6", averageRating: 4.6, reviewCount: 60 }),
    ]);
    h.enqueue(T.dailyLoungeSpotlightsTable, []); // B has no cached row of its own
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "4,5,6" }]); // B persist re-select
    const b = await get(memberB);
    const bIds = (b.body.businesses as Record<string, unknown>[]).map((x) => x.id).sort();
    expect(bIds).toEqual([4, 5, 6]); // independent — no cross-member leakage
    const bInsert = h.inserted
      .filter((i) => i.table === T.dailyLoungeSpotlightsTable)
      .pop();
    expect((bInsert!.values as Record<string, unknown>).memberUserId).toBe(memberB.id);
  });

  it("legacyLoungeId: unique near same-name match resolves; ambiguous & far are null", async () => {
    enqueueSavedLocation();
    // Winners: id1 (unique legacy match), id2 (ambiguous — two legacy rows),
    // id3 (same name but a legacy row too far away).
    h.enqueue(T.businessesTable, [
      biz({ id: 1, name: "Cloud Nine", city: "Austin", state: "TX", averageRating: 5, reviewCount: 100 }),
      biz({ id: 2, handle: "l2", name: "Smoke Ring", city: "Austin", state: "TX", averageRating: 4.8, reviewCount: 80 }),
      biz({ id: 3, handle: "l3", name: "Hazy Days", city: "Austin", state: "TX", averageRating: 4.6, reviewCount: 60 }),
    ]);
    h.enqueue(T.dailyLoungeSpotlightsTable, []); // readDailyIds none
    h.enqueue(T.dailyLoungeSpotlightsTable, [{ businessIds: "1,2,3" }]); // persist re-select
    h.enqueue(T.businessFollowsTable, []); // follows none
    // Legacy lounges scan result:
    h.enqueue(T.loungesTable, [
      // id1 → exactly one near match (same coords) → resolves to 501.
      { id: 501, name: "Cloud Nine", city: "Austin", state: "TX", lat: ORIGIN.lat, lng: ORIGIN.lng },
      // id2 → two same-name near rows → ambiguous → null.
      { id: 502, name: "Smoke Ring", city: "Austin", state: "TX", lat: ORIGIN.lat, lng: ORIGIN.lng },
      { id: 503, name: "Smoke Ring", city: "Austin", state: "TX", lat: ORIGIN.lat + 0.0001, lng: ORIGIN.lng },
      // id3 → same name but ~7 miles away (> 0.1mi) → no match → null.
      { id: 504, name: "Hazy Days", city: "Austin", state: "TX", lat: ORIGIN.lat + 0.1, lng: ORIGIN.lng },
    ]);

    const { body } = await get(user);
    const cards = body.businesses as Record<string, unknown>[];
    const byId = new Map(cards.map((c) => [c.id, c.legacyLoungeId]));
    expect(byId.get(1)).toBe(501); // unique near match
    expect(byId.get(2)).toBeNull(); // ambiguous same-name
    expect(byId.get(3)).toBeNull(); // same name but too far

    // Privacy: the legacy match must never leak member/user coords or ids.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("30.2672");
    expect(serialized).not.toContain("-97.7431");
    expect(serialized).not.toContain(String(user.id));
  });
});

async function putLocation(user: unknown, payload: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers["x-test-user"] = JSON.stringify(user);
  const res = await fetch(`${baseUrl}/lounge-spotlight/location`, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("PUT /lounge-spotlight/location", () => {
  it("signed-out → 401 and nothing persisted", async () => {
    const { status } = await putLocation(undefined, {
      latitude: 30.2672,
      longitude: -97.7431,
    });
    expect(status).toBe(401);
    expect(h.inserted.find((i) => i.table === T.memberLocationsTable)).toBeFalsy();
  });

  it("rejects out-of-range / non-finite coordinates with 400", async () => {
    for (const payload of [
      { latitude: 999, longitude: 0 },
      { latitude: 0, longitude: 999 },
      { latitude: "30", longitude: -97 },
      { latitude: Number.NaN, longitude: 0 },
    ]) {
      const { status } = await putLocation(user, payload);
      expect(status).toBe(400);
    }
    expect(h.inserted.find((i) => i.table === T.memberLocationsTable)).toBeFalsy();
  });

  it("rejects an invalid timezone with 400", async () => {
    const { status } = await putLocation(user, {
      latitude: 30.2672,
      longitude: -97.7431,
      timezone: "Not/AZone",
    });
    expect(status).toBe(400);
    expect(h.inserted.find((i) => i.table === T.memberLocationsTable)).toBeFalsy();
  });

  it("persists a valid device location and NEVER echoes coords/tz", async () => {
    const { status, body } = await putLocation(user, {
      latitude: 30.2672,
      longitude: -97.7431,
      timezone: "America/Chicago",
    });
    expect(status).toBe(200);
    // Response is exactly { saved: true } — nothing else.
    expect(body).toEqual({ saved: true });
    // A device-source row was written with the coords + tz.
    const wrote = h.inserted.find((i) => i.table === T.memberLocationsTable);
    expect(wrote).toBeTruthy();
    const vals = wrote!.values as Record<string, unknown>;
    expect(vals.source).toBe("device");
    expect(vals.lat).toBe(30.2672);
    expect(vals.userId).toBe(user.id);
    // Stale city keys are cleared by a device fix.
    expect(vals.cityKey).toBeNull();
    expect(vals.stateKey).toBeNull();
    // Privacy: the response must not contain coordinates, tz, user id, or keys.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("30.2672");
    expect(serialized).not.toContain("-97.7431");
    expect(serialized).not.toContain("America/Chicago");
    expect(serialized).not.toContain(String(user.id));
    expect(body).not.toHaveProperty("latitude");
    expect(body).not.toHaveProperty("longitude");
    expect(body).not.toHaveProperty("lat");
    expect(body).not.toHaveProperty("lng");
    expect(body).not.toHaveProperty("timezone");
    expect(body).not.toHaveProperty("userId");
  });

  it("accepts a valid location without a timezone", async () => {
    const { status, body } = await putLocation(user, {
      latitude: 40.7128,
      longitude: -74.006,
    });
    expect(status).toBe(200);
    expect(body).toEqual({ saved: true });
    const wrote = h.inserted.find((i) => i.table === T.memberLocationsTable);
    expect((wrote!.values as Record<string, unknown>).timezone).toBeNull();
  });
});
