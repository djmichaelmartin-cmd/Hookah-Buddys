---
name: Local ranking cache isolation
description: Why daily radius-based rankings need member isolation even when their location key is coarse and private
---

Daily caches for radius-bound rankings must be scoped to the member as well as the private coarse location and local date.

**Why:** Two members inside one coarse grid cell can still have different candidates at the edge of a fixed-radius search. Sharing the first member's cached winner IDs can silently remove the second member's true top results.

**How to apply:** Use coarse location only as a privacy-preserving partition. Include the member identity in cache uniqueness, and always revalidate cached winners against current safety and eligibility rules.