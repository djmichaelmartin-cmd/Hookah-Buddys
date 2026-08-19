---
name: Buddy naming convention
description: Public branding terminology and the intentional boundary around legacy internal identifiers.
---

All user-facing copy must use **Buddy/Buddies** and **HookahBuddys**. Keep the established internal `doll`/`dolls` role values, database/schema names, API fields, endpoint paths, generated hook names, and code identifiers unchanged.

**Why:** The product was publicly rebranded, but renaming the internal contract would create unnecessary database and API migrations and could break existing clients and links.

**How to apply:** For new UI labels, notifications, emails, validation errors, plan copy, policies, and metadata, use Buddy terminology. Translate internal `doll` values at the presentation boundary rather than exposing or renaming them.