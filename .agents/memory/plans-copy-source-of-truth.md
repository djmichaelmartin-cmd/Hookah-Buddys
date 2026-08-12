---
name: Plans copy source of truth
description: Plan name/description/features are DB-owned and admin-edited; startup sync must not overwrite them.
---

Plan copy (name, description, features) is edited live via the admin Plans UI and stored in the database as the source of truth.

**Why:** The startup plan sync used to overwrite these fields on every boot, which would silently revert admin edits on each deploy. It was changed to sync only structural fields (tier, slug, monthlyCredits, highlighted) for existing rows; copy in the canonical code definitions only applies on first insert.

**How to apply:** Never re-add copy fields to the startup sync's UPDATE path. To change plan wording, use the admin UI (or SQL), not code edits — code copy changes will not take effect for existing rows.
