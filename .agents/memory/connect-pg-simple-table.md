---
name: connect-pg-simple session table
description: Why the session table is defined in Drizzle instead of auto-created
---

connect-pg-simple's `createTableIfMissing: true` does NOT honor a custom `tableName` — its bundled `table.sql` hardcodes a table named `session`, so requesting `tableName: "user_sessions"` silently creates nothing usable and every session write fails (login appears to work, cookie is set, but `/auth/me` returns authenticated:false because no session row persists).

**Why:** the bundled SQL is static; the existence check uses your tableName but the CREATE uses `session`, so the check never passes and creation effectively no-ops for custom names.

**How to apply:** define the session table yourself in Drizzle (`user_sessions`: `sid varchar PK`, `sess json`, `expire timestamp(6)`, index on expire), push it like any other table, and set `createTableIfMissing: false`. If sessions ever stop persisting, first check the session table actually exists in the DB.
