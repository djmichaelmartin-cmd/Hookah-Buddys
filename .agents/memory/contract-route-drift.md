---
name: Contract-route drift
description: Why admin buttons silently did nothing — Express routes drifted from the OpenAPI contract the generated client calls.
---

In this repo the web client is generated from `lib/api-spec/openapi.yaml` (Orval).
The generated hooks call the exact method + path defined in the spec. If a server
route in `artifacts/api-server/src/routes/*` uses a different HTTP method or path,
the request hits no route → Express 404 → the client mutation rejects. Several
admin mutations had no `onError` handler, so the UI showed nothing at all ("button
does nothing").

**Why:** Found multiple drifted admin routes — application review, media moderate,
and verification review were registered as `POST` and/or under `/admin/...` prefixes,
while the contract defined them as `PATCH` on `/admin/applications/{id}/review`,
`/media/{id}/moderate`, `/verification/{id}/review`. The web tabs 404'd.

**How to apply:** The OpenAPI spec is the source of truth. When a button/page does
nothing or a tab is empty, check the network method+path against the spec FIRST
(grep the path in openapi.yaml, compare `router.<method>("<path>")`). Fix the server
to match the contract (do not change the contract unless the contract is wrong).
Verify via the proxy at `localhost:80/api/...` with a real session cookie, not the
service port. Restarting api-server is required after route changes (it runs a build
on start).
