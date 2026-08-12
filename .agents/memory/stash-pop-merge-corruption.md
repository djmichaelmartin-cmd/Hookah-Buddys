---
name: Stash pop over upstream merge corruption
description: git stash pop after an upstream task auto-merge can silently mangle files
---
Rule: after `git stash pop` (or any stash round-trip) in a task branch where upstream task merges can land mid-session, re-read or typecheck the touched files — the pop can interleave hunks and produce syntactically broken code without reporting a conflict.

**Why:** A stash pop over an auto-merged upstream change once mangled a route file (handler bodies detached from registrations, declarations moved past exports) with no error shown; the breakage only surfaced at completion review.

**How to apply:** Prefer avoiding stash entirely for quick "is this error preexisting?" checks (use `git show <rev>:<file>` or a worktree). If you do stash, run the affected package's typecheck immediately after popping.
