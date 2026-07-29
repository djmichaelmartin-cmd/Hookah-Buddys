---
name: Engagement-route visibility parity
description: Every like/save/comment/report/view route must enforce the same visibility+block checks as the content's detail route.
---
Rule: any endpoint that touches a content item by ID (like, save, comment list/create, report, view-count) must apply the exact same audience/visibility + bidirectional-block guard as the GET detail route for that item.

**Why:** Code review found feed posts, photos, and reels enforcing audience/visibility only on list+detail routes; private content was probeable and interactable via /like, /comments, /report by ID enumeration.

**How to apply:** Define one `viewerCanSeeX(item, viewer)` helper per content type (feed.ts, photos.ts, reels.ts follow this pattern) and call it in every :id route. Blocks are bidirectional: both viewerBlockedTarget and targetBlockedViewer hide content (self/admin exempt).
