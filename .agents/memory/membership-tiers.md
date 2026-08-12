---
name: Membership tiers & placeholder checkout
description: Bronze/Silver/Gold/Platinum member tiers, gating rules, and the intentional placeholder-payment activation flow.
---

Member membership tiers are bronze/silver/gold/platinum (0/100/300/750 monthly credits), source of truth in `@workspace/pricing` (`MEMBERSHIP_MONTHLY_CREDITS`, `DOLL_SUBSCRIPTION_TIERS`).

**Rules:**
- New member registration auto-activates the Bronze plan server-side.
- Doll-content subscriptions are gated on the member's CURRENT active membership tier (gold/platinum) via `getActiveMembership`, never on the client-submitted planId — a submitted plan id is client-controlled and bypassable.
- `hasActivePaidMembership` is price-based (`price > 0`), so it survives tier renames.

**Why placeholder activation is intentional:** the whole platform uses placeholder Stripe (user spec: "Create placeholder Stripe price IDs"); credit purchases also grant immediately without payment. `POST /subscriptions` therefore activates paid plans directly after the placeholder checkout step. Before going live with real Stripe, activation MUST move behind verified webhook/payment events.

**How to apply:** any new paid-tier gate should check the active membership's tier via the shared `DOLL_SUBSCRIPTION_TIERS`/tier constants, and any tier rename must update pricing lib + seed + live DB rows together.
