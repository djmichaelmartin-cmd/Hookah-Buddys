---
name: Business geocode refresh safety
description: How to refresh a private Business location without making a previously ready page disappear.
---

When a manual geocode refresh rechecks the same address fingerprint, keep the last validated private coordinates until a replacement is validated. Clear them immediately when the address fingerprint changes.

**Why:** A provider outage, ambiguous response, or failed address match during a same-address refresh must not remove a Business that was already safely eligible for nearby discovery. Reusing coordinates after an address change would instead create stale precision.

**How to apply:** Any new refresh or retry path must distinguish an unchanged-address recheck from an address edit. Failed unchanged-address checks may retain the prior ready location; changed-address checks must remain unavailable until the new address validates.