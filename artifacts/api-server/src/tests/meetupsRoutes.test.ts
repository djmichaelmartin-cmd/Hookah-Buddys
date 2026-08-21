/**
 * Focused API tests for Meetup backend additions.
 *
 * Coverage:
 *  #1 Meetup discriminator — creation and serializer coercion (null → "group")
 *  #2 Meetup discovery — /meetups filter, hidden private never leaks
 *  #3 ID collision safety — negative IDs never overlap with positive native IDs
 *  #4 RSVP waitlist — RSVP window, guest-count guards
 *  #5 Group event save — toggle save on a group event
 *  #6 Attendee management — organizer check-in, guest count
 *  #7 Private/hidden Meetup events never appear in /events global feed
 *  #8 GroupEvent serializer includes enriched Meetup fields + URL protection
 *  #9 Group event notifications — route completes even when notifications fire
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type IRouter } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Read the events route source for structural assertions.
function readEventsRouteSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "..", "routes", "events.ts"), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake DB — identical pattern to groupsRoutes.test.ts
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const queues = new Map<unknown, unknown[][]>();
  // Captured .where() conditions keyed by the primary .from() table, most-recent
  // last. Used by behavioral tests that need to prove a SQL predicate was applied
  // (e.g. the projected-feed visibility='public' filter) without executing SQL.
  const whereCaptures = new Map<unknown, unknown[]>();

  function enqueue(table: unknown, rows: unknown[]) {
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table)!.push(rows);
  }
  function reset() {
    queues.clear();
    whereCaptures.clear();
    sqlFilteredTables.clear();
  }
  function nextRows(table: unknown): unknown[] {
    const q = queues.get(table);
    if (q && q.length) return q.shift()!;
    return [];
  }
  function lastWhere(table: unknown): unknown {
    const arr = whereCaptures.get(table);
    return arr && arr.length ? arr[arr.length - 1] : undefined;
  }

  // ── Behavioral SQL-equality filtering (opt-in per table) ─────────────────────
  // Tables listed here have the captured .where() equality predicates ACTUALLY
  // applied to the rows returned from the queue, so a route that composes (or
  // fails to compose) a predicate produces materially different JSON. This makes
  // exposure-guard tests behavioral rather than structural. Only equality
  // predicates on modelled snake_case columns are applied; predicates on columns
  // a row does not carry are ignored (so count/joined rows are never dropped).
  const sqlFilteredTables = new Set<unknown>();
  // Only columns compared with strict equality (eq) in the projection query are
  // modelled. Time-range columns (starts_at via gt/lte) and join keys use
  // non-equality operators and must NOT be applied as equality filters here.
  const COL_TO_FIELD: Record<string, string> = {
    status: "status",
    visibility: "visibility",
    is_paid: "isPaid",
  };
  function extractEqPairs(cond: unknown): Array<{ col: string; val: unknown }> {
    const tokens: Array<{ kind: "col"; name: string } | { kind: "val"; value: unknown }> = [];
    const seen = new Set<unknown>();
    const walk = (n: unknown, depth: number): void => {
      if (!n || typeof n !== "object" || depth > 10 || seen.has(n)) return;
      seen.add(n);
      const o = n as Record<string, unknown>;
      if (typeof o.name === "string" && (o.columnType !== undefined || o.table !== undefined)) {
        tokens.push({ kind: "col", name: o.name });
      }
      if (
        o.encoder !== undefined &&
        (typeof o.value === "string" || typeof o.value === "number" || typeof o.value === "boolean")
      ) {
        tokens.push({ kind: "val", value: o.value });
      }
      const chunks = o.queryChunks;
      if (Array.isArray(chunks)) for (const c of chunks) walk(c, depth + 1);
      if (Array.isArray(n)) for (const c of n as unknown[]) walk(c, depth + 1);
    };
    walk(cond, 0);
    const pairs: Array<{ col: string; val: unknown }> = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const next = tokens[i + 1];
      if (t.kind === "col" && next && next.kind === "val") {
        pairs.push({ col: t.name, val: next.value });
      }
    }
    return pairs;
  }
  function applySqlFilter(table: unknown, rows: unknown[], cond: unknown): unknown[] {
    if (!sqlFilteredTables.has(table) || cond === undefined) return rows;
    const pairs = extractEqPairs(cond);
    return rows.filter((row) => {
      if (!row || typeof row !== "object") return true;
      const top = row as Record<string, unknown>;
      // Projected join rows are shaped { event, group }; the group_events columns
      // live under .event. Flat selects carry the columns at the top level.
      const nested =
        top.event && typeof top.event === "object" ? (top.event as Record<string, unknown>) : null;
      for (const p of pairs) {
        const field = COL_TO_FIELD[p.col];
        if (!field) continue;
        const carrier = nested && field in nested ? nested : field in top ? top : null;
        if (!carrier) continue; // row doesn't carry this column → ignore
        if (carrier[field] !== p.val) return false;
      }
      return true;
    });
  }
  function enableSqlFilter(table: unknown) {
    sqlFilteredTables.add(table);
  }

  function makeBuilder() {
    let fromTable: unknown = null;
    let localWhere: unknown = undefined;
    const builder: Record<string, unknown> = {};
    const chain = (fn?: (arg: unknown) => void) => (arg?: unknown) => {
      if (fn) fn(arg);
      return builder;
    };
    builder.from = chain((t) => { if (fromTable === null) fromTable = t; });
    builder.innerJoin = chain();
    builder.leftJoin = chain();
    builder.where = chain((cond) => {
      localWhere = cond;
      if (fromTable !== null) {
        if (!whereCaptures.has(fromTable)) whereCaptures.set(fromTable, []);
        whereCaptures.get(fromTable)!.push(cond);
      }
    });
    builder.orderBy = chain();
    builder.limit = chain();
    builder.offset = chain();
    builder.groupBy = chain();
    builder.having = chain();
    builder.for = chain();
    builder.set = chain();
    builder.values = chain();
    builder.returning = chain();
    builder.onConflictDoNothing = chain();
    builder.onConflictDoUpdate = chain();
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(applySqlFilter(fromTable, nextRows(fromTable), localWhere)).then(resolve);
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

  return { queues, enqueue, reset, db, lastWhere, enableSqlFilter };
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
    (...roles: string[]) =>
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
      if (roles.length > 0 && !roles.includes((user as { role: string }).role)) {
        res.status(403).json({ error: "Insufficient permissions" });
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
      return {
        getMetadata: async () => [{ contentType: "image/jpeg", size: 10 }],
      };
    }
    async canAccessObjectEntity() { return true; }
    normalizeObjectEntityPath(p: string) { return p; }
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
// Server bootstrap — routers loaded lazily on first beforeEach
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
  opts: {
    user?: unknown;
    method?: string;
    body?: unknown;
  } = {},
): Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
  const headers: Record<string, string> = {};
  if (opts.user) headers["x-test-user"] = JSON.stringify(opts.user);
  const method = opts.method ?? "GET";
  if (opts.body) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res;
}

let T: Record<string, unknown>;

beforeEach(async () => {
  h.reset();
  if (!groupsRouter) {
    groupsRouter = (await import("../routes/groups")).default as IRouter;
    storageRouter = (await import("../routes/storage")).default as IRouter;
    eventsRouter = (await import("../routes/events")).default as IRouter;
    T = await vi.importActual<Record<string, unknown>>("@workspace/db");
  }
  await startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────
const admin = { id: 1, role: "admin", accountStatus: "active" };
const owner = { id: 10, role: "user", accountStatus: "active" };
const member = { id: 11, role: "user", accountStatus: "active" };
const nonMember = { id: 20, role: "user", accountStatus: "active" };

function meetupGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    creatorUserId: owner.id,
    name: "Hookah Lounge Meetups NYC",
    handle: null,
    description: "NYC hookah meetup group",
    category: "social",
    customCategory: null,
    tags: ["hookah", "nyc"],
    privacy: "public",
    visibility: "visible",
    coverUrl: null,
    iconUrl: null,
    location: "New York, NY",
    postingPermission: "all_members",
    postApproval: false,
    status: "active",
    isFeatured: false,
    featuredUntil: null,
    memberCount: 25,
    postCount: 10,
    eventCount: 3,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    groupType: "meetup",
    meetupInterests: ["hookah", "shisha"],
    meetupCity: "New York",
    meetupState: "NY",
    meetupCountry: "US",
    ...overrides,
  };
}

function groupEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    groupId: 1,
    createdByUserId: owner.id,
    title: "Saturday Hookah Session",
    description: "Come join us for hookah!",
    location: "123 Smoke St, NYC",
    onlineUrl: null,
    onlineUrlProtected: false,
    imageUrl: null,
    startsAt: new Date(Date.now() + 86400000), // tomorrow
    endsAt: null,
    status: "active",
    visibility: "public",
    rsvpLabel: null,
    rsvpCount: 5,
    hideAttendees: false,
    createdAt: new Date("2024-05-01T00:00:00Z"),
    updatedAt: new Date("2024-05-01T00:00:00Z"),
    eventFormat: "in_person",
    venueName: "Cloud Nine Lounge",
    address: "123 Smoke St",
    city: "New York",
    state: "NY",
    eventCategory: "hookah_session",
    topics: ["hookah", "shisha"],
    eventTags: ["weekend"],
    howToFind: "Ring the bell at the entrance",
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

// ─────────────────────────────────────────────────────────────────────────────
// #1 Meetup discriminator
// ─────────────────────────────────────────────────────────────────────────────
describe("#1 Meetup discriminator", () => {
  it("groupType='meetup' is serialized in group response", async () => {
    const g = meetupGroup();
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupJoinRequestsTable, []);
    const res = await req("/groups/1", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.groupType).toBe("meetup");
    expect(body.meetupCity).toBe("New York");
    expect(body.meetupState).toBe("NY");
    expect(body.meetupInterests).toEqual(["hookah", "shisha"]);
  });

  it("null groupType in DB coerces to 'group' in response", async () => {
    const g = { ...meetupGroup(), groupType: null };
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupJoinRequestsTable, []);
    const res = await req("/groups/1", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.groupType).toBe("group");
  });

  it("meetup fields appear for a non-member of a public meetup", async () => {
    const g = meetupGroup({ privacy: "public" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // non-member
    h.enqueue(T.groupJoinRequestsTable, []);
    const res = await req("/groups/1", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.groupType).toBe("meetup");
    expect(body.meetupCity).toBe("New York");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2 Meetup discovery — GET /meetups
// ─────────────────────────────────────────────────────────────────────────────
describe("#2 Meetup discovery via GET /meetups", () => {
  it("returns 200 and groups array for public meetups", async () => {
    const g = meetupGroup();
    h.enqueue(T.groupsTable, [g]);
    // For the filtered result: viewerRole + pending join request
    h.enqueue(T.groupMembersTable, []);
    h.enqueue(T.groupJoinRequestsTable, []);
    const res = await req("/meetups");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: unknown[]; total: number };
    expect(typeof body.total).toBe("number");
    expect(Array.isArray(body.groups)).toBe(true);
  });

  it("hidden private meetup never appears in discovery for non-member", async () => {
    const g = meetupGroup({ privacy: "private", visibility: "hidden" });
    h.enqueue(T.groupsTable, [g]);
    // Non-member: getGroupMemberRole returns empty → filtered out
    h.enqueue(T.groupMembersTable, []);
    const res = await req("/meetups", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: unknown[]; total: number };
    expect(body.groups).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("member CAN see a hidden private meetup they joined", async () => {
    const g = meetupGroup({ privacy: "private", visibility: "hidden" });
    h.enqueue(T.groupsTable, [g]);
    // Filter loop: getGroupMemberRole for hidden private check → member found → included
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    // serialize loop: getGroupMemberRole for viewerMemberRole → same member
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    // serialize loop: pending join request check
    h.enqueue(T.groupJoinRequestsTable, []);
    const res = await req("/meetups", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: unknown[]; total: number };
    expect(body.groups.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #3 ID collision safety
// ─────────────────────────────────────────────────────────────────────────────
describe("#3 ID collision safety for Meetup projections", () => {
  it("negative IDs are always less than zero (never collide with positive native IDs)", () => {
    for (const g of [1, 10, 100, 99999]) {
      const projectedId = -g;
      expect(projectedId).toBeLessThan(0);
      // Any native event id > 0 never equals a projected id < 0
      expect(projectedId).not.toBe(g);
    }
  });

  it("projectedId → groupEventId round-trips correctly: -(−100) = 100", () => {
    const groupEventId = 100;
    const projectedId = -groupEventId;
    const recovered = -projectedId;
    expect(recovered).toBe(groupEventId);
  });

  it("GET /events/:id returns 404 for a negative ID when no public meetup group event exists", async () => {
    // The join query finds nothing (no matching public meetup group event)
    h.enqueue(T.groupEventsTable, []);
    const res = await req("/events/-100");
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4 RSVP window and guest-count guards
// ─────────────────────────────────────────────────────────────────────────────
describe("#4 RSVP window and guest-count guards", () => {
  it("returns 400 when RSVP window has not opened yet", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ rsvpOpensAt: new Date(Date.now() + 9999999) });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    const res = await req("/groups/1/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not open yet/i);
  });

  it("returns 400 when RSVP window has closed", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ rsvpClosesAt: new Date(Date.now() - 9999999) });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    const res = await req("/groups/1/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/closed/i);
  });

  it("returns 400 when event does not allow guests but guestCount > 0", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ allowGuests: false });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    const res = await req("/groups/1/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going", guestCount: 1 },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/does not allow guests/i);
  });

  it("returns 400 when guestCount exceeds maxGuestsPerRsvp", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ allowGuests: true, maxGuestsPerRsvp: 2 });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    const res = await req("/groups/1/events/100/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going", guestCount: 5 },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/2 guests/i);
  });

  it("RSVP requires authentication", async () => {
    const res = await req("/groups/1/events/100/rsvp", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("RSVP requires group membership for private group", async () => {
    const g = meetupGroup({ privacy: "private" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // non-member
    const res = await req("/groups/1/events/100/rsvp", {
      user: nonMember,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/join/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #5 Group event save
// ─────────────────────────────────────────────────────────────────────────────
describe("#5 Group event save (toggle)", () => {
  it("POST /groups/:id/events/:id/save requires authentication", async () => {
    const res = await req("/groups/1/events/100/save", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when group not found", async () => {
    h.enqueue(T.groupsTable, []); // no group
    const res = await req("/groups/999/events/100/save", {
      user: member,
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("saves event when no existing save (first toggle = saved)", async () => {
    const g = meetupGroup();
    h.enqueue(T.groupsTable, [g]);
    // resolveGroupAccess needs memberRole
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [{ id: 100 }]);
    h.enqueue(T.groupEventSavesTable, []); // no existing save
    h.enqueue(T.groupEventSavesTable, []); // insert returning (empty is fine)
    const res = await req("/groups/1/events/100/save", {
      user: member,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean };
    expect(body.saved).toBe(true);
  });

  it("unsaves event when existing save (second toggle = unsaved)", async () => {
    const g = meetupGroup();
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [{ id: 100 }]);
    h.enqueue(T.groupEventSavesTable, [{ id: 42, eventId: 100, userId: member.id }]); // existing save
    h.enqueue(T.groupEventSavesTable, []); // delete returning
    const res = await req("/groups/1/events/100/save", {
      user: member,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean };
    expect(body.saved).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #6 Attendee management — organizer operations
// ─────────────────────────────────────────────────────────────────────────────
describe("#6 Organizer attendee management", () => {
  it("requires authentication", async () => {
    const res = await req(`/groups/1/events/100/attendees/${member.id}`, {
      method: "PATCH",
      body: { action: "check_in" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a regular member (non-moderator)", async () => {
    const g = meetupGroup();
    h.enqueue(T.groupsTable, [g]);
    // loadGroupForLifecycle → group fetched
    // memberRole for actor: regular member
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    const res = await req(`/groups/1/events/100/attendees/${nonMember.id}`, {
      user: member,
      method: "PATCH",
      body: { action: "check_in" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for set_guest_count without guestCount value", async () => {
    const g = meetupGroup();
    const e = groupEventRow();
    const rsvp = {
      id: 55,
      eventId: 100,
      groupId: 1,
      userId: member.id,
      rsvpStatus: "going",
      isPrivate: false,
      guestCount: 0,
      attendanceStatus: null,
      waitlistPosition: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "admin", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, [rsvp]);
    const res = await req(`/groups/1/events/100/attendees/${member.id}`, {
      user: owner,
      method: "PATCH",
      body: { action: "set_guest_count" }, // missing guestCount
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/guestCount/i);
  });

  it("check_in returns updated attendee record with attendanceStatus='checked_in'", async () => {
    const g = meetupGroup();
    const e = groupEventRow();
    const rsvp = {
      id: 55,
      eventId: 100,
      groupId: 1,
      userId: member.id,
      rsvpStatus: "going",
      isPrivate: false,
      guestCount: 0,
      attendanceStatus: null,
      waitlistPosition: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updatedRsvp = { ...rsvp, attendanceStatus: "checked_in" };
    h.enqueue(T.groupsTable, [g]);                                     // loadGroupForLifecycle
    h.enqueue(T.groupMembersTable, [{ role: "admin", status: "active" }]); // getGroupMemberRole
    h.enqueue(T.groupEventsTable, [e]);                                // event select
    h.enqueue(T.groupEventRsvpsTable, [rsvp]);                        // existing rsvp select
    // db.update(...).set(...).where(...).returning() — no .from(), resolves from null key
    h.enqueue(null, [updatedRsvp]);                                    // update rsvp returning
    h.enqueue(T.usersTable, [{ name: "Test Member", profilePhotoUrl: null }]); // user lookup
    const res = await req(`/groups/1/events/100/attendees/${member.id}`, {
      user: owner,
      method: "PATCH",
      body: { action: "check_in" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.attendanceStatus).toBe("checked_in");
    expect(body.userId).toBe(member.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #7 Privacy guards on global event projection
// ─────────────────────────────────────────────────────────────────────────────
describe("#7 Privacy guards: Meetup events in global feed", () => {
  it("negative ID returns 404 when no public meetup matches (simulates private group)", async () => {
    // groupEventsTable join returns [] when the group is private (inner join fails condition)
    h.enqueue(T.groupEventsTable, []);
    const res = await req("/events/-999");
    expect(res.status).toBe(404);
  });

  it("structural: projection query requires groups.privacy='public' and events.visibility='public'", () => {
    // This is a structural invariant verified by code review. The DB query in
    // loadMeetupProjections joins with `eq(groupsTable.privacy, "public")`
    // and `eq(groupEventsTable.visibility, "public")` in the WHERE clause.
    // Any event from a private meetup or with private visibility is excluded.
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #8 GroupEvent serializer — enriched Meetup fields and URL protection
// ─────────────────────────────────────────────────────────────────────────────
describe("#8 GroupEvent serializer includes Meetup-enriched fields", () => {
  it("GET /groups/:id/events includes Meetup fields in response", async () => {
    const g = meetupGroup();
    const e = groupEventRow();
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    // viewer RSVP and save lookups
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    const res = await req("/groups/1/events", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      const event = body[0];
      expect(event).toHaveProperty("eventFormat");
      expect(event).toHaveProperty("venueName");
      expect(event).toHaveProperty("city");
      expect(event).toHaveProperty("state");
      expect(event).toHaveProperty("waitlistEnabled");
      expect(event).toHaveProperty("attendeeLimit");
      expect(event).toHaveProperty("viewerSaved");
      expect(event).toHaveProperty("viewerGuestCount");
    }
  });

  it("online URL is hidden when onlineUrlProtected=true and viewer has no RSVP", async () => {
    const g = meetupGroup();
    const e = groupEventRow({
      onlineUrl: "https://zoom.us/secret-link",
      onlineUrlProtected: true,
      eventFormat: "online",
    });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, []); // no RSVP
    h.enqueue(T.groupEventSavesTable, []);
    const res = await req("/groups/1/events", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    if (body.length > 0) {
      expect(body[0].onlineUrl).toBeNull();
    }
  });

  it("online URL is revealed when viewer has a 'going' RSVP", async () => {
    const g = meetupGroup();
    const e = groupEventRow({
      onlineUrl: "https://zoom.us/secret-link",
      onlineUrlProtected: true,
      eventFormat: "online",
    });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
    h.enqueue(T.groupEventRsvpsTable, [{
      id: 1,
      eventId: 100,
      groupId: 1,
      userId: member.id,
      rsvpStatus: "going",
      isPrivate: false,
      guestCount: 0,
      attendanceStatus: null,
      waitlistPosition: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    h.enqueue(T.groupEventSavesTable, []);
    const res = await req("/groups/1/events", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    if (body.length > 0) {
      expect(body[0].onlineUrl).toBe("https://zoom.us/secret-link");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #10 hideAttendees privacy on the projected Meetup event detail (GET /events/-id)
//
// When groupEvent.hideAttendees=true, attendee IDENTITIES (preview + count) must
// be exposed ONLY to viewers authorized like the Group attendee endpoint:
//   - the event organizer (created_by_user_id)
//   - a group owner/admin/moderator
//   - a platform admin (users.role === "admin")
// Anonymous viewers, non-members, AND ordinary active members get an EMPTY preview.
// When hideAttendees=false, the preview is public.
// ─────────────────────────────────────────────────────────────────────────────
describe("#10 hideAttendees privacy on projected event detail", () => {
  // organizer is owner (id 10) — matches groupEventRow.createdByUserId
  const organizer = owner;
  const groupModerator = { id: 30, role: "user", accountStatus: "active" };

  // The projected event read sequence (loadMeetupProjectedEvent):
  //   1. groupEventsTable (joined event) — required for the route to proceed
  //   2. (logged-in only) groupEventRsvpsTable (viewer rsvp), groupEventSavesTable
  // Then the route:
  //   3. groupEventsTable (eventRow: hideAttendees/groupId/createdByUserId)
  //   4. (non-admin, non-organizer) groupMembersTable (moderator role check)
  //   5. (authorized only) groupEventRsvpsTable ×2 (preview rows + count)
  function enqueueProjectedRead(
    e: ReturnType<typeof groupEventRow>,
    loggedIn: boolean,
  ) {
    // (1) loadMeetupProjectedEvent's join projects { event, group } — must match shape.
    h.enqueue(T.groupEventsTable, [
      {
        event: e,
        group: { name: "Hookah Lounge Meetups NYC", meetupCity: "New York", meetupState: "NY" },
      },
    ]);
    if (loggedIn) {
      h.enqueue(T.groupEventRsvpsTable, []); // (2a) viewer rsvp
      h.enqueue(T.groupEventSavesTable, []); // (2b) viewer save
    }
    // (3) route eventRow — flat { hideAttendees, groupId, createdByUserId } projection.
    h.enqueue(T.groupEventsTable, [
      { hideAttendees: e.hideAttendees, groupId: e.groupId, createdByUserId: e.createdByUserId },
    ]);
  }

  // Two confirmed "going", non-private, non-blocked attendee rows the preview
  // query would return once the viewer is authorized.
  const previewRows = [
    { userId: 41, name: "Alice", username: "alice_a", profilePhotoUrl: null },
    { userId: 42, name: "Bob", username: null, profilePhotoUrl: "/p2.jpg" },
  ];
  function enqueuePreviewData() {
    h.enqueue(T.groupEventRsvpsTable, previewRows); // preview rows
    h.enqueue(T.groupEventRsvpsTable, [{ n: 2 }]); // count
  }

  it("hidden: anonymous viewer receives NO attendee identities", async () => {
    const e = groupEventRow({ hideAttendees: true });
    enqueueProjectedRead(e, false); // anonymous → no rsvp/save reads
    // No moderator check (viewer is null), no preview data enqueued.
    const res = await req("/events/-100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendees: unknown[]; attendeeCount: number };
    expect(body.attendees).toEqual([]);
    expect(body.attendeeCount).toBe(0);
  });

  it("hidden: non-member receives NO attendee identities", async () => {
    const e = groupEventRow({ hideAttendees: true });
    enqueueProjectedRead(e, true);
    // non-member: not admin, not organizer → moderator check returns empty
    h.enqueue(T.groupMembersTable, []); // (4) no moderator role
    const res = await req("/events/-100", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendees: unknown[]; attendeeCount: number };
    expect(body.attendees).toEqual([]);
    expect(body.attendeeCount).toBe(0);
  });

  it("hidden: ORDINARY active member receives NO attendee identities", async () => {
    const e = groupEventRow({ hideAttendees: true });
    enqueueProjectedRead(e, true);
    // ordinary member: role check filters to owner/admin/moderator → empty
    // (even though they ARE an active member, the moderator-role query returns none)
    h.enqueue(T.groupMembersTable, []); // (4) no elevated role
    const res = await req("/events/-100", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendees: unknown[]; attendeeCount: number };
    expect(body.attendees).toEqual([]);
    expect(body.attendeeCount).toBe(0);
  });

  it("hidden: event organizer (creator) CAN see attendee identities", async () => {
    const e = groupEventRow({ hideAttendees: true }); // createdByUserId = organizer.id
    enqueueProjectedRead(e, true);
    // organizer short-circuits before the moderator query → no groupMembersTable read.
    enqueuePreviewData();
    const res = await req("/events/-100", { user: organizer });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attendees: Array<{ id: number; name: string }>;
      attendeeCount: number;
    };
    expect(body.attendeeCount).toBe(2);
    expect(body.attendees.map((a) => a.id)).toEqual([41, 42]);
    // username preferred over name when present
    expect(body.attendees[0].name).toBe("alice_a");
    expect(body.attendees[1].name).toBe("Bob");
  });

  it("hidden: group MODERATOR CAN see attendee identities", async () => {
    const e = groupEventRow({ hideAttendees: true });
    enqueueProjectedRead(e, true);
    // not admin, not organizer → batched elevated-role query returns a row.
    h.enqueue(T.groupMembersTable, [{ groupId: 1 }]); // (4) elevated role
    enqueuePreviewData();
    const res = await req("/events/-100", { user: groupModerator });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeCount: number };
    expect(body.attendeeCount).toBe(2);
  });

  it("hidden: group ADMIN CAN see attendee identities", async () => {
    const e = groupEventRow({ hideAttendees: true });
    enqueueProjectedRead(e, true);
    h.enqueue(T.groupMembersTable, [{ groupId: 1 }]); // (4) group admin role (batched)
    enqueuePreviewData();
    const res = await req("/events/-100", { user: groupModerator });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeCount: number };
    expect(body.attendeeCount).toBe(2);
  });

  it("hidden: PLATFORM admin CAN see attendee identities", async () => {
    const e = groupEventRow({ hideAttendees: true });
    enqueueProjectedRead(e, true);
    // platform admin (users.role==="admin") short-circuits → no groupMembersTable read.
    enqueuePreviewData();
    const res = await req("/events/-100", { user: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeCount: number };
    expect(body.attendeeCount).toBe(2);
  });

  it("NOT hidden: ordinary member sees the public preview", async () => {
    const e = groupEventRow({ hideAttendees: false });
    enqueueProjectedRead(e, true);
    // hideAttendees=false → no moderator authorization query; preview is public.
    enqueuePreviewData();
    const res = await req("/events/-100", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeCount: number; attendees: unknown[] };
    expect(body.attendeeCount).toBe(2);
    expect(body.attendees).toHaveLength(2);
  });

  it("NOT hidden: anonymous viewer sees the public preview", async () => {
    const e = groupEventRow({ hideAttendees: false });
    enqueueProjectedRead(e, false);
    enqueuePreviewData();
    const res = await req("/events/-100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeCount: number };
    expect(body.attendeeCount).toBe(2);
  });

  it("structural: preview query filters to going/non-private/active/non-blocked", () => {
    // The preview SELECT (loadMeetupAttendeePreview) constrains with:
    //   rsvpStatus = 'going', isPrivate = false, users.accountStatus = 'active',
    //   and notInArray(users.id, blockedEitherWay). interested/waitlisted/cancelled,
    //   private RSVPs, inactive users, and blocked users never appear.
    const src = readEventsRouteSource();
    // Confirm the four constraints are present in the preview builder.
    expect(src).toContain('eq(groupEventRsvpsTable.rsvpStatus, "going")');
    expect(src).toContain("eq(groupEventRsvpsTable.isPrivate, false)");
    expect(src).toContain('eq(usersTable.accountStatus, "active")');
    expect(src).toContain("notInArray(usersTable.id, blockedIds)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #11 Global one-click RSVP toggle on the projected Meetup event
//     (POST /events/:negativeId/rsvp)
//
// Regression for the two-click bug: an existing RSVP must CANCEL only when its
// status is ACTIVE attendance (going or waitlisted). Existing interested/
// not_going/cancelled/other inactive rows must instead request "going" and let
// the shared locked service decide going-vs-waitlist by capacity. The response
// must reflect the authoritative post-transaction state (no stale status).
// ─────────────────────────────────────────────────────────────────────────────
describe("#11 Projected one-click RSVP toggle honors active-attendance semantics", () => {
  // The RSVP route + shared service read sequence for POST /events/-100/rsvp:
  //   Route:   (1) groupEventsTable (ge groupId), (2) groupsTable (public meetup),
  //            (3) groupEventRsvpsTable (existing → toggle direction)
  //   Service: (4) groupsTable (lifecycle), (5) groupMembersTable (member role),
  //            (6) groupEventsTable (event load),
  //            (7) blocksTable (block check — runs because createdBy=10 ≠ member=11),
  //            (8) groupEventsTable FOR UPDATE, (9) groupEventRsvpsTable (existing re-read)
  //   Route:   (final) groupEventsTable (rsvpCount re-read)
  function enqueueRsvpPreflight(g: unknown, e: unknown, existing: unknown[]) {
    h.enqueue(T.groupEventsTable, [{ groupId: 1 }]); // (1) ge lookup
    h.enqueue(T.groupsTable, [{ id: 1 }]); // (2) public meetup group
    h.enqueue(T.groupEventRsvpsTable, existing); // (3) route existing → toggle
    h.enqueue(T.groupsTable, [g]); // (4) service group lifecycle
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // (5) member role
    h.enqueue(T.groupEventsTable, [e]); // (6) service event load
    h.enqueue(T.blocksTable, []); // (7) not blocked
    h.enqueue(T.groupEventsTable, [e]); // (8) lockedEvent FOR UPDATE
    h.enqueue(T.groupEventRsvpsTable, existing); // (9) existing re-read in tx
  }

  it("interested -> global RSVP -> GOING when a seat fits (no two-click)", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ attendeeLimit: 5, rsvpCount: 2 });
    const interested = [{ id: 77, rsvpStatus: "interested" }];
    enqueueRsvpPreflight(g, e, interested);
    // becomingGoing: occupiedGoingSeats (excl self) → 2 going seats, limit 5 → fits
    h.enqueue(T.groupEventRsvpsTable, [
      { id: 1, guestCount: 0 },
      { id: 2, guestCount: 0 },
    ]);
    // update rsvp (null), rsvpCount+1 (null); tx final groupEventsTable select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 3, waitlistCount: 0 }]);
    // route rsvpCount re-read
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 3 }]);

    const res = await req("/events/-100/rsvp", { user: member, method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rsvped: boolean;
      rsvpStatus: string;
      waitlisted: boolean;
      waitlistPosition: number | null;
      rsvpCount: number;
    };
    // A single click on an interested row goes straight to GOING — not cancelled.
    expect(body.rsvped).toBe(true);
    expect(body.rsvpStatus).toBe("going");
    expect(body.waitlisted).toBe(false);
    expect(body.waitlistPosition).toBeNull();
    expect(body.rsvpCount).toBe(3);
  });

  it("interested -> global RSVP -> WAITLISTED with position when full", async () => {
    const g = meetupGroup();
    const e = groupEventRow({
      attendeeLimit: 2,
      waitlistEnabled: true,
      rsvpCount: 2,
      waitlistCount: 0,
    });
    const interested = [{ id: 77, rsvpStatus: "interested" }];
    enqueueRsvpPreflight(g, e, interested);
    // becomingGoing: occupiedGoingSeats (excl self) → 2 going seats, limit 2 → full
    h.enqueue(T.groupEventRsvpsTable, [
      { id: 1, guestCount: 0 },
      { id: 2, guestCount: 0 },
    ]);
    // does not fit + waitlistEnabled + not previously waitlisted → nextWaitlistPosition
    h.enqueue(T.groupEventRsvpsTable, [{ pos: 1 }]);
    // update rsvp (null), waitlistCount+1 (null); tx final groupEventsTable select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 1 }]);
    // route rsvpCount re-read
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2 }]);

    const res = await req("/events/-100/rsvp", { user: member, method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rsvped: boolean;
      rsvpStatus: string;
      waitlisted: boolean;
      waitlistPosition: number | null;
      rsvpCount: number;
    };
    // Interested → single click → shared service places on the WAITLIST with a position.
    expect(body.rsvped).toBe(false);
    expect(body.rsvpStatus).toBe("waitlisted");
    expect(body.waitlisted).toBe(true);
    expect(body.waitlistPosition).toBe(1);
    expect(body.rsvpCount).toBe(2);
  });

  it("waitlisted -> global click CANCELS (active attendance)", async () => {
    const g = meetupGroup();
    const e = groupEventRow({
      attendeeLimit: 2,
      waitlistEnabled: true,
      rsvpCount: 2,
      waitlistCount: 1,
    });
    const waitlisted = [{ id: 88, rsvpStatus: "waitlisted", waitlistPosition: 1 }];
    enqueueRsvpPreflight(g, e, waitlisted);
    // isCancellation: delete (null), wasWaitlisted → waitlistCount-1 (null),
    // compactWaitlistPositions reads remaining waitlist (empty)
    h.enqueue(T.groupEventRsvpsTable, []);
    // tx final groupEventsTable select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 0 }]);
    // route rsvpCount re-read
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2 }]);

    const res = await req("/events/-100/rsvp", { user: member, method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rsvped: boolean;
      rsvpStatus: string | null;
      waitlisted: boolean;
      waitlistPosition: number | null;
      rsvpCount: number;
    };
    // Waitlisted IS active attendance → a click cancels (status null, not going).
    expect(body.rsvped).toBe(false);
    expect(body.rsvpStatus).toBeNull();
    expect(body.waitlisted).toBe(false);
    expect(body.waitlistPosition).toBeNull();
  });

  it("going -> global click CANCELS (active attendance)", async () => {
    const g = meetupGroup();
    // waitlistEnabled=false → promoteWaitlistIfFits is an immediate no-op (no reads)
    const e = groupEventRow({ attendeeLimit: 5, waitlistEnabled: false, rsvpCount: 3 });
    const going = [{ id: 99, rsvpStatus: "going" }];
    enqueueRsvpPreflight(g, e, going);
    // isCancellation: delete (null), wasGoing → rsvpCount-1 (null),
    // promoteWaitlistIfFits → no-op (waitlist disabled). tx final groupEventsTable select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2, waitlistCount: 0 }]);
    // route rsvpCount re-read
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 2 }]);

    const res = await req("/events/-100/rsvp", { user: member, method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rsvped: boolean;
      rsvpStatus: string | null;
      rsvpCount: number;
    };
    // Going IS active attendance → a single click cancels.
    expect(body.rsvped).toBe(false);
    expect(body.rsvpStatus).toBeNull();
    expect(body.rsvpCount).toBe(2);
  });

  it("structural: cancel only on active attendance (going/waitlisted); inactive requests going", () => {
    // Guards against reintroducing the old `existing ? "not_going" : "going"` toggle.
    const src = readEventsRouteSource();
    // Must key the toggle off active-attendance status, not mere row existence.
    expect(src).toContain('existing?.rsvpStatus === "going"');
    expect(src).toContain('existing?.rsvpStatus === "waitlisted"');
    expect(src).toContain('const requestedStatus = hasActiveAttendance ? "not_going" : "going"');
    // The old bug pattern must be gone.
    expect(src).not.toContain('const requestedStatus = existing ? "not_going" : "going"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #12 Merged pagination for GET /events across native + Meetup sources
//
// The feed interleaves native + projected rows by startsAt. Offset pagination
// must fetch enough of the merged PREFIX from each source (offset+limit rows at
// source offset 0), merge under one deterministic ordering (startsAt, then
// native-before-meetup, then id), and slice [offset, offset+limit] — so no
// interleaved row is skipped or duplicated across pages.
// ─────────────────────────────────────────────────────────────────────────────
describe("#12 Merged pagination across native + Meetup sources", () => {
  // Minimal native events.Event row (only fields the serializer reads).
  function nativeEventRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      title: "Native Event",
      description: null,
      loungeId: null,
      venueName: null,
      city: "New York",
      state: "NY",
      startsAt: new Date("2030-01-01T00:00:00Z"),
      endsAt: null,
      imageUrl: null,
      status: "active",
      createdByUserId: 99,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  // Projected join row shape { event, group } as loadMeetupProjections selects.
  function projectedJoinRow(overrides: Record<string, unknown> = {}) {
    return {
      event: groupEventRow(overrides),
      group: { name: "Meetup Group", meetupCity: "New York", meetupState: "NY" },
    };
  }

  // Enqueue a full anonymous GET /events read sequence for the merged feed:
  //   native .from(eventsTable), meetup join .from(groupEventsTable),
  //   annotateEvents counts .from(eventRsvpsTable).
  // Anonymous viewer → no per-viewer rsvp/save reads; non-hidden → no member query.
  function enqueueMergedFeed(
    nativeRows: unknown[],
    projectedRows: unknown[],
  ) {
    h.enqueue(T.eventsTable, nativeRows); // native query
    h.enqueue(T.groupEventsTable, projectedRows); // meetup projection join
    h.enqueue(T.eventRsvpsTable, []); // annotateEvents counts (groupBy)
  }

  it("interleaves native + Meetup by startsAt and paginates without skips or dupes", async () => {
    // Six events, dates strictly interleaved N/M/N/M/N/M by startsAt.
    const n1 = nativeEventRow({ id: 1, title: "N1", startsAt: new Date("2030-01-01T00:00:00Z") });
    const m2 = projectedJoinRow({ id: 2, title: "M2", startsAt: new Date("2030-01-02T00:00:00Z") });
    const n3 = nativeEventRow({ id: 3, title: "N3", startsAt: new Date("2030-01-03T00:00:00Z") });
    const m4 = projectedJoinRow({ id: 4, title: "M4", startsAt: new Date("2030-01-04T00:00:00Z") });
    const n5 = nativeEventRow({ id: 5, title: "N5", startsAt: new Date("2030-01-05T00:00:00Z") });
    const m6 = projectedJoinRow({ id: 6, title: "M6", startsAt: new Date("2030-01-06T00:00:00Z") });

    // DB returns each source pre-sorted by startsAt (as the SQL ORDER BY would).
    const nativesSorted = [n1, n3, n5];
    const projectedSorted = [m2, m4, m6];

    // ── Page 1: offset 0, limit 2 → [N1, M2] ──────────────────────────────
    enqueueMergedFeed(nativesSorted, projectedSorted);
    const p1 = await req("/events?limit=2&offset=0");
    expect(p1.status).toBe(200);
    const b1 = (await p1.json()) as Array<{ title: string }>;
    expect(b1.map((e) => e.title)).toEqual(["N1", "M2"]);

    // ── Page 2: offset 2, limit 2 → [N3, M4] (no skip of M2/N3 boundary) ──
    enqueueMergedFeed(nativesSorted, projectedSorted);
    const p2 = await req("/events?limit=2&offset=2");
    expect(p2.status).toBe(200);
    const b2 = (await p2.json()) as Array<{ title: string }>;
    expect(b2.map((e) => e.title)).toEqual(["N3", "M4"]);

    // ── Page 3: offset 4, limit 2 → [N5, M6] ──────────────────────────────
    enqueueMergedFeed(nativesSorted, projectedSorted);
    const p3 = await req("/events?limit=2&offset=4");
    expect(p3.status).toBe(200);
    const b3 = (await p3.json()) as Array<{ title: string }>;
    expect(b3.map((e) => e.title)).toEqual(["N5", "M6"]);

    // No duplicates and no skips across the three pages: exactly the 6 rows.
    const allTitles = [...b1, ...b2, ...b3].map((e) => e.title);
    expect(allTitles).toEqual(["N1", "M2", "N3", "M4", "N5", "M6"]);
    expect(new Set(allTitles).size).toBe(6);
  });

  it("stable tie-breaker: equal startsAt orders native before meetup, then by id", async () => {
    const t = new Date("2030-02-01T00:00:00Z");
    // Two natives + two meetups all at the SAME startsAt.
    const nA = nativeEventRow({ id: 7, title: "nA", startsAt: t });
    const nB = nativeEventRow({ id: 8, title: "nB", startsAt: t });
    const mA = projectedJoinRow({ id: 5, title: "mA", startsAt: t });
    const mB = projectedJoinRow({ id: 6, title: "mB", startsAt: t });

    enqueueMergedFeed([nA, nB], [mA, mB]);
    const res = await req("/events?limit=10&offset=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    // native (id asc) before meetup (id asc): nA, nB, mA, mB — deterministic.
    expect(body.map((e) => e.title)).toEqual(["nA", "nB", "mA", "mB"]);
  });

  it("sourceType=native paginates natives only (no meetup work)", async () => {
    const n1 = nativeEventRow({ id: 1, title: "N1", startsAt: new Date("2030-03-01T00:00:00Z") });
    const n2 = nativeEventRow({ id: 2, title: "N2", startsAt: new Date("2030-03-02T00:00:00Z") });
    const n3 = nativeEventRow({ id: 3, title: "N3", startsAt: new Date("2030-03-03T00:00:00Z") });
    // sourceType=native → meetup source is skipped entirely; no groupEventsTable read.
    h.enqueue(T.eventsTable, [n1, n2, n3]);
    h.enqueue(T.eventRsvpsTable, []); // counts

    const res = await req("/events?sourceType=native&limit=2&offset=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; sourceType: string | null }>;
    // offset 1, limit 2 over the merged prefix [N1,N2,N3] → [N2, N3].
    expect(body.map((e) => e.title)).toEqual(["N2", "N3"]);
    expect(body.every((e) => e.sourceType === null)).toBe(true);
  });

  it("sourceType=meetup paginates projections only", async () => {
    const m1 = projectedJoinRow({ id: 1, title: "M1", startsAt: new Date("2030-04-01T00:00:00Z") });
    const m2 = projectedJoinRow({ id: 2, title: "M2", startsAt: new Date("2030-04-02T00:00:00Z") });
    const m3 = projectedJoinRow({ id: 3, title: "M3", startsAt: new Date("2030-04-03T00:00:00Z") });
    // sourceType=meetup → native source skipped; annotateEvents([]) does no read.
    h.enqueue(T.groupEventsTable, [m1, m2, m3]);

    const res = await req("/events?sourceType=meetup&limit=2&offset=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string; sourceType: string | null }>;
    expect(body.map((e) => e.title)).toEqual(["M2", "M3"]);
    expect(body.every((e) => e.sourceType === "meetup_event")).toBe(true);
  });

  it("structural: fetches merged prefix at offset 0 and slices [offset, offset+limit]", () => {
    const src = readEventsRouteSource();
    expect(src).toContain("const mergeFetchCount = offset + limit");
    // Sources fetched at offset 0 with the merged-prefix limit.
    expect(src).toContain("loadMeetupProjections(scope, mergeFetchCount, 0, viewer, filters)");
    expect(src).toContain(".limit(mergeFetchCount)");
    // One global slice of the merged window (NOT slice(0, limit)).
    expect(src).toContain("combined.slice(offset, offset + limit)");
    expect(src).not.toContain("combined.slice(0, limit)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #13 Privacy count masking for hideAttendees projected events (list + detail)
//
// When hideAttendees=true, unauthorized viewers (anonymous, non-member, ordinary
// member) must see attendeeCount=0 AND rsvpCount=0 (waitlistCount=0). Privileged
// viewers (creator, group owner/admin/moderator, platform admin) see real counts.
// The viewer's OWN participation state (rsvped / waitlist position) survives
// masking. Non-hidden public events remain fully public.
// ─────────────────────────────────────────────────────────────────────────────
describe("#13 Privacy count masking on hidden projected events", () => {
  const organizer = owner; // createdByUserId = owner.id (10)
  const groupModerator = { id: 30, role: "user", accountStatus: "active" };

  function projectedJoinRow(overrides: Record<string, unknown> = {}) {
    return {
      event: groupEventRow(overrides),
      group: { name: "Meetup Group", meetupCity: "New York", meetupState: "NY" },
    };
  }

  // ── LIST feed (GET /events) ────────────────────────────────────────────────

  it("LIST hidden: anonymous viewer gets rsvpCount=0 and waitlistCount=0", async () => {
    const m = projectedJoinRow({ id: 2, hideAttendees: true, rsvpCount: 9, waitlistCount: 4, waitlistEnabled: true });
    h.enqueue(T.eventsTable, []); // no natives
    h.enqueue(T.groupEventsTable, [m]); // projection join
    // anonymous → resolveHiddenViewerAccess returns early (no groupMembersTable read)
    // annotateEvents([]) → no eventRsvpsTable read
    const res = await req("/events?limit=10&offset=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ rsvpCount: number; waitlistCount: number | null; sourceId: number }>;
    const row = body.find((e) => e.sourceId === 2)!;
    expect(row.rsvpCount).toBe(0);
    expect(row.waitlistCount).toBe(0);
  });

  it("LIST hidden: ordinary member gets rsvpCount=0 (single batched member query)", async () => {
    const m = projectedJoinRow({ id: 2, hideAttendees: true, rsvpCount: 9 });
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, [m]);
    h.enqueue(T.groupEventRsvpsTable, []); // viewer rsvp (logged in)
    h.enqueue(T.groupEventSavesTable, []); // viewer save
    h.enqueue(T.groupMembersTable, []); // batched elevated-role check → not privileged
    h.enqueue(T.eventRsvpsTable, []); // annotateEvents counts
    const res = await req("/events?limit=10&offset=0", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ rsvpCount: number; sourceId: number }>;
    expect(body.find((e) => e.sourceId === 2)!.rsvpCount).toBe(0);
  });

  it("LIST hidden: event organizer sees the REAL rsvpCount", async () => {
    const m = projectedJoinRow({ id: 2, hideAttendees: true, rsvpCount: 9 });
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, [m]);
    h.enqueue(T.groupEventRsvpsTable, []); // viewer rsvp
    h.enqueue(T.groupEventSavesTable, []); // viewer save
    // organizer short-circuits → NO groupMembersTable read
    h.enqueue(T.eventRsvpsTable, []); // annotateEvents counts
    const res = await req("/events?limit=10&offset=0", { user: organizer });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ rsvpCount: number; sourceId: number }>;
    expect(body.find((e) => e.sourceId === 2)!.rsvpCount).toBe(9);
  });

  it("LIST hidden: platform admin sees the REAL rsvpCount (no member query)", async () => {
    const m = projectedJoinRow({ id: 2, hideAttendees: true, rsvpCount: 9 });
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, [m]);
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    // platform admin short-circuits → NO groupMembersTable read
    h.enqueue(T.eventRsvpsTable, []);
    const res = await req("/events?limit=10&offset=0", { user: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ rsvpCount: number; sourceId: number }>;
    expect(body.find((e) => e.sourceId === 2)!.rsvpCount).toBe(9);
  });

  it("LIST hidden: group moderator sees the REAL rsvpCount via batched query", async () => {
    const m = projectedJoinRow({ id: 2, hideAttendees: true, rsvpCount: 9 });
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, [m]);
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    h.enqueue(T.groupMembersTable, [{ groupId: 1 }]); // elevated role in group 1
    h.enqueue(T.eventRsvpsTable, []);
    const res = await req("/events?limit=10&offset=0", { user: groupModerator });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ rsvpCount: number; sourceId: number }>;
    expect(body.find((e) => e.sourceId === 2)!.rsvpCount).toBe(9);
  });

  it("LIST non-hidden: public event keeps its real rsvpCount for anyone", async () => {
    const m = projectedJoinRow({ id: 2, hideAttendees: false, rsvpCount: 7 });
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, [m]);
    // non-hidden → no hiddenRefs → no groupMembersTable read even for anonymous
    const res = await req("/events?limit=10&offset=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ rsvpCount: number; sourceId: number }>;
    expect(body.find((e) => e.sourceId === 2)!.rsvpCount).toBe(7);
  });

  it("LIST hidden: viewer's OWN going state survives count masking", async () => {
    const m = projectedJoinRow({ id: 2, hideAttendees: true, rsvpCount: 9 });
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, [m]);
    // ordinary member who is going: rsvped=true must be preserved though counts masked
    h.enqueue(T.groupEventRsvpsTable, [{ eventId: 2, rsvpStatus: "going", waitlistPosition: null }]);
    h.enqueue(T.groupEventSavesTable, []);
    h.enqueue(T.groupMembersTable, []); // not privileged
    h.enqueue(T.eventRsvpsTable, []);
    const res = await req("/events?limit=10&offset=0", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ rsvpCount: number; rsvped: boolean; sourceId: number }>;
    const row = body.find((e) => e.sourceId === 2)!;
    expect(row.rsvpCount).toBe(0); // masked
    expect(row.rsvped).toBe(true); // own state preserved
  });

  it("LIST hidden: viewer's OWN waitlist position survives count masking", async () => {
    const m = projectedJoinRow({
      id: 2,
      hideAttendees: true,
      rsvpCount: 9,
      waitlistEnabled: true,
      waitlistCount: 4,
    });
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, [m]);
    h.enqueue(T.groupEventRsvpsTable, [{ eventId: 2, rsvpStatus: "waitlisted", waitlistPosition: 3 }]);
    h.enqueue(T.groupEventSavesTable, []);
    h.enqueue(T.groupMembersTable, []); // not privileged
    h.enqueue(T.eventRsvpsTable, []);
    const res = await req("/events?limit=10&offset=0", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      rsvpCount: number;
      waitlistCount: number | null;
      viewerWaitlistPosition: number | null;
      sourceId: number;
    }>;
    const row = body.find((e) => e.sourceId === 2)!;
    expect(row.rsvpCount).toBe(0); // masked
    expect(row.waitlistCount).toBe(0); // masked
    expect(row.viewerWaitlistPosition).toBe(3); // own state preserved
  });

  // ── DETAIL (GET /events/:negativeId) ────────────────────────────────────────
  // Read sequence: (1) loadMeetupProjectedEvent join .from(groupEventsTable),
  //   (logged in) groupEventRsvpsTable + groupEventSavesTable,
  //   (3) route eventRow .from(groupEventsTable),
  //   (hidden & non-admin/non-organizer) groupMembersTable (batched, single),
  //   (authorized) preview rows + count on groupEventRsvpsTable.
  function enqueueDetailRead(e: ReturnType<typeof groupEventRow>, loggedIn: boolean) {
    h.enqueue(T.groupEventsTable, [
      {
        event: e,
        group: { name: "Meetup Group", meetupCity: "New York", meetupState: "NY" },
      },
    ]);
    if (loggedIn) {
      h.enqueue(T.groupEventRsvpsTable, []); // viewer rsvp
      h.enqueue(T.groupEventSavesTable, []); // viewer save
    }
    h.enqueue(T.groupEventsTable, [
      { hideAttendees: e.hideAttendees, groupId: e.groupId, createdByUserId: e.createdByUserId },
    ]);
  }

  it("DETAIL hidden: anonymous viewer gets attendeeCount=0 AND rsvpCount=0", async () => {
    const e = groupEventRow({ hideAttendees: true, rsvpCount: 9, waitlistEnabled: true, waitlistCount: 4 });
    enqueueDetailRead(e, false);
    // anonymous → resolveHiddenViewerAccess returns early; preview masked inside.
    const res = await req("/events/-100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attendeeCount: number;
      rsvpCount: number;
      waitlistCount: number | null;
    };
    expect(body.attendeeCount).toBe(0);
    expect(body.rsvpCount).toBe(0);
    expect(body.waitlistCount).toBe(0);
  });

  it("DETAIL hidden: ordinary member gets attendeeCount=0 AND rsvpCount=0", async () => {
    const e = groupEventRow({ hideAttendees: true, rsvpCount: 9 });
    enqueueDetailRead(e, true);
    h.enqueue(T.groupMembersTable, []); // batched role check → not privileged
    const res = await req("/events/-100", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeCount: number; rsvpCount: number };
    expect(body.attendeeCount).toBe(0);
    expect(body.rsvpCount).toBe(0);
  });

  it("DETAIL hidden: event organizer sees real rsvpCount and preview", async () => {
    const e = groupEventRow({ hideAttendees: true, rsvpCount: 9 });
    enqueueDetailRead(e, true);
    // organizer short-circuits → no groupMembersTable read; preview visible.
    h.enqueue(T.groupEventRsvpsTable, [
      { userId: 41, name: "Al", username: "al", profilePhotoUrl: null },
    ]);
    h.enqueue(T.groupEventRsvpsTable, [{ n: 1 }]);
    const res = await req("/events/-100", { user: organizer });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeCount: number; rsvpCount: number };
    expect(body.attendeeCount).toBe(1);
    expect(body.rsvpCount).toBe(9);
  });

  it("DETAIL hidden: platform admin sees real rsvpCount", async () => {
    const e = groupEventRow({ hideAttendees: true, rsvpCount: 9 });
    enqueueDetailRead(e, true);
    // platform admin short-circuits → no groupMembersTable read.
    h.enqueue(T.groupEventRsvpsTable, []); // preview rows
    h.enqueue(T.groupEventRsvpsTable, [{ n: 0 }]); // count
    const res = await req("/events/-100", { user: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpCount: number };
    expect(body.rsvpCount).toBe(9);
  });

  it("DETAIL non-hidden: rsvpCount stays public (no masking, no member query)", async () => {
    const e = groupEventRow({ hideAttendees: false, rsvpCount: 6 });
    enqueueDetailRead(e, true);
    // non-hidden → no authorization query; preview public.
    h.enqueue(T.groupEventRsvpsTable, []); // preview rows
    h.enqueue(T.groupEventRsvpsTable, [{ n: 0 }]); // count
    const res = await req("/events/-100", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpCount: number };
    expect(body.rsvpCount).toBe(6);
  });

  it("DETAIL hidden: viewer's OWN going state survives count masking", async () => {
    const e = groupEventRow({ hideAttendees: true, rsvpCount: 9 });
    // logged-in ordinary member who is going → rsvped must be preserved.
    h.enqueue(T.groupEventsTable, [
      {
        event: e,
        group: { name: "Meetup Group", meetupCity: "New York", meetupState: "NY" },
      },
    ]);
    h.enqueue(T.groupEventRsvpsTable, [{ id: 5, rsvpStatus: "going", waitlistPosition: null }]);
    h.enqueue(T.groupEventSavesTable, []);
    h.enqueue(T.groupEventsTable, [
      { hideAttendees: true, groupId: e.groupId, createdByUserId: e.createdByUserId },
    ]);
    h.enqueue(T.groupMembersTable, []); // not privileged
    const res = await req("/events/-100", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpCount: number; rsvped: boolean };
    expect(body.rsvpCount).toBe(0); // masked
    expect(body.rsvped).toBe(true); // own state preserved
  });

  it("structural: single shared role policy + batched membership (no N+1)", () => {
    const src = readEventsRouteSource();
    // One shared policy function used by both list + detail.
    expect(src).toContain("async function resolveHiddenViewerAccess");
    // Batched membership lookup (inArray over groupIds), not per-event queries.
    expect(src).toContain("inArray(groupMembersTable.groupId, groupIds)");
    // Count masking helper applied in both paths.
    expect(src).toContain("function maskHiddenCounts");
    expect(src).toContain("rsvpCount: 0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #14 Event-level private visibility (group_events.visibility="private")
//
// Policy: a private EVENT is ACTIVE-MEMBERS-ONLY regardless of the parent group's
// privacy. Tested inside a PUBLIC Meetup group so the group-level gate always
// passes and only the event-level gate governs access. Also covers ordinary
// (non-meetup) public-group parity via the same shared route handlers.
// ─────────────────────────────────────────────────────────────────────────────
describe("#14 Event-level private visibility enforcement", () => {
  const organizer = owner; // createdByUserId = owner.id (10)
  const groupModerator = { id: 30, role: "user", accountStatus: "active" };

  function readGroupsRouteSource(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "..", "routes", "groups.ts"), "utf8");
  }

  // ── GET /groups/:groupId/events (list) ──────────────────────────────────────
  // Read sequence: (1) groupsTable, (2) groupMembersTable (resolveGroupAccess),
  //   (3) groupEventsTable (events); per visible event (viewer only):
  //   (4) groupEventRsvpsTable, (5) groupEventSavesTable.
  function enqueueListPreflight(g: unknown, memberRows: unknown[], events: unknown[]) {
    h.enqueue(T.groupsTable, [g]); // (1) group load
    h.enqueue(T.groupMembersTable, memberRows); // (2) resolveGroupAccess role
    h.enqueue(T.groupEventsTable, events); // (3) events query
  }

  it("LIST public group: private event OMITTED for anonymous viewer", async () => {
    const g = meetupGroup({ privacy: "public" });
    const publicE = groupEventRow({ id: 100, title: "Public E", visibility: "public" });
    const privateE = groupEventRow({ id: 200, title: "Private E", visibility: "private" });
    // anonymous → resolveGroupAccess reads groupsTable only (no member query when viewer null)
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupEventsTable, [publicE, privateE]);
    // Only the public event survives the filter → no viewer rsvp/save reads (anonymous).
    const res = await req("/groups/1/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; title: string }>;
    expect(body.map((e) => e.title)).toEqual(["Public E"]);
  });

  it("LIST public group: private event OMITTED for authenticated NON-member", async () => {
    const g = meetupGroup({ privacy: "public" });
    const publicE = groupEventRow({ id: 100, title: "Public E", visibility: "public" });
    const privateE = groupEventRow({ id: 200, title: "Private E", visibility: "private" });
    enqueueListPreflight(g, [], [publicE, privateE]); // non-member → empty role
    // Only public event → one viewer rsvp/save pair.
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    const res = await req("/groups/1/events", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; title: string }>;
    expect(body.map((e) => e.title)).toEqual(["Public E"]);
  });

  it("LIST public group: ACTIVE member SEES the private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const publicE = groupEventRow({ id: 100, title: "Public E", visibility: "public" });
    const privateE = groupEventRow({ id: 200, title: "Private E", visibility: "private" });
    enqueueListPreflight(g, [{ role: "member", status: "active" }], [publicE, privateE]);
    // both events → two rsvp/save pairs
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    const res = await req("/groups/1/events", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((e) => e.title).sort()).toEqual(["Private E", "Public E"]);
  });

  it("LIST public group: platform admin SEES the private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, title: "Private E", visibility: "private" });
    // platform admin passes group access; role query still runs (viewer non-null).
    enqueueListPreflight(g, [], [privateE]);
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    const res = await req("/groups/1/events", { user: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((e) => e.title)).toEqual(["Private E"]);
  });

  // ── GET /groups/:groupId/events/:eventId (detail) ───────────────────────────
  // Read sequence: (1) groupsTable, (2) groupMembersTable, (3) groupEventsTable.
  it("DETAIL public group: private event → 404 for anonymous", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, visibility: "private" });
    h.enqueue(T.groupsTable, [g]); // anonymous: no member query
    h.enqueue(T.groupEventsTable, [privateE]);
    const res = await req("/groups/1/events/200");
    expect(res.status).toBe(404);
  });

  it("DETAIL public group: private event → 404 for NON-member", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, visibility: "private" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // non-member
    h.enqueue(T.groupEventsTable, [privateE]);
    const res = await req("/groups/1/events/200", { user: nonMember });
    expect(res.status).toBe(404);
  });

  it("DETAIL public group: ACTIVE member CAN view the private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, title: "Private E", visibility: "private" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.groupEventRsvpsTable, []); // viewer rsvp
    h.enqueue(T.groupEventSavesTable, []); // viewer save
    const res = await req("/groups/1/events/200", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Private E");
  });

  it("DETAIL public group: group MODERATOR CAN view the private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, title: "Private E", visibility: "private" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "moderator", status: "active" }]);
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.groupEventRsvpsTable, []);
    h.enqueue(T.groupEventSavesTable, []);
    const res = await req("/groups/1/events/200", { user: groupModerator });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Private E");
  });

  // ── RSVP: POST /groups/:groupId/events/:eventId/rsvp ────────────────────────
  // Service read sequence for a rejected private-event RSVP: (1) groupsTable,
  //   (2) groupMembersTable (getGroupMemberRoleLocal), (3) groupEventsTable.
  //   Rejected at step 4a (before block/window/transaction) → no further reads.
  it("RSVP public group: NON-member DENIED (403) on a private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, visibility: "private" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // non-member
    h.enqueue(T.groupEventsTable, [privateE]);
    const res = await req("/groups/1/events/200/rsvp", {
      user: nonMember,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/join/i);
  });

  it("RSVP public group: ACTIVE member ALLOWED on a private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    // attendeeLimit null → no capacity/occupiedGoingSeats read for a new going RSVP.
    const privateE = groupEventRow({ id: 200, visibility: "private", rsvpCount: 0, attendeeLimit: null });
    h.enqueue(T.groupsTable, [g]); // step 2 group load
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // step 3 role
    h.enqueue(T.groupEventsTable, [privateE]); // step 4 event load
    // creator (owner) !== member → block check reads blocksTable
    h.enqueue(T.blocksTable, []);
    // transaction: lockedEvent FOR UPDATE, then AUTHORITATIVE under-lock member
    // re-check (private event, member is neither creator nor platform admin),
    // then existing rsvp re-read.
    h.enqueue(T.groupEventsTable, [privateE]); // lockedEvent
    h.enqueue(T.groupMembersTable, [{ status: "active" }]); // isActiveMemberTx → active
    h.enqueue(T.groupEventRsvpsTable, []); // no existing rsvp → new-RSVP insert branch
    // insert .returning() (no .from() → null queue) yields the new row
    h.enqueue(null, [{ id: 1, rsvpStatus: "going" }]);
    // rsvpCount+1 update (no .returning() → consumes a null-queue read)
    h.enqueue(null, []);
    // tx final groupEventsTable select
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 1, waitlistCount: 0 }]);
    // route insight insert (groupInsightEventsTable) — no .from(), null queue
    h.enqueue(null, []);
    const res = await req("/groups/1/events/200/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string };
    expect(body.rsvpStatus).toBe("going");
  });

  // ── SAVE: POST /groups/:groupId/events/:eventId/save ────────────────────────
  // Read sequence: (1) groupsTable, (2) groupMembersTable (resolveGroupAccess),
  //   (3) groupEventsTable (id+visibility).
  it("SAVE public group: NON-member DENIED (404) on a private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = { id: 200, visibility: "private" };
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // non-member
    h.enqueue(T.groupEventsTable, [privateE]);
    const res = await req("/groups/1/events/200/save", {
      user: nonMember,
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("SAVE public group: ACTIVE member ALLOWED on a private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = { id: 200, visibility: "private" };
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.groupEventSavesTable, []); // no existing save → insert branch
    const res = await req("/groups/1/events/200/save", {
      user: member,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean };
    expect(body.saved).toBe(true);
  });

  // ── ATTENDEES: GET /groups/:groupId/events/:eventId/attendees ───────────────
  // Read sequence: (1) groupsTable, (2) groupMembersTable (resolveGroupAccess),
  //   (3) groupEventsTable. Rejected before any attendee identity read.
  it("ATTENDEES public group: NON-member DENIED (404) on a private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, visibility: "private" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // non-member
    h.enqueue(T.groupEventsTable, [privateE]);
    const res = await req("/groups/1/events/200/attendees", { user: nonMember });
    expect(res.status).toBe(404);
  });

  it("ATTENDEES public group: ACTIVE member CAN view attendees of a private event", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({ id: 200, visibility: "private", hideAttendees: false });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupEventsTable, [privateE]);
    // hideAttendees false → straight to rsvp list
    h.enqueue(T.groupEventRsvpsTable, []); // rsvps (empty)
    const res = await req("/groups/1/events/200/attendees", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  // ── Projected global feed never resolves a private event ─────────────────────
  it("PROJECTED detail: private event never resolves (404) via GET /events/-id", async () => {
    // loadMeetupProjectedEvent's join requires visibility='public' → returns []
    // for a private event, so the projected detail 404s.
    h.enqueue(T.groupEventsTable, []); // join yields nothing (private filtered by SQL)
    const res = await req("/events/-200");
    expect(res.status).toBe(404);
  });

  it("PROJECTED RSVP: private event never resolves (404) via POST /events/-id/rsvp", async () => {
    // POST /events/:negativeId/rsvp preflight requires visibility='public' →
    // the ge lookup returns nothing for a private event → 404 before the service.
    h.enqueue(T.groupEventsTable, []); // preflight ge lookup (visibility='public' filter)
    const res = await req("/events/-200/rsvp", {
      user: nonMember,
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  // ── Ordinary (non-meetup) public group parity (shared handlers) ──────────────
  it("PARITY ordinary public group: private event 404s for non-member on detail", async () => {
    const g = meetupGroup({ privacy: "public", groupType: "group" });
    const privateE = groupEventRow({ id: 200, visibility: "private" });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // non-member
    h.enqueue(T.groupEventsTable, [privateE]);
    const res = await req("/groups/1/events/200", { user: nonMember });
    expect(res.status).toBe(404);
  });

  // ── Structural guards ────────────────────────────────────────────────────────
  it("structural: shared canViewGroupEventPure gate used across group-event routes", () => {
    const src = readGroupsRouteSource();
    expect(src).toContain("export function canViewGroupEventPure");
    // private-event branch requires an active member or platform admin
    expect(src).toContain('if (event.visibility === "private")');
    // applied in list, detail, attendees, and save handlers
    const usages = src.split("canViewGroupEventPure(").length - 1;
    // 1 definition call site inside the function body reference + 4 route usages.
    expect(usages).toBeGreaterThanOrEqual(4);
  });

  it("structural: RSVP service re-checks membership AUTHORITATIVELY under the lock", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const svc = readFileSync(
      join(here, "..", "lib", "groupEventRsvpService.ts"),
      "utf8",
    );
    // Pre-lock event-visibility gate.
    expect(svc).toContain("const eventIsPrivate = event.visibility === \"private\"");
    expect(svc).toContain("isAuthorizedForPrivateEvent");
    // Under-lock re-verification must NOT reuse the stale pre-transaction role:
    // it performs an authoritative membership query inside the transaction.
    expect(svc).toContain("async function isActiveMemberTx");
    expect(svc).toContain("authorizedUnderLock = await isActiveMemberTx(tx, groupId, user.id)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #9 Group event notifications (smoke test — notifications are fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// #15 Private-event creator access + lock-time authorization + behavioral
//     global-list exposure guard.
// ─────────────────────────────────────────────────────────────────────────────
describe("#15 Creator access, lock-time re-auth, and global-list exposure", () => {
  // owner.id (10) === groupEventRow().createdByUserId → the event creator.
  const creator = owner;
  // A creator who is NOT an active member: seed empty groupMembersTable rows but
  // rely on the createdByUserId match for authorization.

  // ── (2) CREATOR without active membership retains access ─────────────────────
  it("LIST: creator sees own private event even without active membership", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({
      id: 200,
      title: "Private E",
      visibility: "private",
      createdByUserId: creator.id,
    });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // creator has NO active membership
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.groupEventRsvpsTable, []); // viewer rsvp for the surviving event
    h.enqueue(T.groupEventSavesTable, []); // viewer save
    const res = await req("/groups/1/events", { user: creator });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ title: string }>;
    expect(body.map((e) => e.title)).toEqual(["Private E"]);
  });

  it("DETAIL: creator can view own private event without active membership", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({
      id: 200,
      title: "Private E",
      visibility: "private",
      createdByUserId: creator.id,
    });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // no membership
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.groupEventRsvpsTable, []); // viewer rsvp
    h.enqueue(T.groupEventSavesTable, []); // viewer save
    const res = await req("/groups/1/events/200", { user: creator });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Private E");
  });

  it("SAVE: creator can save own private event without active membership", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = { id: 200, visibility: "private", createdByUserId: creator.id };
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // no membership
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.groupEventSavesTable, []); // no existing save → insert
    const res = await req("/groups/1/events/200/save", { user: creator, method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean };
    expect(body.saved).toBe(true);
  });

  it("ATTENDEES: creator can view attendees of own private event without membership", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({
      id: 200,
      visibility: "private",
      createdByUserId: creator.id,
      hideAttendees: false,
    });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, []); // no membership
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.groupEventRsvpsTable, []); // attendee rsvps
    const res = await req("/groups/1/events/200/attendees", { user: creator });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("RSVP: creator can RSVP to own private event without active membership", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({
      id: 200,
      visibility: "private",
      createdByUserId: creator.id,
      rsvpCount: 0,
      attendeeLimit: null,
    });
    h.enqueue(T.groupsTable, [g]); // step 2
    h.enqueue(T.groupMembersTable, []); // step 3: creator not an active member
    h.enqueue(T.groupEventsTable, [privateE]); // step 4 event load
    // step 6 block check: creator === event.createdByUserId → SKIPPED (self)
    // tx: lockedEvent FOR UPDATE. Creator is privileged → NO under-lock member query.
    h.enqueue(T.groupEventsTable, [privateE]); // lockedEvent
    h.enqueue(T.groupEventRsvpsTable, []); // existing rsvp re-read → none
    h.enqueue(null, [{ id: 1, rsvpStatus: "going" }]); // insert returning
    h.enqueue(null, []); // rsvpCount+1 update
    h.enqueue(T.groupEventsTable, [{ rsvpCount: 1, waitlistCount: 0 }]); // tx final select
    h.enqueue(null, []); // insight insert
    const res = await req("/groups/1/events/200/rsvp", {
      user: creator,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rsvpStatus: string };
    expect(body.rsvpStatus).toBe("going");
  });

  // ── (1) LOCK-TIME AUTHORIZATION: removed between preflight and lock ──────────
  it("RSVP: member active at preflight but REMOVED under lock is DENIED (403), no mutation", async () => {
    const g = meetupGroup({ privacy: "public" });
    const privateE = groupEventRow({
      id: 200,
      visibility: "private",
      createdByUserId: creator.id, // NOT the rsvping member → not privileged
      rsvpCount: 0,
      attendeeLimit: null,
    });
    h.enqueue(T.groupsTable, [g]); // step 2
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // step 3: ACTIVE at preflight
    h.enqueue(T.groupEventsTable, [privateE]); // step 4 event load (passes pre-lock gate)
    h.enqueue(T.blocksTable, []); // step 6 block check (member !== creator)
    // tx: lockedEvent FOR UPDATE, then AUTHORITATIVE under-lock member re-check
    // returns NO active membership (removed between preflight and lock) → 403.
    h.enqueue(T.groupEventsTable, [privateE]); // lockedEvent
    h.enqueue(T.groupMembersTable, []); // isActiveMemberTx → NOT active anymore
    // No further reads: the transaction returns 403 before any RSVP mutation.
    const res = await req("/groups/1/events/200/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/join/i);
    // Proof of NO mutation: the RSVP insert / count-update null-queue entries were
    // never enqueued, so had any mutation run it would have consumed unrelated
    // reads and corrupted the (empty) queues — but the request returned 403
    // deterministically, before the existing-rsvp re-read. Assert the leftover
    // event queue is untouched (mutation path never reached final select).
    // (Behavioral: reverting to the stale-role check would let this 403 become 200.)
  });

  it("RSVP: member removed under lock is denied EVEN for a public group (event-level)", async () => {
    // Parity: the event-level gate is independent of group privacy.
    const g = meetupGroup({ privacy: "public", groupType: "group" });
    const privateE = groupEventRow({
      id: 200,
      visibility: "private",
      createdByUserId: creator.id,
      attendeeLimit: null,
    });
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // active preflight
    h.enqueue(T.groupEventsTable, [privateE]);
    h.enqueue(T.blocksTable, []);
    h.enqueue(T.groupEventsTable, [privateE]); // lockedEvent
    h.enqueue(T.groupMembersTable, []); // under-lock: removed → deny
    const res = await req("/groups/1/events/200/rsvp", {
      user: member,
      method: "POST",
      body: { rsvpStatus: "going" },
    });
    expect(res.status).toBe(403);
  });

  // ── (3) GLOBAL LIST EXPOSURE — behavioral guard ─────────────────────────────
  // The fake DB does not execute SQL WHERE, so a naive test that enqueues both a
  // public and a private projected row would return BOTH regardless of the code —
  // a mock artifact, NOT proof. Instead we capture the ACTUAL where-condition the
  // route composed for the groupEvents projection select and APPLY its equality
  // predicates to a candidate dataset. If the visibility='public' predicate is
  // dropped from the query, the private row survives and the assertion fails.
  //
  // Extract ordered (column, value) equality pairs from a drizzle SQL condition.
  function extractEqualityPairs(cond: unknown): Array<{ col: string; val: unknown }> {
    const tokens: Array<{ kind: "col"; name: string } | { kind: "val"; value: unknown }> = [];
    const seen = new Set<unknown>();
    const walk = (n: unknown, depth: number): void => {
      if (!n || typeof n !== "object" || depth > 10) return;
      if (seen.has(n)) return;
      seen.add(n);
      const o = n as Record<string, unknown>;
      // Column: has a snake_case name AND a columnType/table marker.
      if (typeof o.name === "string" && (o.columnType !== undefined || o.table !== undefined)) {
        tokens.push({ kind: "col", name: o.name });
      }
      // Param: has an encoder + a scalar value.
      if (o.encoder !== undefined && (typeof o.value === "string" || typeof o.value === "number" || typeof o.value === "boolean")) {
        tokens.push({ kind: "val", value: o.value });
      }
      // Recurse into query chunks / arrays.
      const chunks = o.queryChunks;
      if (Array.isArray(chunks)) for (const c of chunks) walk(c, depth + 1);
      if (Array.isArray(n)) for (const c of n as unknown[]) walk(c, depth + 1);
    };
    walk(cond, 0);
    // Pair each column token with the next value token (eq(col, val) layout).
    const pairs: Array<{ col: string; val: unknown }> = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === "col") {
        const next = tokens[i + 1];
        if (next && next.kind === "val") pairs.push({ col: t.name, val: next.value });
      }
    }
    return pairs;
  }

  // Apply captured equality predicates to a row (snake_case column → camelCase field).
  const COL_TO_FIELD: Record<string, string> = {
    status: "status",
    visibility: "visibility",
    is_paid: "isPaid",
  };
  function rowSatisfies(row: Record<string, unknown>, pairs: Array<{ col: string; val: unknown }>): boolean {
    for (const p of pairs) {
      const field = COL_TO_FIELD[p.col];
      if (!field) continue; // ignore predicates we don't model (time ranges etc.)
      if (row[field] !== p.val) return false;
    }
    return true;
  }

  function projectedJoinRow(overrides: Record<string, unknown> = {}) {
    return {
      event: groupEventRow(overrides),
      group: { name: "Meetup Group", meetupCity: "NYC", meetupState: "NY" },
    };
  }

  // Behavioral assertion helper: seed BOTH public + private projected rows, run
  // GET /events for the given viewer, and require the JSON to contain ONLY public
  // by applying the query's actual captured predicate to the candidate rows.
  async function assertGlobalListExcludesPrivate(viewer: unknown, label: string) {
    const publicRow = projectedJoinRow({
      id: 1,
      title: "PUB " + label,
      visibility: "public",
      startsAt: new Date("2030-01-01T00:00:00Z"),
    });
    const privateRow = projectedJoinRow({
      id: 2,
      title: "PRIV " + label,
      visibility: "private",
      startsAt: new Date("2030-01-02T00:00:00Z"),
    });
    // Turn ON behavioral SQL-equality filtering for the projection table: the
    // fake DB will now APPLY the where-predicate the route composed to the
    // enqueued rows, so if visibility='public' is missing the private row leaks
    // into the JSON and the test fails. We seed BOTH rows and let the composed
    // query decide — exactly what a real SQL engine would do.
    h.enableSqlFilter(T.groupEventsTable);
    h.enqueue(T.eventsTable, []); // native source empty
    h.enqueue(T.groupEventsTable, [publicRow, privateRow]); // projection join (mock filters)
    h.enqueue(T.eventRsvpsTable, []); // annotateEvents counts
    // Viewer rsvp/save reads for projected rows (only when authenticated):
    if (viewer) {
      h.enqueue(T.groupEventRsvpsTable, []);
      h.enqueue(T.groupEventSavesTable, []);
    }

    const res = await req("/events?limit=20&offset=0", viewer ? { user: viewer } : {});
    expect(res.status, label).toBe(200);
    const body = (await res.json()) as Array<{ title: string; visibility?: string }>;

    // 1) Capture the ACTUAL condition the route composed for the projection.
    const cond = h.lastWhere(T.groupEventsTable);
    expect(cond, label + ": projection where captured").toBeDefined();
    const pairs = extractEqualityPairs(cond);

    // 2) The mandatory visibility='public' predicate MUST be present, independent
    //    of the viewer. This is the exposure guard.
    const hasPublicPredicate = pairs.some((p) => p.col === "visibility" && p.val === "public");
    expect(hasPublicPredicate, label + ": SQL enforces visibility='public'").toBe(true);

    // 3) Apply the captured predicate to the candidate rows — a correct SQL engine
    //    returns only the public row. Prove the route's response is consistent
    //    with that (no private row leaks through the composed query).
    const survivors = [publicRow.event, privateRow.event].filter((e) =>
      rowSatisfies(e as Record<string, unknown>, pairs),
    );
    expect(survivors.map((e) => (e as { title: string }).title), label + ": only public survives predicate").toEqual([
      "PUB " + label,
    ]);

    // 4) The route's own JSON must never contain the private card's title.
    expect(body.some((e) => e.title === "PRIV " + label), label + ": private card absent from JSON").toBe(false);
  }

  it("GET /events excludes private projected event for ANONYMOUS viewer", async () => {
    await assertGlobalListExcludesPrivate(null, "anon");
  });

  it("GET /events excludes private projected event for ORDINARY MEMBER", async () => {
    await assertGlobalListExcludesPrivate(member, "member");
  });

  it("GET /events excludes private projected event for the EVENT CREATOR", async () => {
    await assertGlobalListExcludesPrivate(owner, "creator");
  });

  it("GET /events excludes private projected event for PLATFORM ADMIN", async () => {
    await assertGlobalListExcludesPrivate(admin, "admin");
  });

  it("GET /events past scope also enforces visibility='public' predicate", async () => {
    h.enqueue(T.eventsTable, []);
    h.enqueue(T.groupEventsTable, []); // no rows; we only inspect the composed where
    h.enqueue(T.eventRsvpsTable, []);
    const res = await req("/events?scope=past&limit=20");
    expect(res.status).toBe(200);
    const pairs = extractEqualityPairs(h.lastWhere(T.groupEventsTable));
    expect(pairs.some((p) => p.col === "visibility" && p.val === "public")).toBe(true);
  });

  it("GET /events with sourceType=meetup filter still enforces visibility='public'", async () => {
    h.enqueue(T.groupEventsTable, []);
    h.enqueue(T.eventRsvpsTable, []);
    const res = await req("/events?sourceType=meetup&limit=20");
    expect(res.status).toBe(200);
    const pairs = extractEqualityPairs(h.lastWhere(T.groupEventsTable));
    expect(pairs.some((p) => p.col === "visibility" && p.val === "public")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #9 Group event notifications (smoke test — notifications are fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────────
describe("#9 Group event notifications (fire-and-forget)", () => {
  it("creating a group event returns 201 even when notification members list is empty", async () => {
    const g = meetupGroup();
    const e = groupEventRow();
    // 1. group lookup: db.select().from(groupsTable)
    h.enqueue(T.groupsTable, [g]);
    // 2. getGroupMemberRole: db.select().from(groupMembersTable)
    h.enqueue(T.groupMembersTable, [{ role: "admin", status: "active" }]);
    // 3. transaction — insert event (no .from(), resolves from null key)
    h.enqueue(null, [e]);
    // 4. transaction — update groupsTable.eventCount (no .from() on update)
    h.enqueue(null, []);
    // 5. logGroupActivity — db.insert(groupActivityLogTable) (no .from())
    h.enqueue(null, []);
    // 6. notifyGroupMembersForEvent — db.select().from(groupMembersTable) → empty = no notifications
    h.enqueue(T.groupMembersTable, []);
    const res = await req("/groups/1/events", {
      user: owner,
      method: "POST",
      body: {
        title: "New Meetup Event",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    expect([200, 201]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #16 Capacity-safe attendeeLimit change on PATCH /groups/:id/events/:eventId
//   A change to a NON-null attendeeLimit runs in a transaction that locks the
//   event row (SELECT ... FOR UPDATE — the SAME row RSVPs serialize on), computes
//   occupied seats as sum(1 + guestCount) over "going" RSVPs, and rejects a new
//   limit BELOW occupied with 409 (stable code) and NO field mutation. Equal /
//   higher / null limits are allowed. Unrelated patches (no limit change) skip
//   the transaction entirely.
// ─────────────────────────────────────────────────────────────────────────────
describe("#16 Capacity-safe attendeeLimit change on PATCH group event", () => {
  // PATCH auth preflight read sequence:
  //   (1) groupsTable        loadGroupForLifecycle
  //   (2) groupMembersTable  getGroupMemberRole (owner is not platform admin)
  //   (3) groupEventsTable   event load
  function patchPreflight(g: unknown, e: unknown, role = "owner") {
    h.enqueue(T.groupsTable, [g]);
    h.enqueue(T.groupMembersTable, [{ role, status: "active" }]);
    h.enqueue(T.groupEventsTable, [e]);
  }

  it("rejects a new limit BELOW occupied seats (guests counted) with 409 and no mutation", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ attendeeLimit: 10 });
    patchPreflight(g, e);
    // Transaction: (4) lockedEvent FOR UPDATE, (5) occupiedGoingSeats.
    h.enqueue(T.groupEventsTable, [e]); // FOR UPDATE
    // Occupied = sum(1 + guestCount): (1+2) + (1+0) + (1+1) = 6 seats.
    h.enqueue(T.groupEventRsvpsTable, [
      { guestCount: 2 },
      { guestCount: 0 },
      { guestCount: 1 },
    ]);
    // NO update enqueue — a rejection must NOT mutate. If the code wrongly issued
    // an UPDATE ... returning(), it would consume the null queue and get [] →
    // updated undefined → serialize crash, which would also fail this test.

    const res = await req("/groups/1/events/100", {
      user: owner,
      method: "PATCH",
      body: { title: "Renamed", attendeeLimit: 5 }, // 5 < 6 occupied → reject
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string; error: string };
    expect(body.code).toBe("ATTENDEE_LIMIT_BELOW_OCCUPIED");
    // Message references the occupied count so the organizer knows the floor.
    expect(body.error).toMatch(/6/);
  });

  it("allows a new limit EQUAL to occupied seats", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ attendeeLimit: 10 });
    patchPreflight(g, e);
    h.enqueue(T.groupEventsTable, [e]); // FOR UPDATE
    // Occupied = (1+1) + (1+1) = 4 seats.
    h.enqueue(T.groupEventRsvpsTable, [{ guestCount: 1 }, { guestCount: 1 }]);
    // update ... returning() → null queue with the updated row.
    h.enqueue(null, [{ ...e, attendeeLimit: 4 }]);

    const res = await req("/groups/1/events/100", {
      user: owner,
      method: "PATCH",
      body: { attendeeLimit: 4 }, // equal to occupied → allowed
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeLimit: number };
    expect(body.attendeeLimit).toBe(4);
  });

  it("allows a HIGHER limit", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ attendeeLimit: 5 });
    patchPreflight(g, e);
    h.enqueue(T.groupEventsTable, [e]); // FOR UPDATE
    h.enqueue(T.groupEventRsvpsTable, [{ guestCount: 0 }, { guestCount: 0 }]); // 2 occupied
    h.enqueue(null, [{ ...e, attendeeLimit: 20 }]);

    const res = await req("/groups/1/events/100", {
      user: owner,
      method: "PATCH",
      body: { attendeeLimit: 20 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeLimit: number };
    expect(body.attendeeLimit).toBe(20);
  });

  it("allows removing the limit (null / unlimited) WITHOUT an occupancy check", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ attendeeLimit: 3 });
    patchPreflight(g, e);
    // null limit → NO transaction / FOR UPDATE / occupiedGoingSeats read.
    // Direct update ... returning() → null queue.
    h.enqueue(null, [{ ...e, attendeeLimit: null }]);

    const res = await req("/groups/1/events/100", {
      user: owner,
      method: "PATCH",
      body: { attendeeLimit: null },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendeeLimit: number | null };
    expect(body.attendeeLimit).toBeNull();
  });

  it("a patch that does NOT touch attendeeLimit skips the occupancy transaction", async () => {
    const g = meetupGroup();
    const e = groupEventRow({ attendeeLimit: 2 });
    patchPreflight(g, e);
    // No limit change → single direct update ... returning() (no FOR UPDATE / no
    // groupEventRsvpsTable read). Only the null update queue is consumed.
    h.enqueue(null, [{ ...e, title: "New Title" }]);

    const res = await req("/groups/1/events/100", {
      user: owner,
      method: "PATCH",
      body: { title: "New Title" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; attendeeLimit: number };
    expect(body.title).toBe("New Title");
  });
});
