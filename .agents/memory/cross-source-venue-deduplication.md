---
name: Cross-source venue deduplication
description: Safe duplicate suppression between Business Pages and the legacy lounge directory
---

Do not suppress a legacy directory venue using only normalized name, city, and state.

**Why:** Separate venues can share a brand/name within one city. Natural-key matching can hide a legitimate directory result while its map marker remains, creating inconsistent discovery behavior.

**How to apply:** Suppress only when the server establishes exactly one cross-source match using public venue identity evidence and tight coordinate proximity. Keep ambiguous or unmatched entries visible.