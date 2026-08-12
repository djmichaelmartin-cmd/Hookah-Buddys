---
name: Payment provider decision
description: Which payment processor this project will use and how the payment gate is structured for it
---

# Payment provider: Authorize.net (planned), NOT Stripe

**The rule:** The user explicitly declined the Stripe integration (August 2026) and stated Authorize.net will eventually be the payment processor. Do not propose or wire up Stripe again.

**Why:** User's stated business choice.

**How to apply:**
- The payment security gate is provider-agnostic and must stay: `POST /subscriptions` returns 402 for paid plans, `POST /credits/purchase` returns 402 always; activation/credit grants happen only from a verified payment webhook.
- Current dormant Stripe plumbing (checkout session creation in the checkout route, signature-verified webhook handler, `stripe*` columns on subscriptions, seed-stripe-products script) is the swap-out surface when Authorize.net is integrated. Replace the internals of the checkout route and webhook handler; keep the gate and the activation-via-webhook flow (`activateMembership`/`renewMembership`/`grantCredits`).
- Until a processor is configured, `POST /checkout` correctly fails loud with 503 "payment processing not configured".
- Authorize.net equivalents: Accept Hosted payment pages ≈ Stripe Checkout; Webhooks (with HMAC-SHA512 signature verification) ≈ Stripe webhooks; ARB (Automated Recurring Billing) ≈ Stripe subscriptions.
