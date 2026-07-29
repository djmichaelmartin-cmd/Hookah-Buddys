---
name: Orval query options need explicit queryKey
description: Passing custom `query` options to generated useX hooks requires queryKey
---

Rule: when passing `{ query: { enabled: ... } }` to a generated `useX` hook, you must also pass `queryKey: getXQueryKey(params)` or TS fails (`queryKey` is required in UseQueryOptions).

**Why:** the generated hooks only default the queryKey when no query options are supplied; supplying partial options drops the default.

**How to apply:** any conditional query (`enabled`) in artifacts/web must import and pass the matching `get*QueryKey` helper with the same params.
