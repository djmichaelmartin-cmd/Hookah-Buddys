---
name: Stripe invoice webhook versions
description: Compatibility rule for resolving recurring subscriptions from versioned Stripe invoice payloads.
---

Stripe invoice renewal handling must accept both the current `parent.subscription_details.subscription` shape and the legacy top-level `subscription` shape.

**Why:** Stripe webhook endpoints retain their own API version independently of the installed SDK. Replacing the legacy field outright can silently stop renewals for an existing endpoint even when typechecks pass against a newer SDK.

**How to apply:** When changing Stripe invoice handling, preserve both payload shapes, accept string and expanded subscription objects, log invoices with no resolvable subscription, and run behavioral tests proving each shape reaches renewal.

Stripe fulfillment must durably claim signed event IDs before granting credits or subscriptions, and renewal should use one canonical invoice-success event.

**Why:** Stripe retries webhook deliveries, and one invoice can emit both `invoice.payment_succeeded` and `invoice.paid`. Signature verification proves authenticity, not uniqueness; processing both or replaying either can double-grant value.

**How to apply:** Store processed event IDs under a unique constraint, remove the claim when processing fails so Stripe can retry, require settled payment status, and avoid handling multiple invoice event types for the same renewal.