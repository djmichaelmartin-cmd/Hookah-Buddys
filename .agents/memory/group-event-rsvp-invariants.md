---
name: Group-event RSVP invariants
description: Durable rules for capacity, waitlists, guests, and organizer-driven RSVP transitions.
---

Treat every RSVP mutation as a transition, including organizer actions and guest-count edits. Under one event-row lock, calculate party size as the member plus guests, repair counters and queue positions, and run FIFO promotion whenever seats are released.

When a going attendee is moved onto the waitlist, exclude that attendee from the immediate promotion pass so they cannot reclaim the seat they just released. Do not skip an oversized party at the head of the queue.

For projected global Events, a waitlisted viewer can still have `rsvped=false`; clients must treat the waitlist position as an active RSVP state and offer an explicit leave-waitlist action. Hidden attendee identities are organizer/group-moderator/platform-admin only—ordinary membership is never sufficient.

The projected Event RSVP toggle cancels only active attendance (`going` or `waitlisted`). An existing `interested`, `not_going`, or cancelled row must request `going` and let the locked capacity service decide going versus waitlisted.

When attendees are hidden, mask aggregate attendance totals as well as identities for unauthorized viewers. Clients must treat an explicit zero as authoritative rather than falling back to another count.

Event-level privacy is independent of parent Group privacy. A private event requires active membership (or creator/platform-admin authority) on every read and mutation; RSVP must re-read membership inside the event-lock transaction rather than trusting preflight state.

Member intent must never force `waitlisted`; normalize it through the locked going/capacity decision. Capacity-limit reductions must lock that same event row and reject limits below occupied party seats, including guests.

**Why:** Multiple reviews found that handling only new RSVPs correctly still allowed overbooking or stalled waitlists through existing-status transitions, guest changes, and organizer actions.

**How to apply:** Any new RSVP status, capacity rule, guest behavior, or attendance-management action must use the same lock-scoped transition service and test both seat-acquiring and seat-releasing paths.