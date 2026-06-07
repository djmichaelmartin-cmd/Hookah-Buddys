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

/** Whole minutes actually charged, honoring the 5-minute minimum. */
export function effectiveVideoMinutes(minutes: number): number {
  const m = Math.trunc(Number(minutes)) || 0;
  return Math.max(m, CREDIT_COSTS.videoMinMinutes);
}

/** Total credit cost for a video chat of the given requested length. */
export function videoChatCreditCost(minutes: number): number {
  return effectiveVideoMinutes(minutes) * CREDIT_COSTS.videoPerMinute;
}

/** Credit cost to unlock a premium media item, derived from its media type. */
export function unlockCreditCost(mediaType: string): number {
  return VIDEO_MEDIA_TYPES.has(mediaType) ? CREDIT_COSTS.unlockVideo : CREDIT_COSTS.unlockPhoto;
}

/** Credit cost to send a message: starting a new thread vs. a follow-up. */
export function messageCreditCost(isFirstInThread: boolean): number {
  return isFirstInThread ? CREDIT_COSTS.messageStart : CREDIT_COSTS.messageFollowup;
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
