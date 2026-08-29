# Meetup publish-to-RSVP analytics

The Meetup funnel uses privacy-safe custom events with one shared `host_type`
dimension. Its only values are `member` and `business`; no names, handles, user
IDs, Meetup IDs, Business IDs, or free-form content are sent.

| Description | Event name |
| --- | --- |
| A new Meetup and its first event were successfully published | `meetup_published` |
| A future event was successfully published for an existing Meetup | `meetup_event_published` |
| A member successfully changed their RSVP to going on a Meetup event | `meetup_rsvp_completed` |

## Funnel

Compare `meetup_published` plus `meetup_event_published` against
`meetup_rsvp_completed`, grouped by `host_type`. This shows whether organizers
publish with a member or Business host and whether Business-hosted Meetup events
produce more confirmed going RSVPs.

Waitlist joins, interested responses, cancellations, failed requests, and draft
saves are excluded because they are not successful turnout commitments or
published events.