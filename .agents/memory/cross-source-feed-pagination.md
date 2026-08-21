---
name: Cross-source feed pagination
description: Correct offset pagination for one feed assembled from independently queried sources.
---

For offset-based feeds merged from multiple sources, query each included source from offset zero for at least `offset + limit` rows, apply one deterministic global ordering with stable tie-breakers, then slice the merged list exactly once.

**Why:** Applying the same offset to each source before merging permanently skips interleaved rows that were fetched for an earlier merged page but cut by its final limit.

**How to apply:** Use this rule whenever native and projected/partner records share one paginated feed. Source-only filters can query just that source, but must preserve the same stable ordering.