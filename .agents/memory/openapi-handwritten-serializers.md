---
name: OpenAPI hand-written serializers
description: Why adding a required field to a shared OpenAPI schema can silently break the server at runtime.
---

Route handlers in `artifacts/api-server/src/routes/` build JSON responses by hand
(object literals), not from a shared serializer. The same OpenAPI component (e.g.
`Plan`) is emitted by more than one route (`plans.ts` returns the plan list,
`subscriptions.ts` embeds plan data).

**Rule:** when you add a field to a schema's `required` list in
`lib/api-spec/openapi.yaml`, update *every* handler that returns that schema to
include the field.

**Why:** the server is not validated against the generated response types, so a
missing field compiles and runs fine but ships `undefined` to clients. The web app
trusts the generated (now non-optional) type and breaks at runtime (e.g. the
Pricing/Memberships page reading `plan.monthlyCredits`).

**How to apply:** after editing a `required` array, grep for every route that
constructs that response shape and confirm the new key is present, then curl the
endpoint to verify the field is in the payload.
