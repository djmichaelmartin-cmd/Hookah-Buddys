---
name: Credit spend atomicity
description: Rules for keeping credit debit/grant/adjust atomic, idempotent, and ledger-consistent
---

# Credit spend atomicity

Every credit balance change must be atomic and leave the ledger reconcilable
with the balance. Never read a balance and then write it back from app code —
that loses concurrent updates and can split the balance from its transaction.

**Why:** this is a money-like ledger. A read-balance → compute → write pattern
(with a separate ledger insert) lets two concurrent requests both pass a
precheck and overspend, and a crash between the two writes diverges balance from
history. The lost-update flaw is easy to miss in the admin-adjustment path even
after the main spend path is made atomic — audit every balance mutation, not
just the obvious one.

**How to apply:**
- Debit: single conditional UPDATE `balance = balance - cost WHERE balance >=
  cost RETURNING`, inside a transaction; no returned row ⇒ insufficient ⇒ 402.
  Insert the domain row and the ledger entry in that same transaction.
- Grant: single additive UPDATE + ledger insert in one transaction.
- Adjust (admin): clamp at zero, but lock the balance row (`SELECT ... FOR
  UPDATE`) so concurrent adjustments serialize, and log the *applied* (post-clamp)
  delta, not the requested amount, or the ledger won't reconcile.
- Idempotent actions (content unlocks): enforce with a DB unique constraint plus
  `onConflictDoNothing`; on conflict, roll back the debit and return the existing
  row (no charge). After a concurrent exact-balance 402, re-check existence
  before returning the error.

**Gotcha:** `drizzle-kit push` needs a TTY and offers to truncate before adding a
unique constraint to a populated table; in this sandbox apply such constraints
with a direct `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` via psql after
confirming no duplicate rows exist.

**Gotcha:** re-running the seed reassigns serial IDs for packages AND users, so
any hardcoded id from a prior session (packageId, userId) will 404 — always
re-fetch ids from the API between seeds when testing.
