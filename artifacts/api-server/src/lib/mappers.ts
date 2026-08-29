import type { User, Doll, Media } from "@workspace/db";
import { resolveUnlockTier, unlockCreditCost } from "@workspace/pricing";

function iso(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

export function toUserResponse(user: User) {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    accountStatus: user.accountStatus,
    buddyType: user.buddyType ?? null,
    dollId: user.dollId ?? null,
    createdAt: iso(user.createdAt),
  };
}

export function toMemberProfileResponse(user: User) {
  return {
    id: user.id,
    name: user.name,
    username: user.username ?? null,
    city: user.city ?? null,
    state: user.state ?? null,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    buddyType: user.buddyType ?? null,
    memberSince: iso(user.createdAt) ?? "",
  };
}

export type BuddyDiscoveryProfile = {
  id: number;
  accountType: "member" | "doll";
  dollId: number | null;
  name: string;
  handle: string | null;
  age: number | null;
  city: string | null;
  state: string | null;
  profilePhotoUrl: string | null;
  buddyType: "female_buddy" | "male_buddy" | null;
  memberSince: string;
  profileUrl: string;
};

export type DollCounts = {
  premiumPhotoCount: number;
  premiumVideoCount: number;
  freePhotoCount: number;
  shortVideoCount: number;
  favoriteCount: number;
};

export function toDollResponse(
  doll: Doll,
  counts: DollCounts,
  buddyType: "female_buddy" | "male_buddy" | null = null,
) {
  return {
    id: doll.id,
    creatorUserId: doll.userId,
    stageName: doll.stageName,
    city: doll.city,
    state: doll.state,
    age: doll.age ?? null,
    bio: doll.bio ?? "",
    favoriteFlavor: doll.favoriteFlavor ?? "",
    experienceLevel: doll.experienceLevel ?? "",
    preferences: doll.preferences ?? "",
    profilePhotoUrl: doll.profilePhotoUrl ?? "",
    buddyType,
    verified: doll.verified,
    featured: doll.featured,
    elite: doll.elite,
    online: doll.online,
    availableForVideoChat: doll.availableForVideoChat,
    tier: doll.tier as "free" | "premium" | "featured" | "elite",
    premiumPhotoCount: counts.premiumPhotoCount,
    premiumVideoCount: counts.premiumVideoCount,
    freePhotoCount: counts.freePhotoCount,
    shortVideoCount: counts.shortVideoCount,
    favoriteCount: counts.favoriteCount,
    subscriptionPrice: doll.subscriptionPrice,
    messagePrice: doll.messagePrice,
    videoChatRate: doll.videoChatRate,
    createdAt: iso(doll.createdAt),
  };
}

export function toMediaResponse(media: Media, dollName?: string, locked = false) {
  return {
    id: media.id,
    dollId: media.dollId,
    type: media.type as
      | "profile"
      | "free_photo"
      | "premium_photo"
      | "premium_video"
      | "short_video"
      | "verification",
    url: locked ? "" : (media.url ?? ""),
    thumbnailUrl: media.thumbnailUrl ?? "",
    caption: media.caption ?? "",
    status: media.status as "pending_review" | "approved" | "rejected",
    containsHookah: media.containsHookah,
    premium: media.premium,
    price: media.price,
    // Tier/unlock pricing only applies to paywalled media. Non-premium items
    // intentionally omit these so clients never show a misleading unlock cost.
    tier: media.premium ? resolveUnlockTier(media.type, media.tier) : undefined,
    unlockCost: media.premium ? unlockCreditCost(media.type, media.tier) : undefined,
    locked,
    moderationNotes: media.moderationNotes ?? null,
    dollName: dollName ?? "",
    createdAt: iso(media.createdAt),
  };
}
