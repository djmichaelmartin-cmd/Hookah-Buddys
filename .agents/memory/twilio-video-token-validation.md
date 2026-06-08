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
To actually validate credentials, hit the Twilio REST API with the API Key SID +
Secret (HTTP basic), or just attempt a real `connect()`. Never treat a successful
token mint as proof the credentials work.
