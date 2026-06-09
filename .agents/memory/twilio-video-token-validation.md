---
name: Twilio Video token mint != credential validation
description: A 201 from the video-chat token endpoint does NOT prove the Twilio credentials are valid.
---

The server mints a Twilio Video AccessToken by signing a JWT locally with the API
Key Secret. It embeds the Account SID (as `sub`) and API Key SID (as `iss`) without
validating their format or authenticity — Twilio only checks them when the browser
client calls `connect()`.

**Why:** During this integration the token endpoint returned 201 with a
structurally valid JWT, but the decoded `sub` was not a Twilio Account SID (Twilio
Account SIDs start with `AC`, API Key SIDs start with `SK`). The user's
`TWILIO_ACCOUNT_SID` secret held a non-Twilio value, so live `connect()` would fail
even though the endpoint looked healthy.

**How to apply:** When video "doesn't connect" but the token endpoint returns 201,
decode the JWT payload and sanity-check the prefixes (`iss` → `SK`, `sub` → `AC`).
To actually validate credentials, HTTP-basic-auth the API Key SID + Secret against a
PRODUCT endpoint you use (e.g. `GET video.twilio.com/v1/Rooms`) — NOT `/Accounts.json`
(Standard keys return 20003 there even when valid; see twilio-apikey-scope.md) — or
just attempt a real `connect()`. Never treat a successful token mint as proof the
credentials work.
