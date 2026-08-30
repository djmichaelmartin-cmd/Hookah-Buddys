---
name: Orphaned artifact process groups
description: Diagnose artifact workflows that report port conflicts while older copies still serve the assigned ports.
---

When a managed artifact restart reports `EADDRINUSE`, verify the assigned ports and process groups before changing app code. A failed workflow record can coexist with an older healthy process tree still bound to the same port.

**Why:** Merge-triggered restarts have left old web and API process groups attached to the workflow supervisor. Replacement processes failed immediately even though direct health checks still returned 200.

**How to apply:** Inspect listeners, process group IDs, and direct HTTP responses. Stop only the stale artifact process groups, then restart the exact managed workflows once. If Vite subsequently reports invalid React hooks only in the old Preview, follow the stale Preview bootstrap procedure.