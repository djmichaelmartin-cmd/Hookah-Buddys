---
name: API server has no hot-reload
description: New/changed Express routes don't take effect until the api-server workflow is restarted.
---

The `@workspace/api-server` dev script is `build && start` (esbuild bundle, then run) — there is no file watcher. After adding or changing a route, the running server keeps serving the old bundle, so a brand-new endpoint returns `Cannot GET /api/...` until you restart it.

**Why:** dev = one-shot build+start, not `tsx watch`/nodemon. Editing files alone does nothing.

**How to apply:** After any api-server source change, `restart_workflow "artifacts/api-server: API Server"` before cur/UI testing. The web (Vite) app does hot-reload and needs no restart.
