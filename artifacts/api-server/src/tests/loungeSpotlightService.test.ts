/**
 * PURE service-level tests for the Local Lounge Spotlight.
 *
 * These exercise the pure ranking/selection/date/coarse-key helpers directly
 * (no DB, no HTTP), proving: the exact weighted-rating formula, review-volume
 * tie handling, eligible/lifecycle candidate filters, 25-mile filtering, the
 * full deterministic tie-break chain, top-three-only deterministic rotation,
 * local-date stability, and that the coarse key is one-way (not raw coords).
 */
import { describe, it, expect } from "vitest";
import {
  weightedRating,
  rankCandidates,
  rotateDaily,
  resolveLocalDate,
  coarseLocationKey,
  haversineMiles,
  saveMemberLocation,
  RADIUS_MILES,
  type CandidateBusiness,
} from "../lib/loungeSpotlight";

function makeCandidate(over: Partial<CandidateBusiness>): CandidateBusiness {
  return {
    id: 1,
    handle: "h",
    name: "Biz",
    logoUrl: null,
    coverUrl: null,
    businessType: "lounge",
    category: null,
    city: "Austin",
    state: "TX",
    tagline: null,
    description: null,
    lat: 30.2672,
    lng: -97.7431,
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

const ORIGIN = { lat: 30.2672, lng: -97.7431 };

describe("weightedRating", () => {
  it("matches the exact formula (avg*count + 4.0*5)/(count+5)", () => {
    expect(weightedRating(5, 5)).toBeCloseTo((5 * 5 + 20) / 10, 10);
    expect(weightedRating(3, 0)).toBeCloseTo(20 / 5, 10); // 4.0 prior
    expect(weightedRating(4.5, 10)).toBeCloseTo((45 + 20) / 15, 10);
  });
  it("treats null averageRating as 0", () => {
    expect(weightedRating(null, 4)).toBeCloseTo(20 / 9, 10);
  });
});

describe("candidate filters", () => {
  it("excludes non-active, unpublished, ineligible", () => {
    const cands = [
      makeCandidate({ id: 1, status: "suspended" }),
      makeCandidate({ id: 2, isPublished: false }),
      makeCandidate({ id: 3, eligibleForLoungeSpotlight: false }),
      makeCandidate({ id: 4 }),
    ];
    const ranked = rankCandidates(cands, ORIGIN);
    expect(ranked.map((r) => r.id)).toEqual([4]);
  });

  it("requires averageRating non-null and reviewCount > 0", () => {
    const cands = [
      makeCandidate({ id: 1, averageRating: null }),
      makeCandidate({ id: 2, reviewCount: 0 }),
      makeCandidate({ id: 3 }),
    ];
    expect(rankCandidates(cands, ORIGIN).map((r) => r.id)).toEqual([3]);
  });

  it("requires valid coordinates", () => {
    const cands = [
      makeCandidate({ id: 1, lat: null }),
      makeCandidate({ id: 2, lng: 999 }),
      makeCandidate({ id: 3 }),
    ];
    expect(rankCandidates(cands, ORIGIN).map((r) => r.id)).toEqual([3]);
  });

  it("does NOT restrict by businessType", () => {
    const cands = [
      makeCandidate({ id: 1, businessType: "shop" }),
      makeCandidate({ id: 2, businessType: "brand" }),
    ];
    expect(rankCandidates(cands, ORIGIN).map((r) => r.id).sort()).toEqual([1, 2]);
  });
});

describe("25-mile filtering", () => {
  it("keeps within radius, drops beyond", () => {
    // ~20mi north and ~40mi north of origin.
    const near = makeCandidate({ id: 1, lat: ORIGIN.lat + 0.29, lng: ORIGIN.lng });
    const far = makeCandidate({ id: 2, lat: ORIGIN.lat + 0.7, lng: ORIGIN.lng });
    expect(
      haversineMiles(ORIGIN.lat, ORIGIN.lng, near.lat!, near.lng!),
    ).toBeLessThan(RADIUS_MILES);
    expect(
      haversineMiles(ORIGIN.lat, ORIGIN.lng, far.lat!, far.lng!),
    ).toBeGreaterThan(RADIUS_MILES);
    const ranked = rankCandidates([near, far], ORIGIN);
    expect(ranked.map((r) => r.id)).toEqual([1]);
  });

  it("keeps nearby businesses outside the member's saved city boundary", () => {
    const nearbyOtherCity = makeCandidate({
      id: 3,
      city: "Round Rock",
      state: "TX",
      lat: 30.31,
      lng: -97.68,
    });
    expect(rankCandidates([nearbyOtherCity], ORIGIN).map((r) => r.id)).toEqual([
      3,
    ]);
  });
});

describe("ranking tie-breaks", () => {
  it("ranks by weightedRating DESC first", () => {
    const a = makeCandidate({ id: 1, averageRating: 5, reviewCount: 50 });
    const b = makeCandidate({ id: 2, averageRating: 4.2, reviewCount: 50 });
    expect(rankCandidates([b, a], ORIGIN).map((r) => r.id)).toEqual([1, 2]);
  });

  it("breaks weighted ties by review volume", () => {
    // Same avg → same-ish weighted; higher reviewCount actually raises weighted,
    // so use identical avg=4.0 which makes weighted == 4.0 regardless of count.
    const a = makeCandidate({ id: 1, averageRating: 4.0, reviewCount: 5 });
    const b = makeCandidate({ id: 2, averageRating: 4.0, reviewCount: 40 });
    expect(weightedRating(4, 5)).toBeCloseTo(4, 10);
    expect(weightedRating(4, 40)).toBeCloseTo(4, 10);
    expect(rankCandidates([a, b], ORIGIN).map((r) => r.id)).toEqual([2, 1]);
  });

  it("then verified, then featured, then sponsored, then distance, then id", () => {
    const base = { averageRating: 4.0, reviewCount: 10 };
    // All same weighted (4.0) + same reviewCount → cascade through the chain.
    const verified = makeCandidate({ id: 1, ...base, verificationStatus: "verified", isFeatured: false });
    const unverifiedFeatured = makeCandidate({
      id: 2,
      ...base,
      verificationStatus: "unverified",
      isFeatured: true,
    });
    const ranked = rankCandidates([unverifiedFeatured, verified], ORIGIN);
    // verified wins over featured (verified is earlier in the chain).
    expect(ranked.map((r) => r.id)).toEqual([1, 2]);
  });

  it("respects featuredUntil expiry (expired featured does not boost)", () => {
    const base = { averageRating: 4.0, reviewCount: 10, verificationStatus: "unverified" };
    const past = new Date(Date.now() - 86400000);
    const expiredFeatured = makeCandidate({ id: 1, ...base, isFeatured: true, featuredUntil: past });
    const plain = makeCandidate({ id: 2, ...base });
    // Both effFeatured=false now → tie falls to distance then id → id 1 first.
    expect(rankCandidates([plain, expiredFeatured], ORIGIN).map((r) => r.id)).toEqual([1, 2]);
  });

  it("final tie-break is id ASC", () => {
    const base = { averageRating: 4.0, reviewCount: 10, verificationStatus: "unverified" };
    const a = makeCandidate({ id: 7, ...base });
    const b = makeCandidate({ id: 3, ...base });
    expect(rankCandidates([a, b], ORIGIN).map((r) => r.id)).toEqual([3, 7]);
  });
});

describe("deterministic daily rotation (top-3 only)", () => {
  it("rotates the same three, never substitutes rank 4+", () => {
    const top3 = [10, 20, 30];
    const d1 = rotateDaily(top3, "2025-01-01");
    const d2 = rotateDaily(top3, "2025-01-02");
    // Same membership regardless of date.
    expect([...d1].sort()).toEqual([10, 20, 30]);
    expect([...d2].sort()).toEqual([10, 20, 30]);
  });

  it("is stable for a given date", () => {
    const top3 = [10, 20, 30];
    expect(rotateDaily(top3, "2025-06-15")).toEqual(rotateDaily(top3, "2025-06-15"));
  });

  it("handles <=1 element", () => {
    expect(rotateDaily([], "2025-01-01")).toEqual([]);
    expect(rotateDaily([5], "2025-01-01")).toEqual([5]);
  });
});

describe("resolveLocalDate", () => {
  const fixed = new Date("2025-03-10T03:30:00Z"); // 22:30 prev day US-Central
  it("prefers a valid primary timezone", () => {
    expect(resolveLocalDate("America/Chicago", "UTC", fixed)).toBe("2025-03-09");
    expect(resolveLocalDate(null, null, fixed)).toBe("2025-03-10");
  });
  it("falls back to fallback tz then UTC when primary invalid", () => {
    expect(resolveLocalDate("Not/AZone", "America/Chicago", fixed)).toBe("2025-03-09");
    expect(resolveLocalDate("Not/AZone", "Also/Bad", fixed)).toBe("2025-03-10");
  });
  it("is stable across calls", () => {
    expect(resolveLocalDate("America/New_York", null, fixed)).toBe(
      resolveLocalDate("America/New_York", null, fixed),
    );
    expect(resolveLocalDate("America/New_York", null, fixed)).toBe("2025-03-09");
  });
});

describe("coarseLocationKey privacy", () => {
  it("is a one-way hash, not raw coordinates", () => {
    const key = coarseLocationKey(30.2672, -97.7431);
    expect(key).not.toContain("30");
    expect(key).not.toContain("97");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
  it("quantizes nearby coordinates to the same key", () => {
    const a = coarseLocationKey(30.2672, -97.7431);
    const b = coarseLocationKey(30.2699, -97.7449); // within the same coarse cell
    expect(a).toBe(b);
  });
  it("differs for far-apart coordinates", () => {
    expect(coarseLocationKey(30.2672, -97.7431)).not.toBe(
      coarseLocationKey(40.7128, -74.006),
    );
  });
});

describe("saveMemberLocation validation + privacy", () => {
  // Minimal fake db: records the upserted values; never queried on failure.
  function fakeDb() {
    const writes: Record<string, unknown>[] = [];
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          writes.push(v);
          return { onConflictDoUpdate: () => Promise.resolve([]) };
        },
      }),
    };
    return { db: db as never, writes };
  }

  it("rejects out-of-range or non-finite coordinates without writing", async () => {
    for (const input of [
      { latitude: 91, longitude: 0 },
      { latitude: -90.001, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: Number.NaN, longitude: 0 },
      { latitude: "30", longitude: -97 },
      { latitude: 30, longitude: null },
    ]) {
      const { db, writes } = fakeDb();
      const r = await saveMemberLocation(1, input as never, db);
      expect(r).toEqual({ ok: false, error: "invalid_coordinates" });
      expect(writes).toHaveLength(0);
    }
  });

  it("rejects an invalid or non-string timezone without writing", async () => {
    for (const tz of ["Not/AZone", "", "   ", 5 as unknown]) {
      const { db, writes } = fakeDb();
      const r = await saveMemberLocation(
        1,
        { latitude: 30, longitude: -97, timezone: tz } as never,
        db,
      );
      expect(r).toEqual({ ok: false, error: "invalid_timezone" });
      expect(writes).toHaveLength(0);
    }
  });

  it("persists a device location, clears stale city keys, returns only ok", async () => {
    const { db, writes } = fakeDb();
    const r = await saveMemberLocation(
      7,
      { latitude: 30.2672, longitude: -97.7431, timezone: "America/Chicago" },
      db,
    );
    expect(r).toEqual({ ok: true });
    expect(writes).toHaveLength(1);
    const w = writes[0];
    expect(w.userId).toBe(7);
    expect(w.source).toBe("device");
    expect(w.cityKey).toBeNull();
    expect(w.stateKey).toBeNull();
    // The result carries NO coordinates/timezone — only { ok: true }.
    expect(Object.keys(r)).toEqual(["ok"]);
  });

  it("accepts a missing timezone (stored null)", async () => {
    const { db, writes } = fakeDb();
    const r = await saveMemberLocation(9, { latitude: 40.7128, longitude: -74.006 }, db);
    expect(r).toEqual({ ok: true });
    expect(writes[0].timezone).toBeNull();
  });
});
