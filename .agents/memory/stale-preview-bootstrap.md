---
name: Stale Preview bootstrap
description: Recover a Replit Preview iframe that stays blank even though Vite reconnects and clean screenshots render.
---

When Preview is white but its console shows only Vite connecting—without React startup or runtime errors—a workflow restart may reconnect the old document without loading the app entry module. Make an HTML entry change while Vite is already running so it broadcasts a full-page reload; restarting after the change can miss that broadcast.

**Why:** A stale iframe remained white across workflow restarts while fresh app screenshots rendered normally. A live `index.html` change produced Vite's page-reload event and the app immediately resumed its startup API requests.

**How to apply:** First prove the root HTML and entry module return 200 and a fresh screenshot renders. If the affected session still has only Vite logs, force a live HTML reload and verify startup API traffic resumes.