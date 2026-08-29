---
name: Stale Preview bootstrap
description: Recover a Replit Preview iframe that stays blank even though Vite reconnects and clean screenshots render.
---

When Preview is white or shows an old React startup error, a workflow restart may reconnect the old document without loading the current app entry module. First compare it with a fresh browser context through the artifact proxy. If the fresh context works, make an HTML entry change while Vite is already running so it broadcasts a full-page reload; restarting after the change can miss that broadcast.

**Why:** Stale iframes have remained white or kept reporting an invalid React hook call across workflow restarts while fresh proxied browser contexts rendered normally. A live `index.html` change produced Vite's page-reload event and the app immediately resumed its startup API requests.

**How to apply:** Prove the root HTML and entry module return 200 in a fresh browser through the artifact proxy, not the raw Vite port. After dependency-changing merges, clear Vite's generated optimizer cache before restart. If only the existing Preview remains broken, force a live HTML reload and verify startup API traffic resumes.