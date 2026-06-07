---
name: lead-collector design & ops
description: Decisions and operational gotchas for the Google Places lead-collection feature (@workspace/lead-collector + admin leads endpoints).
---

# Lead collector (Google Places) — decisions & ops

## Running a collection (operational)
- A full market run (e.g. Las Vegas = ~110 queries) takes ~4-5 minutes. The bash tool times out at 120s, so the foreground script (`pnpm --filter @workspace/scripts run collect-leads`) gets killed mid-run.
- **Preferred:** trigger via the background API endpoint `POST /api/admin/leads/collect` (runs inside the long-lived server process), then poll `GET /api/admin/leads/collect` until `running:false`. Polling loops in bash also hit the 120s cap — just re-issue the poll; the run keeps going server-side.
- Collection status is **process-local in-memory** (a module variable). Acceptable for single-process deploy; not durable across restarts/replicas. If multi-instance is ever needed, move the run lock/status to a DB row.

## Classification decisions
- **Hookah-signal gating:** a lead is only auto-promoted to `confirmed`/`likely` when it has an explicit hookah signal (`hookah_bar` type OR name matches /hookah|shisha|narghile|nargila|sheesha/). Generic bars/nightclubs/smoke_shops returned by hookah searches are kept but capped at `needs_manual`.
- **Why:** brand rule is hookah-only; without this, a well-reviewed generic bar (contact+rating points alone ≈ 40-45) would falsely score as `likely`. Keep them for manual review rather than rejecting (Google often doesn't tag real hookah lounges with `hookah_bar`).
- **How to apply:** see `hasHookahSignal()` in `lib/lead-collector/src/classify.ts`; `deriveValidationStatus` returns `needs_manual` when it's false.

## CSV export security
- The CSV export (`/api/admin/leads/export.csv`) must neutralize formula injection: any cell starting with `= + - @` or a leading tab/CR is prefixed with an apostrophe before quote-escaping. Data comes from external Google Places results, so this is required, not optional.
- **How to apply:** `csvCell()` in `artifacts/api-server/src/routes/leads.ts`.
