/**
 * syncPlans — idempotent startup sync for the canonical plan catalogue.
 *
 * On every server boot this function ensures the `plans` table matches the
 * definitions below. It is safe to run against a live database because:
 *
 *  - Existing rows are UPDATE-d in place (plan IDs never change, so
 *    subscription foreign keys remain valid).
 *  - Missing rows are INSERT-ed.
 *  - No rows are deleted.
 *
 * Member plans are matched by (audience, price) — a stable identity that
 * survives the old free/basic/premium → bronze/silver/gold/platinum rename.
 * Doll plans are matched by (audience, tier), which has always been stable.
 */

import { and, eq } from "drizzle-orm";
import { db, plansTable } from "@workspace/db";
import { logger } from "./logger";

type PlanDef = {
  slug?: string;
  name: string;
  audience: "member" | "doll";
  price: number;
  interval: string;
  tier: string;
  description: string;
  features: string[];
  highlighted: boolean;
  monthlyCredits: number;
  stripePriceId?: string;
};

const CANONICAL_PLANS: PlanDef[] = [
  // ── Member plans ──────────────────────────────────────────────────────────
  {
    slug: "bronze",
    name: "Bronze — Free Profile",
    audience: "member",
    price: 0,
    interval: "month",
    tier: "bronze",
    monthlyCredits: 0,
    description:
      "Bronze is free and gives you access to the social side of HookahDolls. Credits are only needed for premium Doll interactions like paid messaging, premium content unlocks, and video chat.",
    features: [
      "Create a free HookahDolls profile",
      "Join the public hookah social feed",
      "Post hookah-related content",
      "Upload public photos & reels",
      "Like, comment & save posts",
      "Follow Dolls and Bros",
      "Add friends",
      "Browse public profiles",
      "Basic privacy settings & notifications",
      "View public Doll profile previews",
      "Upgrade anytime",
      "Buy credits anytime",
    ],
    highlighted: false,
  },
  {
    slug: "silver",
    name: "Silver — Social Plus",
    audience: "member",
    price: 19.99,
    interval: "month",
    tier: "silver",
    monthlyCredits: 100,
    stripePriceId: "price_placeholder_silver_monthly",
    description: "An optional upgrade with monthly credits for messaging and premium unlocks.",
    features: [
      "Everything in Free Profile",
      "100 monthly credits",
      "Full Doll browsing",
      "Save favorite Dolls",
      "Enhanced profile features",
      "Use credits for Doll messaging",
      "Use credits for premium content unlocks",
      "Use credits toward video chat",
      "Silver badge",
      "Buy extra credits anytime",
    ],
    highlighted: false,
  },
  {
    slug: "gold",
    name: "Gold — Premium Access",
    audience: "member",
    price: 39.99,
    interval: "month",
    tier: "gold",
    monthlyCredits: 300,
    stripePriceId: "price_placeholder_gold_monthly",
    description:
      "Best for active members who want regular messaging, premium unlocks, and occasional video chat.",
    features: [
      "Everything in Silver",
      "300 monthly credits",
      "Better Doll discovery & search access",
      "Priority access to featured Dolls",
      "More premium previews",
      "Gold badge",
      "More saved favorites",
      "More profile visibility",
      "Better value for regular interaction",
    ],
    highlighted: true,
  },
  {
    slug: "platinum",
    name: "Platinum — VIP Access",
    audience: "member",
    price: 79.99,
    interval: "month",
    tier: "platinum",
    monthlyCredits: 750,
    stripePriceId: "price_placeholder_platinum_monthly",
    description:
      "Best for power users who want frequent messaging, premium unlocks, and video chat access.",
    features: [
      "Everything in Gold",
      "750 monthly credits",
      "VIP Bro badge",
      "Priority support",
      "Best profile visibility",
      "Advanced search filters",
      "Early access to featured Dolls",
      "Exclusive Platinum promotions",
      "Best for frequent messaging, unlocks & video chat",
    ],
    highlighted: false,
  },
  // ── Doll plans ────────────────────────────────────────────────────────────
  {
    name: "Doll — Free",
    audience: "doll",
    price: 0,
    interval: "month",
    tier: "free",
    monthlyCredits: 0,
    description: "Get verified and start building your audience.",
    features: ["Verified profile", "Upload free content", "Receive messages"],
    highlighted: false,
  },
  {
    name: "Doll — Premium",
    audience: "doll",
    price: 9.99,
    interval: "month",
    tier: "premium",
    monthlyCredits: 0,
    description: "Sell premium content and set your own prices.",
    features: ["Everything in Free", "Premium content sales", "Custom pricing", "Basic analytics"],
    highlighted: false,
  },
  {
    name: "Doll — Featured",
    audience: "doll",
    price: 24.99,
    interval: "month",
    tier: "featured",
    monthlyCredits: 0,
    description: "Get top placement in browse and search.",
    features: [
      "Everything in Premium",
      "Featured placement",
      "Boosted in search",
      "Advanced analytics",
    ],
    highlighted: true,
  },
  {
    name: "Doll — Elite",
    audience: "doll",
    price: 49.99,
    interval: "month",
    tier: "elite",
    monthlyCredits: 0,
    description: "Maximum visibility and the Elite badge.",
    features: [
      "Everything in Featured",
      "Elite badge",
      "Highest ranking priority",
      "Video chat tools",
      "Dedicated support",
    ],
    highlighted: false,
  },
];

export async function syncPlans(): Promise<void> {
  let updated = 0;
  let inserted = 0;

  for (const plan of CANONICAL_PLANS) {
    // Member plans: match by audience + price (stable across the tier rename).
    // Doll plans:   match by audience + tier  (always been stable).
    const matchCondition =
      plan.audience === "member"
        ? and(eq(plansTable.audience, plan.audience), eq(plansTable.price, plan.price))
        : and(eq(plansTable.audience, plan.audience), eq(plansTable.tier, plan.tier));

    const [existing] = await db.select({ id: plansTable.id }).from(plansTable).where(matchCondition);

    if (existing) {
      // Never overwrite stripePriceId — it is managed by the payment provider
      // setup flow and must survive repeated server restarts.
      await db
        .update(plansTable)
        .set({
          name: plan.name,
          tier: plan.tier,
          description: plan.description,
          features: plan.features,
          highlighted: plan.highlighted,
          monthlyCredits: plan.monthlyCredits,
          ...(plan.slug !== undefined && { slug: plan.slug }),
        })
        .where(eq(plansTable.id, existing.id));
      updated++;
    } else {
      await db.insert(plansTable).values({
        name: plan.name,
        audience: plan.audience,
        price: plan.price,
        interval: plan.interval,
        tier: plan.tier,
        description: plan.description,
        features: plan.features,
        highlighted: plan.highlighted,
        monthlyCredits: plan.monthlyCredits,
        ...(plan.slug !== undefined && { slug: plan.slug }),
        ...(plan.stripePriceId !== undefined && { stripePriceId: plan.stripePriceId }),
      });
      inserted++;
    }
  }

  logger.info({ updated, inserted }, "syncPlans complete");
}
