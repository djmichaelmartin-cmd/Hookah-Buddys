/**
 * Events routes — /events
 *
 * Global events feed includes two sources:
 *  1. Native events from the `events` table (positive integer IDs)
 *  2. Meetup group events projected from `group_events` (negative IDs = -groupEventId)
 *
 * Negative ID convention (collision-safe):
 *   projectedId = -groupEventId
 *   This ensures native IDs and projected IDs are disjoint sets.
 *
 * Projection rules for Meetup events:
 *   - Only events from groups where groupType = "meetup"
 *   - Only events with status = "active" and visibility = "public"
 *   - Private/hidden group events NEVER appear in the global feed
 *   - onlineUrl is NEVER exposed in the global feed (even if not protected)
 *   - sourceType: "meetup_event", sourceId: groupEventId, meetupId: groupId, meetupName: group.name
 *
 * ID parsing:
 *   Both positive and negative IDs are validated strictly. A non-integer or a
 *   string like "123abc" is rejected with 404 (parseInt("123abc") returns 123 but
 *   we re-verify the entire string to prevent suffix-injection).
 *
 * Query filters:
 *   city, state          — apply to both native and projected rows
 *   eventFormat          — projected rows only (native events have no format)
 *   eventCategory        — projected rows only
 *   topic                — projected rows only (matches any element in topics text[])
 *   sourceType           — "native" or "meetup" to restrict to one source
 *   priceType            — "free"|"paid" on projected rows only
 *   startsAfter          — applied to both sources
 *   startsBefore         — applied to both sources
 *
 * Topic filter (PostgreSQL text[] predicate):
 *   Uses the standard ANY() operator: topic = ANY(topics_column)
 *   NOT jsonb @> containment — topics is a text[] column, not jsonb.
 *
 * Paid event RSVP guard (shared service):
 *   Projected RSVPs delegate to executeGroupEventRsvp() with allowPublicRsvp=true.
 *   This enforces: suspended-user check, group lifecycle, RSVP window, block check,
 *   paid-event guard, capacity/waitlist, counter repair — same as the group route.
 *
 * Projected one-click RSVP toggle (POST /events/:negativeId/rsvp):
 *   The global feed exposes a single toggle button (no body/status input). A click
 *   CANCELS only when the viewer currently holds an ACTIVE attendance (rsvpStatus
 *   "going" or "waitlisted"). Any other existing row ("interested", "not_going",
 *   "cancelled", or any inactive status) is NOT active attendance, so a click
 *   requests "going" and the shared locked service resolves going-vs-waitlist by
 *   capacity. The response reflects the authoritative post-transaction state
 *   (rsvped/rsvpStatus/waitlisted/waitlistPosition/rsvpCount) — never a stale one.
 *
 * Attendee preview (hideAttendees):
 *   When hideAttendees=true on a projected event, attendee identities (preview +
 *   count) are exposed ONLY to viewers authorized like the Group attendee endpoint:
 *   the event organizer, a group owner/admin/moderator, or a platform admin.
 *   Anonymous viewers, non-members, AND ordinary active members all receive an
 *   empty preview and zero count. Only confirmed "going", non-private, non-blocked
 *   attendees are ever counted. Block guards are applied consistently.
 *
 * Existing native event IDs, endpoints, and behavior are unchanged.
 */

import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gt, ilike, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  eventRsvpsTable,
  eventSavesTable,
  usersTable,
  groupsTable,
  groupEventsTable,
  groupEventRsvpsTable,
  groupEventSavesTable,
  groupMembersTable,
  type Event,
} from "@workspace/db";
import { getSessionUser, requireAuth } from "../lib/auth";
import { loadAudienceSets } from "../lib/socialHelpers";
import { executeGroupEventRsvp } from "../lib/groupEventRsvpService";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Strict event ID parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a route param as a strict integer (no trailing non-numeric chars).
 * Returns NaN for malformed inputs like "123abc" or "".
 * Valid: "123", "-45"
 * Invalid: "123abc", "12.5", "", undefined
 */
function parseStrictInt(raw: string | undefined): number {
  if (!raw || !/^-?\d+$/.test(raw.trim())) return NaN;
  return parseInt(raw.trim(), 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Native event serializer
// ─────────────────────────────────────────────────────────────────────────────

type NativeEventResponse = {
  id: number;
  title: string;
  description: string | null;
  loungeId: number | null;
  venueName: string | null;
  city: string;
  state: string;
  startsAt: string;
  endsAt: string | null;
  imageUrl: string | null;
  status: "active" | "cancelled";
  rsvpCount: number;
  rsvped: boolean;
  saved: boolean;
  sourceType: string | null;
  sourceId: number | null;
  meetupId: number | null;
  meetupName: string | null;
  // Meetup-projected extra fields (all null for native events)
  eventFormat: string | null;
  eventCategory: string | null;
  topics: string[] | null;
  eventTags: string[] | null;
  isPaid: boolean | null;
  paidMetadata: Record<string, unknown> | null;
  attendeeLimit: number | null;
  waitlistEnabled: boolean | null;
  waitlistCount: number | null;
  viewerWaitlistPosition: number | null;
};

function eventToResponse(
  event: Event,
  rsvpCount: number,
  rsvped: boolean,
  saved: boolean,
): NativeEventResponse {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    loungeId: event.loungeId ?? null,
    venueName: event.venueName ?? null,
    city: event.city,
    state: event.state,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt ? event.endsAt.toISOString() : null,
    imageUrl: event.imageUrl ?? null,
    status: event.status === "cancelled" ? "cancelled" : "active",
    rsvpCount,
    rsvped,
    saved,
    // Native events carry no Meetup attribution
    sourceType: null,
    sourceId: null,
    meetupId: null,
    meetupName: null,
    // Meetup-projected extra fields are null for native events
    eventFormat: null,
    eventCategory: null,
    topics: null,
    eventTags: null,
    isPaid: null,
    paidMetadata: null,
    attendeeLimit: null,
    waitlistEnabled: null,
    waitlistCount: null,
    viewerWaitlistPosition: null,
  };
}

async function annotateEvents(events: Event[], viewerUserId: number | null) {
  const ids = events.map((e) => e.id);
  if (ids.length === 0) return [];
  const counts = await db
    .select({ eventId: eventRsvpsTable.eventId, n: count() })
    .from(eventRsvpsTable)
    .where(inArray(eventRsvpsTable.eventId, ids))
    .groupBy(eventRsvpsTable.eventId);
  const countMap = new Map(counts.map((c) => [c.eventId, Number(c.n)]));

  const rsvpedSet = new Set<number>();
  const savedSet = new Set<number>();
  if (viewerUserId !== null) {
    const [rsvps, saves] = await Promise.all([
      db
        .select({ eventId: eventRsvpsTable.eventId })
        .from(eventRsvpsTable)
        .where(
          and(
            inArray(eventRsvpsTable.eventId, ids),
            eq(eventRsvpsTable.userId, viewerUserId),
          ),
        ),
      db
        .select({ eventId: eventSavesTable.eventId })
        .from(eventSavesTable)
        .where(
          and(
            inArray(eventSavesTable.eventId, ids),
            eq(eventSavesTable.userId, viewerUserId),
          ),
        ),
    ]);
    for (const r of rsvps) rsvpedSet.add(r.eventId);
    for (const s of saves) savedSet.add(s.eventId);
  }

  return events.map((e) =>
    eventToResponse(e, countMap.get(e.id) ?? 0, rsvpedSet.has(e.id), savedSet.has(e.id)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Meetup event projection helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Projected ID for a Meetup group event: use negative to guarantee no collision
 * with native event IDs. projectedId = -groupEventId.
 */
function meetupProjectedId(groupEventId: number): number {
  return -groupEventId;
}

/** Extract the original groupEventId from a negative projected ID. */
function projectedIdToGroupEventId(projectedId: number): number {
  return -projectedId;
}

/** True when an event ID is a Meetup projection. */
function isMeetupProjectedId(id: number): boolean {
  return id < 0;
}

type MeetupEventRow = typeof groupEventsTable.$inferSelect & {
  groupName: string;
  meetupCity: string | null;
  meetupState: string | null;
};

/**
 * Serialize a Meetup group event into the global Event shape.
 * Uses the negative projected ID. City/state fall back to Meetup group metadata.
 * onlineUrl is NEVER exposed in the global feed regardless of onlineUrlProtected.
 *
 * NOTE: sourceType / sourceId / meetupId / meetupName belong on the GLOBAL Event
 * shape only — they are NOT emitted by the GroupEvent serializer in groups.ts,
 * which serves members who already know which group they're in.
 */
function meetupEventToResponse(
  e: MeetupEventRow,
  rsvped: boolean,
  saved: boolean,
  viewerWaitlistPosition: number | null = null,
): NativeEventResponse {
  return {
    id: meetupProjectedId(e.id),
    title: e.title,
    description: e.description ?? null,
    loungeId: null,
    venueName: e.venueName ?? null,
    city: e.city ?? e.meetupCity ?? "",
    state: e.state ?? e.meetupState ?? "",
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    imageUrl: e.imageUrl ?? null,
    status: e.status === "cancelled" ? "cancelled" : "active",
    rsvpCount: e.rsvpCount,
    rsvped,
    saved,
    sourceType: "meetup_event",
    sourceId: e.id,
    meetupId: e.groupId,
    meetupName: e.groupName,
    // Extra Meetup fields — never expose onlineUrl in public global feed
    eventFormat: e.eventFormat ?? null,
    eventCategory: e.eventCategory ?? null,
    topics: (e.topics as string[] | null) ?? null,
    eventTags: (e.eventTags as string[] | null) ?? null,
    isPaid: e.isPaid,
    paidMetadata: (e.paidMetadata as Record<string, unknown> | null) ?? null,
    attendeeLimit: e.attendeeLimit ?? null,
    waitlistEnabled: e.waitlistEnabled,
    waitlistCount: e.waitlistCount,
    viewerWaitlistPosition,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EventListFilters — parsed from query params
// ─────────────────────────────────────────────────────────────────────────────

type EventListFilters = {
  city?: string;
  state?: string;
  eventFormat?: string;
  eventCategory?: string;
  topic?: string;
  sourceType?: "native" | "meetup";
  priceType?: "free" | "paid";
  startsAfter?: Date;
  startsBefore?: Date;
};

function parseEventListFilters(query: Record<string, unknown>): EventListFilters {
  const filters: EventListFilters = {};
  if (typeof query.city === "string" && query.city.trim()) filters.city = query.city.trim();
  if (typeof query.state === "string" && query.state.trim())
    filters.state = query.state.trim().toUpperCase();
  if (
    typeof query.eventFormat === "string" &&
    ["in_person", "online", "hybrid"].includes(query.eventFormat)
  ) {
    filters.eventFormat = query.eventFormat;
  }
  if (typeof query.eventCategory === "string" && query.eventCategory.trim())
    filters.eventCategory = query.eventCategory.trim();
  if (typeof query.topic === "string" && query.topic.trim())
    filters.topic = query.topic.trim();
  if (query.sourceType === "native" || query.sourceType === "meetup")
    filters.sourceType = query.sourceType;
  if (query.priceType === "free" || query.priceType === "paid")
    filters.priceType = query.priceType;
  if (typeof query.startsAfter === "string") {
    const d = new Date(query.startsAfter);
    if (!isNaN(d.getTime())) filters.startsAfter = d;
  }
  if (typeof query.startsBefore === "string") {
    const d = new Date(query.startsBefore);
    if (!isNaN(d.getTime())) filters.startsBefore = d;
  }
  return filters;
}

/**
 * Apply city/state/time-range filters to already-serialized native event responses.
 * Meetup-specific filters (eventFormat, eventCategory, topic, priceType) cause
 * all native events to be excluded when applied.
 */
function applyNativeFilters(
  events: NativeEventResponse[],
  filters: EventListFilters,
): NativeEventResponse[] {
  // These filters only apply to meetup projections; if any are set, exclude natives
  if (filters.eventFormat || filters.eventCategory || filters.topic || filters.priceType) {
    return [];
  }
  return events.filter((e) => {
    if (filters.city && !e.city.toLowerCase().includes(filters.city.toLowerCase())) return false;
    if (filters.state && e.state.toUpperCase() !== filters.state) return false;
    if (filters.startsAfter && new Date(e.startsAt) <= filters.startsAfter) return false;
    if (filters.startsBefore && new Date(e.startsAt) >= filters.startsBefore) return false;
    return true;
  });
}

/**
 * Load projected public Meetup events for the global feed with optional filters.
 * Only public-visibility events from active public Meetup groups are returned.
 *
 * Topic filter uses PostgreSQL ANY() for text[] columns, not JSONB @> containment.
 */
async function loadMeetupProjections(
  scope: "upcoming" | "past",
  limit: number,
  offset: number,
  viewer: { id: number; role?: string | null } | null,
  filters: EventListFilters = {},
): Promise<NativeEventResponse[]> {
  const viewerUserId = viewer?.id ?? null;
  const now = new Date();

  // Build WHERE conditions for the group_events table
  const eventConditions: Parameters<typeof and> = [
    eq(groupEventsTable.status, "active"),
    eq(groupEventsTable.visibility, "public"),
  ];

  if (scope === "past") {
    eventConditions.push(lte(groupEventsTable.startsAt, now));
  } else {
    eventConditions.push(gt(groupEventsTable.startsAt, now));
  }

  // Optional filters at DB level
  if (filters.city) {
    eventConditions.push(
      or(
        ilike(groupEventsTable.city, `%${filters.city}%`),
        ilike(groupsTable.meetupCity, `%${filters.city}%`),
      )!,
    );
  }
  if (filters.state) {
    eventConditions.push(
      or(
        eq(groupEventsTable.state, filters.state),
        eq(groupsTable.meetupState, filters.state),
      )!,
    );
  }
  if (filters.eventFormat) {
    eventConditions.push(eq(groupEventsTable.eventFormat, filters.eventFormat));
  }
  if (filters.eventCategory) {
    eventConditions.push(eq(groupEventsTable.eventCategory, filters.eventCategory));
  }
  if (filters.topic) {
    // Correct PostgreSQL text[] membership test: topic = ANY(column)
    // topics is a text[] column, NOT jsonb — do NOT use @> containment.
    // Use a parameterized placeholder so the topic value is safely escaped.
    eventConditions.push(
      sql`${filters.topic} = ANY(${groupEventsTable.topics})`,
    );
  }
  if (filters.priceType === "free") {
    eventConditions.push(eq(groupEventsTable.isPaid, false));
  } else if (filters.priceType === "paid") {
    eventConditions.push(eq(groupEventsTable.isPaid, true));
  }
  if (filters.startsAfter) {
    eventConditions.push(gt(groupEventsTable.startsAt, filters.startsAfter));
  }
  if (filters.startsBefore) {
    eventConditions.push(lte(groupEventsTable.startsAt, filters.startsBefore));
  }

  const joinedRows = await db
    .select({
      event: groupEventsTable,
      group: {
        name: groupsTable.name,
        meetupCity: groupsTable.meetupCity,
        meetupState: groupsTable.meetupState,
      },
    })
    .from(groupEventsTable)
    .innerJoin(
      groupsTable,
      and(
        eq(groupEventsTable.groupId, groupsTable.id),
        eq(groupsTable.groupType, "meetup"),
        eq(groupsTable.status, "active"),
        eq(groupsTable.privacy, "public"), // public meetups only in global feed
      ),
    )
    .where(and(...eventConditions))
    .orderBy(
      scope === "past" ? desc(groupEventsTable.startsAt) : asc(groupEventsTable.startsAt),
      asc(groupEventsTable.id),
    )
    .limit(limit)
    .offset(offset);

  const rows: MeetupEventRow[] = joinedRows.map((r) => ({
    ...r.event,
    groupName: r.group.name,
    meetupCity: r.group.meetupCity,
    meetupState: r.group.meetupState,
  }));

  if (!rows.length) return [];

  const groupEventIds = rows.map((r) => r.id);
  const rsvpedSet = new Set<number>();
  const savedSet = new Set<number>();
  const waitlistPositionMap = new Map<number, number | null>();

  if (viewerUserId !== null) {
    const [rsvps, saves] = await Promise.all([
      db
        .select({
          eventId: groupEventRsvpsTable.eventId,
          rsvpStatus: groupEventRsvpsTable.rsvpStatus,
          waitlistPosition: groupEventRsvpsTable.waitlistPosition,
        })
        .from(groupEventRsvpsTable)
        .where(
          and(
            inArray(groupEventRsvpsTable.eventId, groupEventIds),
            eq(groupEventRsvpsTable.userId, viewerUserId),
          ),
        ),
      db
        .select({ eventId: groupEventSavesTable.eventId })
        .from(groupEventSavesTable)
        .where(
          and(
            inArray(groupEventSavesTable.eventId, groupEventIds),
            eq(groupEventSavesTable.userId, viewerUserId),
          ),
        ),
    ]);
    for (const r of rsvps) {
      if (r.rsvpStatus === "going") rsvpedSet.add(r.eventId);
      if (r.rsvpStatus === "waitlisted") {
        waitlistPositionMap.set(r.eventId, r.waitlistPosition ?? null);
      }
    }
    for (const s of saves) savedSet.add(s.eventId);
  }

  const responses = rows.map((e) =>
    meetupEventToResponse(
      e,
      rsvpedSet.has(e.id),
      savedSet.has(e.id),
      waitlistPositionMap.get(e.id) ?? null,
    ),
  );

  // Privacy: mask attendance-disclosing counts on hideAttendees events for any
  // viewer who is not privileged. Authorization is resolved in a single batched
  // membership query across all hidden events (no per-event N+1).
  const hiddenRefs: HiddenEventRef[] = rows
    .filter((e) => e.hideAttendees)
    .map((e) => ({
      groupEventId: e.id,
      groupId: e.groupId,
      createdByUserId: e.createdByUserId ?? null,
    }));

  if (hiddenRefs.length === 0) return responses;

  const allowed = await resolveHiddenViewerAccess(viewer, hiddenRefs);
  const hiddenIds = new Set(hiddenRefs.map((r) => r.groupEventId));

  return responses.map((resp) => {
    // resp.sourceId === group_events.id for meetup projections.
    const geId = resp.sourceId;
    if (geId !== null && hiddenIds.has(geId) && !allowed.has(geId)) {
      return maskHiddenCounts(resp);
    }
    return resp;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hidden-attendee authorization policy (shared by list + detail)
//
// For a projected Meetup event with hideAttendees=true, attendance-disclosing
// data — attendee identities AND aggregate counts (rsvpCount, attendeeCount,
// waitlistCount) — may be shown ONLY to a "privileged" viewer:
//   • a platform admin (users.role === "admin"), OR
//   • the event organizer (group_events.created_by_user_id), OR
//   • a group owner/admin/moderator (active membership with an elevated role).
//
// Everyone else — anonymous, non-members, AND ordinary active members — sees a
// masked event: empty attendee preview and zeroed counts. The viewer's OWN
// participation state (rsvped / waitlisted / viewerWaitlistPosition / saved) is
// always preserved regardless of masking.
//
// The role rule here is the SAME one enforced by the Group attendee-management
// endpoint; both the list and detail handlers resolve it through these helpers
// so there is a single source of truth and no divergence.
// ─────────────────────────────────────────────────────────────────────────────

const ELEVATED_GROUP_ROLES = ["owner", "admin", "moderator"] as const;

type HiddenEventRef = {
  /** group_events.id (the positive DB id, not the projected negative id). */
  groupEventId: number;
  groupId: number;
  createdByUserId: number | null;
};

/**
 * Resolve, in a BOUNDED number of queries (at most one), which of the given
 * hidden projected events the viewer is privileged to see attendance data for.
 *
 * Returns a Set of group_events.id values the viewer may see. Batches the group
 * membership lookup across every distinct group referenced by `hiddenRefs`, so
 * a feed page of N hidden events costs a single membership query — never N+1.
 */
async function resolveHiddenViewerAccess(
  viewer: { id: number; role?: string | null } | null,
  hiddenRefs: HiddenEventRef[],
): Promise<Set<number>> {
  const allowed = new Set<number>();
  if (hiddenRefs.length === 0) return allowed;

  // Anonymous viewers are never privileged for hidden events.
  if (!viewer) return allowed;

  // Platform admin sees everything.
  if (viewer.role === "admin") {
    for (const ref of hiddenRefs) allowed.add(ref.groupEventId);
    return allowed;
  }

  // Event organizer (creator) always sees their own event.
  const unresolved: HiddenEventRef[] = [];
  for (const ref of hiddenRefs) {
    if (ref.createdByUserId !== null && ref.createdByUserId === viewer.id) {
      allowed.add(ref.groupEventId);
    } else {
      unresolved.push(ref);
    }
  }
  if (unresolved.length === 0) return allowed;

  // Batched elevated-role membership lookup across all remaining groups.
  const groupIds = [...new Set(unresolved.map((r) => r.groupId))];
  const rows = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(
      and(
        inArray(groupMembersTable.groupId, groupIds),
        eq(groupMembersTable.userId, viewer.id),
        eq(groupMembersTable.status, "active"),
        inArray(groupMembersTable.role, [...ELEVATED_GROUP_ROLES]),
      ),
    );
  const elevatedGroupIds = new Set(rows.map((r) => r.groupId));
  for (const ref of unresolved) {
    if (elevatedGroupIds.has(ref.groupId)) allowed.add(ref.groupEventId);
  }
  return allowed;
}

/**
 * Zero out every attendance-disclosing count on a projected event response,
 * while preserving the viewer's own participation state. Used when the viewer
 * is not privileged to see a hidden event's attendance.
 */
function maskHiddenCounts(resp: NativeEventResponse): NativeEventResponse {
  return {
    ...resp,
    rsvpCount: 0,
    waitlistCount: resp.waitlistCount === null ? null : 0,
    // rsvped / saved / viewerWaitlistPosition are the viewer's OWN state → kept.
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Load a single Meetup projected event by negative ID
// ─────────────────────────────────────────────────────────────────────────────

async function loadMeetupProjectedEvent(
  projectedId: number,
  viewerUserId: number | null,
): Promise<NativeEventResponse | null> {
  const groupEventId = projectedIdToGroupEventId(projectedId);
  const [joined] = await db
    .select({
      event: groupEventsTable,
      group: {
        name: groupsTable.name,
        meetupCity: groupsTable.meetupCity,
        meetupState: groupsTable.meetupState,
      },
    })
    .from(groupEventsTable)
    .innerJoin(
      groupsTable,
      and(
        eq(groupEventsTable.groupId, groupsTable.id),
        eq(groupsTable.groupType, "meetup"),
        eq(groupsTable.status, "active"),
        // Public meetup groups only — private events never leak via global route
        eq(groupsTable.privacy, "public"),
      ),
    )
    .where(
      and(
        eq(groupEventsTable.id, groupEventId),
        eq(groupEventsTable.visibility, "public"),
        // Allow cancelled so reminder/cancel notification links resolve
        or(
          eq(groupEventsTable.status, "active"),
          eq(groupEventsTable.status, "cancelled"),
        )!,
      ),
    )
    .limit(1);

  if (!joined) return null;
  const row: MeetupEventRow = {
    ...joined.event,
    groupName: joined.group.name,
    meetupCity: joined.group.meetupCity,
    meetupState: joined.group.meetupState,
  };

  let rsvped = false;
  let saved = false;
  let viewerWaitlistPosition: number | null = null;

  if (viewerUserId !== null) {
    const [rsvp, save] = await Promise.all([
      db
        .select({
          id: groupEventRsvpsTable.id,
          rsvpStatus: groupEventRsvpsTable.rsvpStatus,
          waitlistPosition: groupEventRsvpsTable.waitlistPosition,
        })
        .from(groupEventRsvpsTable)
        .where(
          and(
            eq(groupEventRsvpsTable.eventId, groupEventId),
            eq(groupEventRsvpsTable.userId, viewerUserId),
          ),
        )
        .limit(1),
      db
        .select({ id: groupEventSavesTable.id })
        .from(groupEventSavesTable)
        .where(
          and(
            eq(groupEventSavesTable.eventId, groupEventId),
            eq(groupEventSavesTable.userId, viewerUserId),
          ),
        )
        .limit(1),
    ]);
    if (rsvp[0]) {
      rsvped = rsvp[0].rsvpStatus === "going";
      if (rsvp[0].rsvpStatus === "waitlisted") {
        viewerWaitlistPosition = rsvp[0].waitlistPosition ?? null;
      }
    }
    saved = !!save[0];
  }

  return meetupEventToResponse(row, rsvped, saved, viewerWaitlistPosition);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /events — upcoming/past active events (native + Meetup-projected), merged
// ─────────────────────────────────────────────────────────────────────────────
router.get("/events", async (req, res): Promise<void> => {
  const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : 10;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
    : 10;

  const rawOffset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;

  const filter = req.query.filter;
  const viewer = await getSessionUser(req);
  const filters = parseEventListFilters(req.query as Record<string, unknown>);

  // filter=going|saved: native events only (personal saved/going lists don't merge meetup projections)
  if (filter === "going" || filter === "saved") {
    if (!viewer) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const table = filter === "going" ? eventRsvpsTable : eventSavesTable;
    const rows = await db
      .select({ event: eventsTable })
      .from(table)
      .innerJoin(eventsTable, eq(table.eventId, eventsTable.id))
      .where(and(eq(table.userId, viewer.id), eq(eventsTable.status, "active")))
      .orderBy(asc(eventsTable.startsAt))
      .limit(limit)
      .offset(offset);
    const annotated = await annotateEvents(rows.map((r) => r.event), viewer.id);
    res.json(applyNativeFilters(annotated, filters));
    return;
  }

  const past = req.query.scope === "past";
  const scope = past ? "past" : ("upcoming" as const);
  const now = new Date();

  const includeNative = !filters.sourceType || filters.sourceType === "native";
  const includeMeetup = !filters.sourceType || filters.sourceType === "meetup";

  // ── Merged pagination across two independently-ordered sources ─────────────
  // The global feed interleaves native + Meetup rows by startsAt. Applying
  // offset/limit to EACH source independently and re-slicing skips interleaved
  // rows at page boundaries (e.g. offset=2 could drop a native row that sorts
  // between two Meetup rows already consumed by the Meetup source's own offset).
  //
  // Correct approach with an offset-based source API: fetch enough rows from
  // EACH source to cover the whole merged prefix — the first (offset + limit)
  // rows — by querying each source at offset 0 with limit (offset + limit).
  // Then merge, apply ONE deterministic global ordering, and slice the window
  // [offset, offset + limit]. A tie-breaker after startsAt (source, then id)
  // makes page boundaries stable across requests.
  const mergeFetchCount = offset + limit;

  // Meetup-only filters exclude native events entirely
  const hasMeetupOnlyFilter =
    !!filters.eventFormat || !!filters.eventCategory || !!filters.topic || !!filters.priceType;

  // Build native event conditions (city/state/time range only)
  const nativeConditions: Parameters<typeof and> = [
    eq(eventsTable.status, "active"),
    past ? lte(eventsTable.startsAt, now) : gt(eventsTable.startsAt, now),
  ];

  if (filters.city) nativeConditions.push(ilike(eventsTable.city, `%${filters.city}%`));
  if (filters.state) nativeConditions.push(eq(eventsTable.state, filters.state));
  if (filters.startsAfter) nativeConditions.push(gt(eventsTable.startsAt, filters.startsAfter));
  if (filters.startsBefore)
    nativeConditions.push(lte(eventsTable.startsAt, filters.startsBefore));

  const [nativeRows, meetupRows] = await Promise.all([
    includeNative && !hasMeetupOnlyFilter
      ? db
          .select()
          .from(eventsTable)
          .where(and(...nativeConditions))
          // Fetch the full merged prefix from offset 0; interleaving + the global
          // slice below produce the correct page. Secondary id order is a stable
          // tie-breaker for equal startsAt.
          .orderBy(
            past ? desc(eventsTable.startsAt) : asc(eventsTable.startsAt),
            asc(eventsTable.id),
          )
          .limit(mergeFetchCount)
          .offset(0)
      : Promise.resolve([] as Event[]),
    includeMeetup
      ? loadMeetupProjections(scope, mergeFetchCount, 0, viewer, filters)
      : Promise.resolve([] as NativeEventResponse[]),
  ]);

  const nativeAnnotated = await annotateEvents(nativeRows, viewer?.id ?? null);

  // Merge both sources under ONE deterministic global ordering:
  //   1. startsAt (asc for upcoming, desc for past)
  //   2. sourceType tie-breaker: native before meetup (native sourceType is null)
  //   3. id tie-breaker: ascending by absolute source id
  // then slice the requested window [offset, offset + limit].
  const sourceRank = (r: NativeEventResponse) => (r.sourceType === null ? 0 : 1);
  const combined = [...nativeAnnotated, ...meetupRows].sort((a, b) => {
    const aTime = new Date(a.startsAt).getTime();
    const bTime = new Date(b.startsAt).getTime();
    if (aTime !== bTime) return past ? bTime - aTime : aTime - bTime;
    // Deterministic tie-breakers so page boundaries are stable across requests.
    const rankDiff = sourceRank(a) - sourceRank(b);
    if (rankDiff !== 0) return rankDiff;
    return Math.abs(a.id) - Math.abs(b.id);
  });

  res.json(combined.slice(offset, offset + limit));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /events/:id — supports both native (positive) and projected (negative) IDs
// ─────────────────────────────────────────────────────────────────────────────

async function loadActiveEvent(id: number): Promise<Event | null> {
  if (!Number.isInteger(id)) return null;
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event || event.status !== "active") return null;
  return event;
}

const ATTENDEE_PREVIEW_LIMIT = 8;

/**
 * First 8 RSVP'd users for the avatar stack on the event page, plus the
 * eligibility-filtered total. Only active accounts; blocked-either-way users
 * excluded at query level.
 */
async function loadAttendeePreview(eventId: number, viewer: { id: number } | null) {
  const sets = await loadAudienceSets(viewer?.id ?? null);
  const blockedIds = [...sets.blockedEitherWay];
  const conditions = [
    eq(eventRsvpsTable.eventId, eventId),
    eq(usersTable.accountStatus, "active"),
  ];
  if (blockedIds.length > 0) {
    conditions.push(notInArray(usersTable.id, blockedIds));
  }
  const [rows, countResult] = await Promise.all([
    db
      .select({
        userId: usersTable.id,
        name: usersTable.name,
        username: usersTable.username,
        profilePhotoUrl: usersTable.profilePhotoUrl,
      })
      .from(eventRsvpsTable)
      .innerJoin(usersTable, eq(eventRsvpsTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(asc(eventRsvpsTable.createdAt))
      .limit(ATTENDEE_PREVIEW_LIMIT),
    db
      .select({ n: count() })
      .from(eventRsvpsTable)
      .innerJoin(usersTable, eq(eventRsvpsTable.userId, usersTable.id))
      .where(and(...conditions)),
  ]);
  const attendeeCount = countResult[0]?.n ?? 0;
  return {
    attendees: rows.map((r) => ({
      id: r.userId,
      name: r.username ?? r.name,
      profilePhotoUrl: r.profilePhotoUrl ?? null,
    })),
    attendeeCount: Number(attendeeCount),
  };
}

/**
 * Attendee preview for a Meetup projected event (group event RSVPs).
 *
 * Visibility rules:
 *   - hideAttendees=true → attendee IDENTITIES (preview + count) are exposed ONLY
 *     to viewers who satisfy the SAME authorization as the Group attendee-management
 *     endpoint (PATCH /groups/:groupId/events/:eventId/attendees/:userId):
 *       • the event organizer (group_events.created_by_user_id), OR
 *       • a group owner/admin/moderator (canModerateContent role), OR
 *       • a platform admin (users.role === "admin").
 *     Everyone else — anonymous, non-members, AND ordinary active group members —
 *     receives an empty preview and zero count. Ordinary membership does NOT grant
 *     access to hidden attendee identities.
 *   - hideAttendees=false → normal preview visibility (public).
 *   - Only "going" rsvpStatus rows count as confirmed attendees in the preview.
 *     (interested / waitlisted / not_going / cancelled are excluded)
 *   - isPrivate=true rows are excluded.
 *   - Block guard applied (blocked-either-way users never appear).
 */
async function loadMeetupAttendeePreview(
  groupEventId: number,
  event: { hideAttendees: boolean },
  viewer: { id: number } | null,
  viewerCanSeeHidden: boolean,
) {
  // hideAttendees: only organizer / group moderator+ / platform admin may see the
  // list. Every other viewer (including ordinary members) gets an empty response.
  if (event.hideAttendees && !viewerCanSeeHidden) {
    return { attendees: [], attendeeCount: 0 };
  }

  const sets = await loadAudienceSets(viewer?.id ?? null);
  const blockedIds = [...sets.blockedEitherWay];

  // Only confirmed "going" attendees appear in preview (not interested/waitlisted/etc.)
  const conditions = [
    eq(groupEventRsvpsTable.eventId, groupEventId),
    eq(usersTable.accountStatus, "active"),
    eq(groupEventRsvpsTable.isPrivate, false),
    eq(groupEventRsvpsTable.rsvpStatus, "going"),
  ];
  if (blockedIds.length > 0) {
    conditions.push(notInArray(usersTable.id, blockedIds));
  }
  const [rows, countResult] = await Promise.all([
    db
      .select({
        userId: usersTable.id,
        name: usersTable.name,
        username: usersTable.username,
        profilePhotoUrl: usersTable.profilePhotoUrl,
      })
      .from(groupEventRsvpsTable)
      .innerJoin(usersTable, eq(groupEventRsvpsTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(asc(groupEventRsvpsTable.createdAt))
      .limit(ATTENDEE_PREVIEW_LIMIT),
    db
      .select({ n: count() })
      .from(groupEventRsvpsTable)
      .innerJoin(usersTable, eq(groupEventRsvpsTable.userId, usersTable.id))
      .where(and(...conditions)),
  ]);
  const attendeeCount = countResult[0]?.n ?? 0;
  return {
    attendees: rows.map((r) => ({
      id: r.userId,
      name: r.username ?? r.name,
      profilePhotoUrl: r.profilePhotoUrl ?? null,
    })),
    attendeeCount: Number(attendeeCount),
  };
}

router.get("/events/:id", async (req, res): Promise<void> => {
  const id = parseStrictInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const viewer = await getSessionUser(req);

  // Negative IDs = Meetup projections
  if (isMeetupProjectedId(id)) {
    const projected = await loadMeetupProjectedEvent(id, viewer?.id ?? null);
    if (!projected) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const groupEventId = projectedIdToGroupEventId(id);

    // Load full event row to check hideAttendees + organizer identity.
    const [eventRow] = await db
      .select({
        hideAttendees: groupEventsTable.hideAttendees,
        groupId: groupEventsTable.groupId,
        createdByUserId: groupEventsTable.createdByUserId,
      })
      .from(groupEventsTable)
      .where(eq(groupEventsTable.id, groupEventId))
      .limit(1);

    // Authorization for HIDDEN attendance data (identities AND counts): resolved
    // through the SAME shared policy used by the global list feed. Access is
    // granted ONLY to the event organizer, a group owner/admin/moderator, or a
    // platform admin. Ordinary active membership is NOT sufficient. For a
    // non-hidden event no authorization query runs (the feed is public).
    const isHidden = eventRow?.hideAttendees ?? false;
    let viewerCanSeeHidden = false;
    if (isHidden && eventRow) {
      const allowed = await resolveHiddenViewerAccess(viewer, [
        {
          groupEventId,
          groupId: eventRow.groupId,
          createdByUserId: eventRow.createdByUserId ?? null,
        },
      ]);
      viewerCanSeeHidden = allowed.has(groupEventId);
    }

    const preview = await loadMeetupAttendeePreview(
      groupEventId,
      { hideAttendees: isHidden },
      viewer,
      viewerCanSeeHidden,
    );

    // Mask attendance-disclosing counts (rsvpCount, waitlistCount) for hidden
    // events when the viewer is not privileged. attendeeCount is already gated
    // by loadMeetupAttendeePreview. The viewer's own state (rsvped/waitlist/
    // saved) is preserved by maskHiddenCounts.
    const body = isHidden && !viewerCanSeeHidden ? maskHiddenCounts(projected) : projected;

    res.json({ ...body, attendees: preview.attendees, attendeeCount: preview.attendeeCount });
    return;
  }

  // Native events (positive IDs) — unchanged behavior
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [[annotated], preview] = await Promise.all([
    annotateEvents([event], viewer?.id ?? null),
    loadAttendeePreview(id, viewer),
  ]);
  res.json({
    ...annotated,
    attendees: preview.attendees,
    attendeeCount: preview.attendeeCount,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RSVP — supports both native and projected (negative) IDs
//
// Projected RSVP delegates to the centralized executeGroupEventRsvp() service
// with allowPublicRsvp=true. This enforces:
//   - suspended user check
//   - group lifecycle (suspended/hidden/deleted group → 403/404)
//   - RSVP window (cancellations bypass)
//   - block check against event creator
//   - paid-event guard (409 PAID_EVENT_CHECKOUT_UNAVAILABLE)
//   - capacity / waitlist under FOR UPDATE lock
//   - counter repair and waitlist promotion
// ─────────────────────────────────────────────────────────────────────────────
router.post("/events/:id/rsvp", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseStrictInt(req.params.id as string);

  if (isNaN(id)) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  // Meetup projected RSVP: delegate entirely to centralized service
  if (isMeetupProjectedId(id)) {
    const groupEventId = projectedIdToGroupEventId(id);

    // Load the group event to get groupId for the service
    const [ge] = await db
      .select({ groupId: groupEventsTable.groupId })
      .from(groupEventsTable)
      .where(
        and(
          eq(groupEventsTable.id, groupEventId),
          eq(groupEventsTable.status, "active"),
          eq(groupEventsTable.visibility, "public"),
        ),
      );
    if (!ge) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    // Verify it's from a public meetup group
    const [group] = await db
      .select({ id: groupsTable.id })
      .from(groupsTable)
      .where(
        and(
          eq(groupsTable.id, ge.groupId),
          eq(groupsTable.groupType, "meetup"),
          eq(groupsTable.status, "active"),
          eq(groupsTable.privacy, "public"),
        ),
      );
    if (!group) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    // The global projected RSVP is a one-click toggle. It has no body and no
    // rsvpStatus input — a click either JOINS (request "going") or CANCELS.
    //
    // Toggle direction is determined by whether the viewer currently holds an
    // ACTIVE ATTENDANCE. Only "going" and "waitlisted" count as active — those
    // are the states the one-click button visually represents as "you're in".
    // Any other existing status ("interested", "not_going", "cancelled", or any
    // future inactive state) is NOT an active attendance, so a click must
    // request "going" and let the shared locked service decide going-vs-waitlist
    // by capacity. Treating those inactive rows as "already RSVP'd" caused the
    // two-click bug (first click cancelled an interested row, second click went).
    const [existing] = await db
      .select({ id: groupEventRsvpsTable.id, rsvpStatus: groupEventRsvpsTable.rsvpStatus })
      .from(groupEventRsvpsTable)
      .where(
        and(
          eq(groupEventRsvpsTable.eventId, groupEventId),
          eq(groupEventRsvpsTable.userId, user.id),
        ),
      );

    const hasActiveAttendance =
      existing?.rsvpStatus === "going" || existing?.rsvpStatus === "waitlisted";
    const requestedStatus = hasActiveAttendance ? "not_going" : "going";

    const result = await executeGroupEventRsvp({
      user,
      groupId: ge.groupId,
      eventId: groupEventId,
      requestedStatus,
      guestCount: 0,
      isPrivate: false,
      allowPublicRsvp: true, // public event — bypass private-group membership requirement
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      });
      return;
    }

    // Re-read rsvpCount for the most accurate confirmed-count in the response.
    const [ev] = await db
      .select({ rsvpCount: groupEventsTable.rsvpCount })
      .from(groupEventsTable)
      .where(eq(groupEventsTable.id, groupEventId));

    // Report the authoritative post-transaction state from the shared service:
    // rsvped=true only when going; waitlist state/position surfaced explicitly.
    // No stale "existing" status is used to compute the response.
    res.json({
      rsvped: result.rsvpStatus === "going",
      rsvpStatus: result.rsvpStatus,
      waitlisted: result.waitlisted,
      waitlistPosition: result.waitlistPosition,
      rsvpCount: ev?.rsvpCount ?? result.rsvpCount,
    });
    return;
  }

  // Native event RSVP (unchanged toggle behavior)
  const event = await loadActiveEvent(id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(eventRsvpsTable)
    .where(and(eq(eventRsvpsTable.eventId, id), eq(eventRsvpsTable.userId, user.id)));
  let rsvped: boolean;
  if (existing) {
    await db.delete(eventRsvpsTable).where(eq(eventRsvpsTable.id, existing.id));
    rsvped = false;
  } else {
    await db
      .insert(eventRsvpsTable)
      .values({ eventId: id, userId: user.id })
      .onConflictDoNothing();
    rsvped = true;
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(eventRsvpsTable)
    .where(eq(eventRsvpsTable.eventId, id));
  res.json({ rsvped, rsvpCount: Number(n) });
});

// ─────────────────────────────────────────────────────────────────────────────
// Save — supports both native and projected (negative) IDs
// ─────────────────────────────────────────────────────────────────────────────
router.post("/events/:id/save", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseStrictInt(req.params.id as string);

  if (isNaN(id)) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  // Meetup projected save: use group_event_saves
  if (isMeetupProjectedId(id)) {
    const groupEventId = projectedIdToGroupEventId(id);
    const [ge] = await db
      .select({ id: groupEventsTable.id, groupId: groupEventsTable.groupId })
      .from(groupEventsTable)
      .innerJoin(
        groupsTable,
        and(
          eq(groupEventsTable.groupId, groupsTable.id),
          eq(groupsTable.groupType, "meetup"),
          eq(groupsTable.status, "active"),
          eq(groupsTable.privacy, "public"),
        ),
      )
      .where(
        and(
          eq(groupEventsTable.id, groupEventId),
          eq(groupEventsTable.visibility, "public"),
          eq(groupEventsTable.status, "active"),
        ),
      )
      .limit(1);

    if (!ge) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(groupEventSavesTable)
      .where(
        and(
          eq(groupEventSavesTable.eventId, groupEventId),
          eq(groupEventSavesTable.userId, user.id),
        ),
      );

    let saved: boolean;
    if (existing) {
      await db.delete(groupEventSavesTable).where(eq(groupEventSavesTable.id, existing.id));
      saved = false;
    } else {
      await db
        .insert(groupEventSavesTable)
        .values({ eventId: groupEventId, groupId: ge.groupId, userId: user.id })
        .onConflictDoNothing();
      saved = true;
    }
    res.json({ saved });
    return;
  }

  // Native save (unchanged)
  const event = await loadActiveEvent(id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(eventSavesTable)
    .where(and(eq(eventSavesTable.eventId, id), eq(eventSavesTable.userId, user.id)));
  let saved: boolean;
  if (existing) {
    await db.delete(eventSavesTable).where(eq(eventSavesTable.id, existing.id));
    saved = false;
  } else {
    await db
      .insert(eventSavesTable)
      .values({ eventId: id, userId: user.id })
      .onConflictDoNothing();
    saved = true;
  }
  res.json({ saved });
});

export { annotateEvents };
export default router;
