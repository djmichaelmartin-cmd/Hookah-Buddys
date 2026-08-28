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
      "Bronze is free and gives you access to the social side of HookahBuddys. Credits are only needed for premium Buddy interactions like paid messaging, premium content unlocks, and video chat.",
    features: [
      "Create a free HookahBuddys profile",
      "Join the public HookahBuddys Lounge",
      "Post hookah-related content",
      "Upload public photos & reels",
      "Like, comment & save posts",
      "Follow Buddys and Bros",
      "Add Buddys",
      "Browse public profiles",
      "Basic privacy settings & notifications",
      "View public Buddy profile previews",
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
      "Full Buddy browsing",
      "Save favorite Buddys",
      "Enhanced profile features",
      "Use credits for Buddy messaging",
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
      "Better Buddy discovery & search access",
      "Priority access to featured Buddys",
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
      "Early access to featured Buddys",
      "Exclusive Platinum promotions",
      "Best for frequent messaging, unlocks & video chat",
    ],
    highlighted: false,
  },
  // ── Doll plans ────────────────────────────────────────────────────────────
  {
    name: "Buddy — Free",
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
    name: "Buddy — Premium",
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
    name: "Buddy — Featured",
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
    name: "Buddy — Elite",
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

function renameRetiredPublicTerminology(value: string): string {
  return value
    .replace(/\bfeed\b/gi, "Lounge")
    .replace(/\bfriends\b/gi, "Buddys")
    .replace(/\bfriend\b/gi, "Buddy");
}

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

    const [existing] = await db
      .select({
        id: plansTable.id,
        name: plansTable.name,
        description: plansTable.description,
        features: plansTable.features,
      })
      .from(plansTable)
      .where(matchCondition);

    if (existing) {
      // Never overwrite stripePriceId — it is managed by the payment provider
      // setup flow and must survive repeated server restarts.
      //
      // Copy fields (name, description, features) are intentionally NOT synced
      // for existing rows: they are editable live via the admin Plans UI
      // (PATCH /api/admin/plans/:id) and the database is their source of
      // truth. Overwriting them here would silently revert admin edits on
      // every deploy. Structural fields (tier, slug, credits, highlight) stay
      // code-managed.
      //
      // The targeted public terminology migration below preserves all
      // administrator-authored copy and changes only retired standalone terms.
      const migratedName = renameRetiredPublicTerminology(existing.name);
      const migratedDescription = existing.description
        ? renameRetiredPublicTerminology(existing.description)
        : existing.description;
      const migratedFeatures =
        existing.features?.map(renameRetiredPublicTerminology) ?? existing.features;

      await db
        .update(plansTable)
        .set({
          tier: plan.tier,
          highlighted: plan.highlighted,
          monthlyCredits: plan.monthlyCredits,
          ...(plan.slug !== undefined && { slug: plan.slug }),
          ...(migratedName !== existing.name && { name: migratedName }),
          ...(migratedDescription !== existing.description && {
            description: migratedDescription,
          }),
          ...(migratedFeatures?.some((feature, index) => feature !== existing.features?.[index]) && {
            features: migratedFeatures,
          }),
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
