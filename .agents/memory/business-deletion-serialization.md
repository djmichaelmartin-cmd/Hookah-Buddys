---
name: Business deletion serialization
description: Concurrency and storage-ownership rules for permanent Business Page deletion.
---

Business-scoped writers and permanent deletion must share a transaction-level per-Business lock, and writers must revalidate the parent after acquiring it. A Business row lock alone is not enough when dependent tables lack foreign keys.

**Why:** An in-flight writer can read a Business before deletion and insert a dependent row after deletion commits. Likewise, checking references before deleting a reusable object has a time-of-check/time-of-use race.

**How to apply:** Any new Business-scoped write that could race permanent deletion must take the shared lock and recheck the Business inside its write transaction. Physically delete only objects whose immutable key and metadata prove exclusive Business ownership; retain member-owned upload keys because unrelated content may reuse them.