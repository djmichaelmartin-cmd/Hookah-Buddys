---
name: Stripe invoice webhook versions
description: Compatibility rule for resolving recurring subscriptions from versioned Stripe invoice payloads.
---

Stripe invoice renewal handling must accept both the current `parent.subscription_details.subscription` shape and the legacy top-level `subscription` shape.

**Why:** Stripe webhook endpoints retain their own API version independently of the installed SDK. Replacing the legacy field outright can silently stop renewals for an existing endpoint even when typechecks pass against a newer SDK.

**How to apply:** When changing Stripe invoice handling, preserve both payload shapes, accept string and expanded subscription objects, log invoices with no resolvable subscription, and run behavioral tests proving each shape reaches renewal.