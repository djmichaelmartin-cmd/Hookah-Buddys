---
name: Orval zod Body-name collision
description: Component schemas named <OperationId>Body collide with orval's generated zod names.
---

Orval's zod output auto-names request-body validators `<OperationId>Body` (e.g. operationId `createAdminEvent` → `CreateAdminEventBody`). If a component schema in openapi.yaml is itself named `<OperationId>Body`, the zod barrel exports two members with the same name and `typecheck:libs` fails with TS2308 ambiguity.

**Why:** the zod generator emits both the operation-derived body constant and the component-schema type.

**How to apply:** never name a component schema exactly `<OperationId>Body`; use a distinct name like `AdminEventCreate`/`AdminEventUpdate` and `$ref` it from the requestBody.
