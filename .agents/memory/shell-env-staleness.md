---
name: Shell env staleness vs restarted workflows
description: Why the agent bash shell can read stale secret values and give false credential-validation results
---

# Shell env can go stale after a secret update

After a secret/env var is updated, the agent's `bash` tool shell does **not** reliably
pick up the new value. A freshly **restarted workflow** does (it re-reads secrets at
process spawn). So bash and the running server can disagree on the same env var.

**Symptom seen:** validating Twilio creds with `curl` from bash kept returning 401 even
after the user entered new values; a freshness probe (`server token iss` == `$VAR` in bash)
flipped from MATCH to MISMATCH mid-session, proving bash had gone stale.

**Why:** the bash tool inherits env from a long-lived parent process captured before the
secret change; child shells don't refresh. `code_execution` sandbox can't read
`process.env` at all (it's undefined there).

**How to apply:** to validate secret-dependent behavior, do it from the **restarted
workflow process**, not the agent shell. A reliable pattern: add a temporary startup
self-check in the server (e.g. `index.ts` after `app.listen`) that reads `process.env`,
performs the check (a real provider REST call, not just token minting), and logs only
status + value lengths/prefixes (never the secret). Restart, read logs, then remove it.
To confirm whether bash is fresh, compare a value bash sees against the same value the
restarted server emits (e.g. the API Key SID embedded as `iss` in a freshly minted token).
