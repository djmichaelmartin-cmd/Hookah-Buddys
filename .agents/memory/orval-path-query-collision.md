---
name: Orval path+query param name collision
description: An OpenAPI operation with both a path param and query params can generate colliding *Params type names.
---
Rule: avoid a single OpenAPI operation that mixes a path parameter with query parameters when a sibling operation would generate the same `Get*Params` name — orval/zod codegen collides on the params type name.

**Why:** `GET /profiles/{userId}?viewAs=public` collided with another generated `GetEnhancedProfileParams`; fixed by splitting into a separate path `/profiles/{userId}/public`. Similarly, inline request bodies on admin PATCH had to become named `$ref` schemas (e.g. ClearFieldsInput).

**How to apply:** When adding endpoints to lib/api-spec/openapi.yaml, prefer separate paths over view-mode query params, and use named `$ref` schemas for request bodies; run codegen early to catch collisions.
