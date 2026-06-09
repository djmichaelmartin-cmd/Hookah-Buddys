---
name: Twilio Standard API Key scope — validate against the product API, not the Account API
description: A working Twilio Video API key returns 20003 on /Accounts.json; validate Video keys against video.twilio.com instead.
---

A Twilio **Standard** API Key (SID `SK…` + Secret) authenticates to product APIs
(e.g. Video at `https://video.twilio.com/v1/Rooms`) but is NOT authorized for the
legacy Account-management API (`https://api.twilio.com/2010-04-01/Accounts.json`),
which returns HTTP 401 with `x-twilio-error-code: 20003`.

**Why:** Many credential-validation attempts were wrongly declared "key rejected"
because the probe tested the Account API. A key created programmatically with the
Account SID + Auth Token (the create call returns 201) STILL 401'd on /Accounts.json
but returned 200 on the Video API — proving the key was valid for Video all along.
The Account API is gated by account-management permission that Standard keys lack.
Only Account SID + Auth Token works on the Account API.

**How to apply:** To validate a Twilio Video credential, HTTP-basic-auth against a
**product** endpoint you actually use (e.g. `GET video.twilio.com/v1/Rooms`), or
attempt a real client `connect()`. Never use `/Accounts.json` to test a Standard API
key — a 20003 there does NOT mean the key is bad.

**Related (Replit secret vs env-var precedence):** A shared env var set via
`setEnvVars` overrode a same-named global Replit Secret in this runtime — the server
picked up the provisioned env-var key over the stale secret without any code change.
Useful when you must replace a bad secret you cannot overwrite programmatically; for
a single source of truth, delete the stale secret in the Secrets UI afterward.
