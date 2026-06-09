---
name: Per-Doll revenue / earnings model
description: The single illustrative formula behind per-Doll revenue, why it's shared, and why it must NOT be conflated with platform subscription revenue.
---

# Per-Doll revenue / earnings model

Per-Doll "revenue" (Doll-facing analytics AND the admin "Revenue Share by Doll"
card) comes from one shared helper, `computeDollEarnings(doll, counts)`. Both the
Doll's own dashboard and the admin view call it so the numbers always agree.

**Why shared:** before extraction, the Doll analytics route computed earnings
inline. The admin revenue-share feature needed the same per-Doll number; copying
the formula would let the two drift. One helper = one source of truth.

**How to apply:** any change to how a Doll's earnings are computed goes in the
shared helper, not in a route. If you add a new revenue source, add it there and
both surfaces update together.

## Two DIFFERENT revenue numbers live on the admin dashboard — keep them distinct

- **Platform subscription revenue** (admin `/admin/stats` totalRevenue +
  RevenueBreakdown card): derived from membership/subscription counts. This is
  what the *platform* earns.
- **Per-Doll revenue** (`/admin/revenue/dolls`, sum of `computeDollEarnings`):
  illustrative gross creator earnings (GMV-like). This is what *Dolls* gross.

These intentionally do NOT reconcile (different magnitudes) and an admin sees
both on one screen. The UI labels the per-Doll card as "creator revenue …
measured separately from the platform subscription revenue above" to avoid
confusion. Don't try to make them sum to each other.

**Note:** all of this is placeholder/illustrative math — checkout is a stub, no
real charges occur. If real billing is ever wired up, both models must be
revisited.
