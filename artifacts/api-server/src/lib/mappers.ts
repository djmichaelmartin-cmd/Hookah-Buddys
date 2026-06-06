import type { User, Doll, Media } from "@workspace/db";

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
    dollId: user.dollId ?? null,
    createdAt: iso(user.createdAt),
  };
}

export type DollCounts = {
  premiumPhotoCount: number;
  premiumVideoCount: number;
  freePhotoCount: number;
  shortVideoCount: number;
  favoriteCount: number;
};

export function toDollResponse(doll: Doll, counts: DollCounts) {
  return {
    id: doll.id,
    stageName: doll.stageName,
    city: doll.city,
    state: doll.state,
    age: doll.age ?? null,
    bio: doll.bio ?? "",
    favoriteFlavor: doll.favoriteFlavor ?? "",
    experienceLevel: doll.experienceLevel ?? "",
    preferences: doll.preferences ?? "",
    profilePhotoUrl: doll.profilePhotoUrl ?? "",
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

export function toMediaResponse(media: Media, dollName?: string) {
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
    url: media.url ?? "",
    thumbnailUrl: media.thumbnailUrl ?? "",
    caption: media.caption ?? "",
    status: media.status as "pending_review" | "approved" | "rejected",
    containsHookah: media.containsHookah,
    premium: media.premium,
    price: media.price,
    moderationNotes: media.moderationNotes ?? null,
    dollName: dollName ?? "",
    createdAt: iso(media.createdAt),
  };
}
