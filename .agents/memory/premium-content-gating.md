---
name: Premium content entitlement
description: How Doll premium media (images/videos) access is gated and why the plan tier must be checked.
---

# Premium content entitlement (Doll profiles)

Premium media on `GET /dolls/:id` is gated server-side. A media item is `locked` when
`m.premium && !hasFullAccess && !unlocked`. `toMediaResponse(media, name, locked)` blanks
the `url` when locked (keeps `thumbnailUrl` for a blurred teaser), so locked premium URLs are
never delivered to non-entitled viewers. Access paths: active premium subscription to that doll,
individual content unlock, the doll owner, or admin.

**Rule:** subscription entitlement must check the subscription's PLAN, not just that a
subscription row exists. `viewerSubscribed` requires an active sub joined to `plans` with
`audience === "member"` and `tier !== "free"`. `POST /subscriptions` also rejects a free-tier
plan when a `dollId` is supplied.

**Why:** an earlier version set `viewerSubscribed` from any active `(member, doll)` subscription
row. Because members can subscribe with the free member plan, that let a free membership unlock
all premium content — a broken-access-control / economic bypass. The content gate, not the
client's plan choice, is the security control.

**How to apply:** any new path that grants premium access must verify the granting plan's tier,
and any media-serving endpoint must blank premium URLs for non-entitled viewers (don't rely on
the client to hide them).
