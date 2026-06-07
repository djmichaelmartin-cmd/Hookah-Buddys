---
name: post-merge schema push must be non-interactive
description: Why scripts/post-merge.sh must use drizzle push-force, not plain push
---

The post-merge setup script (`scripts/post-merge.sh`) runs with stdin closed
(`/dev/null`). Plain `drizzle-kit push` is INTERACTIVE: certain schema changes
(e.g. adding a `notNull` column to a table that already has rows, column type
narrowing, drops) trigger a confirmation prompt. With stdin closed that prompt
gets EOF and the change fails to apply — so the change silently never lands in
the main/production DB even though merge "succeeds".

**Rule:** post-merge DB sync must use `pnpm --filter db push-force` (the
non-interactive variant). The `db` package exposes both `push` and `push-force`
scripts; post-merge must use `push-force`.

**Why:** a Memberships/Plans 500 came from `plans.monthly_credits` being defined
in the Drizzle schema but missing from the live DB — the schema was correct, but
interactive `push` in post-merge never applied it. Switching to `push-force`
makes schema drift self-heal on every merge.

**How to apply:** any time you touch `scripts/post-merge.sh` or debug "column
does not exist" / 500s on a deployed/merged app while the dev schema looks
correct, confirm post-merge uses `push-force`, not `push`.
