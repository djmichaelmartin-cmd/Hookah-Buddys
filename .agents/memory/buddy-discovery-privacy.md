---
name: Buddy discovery privacy
description: Privacy and identity rules for the unified member-and-Doll discovery experience.
---

Unified Buddy discovery may combine personal account roles, but every result must remain a narrow public projection and deduplicate by the owning user identity. Apply block relationships against the owning user ID, even when the visible profile URL uses a Doll ID.

Member age must remain unknown unless the product gains a dedicated public age field. Do not calculate it from profile birth-year data; age-bound filters exclude profiles whose age is unknown.

**Why:** Birth-year details are privacy-controlled and default to only-me, while Doll age is an existing dedicated public profile field. Deriving member age would turn a private field into a public discovery attribute.

**How to apply:** New discovery filters, ranking, caching, and online-status work should preserve the narrow projection, owner-ID block checks, role deduplication, and null-age behavior.