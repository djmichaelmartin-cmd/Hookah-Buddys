---
name: Route smoke-test fixtures
description: How to keep broad route-navigation browser checks focused on routing rather than unrelated response-shape crashes.
---

Route smoke tests that visit many data-backed sections must return the real empty response envelope for each mocked endpoint, not a universal empty array.

**Why:** A route can resolve correctly and still fail the smoke test because a child section expects an object such as a page, summary, or named collection. Those render crashes look like missing headings or active navigation and obscure the behavior under test.

**How to apply:** For broad navigation tests, use minimal schema-valid empty fixtures for object responses and arrays only for endpoints whose contract is actually an array.