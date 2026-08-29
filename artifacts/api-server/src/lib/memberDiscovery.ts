import type { BuddyDiscoveryProfile } from "./mappers";

type DiscoveryQuery = {
  search?: string;
  name?: string;
  handle?: string;
  city?: string;
  state?: string;
  buddyType?: "female_buddy" | "male_buddy";
  minAge?: number;
  maxAge?: number;
};

type MemberRow = {
  id: number; name: string; username: string | null; city: string | null; state: string | null;
  profilePhotoUrl: string | null; buddyType: string | null; createdAt: Date;
};
type DollRow = MemberRow & {
  dollId: number; stageName: string; dollAge: number | null; dollCity: string | null;
  dollState: string | null; dollProfilePhotoUrl: string | null;
};

/** Normalize the deliberately narrow eligible DB projections into public discovery rows. */
export function buildBuddyDiscoveryProfiles(
  memberRows: MemberRow[],
  dollRows: DollRow[],
  q: DiscoveryQuery,
  blockedIds = new Set<number>(),
): BuddyDiscoveryProfile[] {
  const profiles: BuddyDiscoveryProfile[] = memberRows.map((u) => ({
    id: u.id, accountType: "member", dollId: null, name: u.name, handle: u.username ?? null,
    // Members do not have a public age field. Never infer one from private data.
    age: null, city: u.city ?? null, state: u.state ?? null, profilePhotoUrl: u.profilePhotoUrl ?? null,
    buddyType: u.buddyType as BuddyDiscoveryProfile["buddyType"],
    memberSince: u.createdAt.toISOString(), profileUrl: `/bros/${u.id}`,
  }));

  // Legacy data may contain multiple approved Dolls for an owner; highest id wins.
  const dollByOwner = new Map<number, DollRow>();
  for (const row of dollRows) {
    const current = dollByOwner.get(row.id);
    if (!current || row.dollId > current.dollId) dollByOwner.set(row.id, row);
  }
  for (const d of dollByOwner.values()) {
    profiles.push({
      id: d.id, accountType: "doll", dollId: d.dollId, name: d.stageName,
      handle: d.username ?? null, age: d.dollAge ?? null, city: d.dollCity ?? null,
      state: d.dollState ?? null, profilePhotoUrl: d.dollProfilePhotoUrl ?? null,
      buddyType: d.buddyType as BuddyDiscoveryProfile["buddyType"],
      memberSince: d.createdAt.toISOString(), profileUrl: `/dolls/${d.dollId}`,
    });
  }

  const includes = (value: string | null, term: string | undefined) =>
    term === undefined || (value ?? "").toLocaleLowerCase().includes(term.toLocaleLowerCase());
  return profiles.filter((profile) => {
    if (blockedIds.has(profile.id) || (q.buddyType && profile.buddyType !== q.buddyType)) return false;
    if (!includes(profile.name, q.name) || !includes(profile.handle, q.handle)) return false;
    if (!includes(profile.city, q.city) || !includes(profile.state, q.state)) return false;
    if (q.search && !includes(profile.name, q.search) && !includes(profile.handle, q.search)) return false;
    if (q.minAge !== undefined && (profile.age === null || profile.age < q.minAge)) return false;
    if (q.maxAge !== undefined && (profile.age === null || profile.age > q.maxAge)) return false;
    return true;
  }).sort((a, b) =>
    Date.parse(b.memberSince) - Date.parse(a.memberSince) || b.id - a.id || (b.dollId ?? 0) - (a.dollId ?? 0),
  );
}