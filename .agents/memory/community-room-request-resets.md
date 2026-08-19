---
name: Community room request resets
description: Prevent transient cross-room feed queries when navigating between community destinations.
---

Room-specific feed state must initialize synchronously when the active community category changes. Resetting sort or hashtag state in an effect permits one destination-category request with the previous room's filters before React applies the reset.

**Why:** Even a short-lived stale request can show the wrong feed while the next query resolves, and cache the wrong category/filter combination.

**How to apply:** Give the room feed a category-derived identity (or otherwise derive the initial state during render) so its filter state starts clean before its data hook can request the destination category. Regression tests should assert every post request after navigation has the new category, `new` filter, and no former hashtag.