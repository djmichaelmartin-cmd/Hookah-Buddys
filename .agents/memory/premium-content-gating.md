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

**Rule:** subscription entitlement must check the subscription's PLAN tier explicitly against
the intended product boundary, not just "non-free". Doll premium content requires a `premium`
tier: `viewerSubscribed` needs an active doll-scoped sub joined to `plans` with
`audience === "member"` AND `tier === "premium"`. `POST /subscriptions` correspondingly rejects
any plan with `tier !== "premium"` when a `dollId` is supplied.

**Why:** member tiers are Free / Basic / Premium. Basic ($19.99) only buys enhanced messaging;
premium photo/video access is a separately-paid feature reserved for Premium ($39.99). An earlier
version checked `tier !== "free"`, which let a Basic sub (crafted `{basic plan + dollId}` payload)
unlock all of a Doll's premium content — a tier-escalation / economic bypass. Check the exact
allowed tier, not a broad "non-free" class, because new mid-tiers will silently inherit access.
The content gate, not the client's plan choice, is the security control.

**How to apply:** any new path that grants premium access must verify the granting plan's tier,
and any media-serving endpoint must blank premium URLs for non-entitled viewers (don't rely on
the client to hide them).
