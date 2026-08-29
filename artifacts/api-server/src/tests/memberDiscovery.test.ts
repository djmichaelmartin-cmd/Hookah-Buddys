import { describe, expect, it } from "vitest";
import { buildBuddyDiscoveryProfiles } from "../lib/memberDiscovery";

const created = new Date("2026-01-01T00:00:00.000Z");
const member = {
  id: 1, name: "Member Alex", username: "alex-handle", city: "Austin", state: "TX",
  profilePhotoUrl: "member.jpg", buddyType: null, createdAt: created,
};
const doll = {
  id: 2, name: "Owner", username: "smokey", city: "private city", state: "private state",
  profilePhotoUrl: "owner.jpg", buddyType: "female_buddy", createdAt: new Date("2026-02-01T00:00:00.000Z"),
  dollId: 9, stageName: "Stage Alex", dollAge: 26, dollCity: "Las Vegas", dollState: "NV",
  dollProfilePhotoUrl: "doll.jpg",
};

describe("Buddy discovery normalization and filtering", () => {
  it("merges eligible projections, maps public fields, deduplicates Dolls, and redacts private fields", () => {
    const result = buildBuddyDiscoveryProfiles([member], [doll, { ...doll, dollId: 11, stageName: "Newest Stage" }], {});
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({
        id: 2, accountType: "doll", dollId: 11, name: "Newest Stage", handle: "smokey",
        age: 26, city: "Las Vegas", state: "NV", profilePhotoUrl: "doll.jpg", profileUrl: "/dolls/11",
      }),
      expect.objectContaining({
        id: 1, accountType: "member", dollId: null, name: "Member Alex", age: null,
        profileUrl: "/bros/1",
      }),
    ]);
    for (const profile of result) {
      expect(profile).not.toHaveProperty("email");
      expect(profile).not.toHaveProperty("passwordHash");
      expect(profile).not.toHaveProperty("legalName");
      expect(profile).not.toHaveProperty("subscriptionPrice");
    }
  });

  it.each([
    [{ name: "stage" }, [2]],
    [{ handle: "ALEX-HANDLE" }, [1]],
    [{ city: "vegas" }, [2]],
    [{ state: "tx" }, [1]],
    [{ buddyType: "female_buddy" as const }, [2]],
    [{ search: "smokey" }, [2]],
    [{ search: "member" }, [1]],
    [{ minAge: 25 }, [2]],
    [{ maxAge: 26 }, [2]],
  ])("applies discovery filter %o", (query, ids) => {
    expect(buildBuddyDiscoveryProfiles([member], [doll], query).map((p) => p.id)).toEqual(ids);
  });

  it("excludes null-age members for each supplied age bound and filters blocks either direction", () => {
    expect(buildBuddyDiscoveryProfiles([member], [doll], { minAge: 18 }).map((p) => p.id)).toEqual([2]);
    expect(buildBuddyDiscoveryProfiles([member], [doll], { maxAge: 99 }).map((p) => p.id)).toEqual([2]);
    expect(buildBuddyDiscoveryProfiles([member], [doll], {}, new Set([1, 2]))).toEqual([]);
  });
});