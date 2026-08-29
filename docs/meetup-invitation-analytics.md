# Meetup invitation analytics funnel

Project Analytics measures the aggregate Meetup invitation funnel with these
privacy-safe browser events:

| Funnel step | Event name | When it fires | Dimensions |
| --- | --- | --- | --- |
| Publish | `meetup_published` | A Meetup publish succeeds | `invite_count`, `has_invites`, `privacy`, `event_format`, `published_from_draft`, `business_hosted` |
| Accept | `meetup_invite_accepted` | A Meetup invitation acceptance succeeds | `source` |
| RSVP | `meetup_invited_member_rsvp` | A member with an accepted Meetup invite successfully updates an RSVP | `rsvp_status`, `waitlisted`, `event_format`, `has_guests` |

Use `meetup_published` filtered to `has_invites = true` as the funnel entry.
Compare its aggregate invite count with accepted-invite events, then compare
accepted-invite events with invited-member RSVP outcomes. The RSVP status
dimension separates going, interested, cancellation, and automatic waitlist
outcomes.

No analytics event includes user, Meetup, event, invite, location, or
free-form-content identifiers. Tracking is best-effort: the shared wrapper is a
safe no-op when Project Analytics is unavailable and catches tracker failures.