---
name: Messaging/video feature gating
description: How "paid member only" features (messaging, video chat) are gated, and the platform-vs-doll subscription distinction.
---

# Messaging / video-chat feature gating

Features like starting a message thread and requesting a video chat are gated to
members who hold an **active platform membership**, distinct from per-Doll
subscriptions.

## Two kinds of member subscription
- **Platform membership**: subscription row with `dollId = NULL`, plan `audience = "member"`, `price > 0`. This is what unlocks messaging + video chat.
- **Doll subscription**: subscription row with `dollId` set — unlocks that Doll's premium content only. Does NOT grant messaging/video access.

A free member (no platform membership, or only a free-tier plan) must upgrade.
`POST /subscriptions` with a paid member plan and **no** `dollId` creates the
platform membership; the server accepts it (it only rejects free-tier plans when
`dollId` is set).

## Enforce on BOTH layers
- **Server (authoritative)**: `requirePaidMember()` middleware in `lib/auth.ts`, chained after `requireAuth("member")`, on `POST /threads` and `POST /video-chats`. It checks `hasActivePaidMembership(userId)` (active sub, dollId null, member plan, price>0) and 403s otherwise.
- **Client**: DollProfile gates the buttons too, but the UI gate is convenience only.

**Why:** the client gate alone is bypassable — a free member can call the APIs
directly. Any new "members-only paid feature" route must add `requirePaidMember()`,
not just hide the button.

**How to apply:** when adding a paid-only action, derive entitlement from a plan
join (`price > 0`, correct `audience`), never from mere subscription-row existence,
and apply the middleware server-side. On the client, wait for the subscriptions
query to settle before deciding (a pending/undefined list must not read as "free").
