/**
 * ROUTE-LEVEL integration tests for the Groups remediation pass.
 *
 * These mount the REAL `groupsRouter` and `storageRouter` in an in-memory
 * Express app and drive them over real HTTP (`app.listen(0)` + `fetch`), so the
 * actual route handlers run end to end — not just helpers. Only three
 * boundaries are faked (a live Postgres + object store are unavailable in CI):
 *
 *   1. `@workspace/db` — `db` is replaced with a small chainable fake whose
 *      awaited result is the next queued row-set for the queried table. The
 *      REAL Drizzle table objects (`groupsTable`, ...) are re-exported so the
 *      routes' imports keep working and the fake can key results by table
 *      identity. Query order per route is deterministic, so per-table FIFO
 *      queues are stable.
 *   2. `../lib/objectStorage` — object existence / metadata / streaming.
 *   3. `../lib/auth` — session user is taken from an `x-test-user` header so we
 *      don't need session middleware.
 *
 * Coverage:
 *   #1 media bypass — universal `/storage/objects/*` rejects private-group
 *      objects; protected `/group-assets/:groupId/objects/*` allows members,
 *      denies non-members, and enforces the this-group reference check; PDF
 *      attachment + nosniff preserved.
 *   #2 visible-private preview — `GET /groups/:id` returns isPreview=true for a
 *      private+visible non-member, and 403 for private+hidden without invite.
 *   #3 dashboard — `/groups/my` includes pending-request groups;
 *      `/groups/invites` returns the enriched payload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type IRouter } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─────────────────────────────────────────────────────────────────────────────
// Fake DB: chainable query builder that resolves to queued per-table row-sets.
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  // table-identity → FIFO queue of row arrays
  const queues = new Map<unknown, unknown[][]>();
  // Fallback default for any table not explicitly queued (empty result).
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

  // Chainable, thenable builder. Every builder method returns `this`; awaiting
  // resolves to the queued rows for the FIRST table seen via `.from()`.
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
    builder.for = chain();
    // Write-builder methods (inert for the read routes under test).
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
    // Writes are not exercised by the read routes under test; provide inert stubs.
    insert: () => makeBuilder(),
    update: () => makeBuilder(),
    delete: () => makeBuilder(),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  // Session user injected per-request via header.
  const users = new Map<number, unknown>();

  return { queues, enqueue, reset, db, users };
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

// Object storage boundary.
const store = vi.hoisted(() => ({
  exists: true,
  contentType: "image/jpeg",
  bytes: Buffer.from("FAKEBYTES"),
  lastDownloadHeaders: {} as Record<string, string>,
}));

vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityFile(objectPath: string) {
      if (!store.exists) throw new ObjectNotFoundError("not found");
      return {
        __path: objectPath,
        getMetadata: async () => [{ contentType: store.contentType, size: store.bytes.length }],
      };
    }
    async canAccessObjectEntity() {
      return true;
    }
    // Emulate the real GCS-normalization: strip a fixed private-object dir
    // prefix and return the canonical `/objects/<entityId>` path. Used to prove
    // raw-GCS persisted values normalize identically to the other variants.
    normalizeObjectEntityPath(rawPath: string) {
      const GCS = "https://storage.googleapis.com/";
      if (!rawPath.startsWith(GCS)) return rawPath;
      const pathname = new URL(rawPath).pathname; // /test-bucket/private/<entityId>
      const dir = "/test-bucket/private/";
      if (!pathname.startsWith(dir)) return pathname;
      return `/objects/${pathname.slice(dir.length)}`;
    }
    async downloadObject() {
      const headers = new Headers({ "Content-Type": store.contentType });
      return new Response(store.bytes, { status: 200, headers });
    }
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

// Import routers AFTER mocks are registered.
let groupsRouter: IRouter;
let storageRouter: IRouter;

let server: Server;
let baseUrl: string;

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", storageRouter);
  app.use("/api", groupsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
}

async function req(
  path: string,
  opts: { user?: unknown } = {},
): Promise<{ status: number; json: () => Promise<unknown>; headers: Headers; text: () => Promise<string> }> {
  const headers: Record<string, string> = {};
  if (opts.user) headers["x-test-user"] = JSON.stringify(opts.user);
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return res;
}

// Real table references for enqueueing.
let T: Record<string, unknown>;

beforeEach(async () => {
  h.reset();
  store.exists = true;
  store.contentType = "image/jpeg";
  if (!groupsRouter) {
    groupsRouter = (await import("../routes/groups")).default as IRouter;
    storageRouter = (await import("../routes/storage")).default as IRouter;
    T = (await vi.importActual<Record<string, unknown>>("@workspace/db"));
  }
  await startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const member = { id: 10, role: "user", accountStatus: "active" };
const nonMember = { id: 20, role: "user", accountStatus: "active" };

const privateVisibleGroup = {
  id: 1,
  creatorUserId: 10,
  name: "Private Visible",
  handle: null,
  description: "d",
  category: null,
  customCategory: null,
  tags: [],
  privacy: "private",
  visibility: "visible",
  coverUrl: null,
  iconUrl: "/api/storage/objects/uploads/icon-1",
  location: null,
  postingPermission: "all_members",
  postApproval: false,
  status: "active",
  isFeatured: false,
  memberCount: 3,
  postCount: 2,
  eventCount: 0,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
};
const privateHiddenGroup = { ...privateVisibleGroup, id: 2, visibility: "hidden", name: "Hidden" };
const publicGroup = {
  ...privateVisibleGroup,
  id: 3,
  name: "Public",
  privacy: "public",
  visibility: "visible",
  iconUrl: null,
};

// A full Group event row fixture. Override `imageUrl`/`groupId` per test.
const eventRow = (overrides: Record<string, unknown> = {}) => ({
  id: 77,
  groupId: 1,
  createdByUserId: 10,
  title: "Meetup",
  description: null,
  location: null,
  onlineUrl: null,
  imageUrl: null,
  startsAt: new Date("2024-06-01T00:00:00Z"),
  endsAt: null,
  status: "active",
  visibility: "public",
  rsvpLabel: null,
  rsvpCount: 0,
  hideAttendees: false,
  createdAt: new Date("2024-05-01T00:00:00Z"),
  updatedAt: new Date("2024-05-02T00:00:00Z"),
  ...overrides,
});

// The canonical target for the requested URL `/storage/objects/uploads/X` is
// `/objects/uploads/X`. Persisted rows below store that same logical object in
// EVERY supported variant to prove normalize-then-compare matching.
const variants = (entity: string) => ({
  canonical: `/objects/${entity}`,
  serving: `/api/storage/objects/${entity}`,
  gcs: `https://storage.googleapis.com/test-bucket/private/${entity}`,
  protected: `/api/group-assets/999/objects/${entity}`,
});

describe("#1 media bypass — universal storage route (all persisted variants)", () => {
  // No private-group reference at all → served.
  function enqueueNoPrivateRefs() {
    h.enqueue(T.groupMediaTable, []);
    h.enqueue(T.groupPostsTable, []);
    h.enqueue(T.groupsTable, []); // hidden-branding query
  }

  it.each([
    ["canonical", "canonical"],
    ["serving URL", "serving"],
    ["raw GCS", "gcs"],
    ["already-protected", "protected"],
  ] as const)(
    "rejects an object referenced by a PRIVATE group when the row is persisted as %s (404)",
    async (_label, key) => {
      const v = variants("uploads/private-obj");
      // Media query returns a row whose mediaUrl is the given variant.
      h.enqueue(T.groupMediaTable, [{ mediaUrl: v[key], posterUrl: null }]);
      const res = await req("/storage/objects/uploads/private-obj");
      expect(res.status).toBe(404);
    },
  );

  it("rejects when the match is a private group's POSTER stored as raw GCS", async () => {
    const v = variants("uploads/private-obj");
    h.enqueue(T.groupMediaTable, []); // no media match
    h.enqueue(T.groupPostsTable, [{ mediaUrl: null, posterUrl: v.gcs }]);
    const res = await req("/storage/objects/uploads/private-obj");
    expect(res.status).toBe(404);
  });

  it("rejects a HIDDEN private group's branding (icon stored as serving URL)", async () => {
    const v = variants("uploads/private-obj");
    h.enqueue(T.groupMediaTable, []);
    h.enqueue(T.groupPostsTable, []);
    h.enqueue(T.groupsTable, [{ iconUrl: v.serving, coverUrl: null }]); // hidden branding
    const res = await req("/storage/objects/uploads/private-obj");
    expect(res.status).toBe(404);
  });

  it("serves an object NOT referenced by any private group", async () => {
    enqueueNoPrivateRefs();
    const res = await req("/storage/objects/uploads/shared-obj");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("FAKEBYTES");
  });

  it("serves an unrelated object even when SOME private rows exist (no normalized match)", async () => {
    // Private rows exist but reference a DIFFERENT object → the requested one is public.
    h.enqueue(T.groupMediaTable, [
      { mediaUrl: "/objects/uploads/some-other", posterUrl: null },
    ]);
    h.enqueue(T.groupPostsTable, [
      { mediaUrl: "https://storage.googleapis.com/test-bucket/private/uploads/another", posterUrl: null },
    ]);
    h.enqueue(T.groupsTable, []);
    const res = await req("/storage/objects/uploads/shared-obj");
    expect(res.status).toBe(200);
  });

  it("forces attachment + nosniff for a PDF (non-private object)", async () => {
    store.contentType = "application/pdf";
    enqueueNoPrivateRefs();
    const res = await req("/storage/objects/uploads/doc.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("#1 media bypass — protected group-asset route (all persisted variants)", () => {
  it.each([
    ["canonical", "canonical"],
    ["serving URL", "serving"],
    ["raw GCS", "gcs"],
    ["already-protected", "protected"],
  ] as const)(
    "allows a MEMBER and streams when the group row persists the media as %s",
    async (_label, key) => {
      const v = variants("uploads/private-obj");
      h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
      h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // getGroupMemberRole
      h.enqueue(T.groupMediaTable, [{ mediaUrl: v[key], posterUrl: null }]); // reference match
      const res = await req("/group-assets/1/objects/uploads/private-obj", { user: member });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it("denies a NON-MEMBER of a private group (403)", async () => {
    h.enqueue(T.groupsTable, [privateVisibleGroup]);
    h.enqueue(T.groupMembersTable, []); // no membership
    const res = await req("/group-assets/1/objects/uploads/private-obj", { user: nonMember });
    expect(res.status).toBe(403);
  });

  it("404s (fail-closed) when the object is NOT referenced by THIS group even for a member", async () => {
    h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    // A DIFFERENT object is referenced → requested one must not match.
    h.enqueue(T.groupMediaTable, [{ mediaUrl: "/objects/uploads/some-other", posterUrl: null }]);
    h.enqueue(T.groupPostsTable, []); // post miss
    h.enqueue(T.groupsTable, [privateVisibleGroup]); // branding query (visible → no match anyway)
    const res = await req("/group-assets/1/objects/uploads/other-group-obj", { user: member });
    expect(res.status).toBe(404);
  });

  it("serves a HIDDEN private group's branding to a member (icon persisted as raw GCS)", async () => {
    const v = variants("uploads/private-obj");
    const hidden = { ...privateHiddenGroup, iconUrl: v.gcs };
    h.enqueue(T.groupsTable, [hidden]); // group lookup
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupMediaTable, []); // media miss
    h.enqueue(T.groupPostsTable, []); // post miss
    h.enqueue(T.groupsTable, [hidden]); // branding query — hidden + matches icon
    const res = await req("/group-assets/2/objects/uploads/private-obj", { user: member });
    expect(res.status).toBe(200);
  });

  it("preserves PDF attachment on the protected route (post reference)", async () => {
    store.contentType = "application/pdf";
    const v = variants("uploads/file.pdf");
    h.enqueue(T.groupsTable, [privateVisibleGroup]);
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupMediaTable, []); // media miss
    h.enqueue(T.groupPostsTable, [{ mediaUrl: v.serving, posterUrl: null }]); // post match
    const res = await req("/group-assets/1/objects/uploads/file.pdf", { user: member });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });
});

// Fields that MUST NOT appear in a sanitized preview (owner identity + internal
// settings/lifecycle/counters).
const FORBIDDEN_PREVIEW_FIELDS = [
  "creatorUserId",
  "postingPermission",
  "postApproval",
  "status",
  "isFeatured",
  "postCount",
  "eventCount",
  "updatedAt",
  "posts",
  "members",
  "media",
  "events",
];
// Fields the discovery/request UI REQUIRES on a preview.
const REQUIRED_PREVIEW_FIELDS = [
  "id",
  "name",
  "handle",
  "description",
  "iconUrl",
  "coverUrl",
  "category",
  "customCategory",
  "tags",
  "location",
  "privacy",
  "visibility",
  "memberCount",
  "viewerMemberRole",
  "viewerHasPendingRequest",
  "isPreview",
];

function assertPreviewAllowlist(body: Record<string, unknown>) {
  for (const f of FORBIDDEN_PREVIEW_FIELDS) {
    expect(body, `preview must OMIT "${f}"`).not.toHaveProperty(f);
  }
  for (const f of REQUIRED_PREVIEW_FIELDS) {
    expect(body, `preview must INCLUDE "${f}"`).toHaveProperty(f);
  }
}

describe("#2 visible-private preview vs hidden denial (allowlisted serializer)", () => {
  it("returns an allowlisted preview for a private+visible non-member (no owner/internal fields)", async () => {
    h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
    h.enqueue(T.groupMembersTable, []); // resolveGroupAccess → not a member
    h.enqueue(T.groupJoinRequestsTable, []); // loadPendingRequest → none
    const res = await req("/groups/1", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isPreview).toBe(true);
    expect(body.id).toBe(1);
    expect(body.name).toBe("Private Visible");
    assertPreviewAllowlist(body);
    // Visible-private branding stays PUBLIC (universal storage URL, not protected).
    expect(body.iconUrl).toBe("/api/storage/objects/uploads/icon-1");
  });

  it("denies a private+hidden group to a non-member without a valid invite (403)", async () => {
    h.enqueue(T.groupsTable, [privateHiddenGroup]);
    h.enqueue(T.groupMembersTable, []); // not a member
    h.enqueue(T.groupInvitesTable, []); // no pending invite
    const res = await req("/groups/2", { user: nonMember });
    expect(res.status).toBe(403);
  });

  it("returns an allowlisted preview for a private+hidden group WITH a valid invite, with PROTECTED branding", async () => {
    // Hidden group branding is protected → preview must rewrite icon/cover URLs.
    const hidden = {
      ...privateHiddenGroup,
      iconUrl: "/api/storage/objects/uploads/hidden-icon",
      coverUrl: "/objects/uploads/hidden-cover",
    };
    h.enqueue(T.groupsTable, [hidden]);
    h.enqueue(T.groupMembersTable, []); // not a member
    h.enqueue(T.groupInvitesTable, [{ id: 500 }]); // valid pending invite
    h.enqueue(T.groupJoinRequestsTable, []); // no pending request
    const res = await req("/groups/2", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isPreview).toBe(true);
    assertPreviewAllowlist(body);
    // Hidden branding must be served through the protected route, never the
    // universal public storage route.
    expect(body.iconUrl).toBe("/api/group-assets/2/objects/uploads/hidden-icon");
    expect(body.coverUrl).toBe("/api/group-assets/2/objects/uploads/hidden-cover");
  });

  it("full (member) detail of a HIDDEN group also emits PROTECTED branding", async () => {
    const hidden = {
      ...privateHiddenGroup,
      iconUrl: "https://storage.googleapis.com/test-bucket/private/uploads/h-icon",
      coverUrl: null,
    };
    h.enqueue(T.groupsTable, [hidden]); // group lookup
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // member
    h.enqueue(T.groupJoinRequestsTable, []); // pending
    const res = await req("/groups/2", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Full response (not a preview) — carries internal fields.
    expect(body.isPreview).toBeUndefined();
    expect(body).toHaveProperty("creatorUserId");
    // Raw-GCS branding is rewritten to the protected form for the hidden group.
    expect(body.iconUrl).toBe("/api/group-assets/2/objects/uploads/h-icon");
  });

  it("full (member) detail of a VISIBLE-private group keeps branding PUBLIC", async () => {
    h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
    h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
    h.enqueue(T.groupJoinRequestsTable, []);
    const res = await req("/groups/1", { user: member });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.iconUrl).toBe("/api/storage/objects/uploads/icon-1");
  });
});

describe("#3 dashboard contract", () => {
  it("listMyGroups includes groups with a PENDING request (viewerHasPendingRequest=true)", async () => {
    h.enqueue(T.groupMembersTable, []); // no active memberships
    h.enqueue(T.groupJoinRequestsTable, [{ groupId: 1 }]); // one pending request
    h.enqueue(T.groupsTable, [privateVisibleGroup]); // hydrate group rows
    const res = await req("/groups/my", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; viewerHasPendingRequest: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(1);
    expect(body[0].viewerHasPendingRequest).toBe(true);
  });

  it("listMyGroupInvites returns the enriched payload (group summary + inviter fields)", async () => {
    // Auto-expire UPDATE (inert), then the pending-invites SELECT.
    h.enqueue(T.groupInvitesTable, [
      {
        id: 42,
        groupId: 1,
        invitedByUserId: 7,
        invitedUserId: 20,
        status: "pending",
        createdAt: new Date("2024-03-01T00:00:00Z"),
        expiresAt: null,
      },
    ]);
    h.enqueue(T.groupsTable, [
      {
        id: 1,
        name: "Private Visible",
        iconUrl: "/api/storage/objects/uploads/icon-1",
        privacy: "private",
        visibility: "visible",
      },
    ]);
    h.enqueue(T.usersTable, [{ id: 7, name: "Inviter Jo", profilePhotoUrl: "/photo.jpg" }]);
    const res = await req("/groups/invites", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: number;
      group: { id: number; name: string; iconUrl: string | null } | null;
      inviterId: number;
      inviterName: string;
      inviterPhotoUrl: string | null;
      groupName: string | null;
    }>;
    expect(body).toHaveLength(1);
    // Visible-private invite icon stays PUBLIC (unmodified).
    expect(body[0].group).toMatchObject({
      id: 1,
      name: "Private Visible",
      iconUrl: "/api/storage/objects/uploads/icon-1",
      groupType: "group",
    });
    expect(body[0].inviterId).toBe(7);
    expect(body[0].inviterName).toBe("Inviter Jo");
    expect(body[0].inviterPhotoUrl).toBe("/photo.jpg");
    // Backward-compatible flat fields retained.
    expect(body[0].groupName).toBe("Private Visible");
  });

  it("listMyGroupInvites rewrites a HIDDEN-private group's invite icon to the PROTECTED route", async () => {
    h.enqueue(T.groupInvitesTable, [
      {
        id: 43,
        groupId: 2,
        invitedByUserId: 7,
        invitedUserId: 20,
        status: "pending",
        createdAt: new Date("2024-03-02T00:00:00Z"),
        expiresAt: null,
      },
    ]);
    h.enqueue(T.groupsTable, [
      {
        id: 2,
        name: "Hidden",
        iconUrl: "/api/storage/objects/uploads/hidden-icon",
        privacy: "private",
        visibility: "hidden",
      },
    ]);
    h.enqueue(T.usersTable, [{ id: 7, name: "Inviter Jo", profilePhotoUrl: "/photo.jpg" }]);
    const res = await req("/groups/invites", { user: nonMember });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      group: { id: number; name: string; iconUrl: string | null } | null;
    }>;
    // Hidden-private branding must be served via the access-controlled route,
    // not the universal (now-denied) storage route.
    expect(body[0].group).toMatchObject({
      id: 2,
      name: "Hidden",
      iconUrl: "/api/group-assets/2/objects/uploads/hidden-icon",
      groupType: "group",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group EVENT image protection (private-group event image bypass fix).
// ─────────────────────────────────────────────────────────────────────────────
describe("#4 private Group EVENT image bypass", () => {
  describe("universal storage route", () => {
    it.each([
      ["canonical", "canonical"],
      ["raw GCS", "gcs"],
    ] as const)(
      "404s an event image referenced by a PRIVATE group when persisted as %s",
      async (_label, key) => {
        const v = variants("uploads/event-obj");
        // isObjectReferencedByPrivateGroup: media miss, post miss, EVENT hit.
        h.enqueue(T.groupMediaTable, []);
        h.enqueue(T.groupPostsTable, []);
        h.enqueue(T.groupEventsTable, [{ imageUrl: v[key] }]);
        const res = await req("/storage/objects/uploads/event-obj");
        expect(res.status).toBe(404);
      },
    );

    it("serves an event image belonging only to a PUBLIC group (not referenced by any private group)", async () => {
      // Public-group event images are not returned by the private-group scan.
      h.enqueue(T.groupMediaTable, []);
      h.enqueue(T.groupPostsTable, []);
      h.enqueue(T.groupEventsTable, []); // scoped to private groups → none
      h.enqueue(T.groupsTable, []); // branding
      const res = await req("/storage/objects/uploads/public-event-obj");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });

  describe("protected group-asset route", () => {
    it.each([
      ["canonical", "canonical"],
      ["raw GCS", "gcs"],
    ] as const)(
      "member 200: streams an event image referenced by THIS group, persisted as %s",
      async (_label, key) => {
        const v = variants("uploads/event-obj");
        h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
        h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
        h.enqueue(T.groupMediaTable, []); // media miss
        h.enqueue(T.groupPostsTable, []); // post miss
        h.enqueue(T.groupEventsTable, [{ imageUrl: v[key] }]); // event hit
        const res = await req("/group-assets/1/objects/uploads/event-obj", { user: member });
        expect(res.status).toBe(200);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      },
    );

    it("non-member 403 for a private group's event image", async () => {
      h.enqueue(T.groupsTable, [privateVisibleGroup]);
      h.enqueue(T.groupMembersTable, []); // not a member
      const res = await req("/group-assets/1/objects/uploads/event-obj", { user: nonMember });
      expect(res.status).toBe(403);
    });

    it("404 (fail-closed) when the event image belongs to a DIFFERENT group (same-group enforcement)", async () => {
      h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
      h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]);
      h.enqueue(T.groupMediaTable, []); // media miss
      h.enqueue(T.groupPostsTable, []); // post miss
      // This group's event references a DIFFERENT object → requested one must not match.
      h.enqueue(T.groupEventsTable, [{ imageUrl: "/objects/uploads/some-other-event" }]);
      h.enqueue(T.groupsTable, [privateVisibleGroup]); // branding query (visible → no match)
      const res = await req("/group-assets/1/objects/uploads/event-obj", { user: member });
      expect(res.status).toBe(404);
    });
  });

  describe("response rewrite", () => {
    it("PRIVATE group event detail rewrites imageUrl to the protected route", async () => {
      h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
      h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // access
      h.enqueue(T.groupEventsTable, [
        eventRow({ groupId: 1, imageUrl: "/api/storage/objects/uploads/event-obj" }),
      ]);
      h.enqueue(T.groupEventRsvpsTable, []); // viewer rsvp
      const res = await req("/groups/1/events/77", { user: member });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { imageUrl: string | null };
      expect(body.imageUrl).toBe("/api/group-assets/1/objects/uploads/event-obj");
    });

    it("PRIVATE group event LIST rewrites imageUrl to the protected route", async () => {
      h.enqueue(T.groupsTable, [privateVisibleGroup]); // group lookup
      h.enqueue(T.groupMembersTable, [{ role: "member", status: "active" }]); // access
      h.enqueue(T.groupEventsTable, [
        eventRow({ groupId: 1, imageUrl: "https://storage.googleapis.com/test-bucket/private/uploads/event-obj" }),
      ]);
      h.enqueue(T.groupEventRsvpsTable, []); // per-event viewer rsvp
      const res = await req("/groups/1/events", { user: member });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ imageUrl: string | null }>;
      expect(body[0].imageUrl).toBe("/api/group-assets/1/objects/uploads/event-obj");
    });

    it("PUBLIC group event image is left UNMODIFIED (universal URL)", async () => {
      h.enqueue(T.groupsTable, [publicGroup]); // group lookup (public → access allowed)
      // resolveGroupAccess for a public group still calls getGroupMemberRole.
      h.enqueue(T.groupMembersTable, []);
      h.enqueue(T.groupEventsTable, [
        eventRow({ groupId: 3, imageUrl: "/api/storage/objects/uploads/public-event-obj" }),
      ]);
      h.enqueue(T.groupEventRsvpsTable, []);
      const res = await req("/groups/3/events/77", { user: nonMember });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { imageUrl: string | null };
      expect(body.imageUrl).toBe("/api/storage/objects/uploads/public-event-obj");
    });
  });
});
