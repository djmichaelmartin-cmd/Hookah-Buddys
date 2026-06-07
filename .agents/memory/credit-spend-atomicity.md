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
- Tiered pricing must be driven by durable, authoritative metadata (a `tier`
  column), not inferred from a loose `type` string. Binary type inference silently
  undercharges when the spec has >2 tiers; reviewers treat an advertised-but-
  unenforced tier as a blocking gap, not an optional follow-up.
- Paywall/premium status must be derived server-side from the authoritative media
  *type*, never from a client-supplied `premium` boolean. A forged
  `premium: false` on a premium type would otherwise store the item as free and
  bypass the paywall. Enforce both the create-path persistence AND the DB layer:
  mirror tier-validity and premium↔tier consistency CHECK constraints in the
  Drizzle schema (not just applied via psql) so non-API writes and future
  regressions can't violate them. Only expose tier/unlockCost in responses for
  premium items so non-premium media never shows a misleading unlock cost.

**Gotcha:** `drizzle-kit push` needs a TTY and offers to truncate before adding a
unique constraint to a populated table; in this sandbox apply such constraints
with a direct `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` via psql after
confirming no duplicate rows exist.

**Gotcha:** re-running the seed reassigns serial IDs for packages AND users, so
any hardcoded id from a prior session (packageId, userId) will 404 — always
re-fetch ids from the API between seeds when testing.
