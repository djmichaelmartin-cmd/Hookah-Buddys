---
name: Optional-session entitlements
description: Public routes with personalized entitlements must load and status-gate optional sessions
---

# Optional-session entitlements

Public routes that personalize paid visibility must explicitly load the optional
session user, then treat banned or suspended accounts as unauthenticated.

**Why:** reading a request-local user populated only by required-auth middleware
makes a signed-in buyer look anonymous, so permanent unlocks disappear. Loading
the raw session without the normal account-status gate creates the opposite
security bug: suspended accounts can keep streaming paid private media.

**How to apply:** use a shared optional-session helper on public list, detail,
availability, and media-stream routes. It should return only active session users.
Anonymous access may still receive genuinely public/free content, but paid
entitlements, owner bypasses, and admin bypasses require the active viewer.
Apply bidirectional block checks before both entitlement metadata and byte
streaming; a previously purchased unlock must not outlive a later block.