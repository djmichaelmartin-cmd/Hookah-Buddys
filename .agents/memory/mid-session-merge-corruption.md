---
name: Mid-session merge corruption
description: Parallel task merges can land mid-session and mangle files you already fixed
---
When parallel tasks merge mid-session, hot files can end up with interleaved/duplicated blocks that still look plausible. In isolated task workspaces, a task may be marked merged before its source is reachable from the current checkout.

**Why:** Automatic rebases onto main have repeatedly left shared route files with handler bodies missing route declarations and variables used before definition. Isolated task branches can also lag task-status updates, so fabricating unavailable sibling changes creates worse conflicts.

**How to apply:** After a merge notification, re-read and re-typecheck touched files. Compare against the actual reachable HEAD; preserve reachable sibling work, but do not recreate task changes that are absent from every local ref.
