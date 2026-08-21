---
name: Meetup attendee broadcasts
description: Why organizer-to-attendee event updates use notifications instead of direct-message threads.
---

Organizer broadcasts to confirmed Meetup attendees should use the in-app notification inbox, not direct-message threads.

**Why:** Direct-message threads model one Buddy-to-member relationship and require a Buddy participant. Reusing them for organizer broadcasts would create invalid conversation ownership and sender-role semantics.

**How to apply:** Keep one notification per eligible attendee, retain Meetup/event context for navigation, and use direct-message threads only for their existing Buddy/member conversation model.