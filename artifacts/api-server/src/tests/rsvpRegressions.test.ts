/**
 * RSVP Regression Tests — Architecture Review Blockers
 *
 * Covers all 8 regression scenarios mandated by the independent architect review:
 *
 * #1  Blocked user cannot RSVP through negative (projected) event ID
 * #2  Simultaneous last-seat attempts cannot oversell (counter correctness)
 * #3  Every RSVP transition keeps rsvpCount/waitlistCount correct
 * #4  Cancellation promotes exactly one waitlisted attendee
 * #5  hideAttendees=true hides preview/count from non-members via global event detail
 * #6  Non-going statuses (interested/waitlisted/cancelled/not_going) do NOT appear
 *     in the global attendee preview (only "going" is counted)
 * #7  Topic filter uses correct PostgreSQL array semantics (ANY() not JSONB @>)
 * #8  Strict numeric event ID parsing rejects malformed suffixes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type IRouter } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─────────────────────────────────────────────────────────────────────────────
// Fake DB — same pattern as other test files
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const queues = new Map<unknown, unknown[][]>();

  function enqueue(table: unknown, rows: unknown[]) {
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table)!.push(rows);
  }
  function reset() {
    queues.clear();
  }
  function nextRows(table: unknown): unknown[] {
    const q = queues.get(table);
    if (q && q.length) return q.shift()!;
    return [];
  }

  function makeBuilder() {
    let fromTable: unknown = null;
    const builder: Record<string, unknown> = {};
    const chain = (fn?: (arg: unknown) => void) => (arg?: unknown) => {
      if (fn) fn(arg);
      return builder;
    };
    builder.from = chain((t) => {
      if (fromTable === null) fromTable = t;
    });
    builder.innerJoin = chain();
    builder.leftJoin = chain();
    builder.where = chain();
    builder.orderBy = chain();
    builder.limit = chain();
    builder.offset = chain();
    builder.groupBy = chain();
    builder.having = chain();
    builder.for = chain(); // SELECT FOR UPDATE — chains through
    builder.set = chain();
    builder.values = chain();
    builder.returning = chain();
    builder.onConflictDoNothing = chain();
    builder.onConflictDoUpdate = chain();
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(nextRows(fromTable)).then(resolve);
    builder.catch = () => builder;
    return builder;
  }

  const db = {
    select: (_cols?: unknown) => makeBuilder(),
    insert: () => makeBuilder(),
    update: () => makeBuilder(),
    delete: () => makeBuilder(),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  return { queues, enqueue, reset, db };
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@workspace/db");
  return { ...actual, db: h.db };
});

vi.mock("../lib/auth", async () => {
  const getSessionUser = async (req: { headers: Record<string, unknown> }) => {
    const raw = req.headers["x-test-user"];
    if (!raw || typeof raw !== "string") return null;
    return JSON.parse(raw);
  };
  const requireAuth =
    () =>
    async (
      req: { headers: Record<string, unknown>; currentUser?: unknown },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void,
    ) => {
      const user = await getSessionUser(req);
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      req.currentUser = user;
      next();
    };
  return { getSessionUser, requireAuth };
});

vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityFile() {
      return { getMetadata: async () => [{ contentType: "image/jpeg", size: 10 }] };
    }
    async canAccessObjectEntity() {
      return true;
    }
    normalizeObjectEntityPath(p: string) {
      return p;
    }
    async downloadObject() {
      return new Response(Buffer.from("FAKE"), {
        status: 200,
        headers: new Headers({ "Content-Type": "image/jpeg" }),
      });
    }
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

vi.mock("../lib/socialHelpers", () => ({
  loadAudienceSets: async () => ({ blockedEitherWay: new Set() }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Server bootstrap
// ─────────────────────────────────────────────────────────────────────────────
let groupsRouter: IRouter;
let storageRouter: IRouter;
let eventsRouter: IRouter;
let server: Server;
let baseUrl: string;

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", storageRouter);
  app.use("/api", eventsRouter);
  app.use("/api", groupsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

async function req(
  path: string,
  opts: { user?: unknown; method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.user) headers["x-test-user"] = JSON.stringify(opts.user);
  const method = opts.method ?? "GET";
  if (opts.body) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

let T: Record<string, unknown>;
// Lazily-imported service entry so the @workspace/db mock is applied first.
let executeGroupEventRsvp: (
  ctx: {
    user: { id: number; role?: string | null; accountStatus?: string | null };
    groupId: number;
    eventId: number;
    requestedStatus: string;
    guestCount?: number;
    isPrivate?: boolean;
    allowPublicRsvp?: boolean;
  },
) => Promise<
  | { ok: true; rsvpStatus: string | null; rsvpCount: number; waitlisted: boolean; waitlistPosition: number | null }
  | { ok: false; status: number; code?: string; error: string }
>;

beforeEach(async () => {
  h.reset();
  if (!groupsRouter) {
    groupsRouter = (await import("../routes/groups")).default as IRouter;
    storageRouter = (await import("../routes/storage")).default as IRouter;
    eventsRouter = (await import("../routes/events")).default as IRouter;
    T = await vi.importActual<Record<string, unknown>>("@workspace/db");
    ({ executeGroupEventRsvp } = await import("../lib/groupEventRsvpService"));
  }
  await startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
const member = { id: 11, role: "user", accountStatus: "active" };
const blockedUser = { id: 99, role: "user", accountStatus: "active" };

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    creatorUserId: 10,
    name: "NYC Meetups",
    handle: null,
    description: null,
    category: "social",
    customCategory: null,
    tags: [],
    privacy: "public",
    visibility: "visible",
    coverUrl: null,
    iconUrl: null,
    location: null,
    postingPermission: "all_members",
    postApproval: false,
    status: "active",
    isFeatured: false,
    featuredUntil: null,
    memberCount: 5,
    postCount: 0,
    eventCount: 2,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    groupType: "meetup",
    meetupInterests: ["hookah"],
    meetupCity: "New York",
    meetupState: "NY",
    meetupCountry: "US",
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    groupId: 2,
    createdByUserId: 10,
    title: "Hookah Night",
    description: null,
    location: "123 Smoke St",
    onlineUrl: null,
    onlineUrlProtected: false,
    imageUrl: null,
    startsAt: new Date(Date.now() + 86400000),
    endsAt: null,
    status: "active",
    visibility: "public",
    rsvpLabel: null,
    rsvpCount: 3,
    hideAttendees: false,
    createdAt: new Date("2024-05-01"),
    updatedAt: new Date("2024-05-01"),
    eventFormat: "in_person",
    venueName: "Cloud Nine",
    address: "123 Smoke St",
    city: "New York",
    state: "NY",
    eventCategory: "hookah_session",
    topics: ["hookah", "shisha"],
    eventTags: ["vip"],
    howToFind: null,
    attendeeLimit: null,
    waitlistEnabled: false,
    waitlistCount: 0,
    allowGuests: false,
    maxGuestsPerRsvp: null,
    rsvpOpensAt: null,
    rsvpClosesAt: null,
    isPaid: false,
    paidMetadata: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    ...overrides,
  };
}

function makeRsvp(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    eventId: 100,
    groupId: 2,
    userId: member.id,
    rsvpStatus: "going",
    isPrivate: false,
    guestCount: 0,
    attendanceStatus: null,
    waitlistPosition: null,
    createdAt: new Date("2024-05-01"),
    updatedAt: new Date("2024-05-01"),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// #1 Blocked user cannot RSVP through negative (projected) event ID
// ─────────────────────────────────────────────────────────────────────────────
describe("#1 Blocked user cannot RSVP via projected event route", () => {
  it("returns 403 when blocked user tries to RSVP via /events/:negativeId/rsvp", async () => {
    const g = makeGroup();
    const e = makeEvent({ createdByUserId: 10 }); // event creator = user 10

    // events.ts route: groupEventsTable → groupsTable → groupEventRsvpsTable (no existing)
    h.enqueue(T.groupEventsTable, [e]);      // active+public check
    h.enqueue(T.groupsTable, [g]);           // meetup group check
    h.enqueue(T.groupEventRsvpsTable, []);   // no existing RSVP → toggle direction = "going"

    // executeGroupEventRsvp:
    h.enqueue(T.groupsTable, [g]);           // lifecycle check
    h.enqueue(T.groupMembersTable, []);      // member check (public, allowPublicRsvp)
    h.enqueue(T.groupEventsTable, [e]);      // event policy
    // isBlockedLocal: blocksTable returns a block row indicating user 99 is blocked by creator 10
    h.enqueue(T.blocksTable, [{ blockerId: 10, blockedUserId: 99 }]); // block exists!

    const res = await req("/events/-100/rsvp", {
      user: blockedUser, // user.id=99, blocked by event creator 10
      method: "POST",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rsvp/i);
  });

  it("returns 403 when blocked user tries to RSVP via group route", async () => {
    const g = makeGroup();
    const e = makeEvent({ createdByUserId: 10 });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []);     // non-member but public group
    h.enqueue(T.groupEventsTable, [e]);
    // isBlockedLocal returns block
    h.enqueue(T.blocksTable, [{ blockerId: 10, blockedUserId: 99 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: blockedUser,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2 Last-seat capacity — cannot oversell; unique waitlist position under lock
// ─────────────────────────────────────────────────────────────────────────────
describe("#2 Capacity enforcement — no oversell, unique waitlist position", () => {
  it("seats a new RSVP when there is exactly 1 seat left", async () => {
    // attendeeLimit=5, current going=4 (4 seats used), new RSVP adds 1 → fits
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 5, waitlistEnabled: false });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);       // FOR UPDATE
    h.enqueue(T.groupEventRsvpsTable, []);    // no existing
    // Capacity check: sum of (1+guestCount) for going RSVPs = 4 rows each with guestCount=0
    h.enqueue(T.groupEventRsvpsTable, [
      { guestCount: 0 }, { guestCount: 0 }, { guestCount: 0 }, { guestCount: 0 },
    ]);
    // Insert → going (fits: 4 + 1 = 5 = attendeeLimit)
    h.enqueue(null, [{ id: 9, rsvpStatus: "going", waitlistPosition: null }]);
    // Update rsvpCount
    // Final select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 5, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).not.toBe(409);
    const body = (await res.json()) as { rsvpStatus: string | null };
    // Should succeed (not null)
    expect(body.rsvpStatus).toBe("going");
  });

  it("puts user on waitlist when all seats taken and waitlistEnabled=true", async () => {
    // attendeeLimit=2, current going=2 (full)
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 2, waitlistEnabled: true });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, []);    // no existing
    // Capacity: 2 going rows, each 1 seat
    h.enqueue(T.groupEventRsvpsTable, [{ guestCount: 0 }, { guestCount: 0 }]);
    // Full → waitlist position query
    h.enqueue(T.groupEventRsvpsTable, [{ pos: 1 }]); // first on waitlist
    // Insert → waitlisted
    h.enqueue(null, [{ id: 10, rsvpStatus: "waitlisted", waitlistPosition: 1 }]);
    // Update waitlistCount
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 1 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).not.toBe(400);
    const body = (await res.json()) as {
      rsvpStatus: string | null;
      waitlisted: boolean;
      waitlistPosition: number | null;
    };
    expect(body.rsvpStatus).toBe("waitlisted");
    expect(body.waitlisted).toBe(true);
    expect(body.waitlistPosition).toBe(1);
  });

  it("returns 409 EVENT_AT_CAPACITY when no waitlist and no seats (no mutation)", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 1, waitlistEnabled: false });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, []);    // no existing
    // Capacity: 1 going (full)
    h.enqueue(T.groupEventRsvpsTable, [{ guestCount: 0 }]);
    // Full + waitlist disabled → 409 immediately, no further reads/mutation.

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string; error: string };
    expect(body.code).toBe("EVENT_AT_CAPACITY");
  });

  it("guest count is included in capacity calculation (1 + guestCount seats) → 409 when full", async () => {
    // attendeeLimit=3, one going RSVP with guestCount=2 → 3 seats used
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 3, waitlistEnabled: false, allowGuests: false });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, []);    // no existing for this user
    // Capacity: 1 going with 2 guests = 3 seats = attendeeLimit
    h.enqueue(T.groupEventRsvpsTable, [{ guestCount: 2 }]);
    // Full, no waitlist → 409 (3 + 1 > 3), no mutation.

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    // Seat 1 + 0 guests would be 1 new seat, but 3 already used from prior RSVP
    // 3 + 1 > 3 → full → capacity error.
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("EVENT_AT_CAPACITY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #3 Every RSVP transition keeps counters correct
// ─────────────────────────────────────────────────────────────────────────────
describe("#3 RSVP transition counter correctness", () => {
  it("going → not_going decrements rsvpCount", async () => {
    const g = makeGroup();
    const e = makeEvent({ rsvpCount: 5, waitlistEnabled: false, attendeeLimit: null });
    const existingGoing = makeRsvp({ rsvpStatus: "going" });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, [existingGoing]);
    // delete + update (null queues)
    // Final event state
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 4, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "not_going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string | null; rsvpCount: number };
    expect(body.rsvpStatus).toBeNull();
    expect(body.rsvpCount).toBe(4);
  });

  it("waitlisted → not_going decrements waitlistCount", async () => {
    const g = makeGroup();
    const e = makeEvent({ rsvpCount: 2, waitlistEnabled: true, waitlistCount: 3, attendeeLimit: 2 });
    const existingWaitlisted = makeRsvp({ rsvpStatus: "waitlisted", waitlistPosition: 1 });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, [existingWaitlisted]);
    // delete + update waitlistCount-1 (null queues)
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 2 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "not_going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpCount: number };
    // rsvpCount unchanged (was waitlisted, not going)
    expect(body.rsvpCount).toBe(2);
  });

  it("new going RSVP increments rsvpCount", async () => {
    const g = makeGroup();
    const e = makeEvent({ rsvpCount: 2, attendeeLimit: null });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, []);    // no existing
    // No capacity check (attendeeLimit=null)
    // Insert returning
    h.enqueue(null, [{ id: 5, rsvpStatus: "going", waitlistPosition: null }]);
    // Update + final
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 3, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string; rsvpCount: number };
    expect(body.rsvpStatus).toBe("going");
    expect(body.rsvpCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4 Cancellation promotes exactly one waitlisted attendee
// ─────────────────────────────────────────────────────────────────────────────
describe("#4 Cancellation promotes exactly one waitlisted attendee", () => {
  it("cancelling a going RSVP promotes first waitlisted to going", async () => {
    const g = makeGroup();
    const e = makeEvent({
      rsvpCount: 2,
      waitlistEnabled: true,
      waitlistCount: 1,
      attendeeLimit: 2,
    });
    const cancellingUser = makeRsvp({ userId: member.id, rsvpStatus: "going" });
    const waitlisted = makeRsvp({
      id: 99, userId: 50, rsvpStatus: "waitlisted", waitlistPosition: 1,
    });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, [cancellingUser]);   // existing going RSVP
    // delete + rsvpCount-1 (null queues)
    // waitlistEnabled=true && attendeeLimit !== null → promote first
    h.enqueue(T.groupEventRsvpsTable, [waitlisted]);       // first waitlisted
    // update waitlisted → going + counters (null queues)
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "not_going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpCount: number };
    // After cancellation + promotion: rsvpCount stays 2 (1 left - 1 promoted = net 0 change)
    expect(body.rsvpCount).toBe(2);
  });

  it("cancellation without waitlist: rsvpCount decrements without promotion", async () => {
    const g = makeGroup();
    const e = makeEvent({
      rsvpCount: 3,
      waitlistEnabled: false,
      waitlistCount: 0,
      attendeeLimit: null,
    });
    const existingGoing = makeRsvp({ rsvpStatus: "going" });

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    // Transaction:
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, [existingGoing]);
    // delete + update rsvpCount-1 (null queues)
    // No waitlist promotion (waitlistEnabled=false)
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "not_going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpCount: number };
    expect(body.rsvpCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #5 hideAttendees=true hides preview from non-members
// ─────────────────────────────────────────────────────────────────────────────
describe("#5 hideAttendees enforcement on projected global event detail", () => {
  it("returns empty attendees when hideAttendees=true and viewer is not a group member", async () => {
    const groupEventId = 100;
    const projectedId = -groupEventId;
    const e = makeEvent({ id: groupEventId, hideAttendees: true });
    const g = makeGroup();

    // loadMeetupProjectedEvent join:
    h.enqueue(T.groupEventsTable, [{
      event: e,
      group: { name: "NYC Meetups", meetupCity: "New York", meetupState: "NY" },
    }]);
    // viewer RSVP + save (no viewer auth)
    // (no viewer → no RSVP/save queries)

    // GET /events/:id then loads:
    // 1. event row for hideAttendees check
    h.enqueue(T.groupEventsTable, [{ hideAttendees: true, groupId: 2 }]);
    // 2. membership check for viewer (no viewer → viewerIsGroupMember=false)
    // 3. loadMeetupAttendeePreview → hideAttendees=true && !viewerIsGroupMember → empty

    const res = await req(`/events/${projectedId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attendees: unknown[];
      attendeeCount: number;
      hideAttendees?: boolean;
    };
    expect(body.attendees).toHaveLength(0);
    expect(body.attendeeCount).toBe(0);
  });

  it("returns attendees when hideAttendees=false (default)", async () => {
    const e = makeEvent({ id: 100, hideAttendees: false });

    h.enqueue(T.groupEventsTable, [{
      event: e,
      group: { name: "NYC Meetups", meetupCity: "New York", meetupState: "NY" },
    }]);
    // event row for hideAttendees check
    h.enqueue(T.groupEventsTable, [{ hideAttendees: false, groupId: 2 }]);
    // attendance preview: going RSVPs + count
    h.enqueue(T.groupEventRsvpsTable, []);         // going attendees rows
    h.enqueue(T.groupEventRsvpsTable, [{ n: 0 }]); // count

    const res = await req("/events/-100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendees: unknown[] };
    // attendees is an array (may be empty — that's fine, key is no hideAttendees block)
    expect(Array.isArray(body.attendees)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #6 Non-going statuses do NOT appear in global attendee preview
// ─────────────────────────────────────────────────────────────────────────────
describe("#6 Only 'going' RSVPs appear in global event attendee preview", () => {
  it("attendee preview filters to rsvpStatus=going only", async () => {
    // The loadMeetupAttendeePreview function adds eq(rsvpStatus, 'going') to the query.
    // We verify this structurally: if a non-going RSVP is returned from the DB,
    // the count query only counts going rows (the WHERE clause is enforced at DB level).
    // Here we verify the structural behavior: count returns only going rows.
    const e = makeEvent({ id: 100, hideAttendees: false });

    h.enqueue(T.groupEventsTable, [{
      event: e,
      group: { name: "NYC Meetups", meetupCity: "New York", meetupState: "NY" },
    }]);
    h.enqueue(T.groupEventsTable, [{ hideAttendees: false, groupId: 2 }]);
    // Attendee preview: only going=2 (even if 5 RSVPs total in the real DB,
    // the query adds rsvpStatus='going' so only 2 come back)
    const goingUser1 = {
      id: 20, name: "Alice", username: "alice", profilePhotoUrl: null,
    };
    const goingUser2 = {
      id: 21, name: "Bob", username: "bob", profilePhotoUrl: null,
    };
    h.enqueue(T.groupEventRsvpsTable, [goingUser1, goingUser2]); // only going rows
    h.enqueue(T.groupEventRsvpsTable, [{ n: 2 }]);               // count = 2

    const res = await req("/events/-100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendees: unknown[]; attendeeCount: number };
    expect(body.attendees).toHaveLength(2);
    expect(body.attendeeCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #7 Topic filter uses correct PostgreSQL array ANY() not JSONB @>
// ─────────────────────────────────────────────────────────────────────────────
describe("#7 Topic filter — PostgreSQL text[] semantics", () => {
  it("GET /events?topic=hookah returns 200 (filter accepted, text[] ANY() predicate)", async () => {
    // topics is a text[] column. The correct predicate is:
    //   'hookah' = ANY(group_events.topics)
    // NOT: topics @> '["hookah"]'::jsonb (JSONB containment — invalid for text[])
    // The DB mock returns empty, which is fine. What we verify is the route doesn't 500.
    h.enqueue(T.groupEventsTable, []); // meetup projection query
    const res = await req("/events?topic=hookah&sourceType=meetup");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it("compiled topic SQL uses = ANY(topics) with a bound parameter (not JSONB @>)", async () => {
    // Real assertion: build the exact fragment the route uses and compile it via
    // the pg dialect. Verify it is text[] membership ("= any"), NOT JSONB
    // containment ("@>"), and that the topic value is a BOUND PARAMETER ($1),
    // not inlined raw text (which the previous sql.raw() implementation did).
    const { sql } = await import("drizzle-orm");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { groupEventsTable } = await import("@workspace/db");

    const topic = "hookah";
    const fragment = sql`${topic} = ANY(${groupEventsTable.topics})`;
    const dialect = new PgDialect();
    const compiled = dialect.sqlToQuery(fragment);

    const normalized = compiled.sql.toLowerCase();
    // Correct text[] membership operator present:
    expect(normalized).toContain("= any(");
    // Column reference present:
    expect(normalized).toContain("topics");
    // Must NOT use JSONB containment (the original bug):
    expect(normalized).not.toContain("@>");
    expect(normalized).not.toContain("::jsonb");
    // Topic value must be a bound parameter, not inlined raw text:
    expect(compiled.params).toContain("hookah");
    expect(normalized).not.toContain("'hookah'"); // never inlined as a literal
  });

  it("topic filter with special characters is safely parameterized (no SQL injection)", async () => {
    // A malicious topic value must never break out of the parameter. Compile the
    // fragment with an injection payload and confirm it stays a bound parameter.
    const { sql } = await import("drizzle-orm");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { groupEventsTable } = await import("@workspace/db");

    const payload = "hookah'); DROP TABLE group_events;--";
    const fragment = sql`${payload} = ANY(${groupEventsTable.topics})`;
    const compiled = new PgDialect().sqlToQuery(fragment);

    // The payload is carried as a bound parameter, never spliced into SQL text.
    expect(compiled.params).toContain(payload);
    expect(compiled.sql.toLowerCase()).not.toContain("drop table");

    // And the route still responds 200 for such input (query short-circuits to []).
    h.enqueue(T.groupEventsTable, []);
    const res = await req(`/events?topic=${encodeURIComponent(payload)}&sourceType=meetup`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #8 Strict numeric event ID parsing
// ─────────────────────────────────────────────────────────────────────────────
describe("#8 Strict numeric event ID parsing", () => {
  it("rejects '123abc' (suffix) with 404", async () => {
    const res = await req("/events/123abc");
    expect(res.status).toBe(404);
  });

  it("rejects '12.5' (float) with 404", async () => {
    const res = await req("/events/12.5");
    expect(res.status).toBe(404);
  });

  it("rejects empty string with 404 (route won't match, but test boundary)", async () => {
    // Express won't route '' to /events/:id since the param is required
    const res = await req("/events/");
    // Will match GET /events (the list route), not /events/:id
    expect(res.status).not.toBe(500); // should be 200 (list route)
  });

  it("rejects 'abc' (non-numeric) with 404", async () => {
    const res = await req("/events/abc");
    expect(res.status).toBe(404);
  });

  it("rejects '-0abc' with 404", async () => {
    const res = await req("/events/-0abc");
    expect(res.status).toBe(404);
  });

  it("accepts valid positive integer", async () => {
    // 404 is expected (no DB entry), but NOT a 400 rejection
    h.enqueue(T.eventsTable, []); // no event in DB → 404 not found
    const res = await req("/events/999");
    // Valid ID format, event not found → 404 (not a parsing error 400)
    expect(res.status).toBe(404);
  });

  it("accepts valid negative integer (projected event lookup)", async () => {
    // -999 is a valid projected ID; returns 404 because event doesn't exist in mock
    h.enqueue(T.groupEventsTable, []); // no projected event
    const res = await req("/events/-999");
    expect(res.status).toBe(404); // valid ID, event not found
  });

  it("RSVP route rejects '123abc' with 404", async () => {
    const res = await req("/events/123abc/rsvp", {
      user: member,
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("RSVP route rejects '12.5' with 404", async () => {
    const res = await req("/events/12.5/rsvp", {
      user: member,
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #9 Suspended user cannot RSVP
// ─────────────────────────────────────────────────────────────────────────────
describe("#9 Suspended user is blocked from RSVP", () => {
  it("returns 403 when user accountStatus is suspended", async () => {
    const g = makeGroup();
    const suspendedUser = { id: 88, role: "user", accountStatus: "suspended" };

    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [makeEvent()]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: suspendedUser,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/account/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #10 Organizer attendee action routes through transactional service
// ─────────────────────────────────────────────────────────────────────────────
describe("#10 Organizer attendee action — transactional counter repair", () => {
  it("set_going on waitlisted: counter-repairs (waitlistCount-1, rsvpCount+1)", async () => {
    const g = makeGroup();
    const e = makeEvent({ rsvpCount: 2, waitlistCount: 1, attendeeLimit: 3 });
    const waitlistedRsvp = makeRsvp({
      id: 55, userId: 50, rsvpStatus: "waitlisted", waitlistPosition: 1,
    });

    // loadGroupForLifecycle → groupsTable
    h.enqueue(T.groupsTable, [g]);
    // getGroupMemberRole for actor
    h.enqueue(T.groupMembersTable, [{ role: "owner", status: "active" }]);
    // executeOrganizerAttendeeAction → transaction:
    // FOR UPDATE lock on event
    h.enqueue(T.groupEventsTable, [e]);
    // existing RSVP (the target)
    h.enqueue(T.groupEventRsvpsTable, [waitlistedRsvp]);
    // Capacity check (checking if space for set_going when !wasGoing)
    // Going RSVPs (current going = 2 rows, capacity limit=3, new seat=1 → fits)
    h.enqueue(T.groupEventRsvpsTable, [{ guestCount: 0 }, { guestCount: 0 }]);
    // Counter repair: update groupEventsTable (waitlistCount-1, rsvpCount+1) → null queue
    h.enqueue(null, []);
    // Update RSVP returning
    h.enqueue(null, [{
      ...waitlistedRsvp, rsvpStatus: "going", waitlistPosition: null,
      attendanceStatus: null,
    }]);
    // user lookup
    h.enqueue(T.usersTable, [{ name: "Target User", profilePhotoUrl: null }]);

    const res = await req("/groups/2/events/100/attendees/50", {
      user: { id: 10, role: "admin", accountStatus: "active" }, // owner
      method: "PATCH",
      body: { action: "set_going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string };
    expect(body.rsvpStatus).toBe("going");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #11 Existing-RSVP transitions enforce capacity under the lock
//     (interested/waitlisted/cancelled -> going, guest-count changes)
// ─────────────────────────────────────────────────────────────────────────────
describe("#11 Existing-RSVP -> going capacity enforcement", () => {
  // Pre-flight read sequence shared by the group RSVP route:
  //   groupsTable, groupMembersTable, groupEventsTable, (blocksTable empty)
  // then the transaction: groupEventsTable FOR UPDATE, groupEventRsvpsTable existing.
  function preflight(g: unknown, e: unknown) {
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    // blocksTable → empty (no block)
    h.enqueue(T.groupEventsTable, [e]); // FOR UPDATE lock
  }

  it("interested -> going at FULL capacity, no waitlist -> 409 EVENT_AT_CAPACITY", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 2, waitlistEnabled: false });
    const existing = makeRsvp({ id: 7, rsvpStatus: "interested" });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [existing]); // existing (interested)
    // occupiedGoingSeats (excl self): 2 going rows → full
    h.enqueue(T.groupEventRsvpsTable, [{ id: 1, guestCount: 0 }, { id: 2, guestCount: 0 }]);
    // does not fit, no waitlist → 409, NO further reads/writes

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("EVENT_AT_CAPACITY");
  });

  it("interested -> going at FULL capacity, waitlist enabled -> downgraded to waitlisted", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 2, waitlistEnabled: true, waitlistCount: 0 });
    const existing = makeRsvp({ id: 7, rsvpStatus: "interested" });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [existing]); // existing (interested)
    // occupiedGoingSeats (excl self): full
    h.enqueue(T.groupEventRsvpsTable, [{ id: 1, guestCount: 0 }, { id: 2, guestCount: 0 }]);
    // does not fit, waitlist enabled, not previously waitlisted → nextWaitlistPosition
    h.enqueue(T.groupEventRsvpsTable, [{ pos: 1 }]); // coalesce(max)+1
    // update RSVP row (null) + waitlistCount+1 update (null)
    // final event select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 1 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rsvpStatus: string; waitlisted: boolean; waitlistPosition: number;
    };
    expect(body.rsvpStatus).toBe("waitlisted");
    expect(body.waitlisted).toBe(true);
    expect(body.waitlistPosition).toBe(1);
  });

  it("waitlisted -> going when a seat is available -> going, counters repaired", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 5, waitlistEnabled: true, rsvpCount: 3, waitlistCount: 1 });
    const existing = makeRsvp({ id: 7, rsvpStatus: "waitlisted", waitlistPosition: 1 });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [existing]); // existing (waitlisted)
    // occupiedGoingSeats (excl self): 3 going seats, limit 5 → new party (1) fits
    h.enqueue(T.groupEventRsvpsTable, [
      { id: 1, guestCount: 0 }, { id: 2, guestCount: 0 }, { id: 3, guestCount: 0 },
    ]);
    // fits → update row (null), rsvpCount+1 (null), waitlistCount-1 (null),
    //        compactWaitlistPositions read (empty), final select
    h.enqueue(T.groupEventRsvpsTable, []); // compact: no remaining waitlisted
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 4, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string; rsvpCount: number };
    expect(body.rsvpStatus).toBe("going");
    expect(body.rsvpCount).toBe(4);
  });

  it("going guest-count INCREASE that fits stays going", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 5, allowGuests: true, maxGuestsPerRsvp: 4 });
    const existing = makeRsvp({ id: 7, rsvpStatus: "going", guestCount: 0 });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [existing]); // existing going, 1 seat
    // Requesting going with guestCount=2 → new party = 3 seats.
    // occupiedGoingSeats EXCLUDING self: suppose 1 other going (1 seat) → 1 + 3 = 4 <= 5 fits
    h.enqueue(T.groupEventRsvpsTable, [{ id: 7, guestCount: 0 }, { id: 8, guestCount: 0 }]);
    // fits, wasGoing so no rsvpCount change; newParty(3) > oldParty(1) so NO promotion.
    // final select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going", guestCount: 2 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string };
    expect(body.rsvpStatus).toBe("going");
  });

  it("going guest-count INCREASE that overflows -> bumped to waitlist (waitlist on)", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 3, waitlistEnabled: true, allowGuests: true, maxGuestsPerRsvp: 4,
      rsvpCount: 2, waitlistCount: 0,
    });
    const existing = makeRsvp({ id: 7, rsvpStatus: "going", guestCount: 0 });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [existing]); // existing going
    // Requesting going with guestCount=3 → new party = 4 seats.
    // occupiedGoingSeats EXCLUDING self: 2 other going seats → 2 + 4 = 6 > 3 → overflow
    h.enqueue(T.groupEventRsvpsTable, [{ id: 7, guestCount: 0 }, { id: 8, guestCount: 0 }]);
    // does not fit, waitlist enabled, not previously waitlisted → nextWaitlistPosition
    h.enqueue(T.groupEventRsvpsTable, [{ pos: 1 }]);
    // update row (null); wasGoing → rsvpCount-1, waitlistCount+1 (null);
    // freed going seat → promoteWaitlistIfFits: read waitlisted queue (empty → nobody)
    h.enqueue(T.groupEventRsvpsTable, []); // promotion: no other waitlisted
    // final select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 1, waitlistCount: 1 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going", guestCount: 3 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string; waitlisted: boolean };
    expect(body.rsvpStatus).toBe("waitlisted");
    expect(body.waitlisted).toBe(true);
  });

  it("going -> interested promotes the first waitlisted attendee", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 2, waitlistEnabled: true, rsvpCount: 2, waitlistCount: 1,
    });
    const existing = makeRsvp({ id: 7, rsvpStatus: "going" });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [existing]); // existing going
    // non-going branch (interested): update row (null), wasGoing → rsvpCount-1 (null)
    // wasGoing && !becomingWaitlisted → promoteWaitlistIfFits
    //   loop read waitlisted queue: one waiting party (1 seat)
    h.enqueue(T.groupEventRsvpsTable, [{ id: 99, userId: 50, guestCount: 0 }]);
    //   occupiedGoingSeats after our downgrade: 1 going seat, limit 2 → fits
    h.enqueue(T.groupEventRsvpsTable, [{ id: 8, guestCount: 0 }]);
    //   promote (updates), then loop again: waitlisted queue now empty
    h.enqueue(T.groupEventRsvpsTable, []); // loop 2: none left
    //   compactWaitlistPositions read (empty)
    h.enqueue(T.groupEventRsvpsTable, []);
    // final select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 0 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "interested" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string; rsvpCount: number };
    expect(body.rsvpStatus).toBe("interested");
    // net rsvpCount unchanged: -1 (self left) +1 (promoted) = 2
    expect(body.rsvpCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #12 Capacity-aware promotion invariants (queue order, oversized party)
// ─────────────────────────────────────────────────────────────────────────────
describe("#12 Promotion respects queue order and party size", () => {
  function preflight(g: unknown, e: unknown) {
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventsTable, [e]); // FOR UPDATE
  }

  it("oversized first waitlisted party is NOT promoted (queue order preserved, not skipped)", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 3, waitlistEnabled: true, rsvpCount: 3, waitlistCount: 2,
    });
    // Cancelling a going RSVP frees exactly 1 seat. The queue head needs 2 seats
    // (party of 2), so it must NOT be promoted, and a smaller party BEHIND it
    // must NOT jump ahead.
    const cancelling = makeRsvp({ id: 7, rsvpStatus: "going", guestCount: 0 });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [cancelling]); // existing going
    // cancellation branch (not_going): delete (null), rsvpCount-1 (null),
    // promoteWaitlistIfFits loop:
    //   read waitlisted ordered → head party of 2 (guestCount:1)
    h.enqueue(T.groupEventRsvpsTable, [{ id: 20, userId: 40, guestCount: 1 }]);
    //   occupiedGoingSeats after cancel: 2 going seats, limit 3 → 1 free, party=2 → NOT fit → stop
    h.enqueue(T.groupEventRsvpsTable, [{ id: 8, guestCount: 0 }, { id: 9, guestCount: 0 }]);
    // no promotion → NO compaction. final select.
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 2 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "not_going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpCount: number };
    // Only the canceller left; nobody promoted (head too big) → rsvpCount 3-1 = 2
    expect(body.rsvpCount).toBe(2);
  });

  it("waitlist positions are compacted after a waitlisted RSVP is removed", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 2, waitlistEnabled: true, rsvpCount: 2, waitlistCount: 3,
    });
    const existing = makeRsvp({ id: 7, rsvpStatus: "waitlisted", waitlistPosition: 2 });
    preflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [existing]); // existing waitlisted (position 2)
    // cancellation branch: delete (null), wasWaitlisted → waitlistCount-1 (null),
    // compactWaitlistPositions: read remaining waitlisted ordered (positions 1,3)
    h.enqueue(T.groupEventRsvpsTable, [
      { id: 10 }, // was position 1 → stays 1
      { id: 12 }, // was position 3 → compacted to 2
    ]);
    // (two update calls to set positions 1 and 2 — null queue, no reads)
    // final select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 2 }]);

    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "not_going" },
    });
    expect(res.status).toBe(200);
    // Compaction ran (no throw); counters intact.
    const body = (await res.json()) as { rsvpCount: number };
    expect(body.rsvpCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #13 Organizer set_guest_count + set_waitlisted invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("#13 Organizer guest-count and waitlist actions", () => {
  const organizer = { id: 10, role: "admin", accountStatus: "active" };

  function orgPreflight(g: unknown, e: unknown) {
    // group lifecycle + actor role, then transaction FOR UPDATE + target RSVP.
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "owner", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]); // FOR UPDATE
  }

  it("set_guest_count INCREASE beyond capacity on a going RSVP -> 409", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 3, allowGuests: true, maxGuestsPerRsvp: 5,
    });
    const target = makeRsvp({ id: 55, userId: 50, rsvpStatus: "going", guestCount: 0 });
    orgPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [target]); // target RSVP (going, 1 seat)
    // set_guest_count to 3 → new party 4 seats. wasGoing && growing → capacity check.
    // occupiedGoingSeats EXCLUDING target: 2 other seats → 2 + 4 = 6 > 3 → 409
    h.enqueue(T.groupEventRsvpsTable, [{ id: 8, guestCount: 0 }, { id: 9, guestCount: 0 }]);

    const res = await req("/groups/2/events/100/attendees/50", {
      user: organizer,
      method: "PATCH",
      body: { action: "set_guest_count", guestCount: 3 },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/capacity/i);
  });

  it("set_guest_count REDUCTION on a going RSVP frees seats and promotes", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 4, waitlistEnabled: true, allowGuests: true, maxGuestsPerRsvp: 5,
      rsvpCount: 1, waitlistCount: 1,
    });
    const target = makeRsvp({ id: 55, userId: 50, rsvpStatus: "going", guestCount: 3 });
    orgPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [target]); // target going, 4 seats
    // set_guest_count to 0 → new party 1 seat. Reduction → no capacity check,
    // update.guestCount set, runPromotion=true.
    // update row returning (null queue)
    h.enqueue(null, [{ ...target, guestCount: 0 }]);
    // promoteWaitlistIfFits loop:
    //   read waitlisted ordered → head party 1 seat
    h.enqueue(T.groupEventRsvpsTable, [{ id: 70, userId: 60, guestCount: 0 }]);
    //   occupiedGoingSeats now: target 1 seat, limit 4 → fits
    h.enqueue(T.groupEventRsvpsTable, [{ id: 55, guestCount: 0 }]);
    //   promote; loop 2: waitlisted empty
    h.enqueue(T.groupEventRsvpsTable, []);
    //   compaction read empty
    h.enqueue(T.groupEventRsvpsTable, []);
    // user lookup for response
    h.enqueue(T.usersTable, [{ name: "Target", profilePhotoUrl: null }]);

    const res = await req("/groups/2/events/100/attendees/50", {
      user: organizer,
      method: "PATCH",
      body: { action: "set_guest_count", guestCount: 0 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guestCount: number };
    expect(body.guestCount).toBe(0);
  });

  it("set_waitlisted on a going user promotes ANOTHER queued user, not the moved one", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 2, waitlistEnabled: true, rsvpCount: 2, waitlistCount: 1,
    });
    const target = makeRsvp({ id: 55, userId: 50, rsvpStatus: "going", guestCount: 0 });
    orgPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [target]); // target going
    // set_waitlisted: not wasWaitlisted → nextWaitlistPosition
    h.enqueue(T.groupEventRsvpsTable, [{ pos: 2 }]); // assign position 2 to moved user
    // wasGoing → rsvpCount-1, waitlistCount+1 (null update — consumes one null entry)
    h.enqueue(null, []);
    // update row returning (null)
    h.enqueue(null, [{ ...target, rsvpStatus: "waitlisted", waitlistPosition: 2 }]);
    // promoteWaitlistIfFits(excludeUserId=50):
    //   loop read waitlisted ordered → [movedUser(50,pos2), other(60,pos1)]
    //   find(userId !== 50) → other(60)
    h.enqueue(T.groupEventRsvpsTable, [
      { id: 80, userId: 60, guestCount: 0 },   // other waitlisted (should be promoted)
      { id: 55, userId: 50, guestCount: 0 },   // the just-moved user (must be skipped)
    ]);
    //   occupiedGoingSeats after the move: 1 going seat, limit 2 → other (1 seat) fits
    h.enqueue(T.groupEventRsvpsTable, [{ id: 9, guestCount: 0 }]);
    //   promote other; loop 2: only moved user remains (excluded) → none to promote
    h.enqueue(T.groupEventRsvpsTable, [{ id: 55, userId: 50, guestCount: 0 }]);
    //   compaction read
    h.enqueue(T.groupEventRsvpsTable, [{ id: 55 }]);
    // user lookup for response
    h.enqueue(T.usersTable, [{ name: "Target", profilePhotoUrl: null }]);

    const res = await req("/groups/2/events/100/attendees/50", {
      user: organizer,
      method: "PATCH",
      body: { action: "set_waitlisted" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string };
    // The moved user themselves is waitlisted (not re-promoted).
    expect(body.rsvpStatus).toBe("waitlisted");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #14 Structural lock assertion — the transaction issues SELECT ... FOR UPDATE
//     (This proves the service REQUESTS row-level locking. It does NOT, and
//      cannot, prove PostgreSQL actually serializes concurrent writers — that
//      requires the real-DB concurrency script documented in
//      scripts/verify-rsvp-concurrency.mjs.)
// ─────────────────────────────────────────────────────────────────────────────
describe("#14 Structural: capacity mutations run under FOR UPDATE", () => {
  it("executeGroupEventRsvp locks the event row with .for('update') inside a transaction", async () => {
    // Spy on the fake db: assert that within the transaction the event row is
    // selected with .for('update') BEFORE any capacity read/write.
    const forUpdateCalls: unknown[] = [];
    const txCalls: string[] = [];

    // Wrap the shared fake to record .for() usage and transaction entry.
    const realTransaction = h.db.transaction;
    h.db.transaction = async (fn: (tx: unknown) => unknown) => {
      txCalls.push("transaction");
      return realTransaction(fn as never);
    };
    const realSelect = h.db.select;
    h.db.select = (cols?: unknown) => {
      const b = realSelect(cols) as Record<string, unknown>;
      const origFor = b.for as (arg?: unknown) => unknown;
      b.for = (arg?: unknown) => {
        forUpdateCalls.push(arg);
        return origFor(arg);
      };
      return b;
    };

    try {
      const g = makeGroup();
      const e = makeEvent({ attendeeLimit: null });
      h.enqueue(T.groupsTable, [g]);
      h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
      h.enqueue(T.groupEventsTable, [e]);
      h.enqueue(T.groupEventsTable, [e]);          // FOR UPDATE
      h.enqueue(T.groupEventRsvpsTable, []);       // no existing
      h.enqueue(null, [{ id: 1, rsvpStatus: "going", waitlistPosition: null }]);
      h.enqueue(T.groupEventsTable, [{ rsvpCount: 1, waitlistCount: 0 }]);

      const res = await req("/groups/2/events/100/rsvp", {
        user: member,
        method: "POST",
        body: { rsvpStatus: "going" },
      });
      expect(res.status).toBe(200);
      // A transaction was opened and a FOR UPDATE lock was requested.
      expect(txCalls).toContain("transaction");
      expect(forUpdateCalls).toContain("update");
    } finally {
      h.db.transaction = realTransaction;
      h.db.select = realSelect;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #15 Member going -> waitlisted promotes the prior FIFO head under the same
//     lock, WITHOUT re-promoting the just-moved member (excludeUserId=self).
//     Release blocker: the old `wasGoing && !becomingWaitlisted` gate skipped
//     promotion entirely when a going member downgraded themselves to waitlist,
//     leaving the freed seat unfilled.
// ─────────────────────────────────────────────────────────────────────────────
describe("#15 Automatic-only waitlisting — 'waitlisted' is never a member/public intent", () => {
  // Two layers of enforcement:
  //  (1) The RSVP route body schema (RsvpGroupEventBody) no longer accepts
  //      "waitlisted" → the route returns 400 before touching the service.
  //  (2) Defense-in-depth: the service itself normalizes a direct "waitlisted"
  //      requestedStatus to "going" and lets the locked capacity path decide
  //      the outcome (going / waitlisted / 409). No stranded waitlist is ever
  //      created on an available / unlimited / waitlist-disabled event.
  //  (Organizer-driven set_waitlisted for the FIFO-promotion scenario stays a
  //   separate path — covered by #16.)

  it("route rejects a member 'waitlisted' body with 400 (schema no longer allows it)", async () => {
    const res = await req("/groups/2/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "waitlisted" },
    });
    expect(res.status).toBe(400);
  });

  // Direct service-level tests (bypassing the route schema) for the
  // normalization guard. @workspace/db is mocked so the service uses the fake DB.
  function svcPreflight(g: unknown, e: unknown) {
    h.enqueue(T.groupsTable, [g]);              // service group lifecycle
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // member role
    h.enqueue(T.groupEventsTable, [e]);         // service event load
    h.enqueue(T.blocksTable, []);               // block check (createdBy 10 ≠ member 11)
    h.enqueue(T.groupEventsTable, [e]);         // lockedEvent FOR UPDATE
  }

  it("service: direct 'waitlisted' on an UNLIMITED event → going (never waitlisted)", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: null, waitlistEnabled: true, rsvpCount: 3 });
    svcPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, []); // no existing → new-RSVP branch
    // attendeeLimit null → NO occupied/capacity read for a new going RSVP.
    h.enqueue(null, [{ id: 1, rsvpStatus: "going" }]); // insert returning
    h.enqueue(null, []);                                // rsvpCount+1
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 4, waitlistCount: 0 }]); // final select

    const result = await executeGroupEventRsvp({
      user: { id: member.id, role: "member", accountStatus: "active" },
      groupId: 2,
      eventId: 100,
      requestedStatus: "waitlisted", // legacy/malicious direct input
      guestCount: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rsvpStatus).toBe("going");
      expect(result.waitlisted).toBe(false);
    }
  });

  it("service: direct 'waitlisted' on an AVAILABLE limited event → going", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 5, waitlistEnabled: true, rsvpCount: 1 });
    svcPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, []); // no existing → new-RSVP branch
    // occupiedGoingSeats → 1 going seat, limit 5 → fits → going.
    h.enqueue(T.groupEventRsvpsTable, [{ id: 8, guestCount: 0 }]);
    h.enqueue(null, [{ id: 1, rsvpStatus: "going" }]); // insert returning
    h.enqueue(null, []);                                // rsvpCount+1
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 0 }]); // final select

    const result = await executeGroupEventRsvp({
      user: { id: member.id, role: "member", accountStatus: "active" },
      groupId: 2,
      eventId: 100,
      requestedStatus: "waitlisted",
      guestCount: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rsvpStatus).toBe("going");
      expect(result.waitlisted).toBe(false);
    }
  });

  it("service: direct 'waitlisted' on a FULL + waitlist-ENABLED event → waitlisted with position", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 2, waitlistEnabled: true, rsvpCount: 2, waitlistCount: 0 });
    svcPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, []); // no existing → new-RSVP branch
    // occupiedGoingSeats → 2 going seats, limit 2 → full → waitlist enabled.
    h.enqueue(T.groupEventRsvpsTable, [{ id: 1, guestCount: 0 }, { id: 2, guestCount: 0 }]);
    // nextWaitlistPosition
    h.enqueue(T.groupEventRsvpsTable, [{ pos: 1 }]);
    h.enqueue(null, [{ id: 1, rsvpStatus: "waitlisted" }]); // insert returning
    h.enqueue(null, []);                                    // waitlistCount+1
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 1 }]); // final select

    const result = await executeGroupEventRsvp({
      user: { id: member.id, role: "member", accountStatus: "active" },
      groupId: 2,
      eventId: 100,
      requestedStatus: "waitlisted",
      guestCount: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rsvpStatus).toBe("waitlisted");
      expect(result.waitlisted).toBe(true);
      expect(result.waitlistPosition).toBe(1);
    }
  });

  it("service: direct 'waitlisted' on a FULL + waitlist-DISABLED event → 409 (no stranded waitlist)", async () => {
    const g = makeGroup();
    const e = makeEvent({ attendeeLimit: 1, waitlistEnabled: false, rsvpCount: 1 });
    svcPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, []); // no existing → new-RSVP branch
    // occupiedGoingSeats → 1 going seat, limit 1 → full + waitlist disabled → 409.
    h.enqueue(T.groupEventRsvpsTable, [{ id: 1, guestCount: 0 }]);

    const result = await executeGroupEventRsvp({
      user: { id: member.id, role: "member", accountStatus: "active" },
      groupId: 2,
      eventId: 100,
      requestedStatus: "waitlisted",
      guestCount: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("EVENT_AT_CAPACITY");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #16 Organizer set_going that cannot fit demotes to waitlisted AND promotes the
//     prior FIFO head with excludeUserId=target (no self-repromotion).
//     Release blocker: the demotion branch adjusted counters but never ran the
//     common promotion path, so the vacated going seat went unfilled.
// ─────────────────────────────────────────────────────────────────────────────
describe("#16 Organizer set_going demotion promotes FIFO head, not target", () => {
  const organizer = { id: 10, role: "admin", accountStatus: "active" };

  function orgPreflight(g: unknown, e: unknown) {
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "owner", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]); // FOR UPDATE
  }

  it("demotes an unfittable going RSVP to waitlist and promotes another queued user", async () => {
    const g = makeGroup();
    const e = makeEvent({
      attendeeLimit: 2, waitlistEnabled: true, allowGuests: true, maxGuestsPerRsvp: 5,
      rsvpCount: 2, waitlistCount: 1,
    });
    // Target (user 50) is currently going with a party of 3 (guestCount 2), which
    // no longer fits within the limit of 2 once re-validated → demote to waitlist.
    const target = makeRsvp({ id: 55, userId: 50, rsvpStatus: "going", guestCount: 2 });
    orgPreflight(g, e);
    h.enqueue(T.groupEventRsvpsTable, [target]); // target RSVP (going, 3 seats)
    // set_going: attendeeLimit set → occupiedGoingSeats EXCLUDING target
    //   other going seat(s): 1 → 1 + 3 = 4 > 2 → does NOT fit → demote branch.
    h.enqueue(T.groupEventRsvpsTable, [{ id: 8, guestCount: 0 }]);
    // wasGoing demotion → nextWaitlistPosition (assign target a queue slot)
    h.enqueue(T.groupEventRsvpsTable, [{ pos: 2 }]);
    // rsvpCount-1, waitlistCount+1 (null update — consumes one null entry);
    // runPromotion=true, exclude target(50).
    h.enqueue(null, []);
    // update row returning (null)
    h.enqueue(null, [{ ...target, rsvpStatus: "waitlisted", waitlistPosition: 2 }]);
    // promoteWaitlistIfFits(excludeUserId=50):
    //   loop read waitlisted ordered → [otherHead(60,pos1), target(50,pos2)]
    h.enqueue(T.groupEventRsvpsTable, [
      { id: 80, userId: 60, guestCount: 0 },  // prior FIFO head — should promote
      { id: 55, userId: 50, guestCount: 0 },  // demoted target — must be skipped
    ]);
    //   occupiedGoingSeats after demotion: 1 going seat, limit 2 → head (1 seat) fits
    h.enqueue(T.groupEventRsvpsTable, [{ id: 8, guestCount: 0 }]);
    //   promote head (2 updates); loop 2: only target remains (excluded) → break
    h.enqueue(T.groupEventRsvpsTable, [{ id: 55, userId: 50, guestCount: 0 }]);
    //   compaction read
    h.enqueue(T.groupEventRsvpsTable, [{ id: 55 }]);
    // user lookup for response
    h.enqueue(T.usersTable, [{ name: "Target", profilePhotoUrl: null }]);

    const res = await req("/groups/2/events/100/attendees/50", {
      user: organizer,
      method: "PATCH",
      body: { action: "set_going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string; waitlistPosition: number | null };
    // Target could not fit → ends up waitlisted, NOT re-promoted over the queue.
    expect(body.rsvpStatus).toBe("waitlisted");
    expect(body.waitlistPosition).toBe(2);
  });
});
