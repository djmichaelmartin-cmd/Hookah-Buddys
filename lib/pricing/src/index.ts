// Single source of truth for HookahDolls credit pricing, shared by the API
// server (enforcement) and the web app (display + estimates). Costs are in
// whole credits; package prices are in US cents.

export const CREDIT_COSTS = {
  // Messaging
  messageStart: 20,
  messageFollowup: 10,
  messagePhoto: 25,
  messagePriority: 50,
  // Video chat
  videoPerMinute: 30,
  videoMinMinutes: 5,
  // Premium content unlocks (by tier)
  unlockPhoto: 25,
  unlockBundle: 100,
  unlockVideo: 150,
  unlockExclusive: 250,
} as const;

const VIDEO_MEDIA_TYPES = new Set(["premium_video", "short_video", "video"]);

/** Media types that are paywalled and therefore require a pricing tier. */
export const PREMIUM_MEDIA_TYPES = ["premium_photo", "premium_video"] as const;
const PREMIUM_MEDIA_TYPE_SET = new Set<string>(PREMIUM_MEDIA_TYPES);

/**
 * Authoritative check for whether a media type is paywalled. The client-supplied
 * `premium` flag must never be trusted on its own — derive it from the type.
 */
export function isPremiumMediaType(mediaType: string): boolean {
  return PREMIUM_MEDIA_TYPE_SET.has(mediaType);
}

/** Whole minutes actually charged, honoring the 5-minute minimum. */
export function effectiveVideoMinutes(minutes: number): number {
  const m = Math.trunc(Number(minutes)) || 0;
  return Math.max(m, CREDIT_COSTS.videoMinMinutes);
}

/** Total credit cost for a video chat of the given requested length. */
export function videoChatCreditCost(minutes: number): number {
  return effectiveVideoMinutes(minutes) * CREDIT_COSTS.videoPerMinute;
}

/** Premium-content unlock pricing tiers. */
export const UNLOCK_TIERS = ["photo", "bundle", "video", "exclusive"] as const;
export type UnlockTier = (typeof UNLOCK_TIERS)[number];

const UNLOCK_TIER_COSTS: Record<UnlockTier, number> = {
  photo: CREDIT_COSTS.unlockPhoto,
  bundle: CREDIT_COSTS.unlockBundle,
  video: CREDIT_COSTS.unlockVideo,
  exclusive: CREDIT_COSTS.unlockExclusive,
};

function isUnlockTier(value: unknown): value is UnlockTier {
  return typeof value === "string" && (UNLOCK_TIERS as readonly string[]).includes(value);
}

/**
 * Resolve the authoritative unlock tier for a media item. An explicit, durable
 * `tier` value always wins; otherwise the tier is inferred from the media type
 * (video types => "video", everything else => "photo").
 */
export function resolveUnlockTier(mediaType: string, tier?: string | null): UnlockTier {
  if (isUnlockTier(tier)) return tier;
  return VIDEO_MEDIA_TYPES.has(mediaType) ? "video" : "photo";
}

/**
 * Credit cost to unlock a premium media item. Uses the explicit pricing tier
 * when set, falling back to type-based inference. Covers all four tiers
 * (photo/bundle/video/exclusive).
 */
export function unlockCreditCost(mediaType: string, tier?: string | null): number {
  return UNLOCK_TIER_COSTS[resolveUnlockTier(mediaType, tier)];
}

/** Credit cost to send a message: starting a new thread vs. a follow-up. */
export function messageCreditCost(isFirstInThread: boolean): number {
  return isFirstInThread ? CREDIT_COSTS.messageStart : CREDIT_COSTS.messageFollowup;
}

// ----- Memberships -----

/**
 * Recurring credits granted each billing cycle by member plan tier. These reset
 * at the start of every cycle and do not roll over. Source of truth shared by
 * the seed, the server (refresh logic), and the web app (display).
 */
export const MEMBERSHIP_MONTHLY_CREDITS: Record<string, number> = {
  free: 0,
  basic: 100,
  premium: 300,
};

/** Monthly credits included with a member plan tier (0 if none / unknown). */
export function membershipMonthlyCredits(tier: string): number {
  return MEMBERSHIP_MONTHLY_CREDITS[tier] ?? 0;
}

/**
 * Next billing date = one calendar month after `from`. Used as the membership
 * credit refresh date / current period end.
 */
export function nextBillingDate(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

export type CreditPackageSeed = {
  slug: string;
  name: string;
  priceCents: number;
  credits: number;
  label: string | null;
  stripePriceId: string;
  sortOrder: number;
};

// Canonical packages seeded onto a fresh DB. At runtime packages are read from
// (and edited in) the database; these are just the launch defaults.
export const CREDIT_PACKAGE_SEEDS: CreditPackageSeed[] = [
  { slug: "starter", name: "Starter", priceCents: 999, credits: 100, label: null, stripePriceId: "price_placeholder_starter", sortOrder: 1 },
  { slug: "popular", name: "Popular", priceCents: 2499, credits: 300, label: "Most Popular", stripePriceId: "price_placeholder_popular", sortOrder: 2 },
  { slug: "social", name: "Social", priceCents: 4999, credits: 700, label: null, stripePriceId: "price_placeholder_social", sortOrder: 3 },
  { slug: "vip", name: "VIP", priceCents: 9999, credits: 1600, label: "Best Value", stripePriceId: "price_placeholder_vip", sortOrder: 4 },
  { slug: "elite", name: "Elite", priceCents: 19999, credits: 3500, label: null, stripePriceId: "price_placeholder_elite", sortOrder: 5 },
];
