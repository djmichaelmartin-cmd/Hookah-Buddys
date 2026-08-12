import { and, eq, or } from "drizzle-orm";
import {
  db,
  friendshipsTable,
  followsTable,
  blocksTable,
  profileDetailsTable,
  profileFieldPrivacyTable,
  privacySettingsTable,
  type ProfileDetails,
  type PrivacySettings,
} from "@workspace/db";

export type Relationship = {
  isSelf: boolean;
  isAdmin: boolean;
  isFriend: boolean;
  isFollower: boolean;
  viewerBlockedTarget: boolean;
  targetBlockedViewer: boolean;
};

export function friendPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export async function getRelationship(
  viewer: { id: number; role: string } | null,
  targetUserId: number,
): Promise<Relationship> {
  const rel: Relationship = {
    isSelf: false,
    isAdmin: viewer?.role === "admin",
    isFriend: false,
    isFollower: false,
    viewerBlockedTarget: false,
    targetBlockedViewer: false,
  };
  if (!viewer) return rel;
  if (viewer.id === targetUserId) {
    rel.isSelf = true;
    return rel;
  }
  const [a, b] = friendPair(viewer.id, targetUserId);
  const [friendship] = await db
    .select()
    .from(friendshipsTable)
    .where(and(eq(friendshipsTable.userAId, a), eq(friendshipsTable.userBId, b)));
  rel.isFriend = !!friendship;
  const [follow] = await db
    .select()
    .from(followsTable)
    .where(and(eq(followsTable.followerId, viewer.id), eq(followsTable.followingId, targetUserId)));
  rel.isFollower = !!follow;
  const blocks = await db
    .select()
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, viewer.id), eq(blocksTable.blockedUserId, targetUserId)),
        and(eq(blocksTable.blockerId, targetUserId), eq(blocksTable.blockedUserId, viewer.id)),
      ),
    );
  rel.viewerBlockedTarget = blocks.some((bl) => bl.blockerId === viewer.id);
  rel.targetBlockedViewer = blocks.some((bl) => bl.blockerId === targetUserId);
  return rel;
}

/** Can the viewer see content with the given audience/visibility setting? */
export function canView(visibility: string, rel: Relationship): boolean {
  if (rel.isSelf || rel.isAdmin) return true;
  switch (visibility) {
    case "public":
      return true;
    case "friends":
      return rel.isFriend;
    case "followers":
      return rel.isFollower || rel.isFriend;
    case "only_me":
      return false;
    default:
      return false;
  }
}

// Default per-field visibility (spec-mandated safety defaults). Anything not listed: public.
export const FIELD_PRIVACY_DEFAULTS: Record<string, string> = {
  birthYear: "only_me",
  ethnicity: "only_me",
  bodyType: "only_me",
  relationshipStatus: "only_me",
};

// Fields that must NEVER be publicly displayed even if user sets them public.
const NEVER_PUBLIC_FIELDS = new Set<string>([]);

export const PROFILE_DETAIL_FIELDS = [
  "coverPhotoUrl",
  "livesInCity",
  "livesInState",
  "fromCity",
  "fromState",
  "birthMonth",
  "birthDay",
  "birthYear",
  "gender",
  "languagesSpoken",
  "hairColor",
  "eyeColor",
  "ethnicity",
  "bodyType",
  "height",
  "relationshipStatus",
  "occupation",
  "education",
  "description",
  "websiteUrl",
  "socialLinks",
  "favoriteHookahFlavor",
  "favoriteHookahLounge",
  "favoriteHookahBrand",
  "favoriteHookahSetup",
  "hookahExperienceLevel",
  "preferredHookahStyle",
  "favoriteSmokeSessionVibe",
  "favoriteHookahAccessories",
  "openToLoungeMeetups",
  "favoriteLoungeCity",
  "interests",
] as const;

export function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseJsonMap(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, string>;
    return null;
  } catch {
    return null;
  }
}

export function detailsToResponse(details: ProfileDetails | undefined) {
  const empty = {
    coverPhotoUrl: null as string | null,
    livesInCity: null,
    livesInState: null,
    fromCity: null,
    fromState: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    gender: null,
    languagesSpoken: null,
    hairColor: null,
    eyeColor: null,
    ethnicity: null,
    bodyType: null,
    height: null,
    relationshipStatus: null,
    occupation: null,
    education: null,
    description: null,
    websiteUrl: null,
    socialLinks: null as Record<string, string> | null,
    favoriteHookahFlavor: null,
    favoriteHookahLounge: null,
    favoriteHookahBrand: null,
    favoriteHookahSetup: null,
    hookahExperienceLevel: null,
    preferredHookahStyle: null,
    favoriteSmokeSessionVibe: null,
    favoriteHookahAccessories: null,
    openToLoungeMeetups: null,
    favoriteLoungeCity: null,
    interests: [] as string[],
  };
  if (!details) return empty;
  return {
    ...empty,
    coverPhotoUrl: details.coverPhotoUrl,
    livesInCity: details.livesInCity,
    livesInState: details.livesInState,
    fromCity: details.fromCity,
    fromState: details.fromState,
    birthMonth: details.birthMonth,
    birthDay: details.birthDay,
    birthYear: details.birthYear,
    gender: details.gender,
    languagesSpoken: details.languagesSpoken,
    hairColor: details.hairColor,
    eyeColor: details.eyeColor,
    ethnicity: details.ethnicity,
    bodyType: details.bodyType,
    height: details.height,
    relationshipStatus: details.relationshipStatus,
    occupation: details.occupation,
    education: details.education,
    description: details.description,
    websiteUrl: details.websiteUrl,
    socialLinks: parseJsonMap(details.socialLinks),
    favoriteHookahFlavor: details.favoriteHookahFlavor,
    favoriteHookahLounge: details.favoriteHookahLounge,
    favoriteHookahBrand: details.favoriteHookahBrand,
    favoriteHookahSetup: details.favoriteHookahSetup,
    hookahExperienceLevel: details.hookahExperienceLevel,
    preferredHookahStyle: details.preferredHookahStyle,
    favoriteSmokeSessionVibe: details.favoriteSmokeSessionVibe,
    favoriteHookahAccessories: details.favoriteHookahAccessories,
    openToLoungeMeetups: details.openToLoungeMeetups,
    favoriteLoungeCity: details.favoriteLoungeCity,
    interests: parseJsonArray(details.interests),
  };
}

export type DetailsResponse = ReturnType<typeof detailsToResponse>;

/** Null out fields the viewer is not allowed to see. coverPhotoUrl is always visible. */
export function filterDetailsForViewer(
  details: DetailsResponse,
  privacyRows: { fieldName: string; visibility: string }[],
  rel: Relationship,
): DetailsResponse {
  if (rel.isSelf || rel.isAdmin) return details;
  const privacyMap = new Map(privacyRows.map((r) => [r.fieldName, r.visibility]));
  const result = { ...details };
  for (const field of PROFILE_DETAIL_FIELDS) {
    if (field === "coverPhotoUrl") continue;
    const visibility = NEVER_PUBLIC_FIELDS.has(field)
      ? "only_me"
      : (privacyMap.get(field) ?? FIELD_PRIVACY_DEFAULTS[field] ?? "public");
    if (!canView(visibility, rel)) {
      if (field === "interests") {
        result.interests = [];
      } else {
        (result as Record<string, unknown>)[field] = null;
      }
    }
  }
  return result;
}

/** Load the viewer's friend and following id sets for audience filtering. */
export async function loadAudienceSets(viewerId: number | null): Promise<{
  friendIds: Set<number>;
  followingIds: Set<number>;
  blockedEitherWay: Set<number>;
}> {
  const friendIds = new Set<number>();
  const followingIds = new Set<number>();
  const blockedEitherWay = new Set<number>();
  if (viewerId == null) return { friendIds, followingIds, blockedEitherWay };
  const [friendships, follows, blocks] = await Promise.all([
    db
      .select()
      .from(friendshipsTable)
      .where(or(eq(friendshipsTable.userAId, viewerId), eq(friendshipsTable.userBId, viewerId))),
    db.select().from(followsTable).where(eq(followsTable.followerId, viewerId)),
    db
      .select()
      .from(blocksTable)
      .where(or(eq(blocksTable.blockerId, viewerId), eq(blocksTable.blockedUserId, viewerId))),
  ]);
  friendships.forEach((f) =>
    friendIds.add(f.userAId === viewerId ? f.userBId : f.userAId),
  );
  follows.forEach((f) => followingIds.add(f.followingId));
  blocks.forEach((b) =>
    blockedEitherWay.add(b.blockerId === viewerId ? b.blockedUserId : b.blockerId),
  );
  return { friendIds, followingIds, blockedEitherWay };
}

/** Can the viewer see a post with the given audience by the given author? */
export function canViewAudience(
  audience: string,
  authorId: number,
  viewer: { id: number; role: string } | null,
  sets: { friendIds: Set<number>; followingIds: Set<number>; blockedEitherWay: Set<number> },
): boolean {
  if (viewer && (viewer.id === authorId || viewer.role === "admin")) return true;
  if (viewer && sets.blockedEitherWay.has(authorId)) return false;
  switch (audience) {
    case "public":
      return true;
    case "friends":
      return sets.friendIds.has(authorId);
    case "followers":
      return sets.followingIds.has(authorId) || sets.friendIds.has(authorId);
    default:
      return false; // only_me and unknown
  }
}

export async function getOrCreatePrivacySettings(userId: number): Promise<PrivacySettings> {
  const [existing] = await db
    .select()
    .from(privacySettingsTable)
    .where(eq(privacySettingsTable.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(privacySettingsTable)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(privacySettingsTable)
    .where(eq(privacySettingsTable.userId, userId));
  return row;
}

export function privacySettingsToResponse(s: PrivacySettings) {
  return {
    defaultPostAudience: s.defaultPostAudience,
    showFriendsList: s.showFriendsList,
    showFollowersList: s.showFollowersList,
    allowFriendRequestsFrom: s.allowFriendRequestsFrom,
    allowMessagesFrom: s.allowMessagesFrom,
    allowTagging: s.allowTagging,
    requireTagReview: s.requireTagReview === "true",
    allowSearchByEmail: s.allowSearchByEmail,
    allowSearchByPhone: s.allowSearchByPhone,
    allowExternalSearchIndexing: s.allowExternalSearchIndexing === "true",
    showOnlineStatus: s.showOnlineStatus === "true",
  };
}

export async function getProfileDetails(userId: number): Promise<ProfileDetails | undefined> {
  const [row] = await db
    .select()
    .from(profileDetailsTable)
    .where(eq(profileDetailsTable.userId, userId));
  return row;
}

export async function getFieldPrivacy(userId: number) {
  return db
    .select()
    .from(profileFieldPrivacyTable)
    .where(eq(profileFieldPrivacyTable.userId, userId));
}
