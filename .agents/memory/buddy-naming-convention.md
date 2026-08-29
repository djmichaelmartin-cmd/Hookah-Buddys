---
name: Buddy naming convention
description: Public branding terminology and the intentional boundary around legacy internal identifiers.
---

All user-facing copy must use **Buddy/Buddys** and **HookahBuddys**. Keep the established internal `doll`/`dolls` role values, database/schema names, API fields, endpoint paths, generated hook names, and code identifiers unchanged.

Buddy Type is a separate personal-profile choice, never an account role or legal-gender substitute. Its internal values may distinguish the pink and blue variants, but the public pill text is always exactly **Buddy**. Nullable values exist only so legacy personal accounts can retain read access while being prompted to complete their profile.

**Why:** The product was publicly rebranded, but renaming the internal contract would create unnecessary database and API migrations and could break existing clients and links. Keeping Buddy Type orthogonal avoids changing roles, memberships, credits, and entitlements.

**How to apply:** For new UI labels, notifications, emails, validation errors, plan copy, policies, and metadata, use Buddy terminology. Translate internal `doll` values at the presentation boundary rather than exposing or renaming them. Reuse the shared Buddy pill and enforce completed Buddy Type only on personal-account creation flows, not read access or entity forms.