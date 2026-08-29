---
name: Group-event creation validation parity
description: Why every route that creates a group event must enforce the same input-safety contract.
---

Every route that creates a group event must enforce HTTP(S)-only online links, valid and ordered event dates, and valid RSVP windows that close strictly before the event starts. This includes combined Meetup creation, additional-event creation, and any legacy completion path.

**Why:** Hardening only the new combined flow left the retained legacy/additional-event route able to store unsafe meeting-link schemes and malformed dates.

**How to apply:** Whenever an event creation flow is added, reused, or redirected, compare its authoritative server validation with every other path that writes the same event model. Browser validation is supplemental, never sufficient.