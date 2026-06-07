---
name: List and detail endpoints must share the same visibility filter
description: Why a browse/list endpoint's status filter must also be enforced on the by-id detail endpoint.
---

When a resource has both a list/browse endpoint and a by-id detail endpoint,
both must apply the SAME visibility/status filter (e.g. `accountStatus='active'`,
`applicationStatus='approved'`, soft-delete, published flag).

**Why:** if the list hides inactive/suspended/unapproved rows but the detail
route only checks the resource type (e.g. `role === 'member'`), anyone can still
read hidden rows by guessing IDs (enumeration). The list filter creates a false
sense of a privacy boundary that the detail route silently bypasses.

**How to apply:** whenever you add or change a status/visibility filter on a list
endpoint, immediately check the matching `/:id` (and any export/related)
endpoints and apply the identical predicate. If admins are allowed to see hidden
rows, branch on role explicitly rather than leaving the filter off for everyone.
