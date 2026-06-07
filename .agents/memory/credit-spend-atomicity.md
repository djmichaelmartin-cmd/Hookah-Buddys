---
name: Credit spend atomicity
description: How credit debit/grant/adjust must stay atomic and idempotent across the api-server
---

# Credit spend atomicity

All credit balance changes must go through the shared helpers in
`artifacts/api-server/src/lib/credits.ts` (`spendCredits`, `grantCredits`,
`adjustCredits`) — never do a read-balance-then-update in a route handler.

**Why:** the original Buy Credits implementation used `select balance` then
`update balance = bal - cost` plus a separate transaction insert in each route
(messages/unlocks/video/purchase/adjustment). Under concurrency two requests
could both pass the precheck and overspend, and a failure between the balance
update and the ledger insert left balance/history diverged. A credit/money
system cannot tolerate either.

**How to apply:**
- Debit with a single conditional UPDATE `SET balance = balance - cost WHERE
  user_id = ? AND balance >= cost RETURNING` inside a `db.transaction`; treat a
  missing returned row as "insufficient" → HTTP 402. The caller's action
  callback inserts both the domain row and the credit transaction in the same tx
  so reference ids and ledger stay consistent.
- Idempotent actions (content unlocks) rely on a DB unique constraint
  (`content_unlocks_member_media_unique` on `(member_user_id, media_id)`) plus
  `onConflictDoNothing`; if the insert returns nothing, throw `AbortSpendError`
  to roll back the debit, then re-fetch and return the existing row (no charge).
  After a 402 from a concurrent exact-balance race, re-check existence before
  returning the error.
- Admin adjustments clamp the balance at zero but must log the **applied** delta
  (post-clamp difference), not the requested amount, or the ledger won't
  reconcile with the balance.

Note: `drizzle-kit push` prompts interactively (needs a TTY) before adding a
unique constraint to a populated table and offers to truncate. In this sandbox
apply such constraints with a direct `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE`
via psql after confirming there are no duplicate rows.
