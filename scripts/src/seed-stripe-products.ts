/**
 * seed-stripe-products.ts
 *
 * Creates Stripe products and prices for each membership plan and credit
 * package, then writes the real Stripe price IDs back to the database so
 * checkout sessions use verified IDs instead of the "price_placeholder_*"
 * fallbacks.
 *
 * Run once after setting STRIPE_SECRET_KEY:
 *   pnpm --filter @workspace/scripts exec tsx src/seed-stripe-products.ts
 *
 * The script is idempotent: it skips products that already exist in Stripe
 * (matched by the `replit_slug` metadata field) and skips DB rows whose
 * stripePriceId is already a real Stripe ID (starts with "price_").
 */

import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, pool, plansTable, creditPackagesTable } from "@workspace/db";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is not set. Set the secret and try again.");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findExistingProduct(slug: string): Promise<Stripe.Product | null> {
  const results = await stripe.products.search({
    query: `metadata['replit_slug']:'${slug}'`,
    limit: 1,
  });
  return results.data[0] ?? null;
}

function isRealPriceId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("price_") && !id.startsWith("price_placeholder");
}

// ── Membership plans ─────────────────────────────────────────────────────────

async function seedMembershipPlans() {
  const plans = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.audience, "member"));

  for (const plan of plans) {
    if (plan.price === 0) {
      console.log(`[SKIP] ${plan.name}: free plan, no Stripe product needed.`);
      continue;
    }
    if (isRealPriceId(plan.stripePriceId)) {
      console.log(`[SKIP] ${plan.name}: already has a real Stripe price ID (${plan.stripePriceId}).`);
      continue;
    }

    const slug = `membership_${plan.slug ?? plan.id}`;

    let product = await findExistingProduct(slug);
    if (!product) {
      product = await stripe.products.create({
        name: `${plan.name} Membership`,
        description: plan.description ?? undefined,
        metadata: { replit_slug: slug },
      });
      console.log(`[CREATE] Product: ${product.id} (${plan.name})`);
    } else {
      console.log(`[FOUND]  Product: ${product.id} (${plan.name})`);
    }

    // Check whether a recurring monthly price already exists for this product.
    const existingPrices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
    const existingMonthly = existingPrices.data.find(
      (p) => p.recurring?.interval === "month" && p.currency === "usd",
    );

    let price: Stripe.Price;
    if (existingMonthly) {
      price = existingMonthly;
      console.log(`[FOUND]  Price:   ${price.id} ($${(price.unit_amount ?? 0) / 100}/mo)`);
    } else {
      price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: Math.round(plan.price * 100),
        recurring: { interval: "month" },
        metadata: { replit_slug: slug },
      });
      console.log(`[CREATE] Price:   ${price.id} ($${(price.unit_amount ?? 0) / 100}/mo)`);
    }

    await db.update(plansTable).set({ stripePriceId: price.id }).where(eq(plansTable.id, plan.id));
    console.log(`[DB]     Updated plan ${plan.id} stripePriceId → ${price.id}`);
  }
}

// ── Credit packages ───────────────────────────────────────────────────────────

async function seedCreditPackages() {
  const packages = await db.select().from(creditPackagesTable);

  for (const pkg of packages) {
    if (isRealPriceId(pkg.stripePriceId)) {
      console.log(`[SKIP] ${pkg.name}: already has a real Stripe price ID (${pkg.stripePriceId}).`);
      continue;
    }

    const slug = `credits_${pkg.slug}`;

    let product = await findExistingProduct(slug);
    if (!product) {
      product = await stripe.products.create({
        name: `${pkg.name} Credits (${pkg.credits} credits)`,
        metadata: { replit_slug: slug, credits: String(pkg.credits) },
      });
      console.log(`[CREATE] Product: ${product.id} (${pkg.name})`);
    } else {
      console.log(`[FOUND]  Product: ${product.id} (${pkg.name})`);
    }

    // Check whether a one-time price already exists for this product.
    const existingPrices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
    const existingOneTime = existingPrices.data.find(
      (p) => !p.recurring && p.currency === "usd",
    );

    let price: Stripe.Price;
    if (existingOneTime) {
      price = existingOneTime;
      console.log(`[FOUND]  Price:   ${price.id} ($${(price.unit_amount ?? 0) / 100})`);
    } else {
      price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: pkg.priceCents,
        metadata: { replit_slug: slug },
      });
      console.log(`[CREATE] Price:   ${price.id} ($${(price.unit_amount ?? 0) / 100})`);
    }

    await db
      .update(creditPackagesTable)
      .set({ stripePriceId: price.id })
      .where(eq(creditPackagesTable.id, pkg.id));
    console.log(`[DB]     Updated package ${pkg.id} stripePriceId → ${price.id}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Seeding Stripe products for membership plans ===");
  await seedMembershipPlans();

  console.log("\n=== Seeding Stripe products for credit packages ===");
  await seedCreditPackages();

  console.log("\nDone. Run the API server to apply the new price IDs.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
