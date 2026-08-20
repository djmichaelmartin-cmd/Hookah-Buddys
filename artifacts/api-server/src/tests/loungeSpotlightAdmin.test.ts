/**
 * ADMIN action tests for Local Lounge Spotlight eligibility moderation.
 *
 * Mounts the REAL `businessesRouter` and drives the admin moderate endpoint over
 * HTTP. Verifies spotlight_enable / spotlight_disable flip the flag, invalidate
 * the durable daily caches (a delete against daily_lounge_spotlights), and write
 * a moderation-log row — without ever logging coordinates or the location key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type IRouter } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => {
  const queues = new Map<unknown, unknown[][]>();
  const inserted: { table: unknown; values: unknown }[] = [];
  const updated: { set: unknown }[] = [];
  const deleted: { table: unknown }[] = [];
  function enqueue(table: unknown, rows: unknown[]) {
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table)!.push(rows);
  }
  function reset() {
    queues.clear();
    inserted.length = 0;
    updated.length = 0;
    deleted.length = 0;
  }
  function nextRows(table: unknown): unknown[] {
    const q = queues.get(table);
    if (q && q.length) return q.shift()!;
    return [];
  }

  function makeSelectBuilder() {
    let fromTable: unknown = null;
    const b: Record<string, unknown> = {};
    const chain = (fn?: (a: unknown) => void) => (a?: unknown) => {
      if (fn) fn(a);
      return b;
    };
    b.from = chain((t) => {
      if (fromTable === null) fromTable = t;
    });
    b.innerJoin = chain();
    b.leftJoin = chain();
    b.where = chain();
    b.orderBy = chain();
    b.limit = chain();
    b.offset = chain();
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(nextRows(fromTable)).then(resolve);
    return b;
  }

  function makeUpdateBuilder() {
    const b: Record<string, unknown> = {};
    let setVal: unknown = null;
    b.set = (v: unknown) => {
      setVal = v;
      updated.push({ set: v });
      return b;
    };
    b.where = () => b;
    // returning yields the updated row echoing the set flag.
    b.returning = () => Promise.resolve([{ id: 7, ...(setVal as object) }]);
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
    return b;
  }

  function makeInsertBuilder(table: unknown) {
    const b: Record<string, unknown> = {};
    b.values = (v: unknown) => {
      inserted.push({ table, values: v });
      return b;
    };
    b.onConflictDoNothing = () => b;
    b.onConflictDoUpdate = () => b;
    b.returning = () => Promise.resolve([]);
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
    return b;
  }

  function makeDeleteBuilder(table: unknown) {
    const b: Record<string, unknown> = {};
    b.where = () => {
      deleted.push({ table });
      return b;
    };
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
    return b;
  }

  const db = {
    select: () => makeSelectBuilder(),
    insert: (t: unknown) => makeInsertBuilder(t),
    update: () => makeUpdateBuilder(),
    delete: (t: unknown) => makeDeleteBuilder(t),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  return { enqueue, reset, db, inserted, updated, deleted };
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
      const u = await getSessionUser(req);
      if (!u) {
        res.status(401).json({ error: "auth" });
        return;
      }
      req.currentUser = u;
      next();
    };
  return { getSessionUser, requireAuth };
});

let businessesRouter: IRouter;
let server: Server;
let baseUrl: string;
let T: Record<string, unknown>;
const admin = { id: 1, role: "admin", accountStatus: "active" };

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", businessesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
}

const bizRow = {
  id: 7,
  ownerUserId: 99,
  handle: "lounge-x",
  name: "Lounge X",
  businessType: "lounge",
  category: null,
  showOwner: false,
  badges: [],
  status: "active",
  isPublished: true,
  verificationStatus: "verified",
  isFeatured: false,
  isSponsored: false,
  eligibleForLoungeSpotlight: true,
  country: "US",
  bookingSlotIntervalMinutes: 30,
  bookingBufferMinutes: 0,
  bookingDefaultDurationMinutes: 60,
  bookingEnabled: false,
  allowMentions: true,
  mentionsRequireApproval: false,
  followerCount: 0,
  saveCount: 0,
  reviewCount: 3,
  checkInCount: 0,
  postCount: 0,
  averageRating: 4.4,
  createdAt: new Date(),
  updatedAt: new Date(),
  hours: null,
  timezone: null,
  isOpenNowOverride: null,
};

beforeEach(async () => {
  h.reset();
  if (!businessesRouter) {
    businessesRouter = (await import("../routes/businesses")).default as IRouter;
    T = await vi.importActual<Record<string, unknown>>("@workspace/db");
  }
  await startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function moderate(action: string) {
  // Query order: getBusinessByHandle → (update/delete/insert-log) → fresh
  // re-fetch → serializeBusinessDetail (follows, saves, roles).
  h.enqueue(T.businessesTable, [{ ...bizRow }]); // getBusinessByHandle
  h.enqueue(T.businessesTable, [
    { ...bizRow, eligibleForLoungeSpotlight: action === "spotlight_enable" },
  ]); // fresh
  h.enqueue(T.businessFollowsTable, []);
  h.enqueue(T.businessSavesTable, []);
  h.enqueue(T.businessPageRolesTable, []);
  const res = await fetch(`${baseUrl}/admin/businesses/lounge-x/moderate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user": JSON.stringify(admin),
    },
    body: JSON.stringify({ action }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("admin spotlight moderation", () => {
  it("spotlight_disable flips the flag, invalidates caches, logs the action", async () => {
    const { status } = await moderate("spotlight_disable");
    expect(status).toBe(200);
    const flagUpdate = h.updated.find(
      (u) => (u.set as Record<string, unknown>).eligibleForLoungeSpotlight === false,
    );
    expect(flagUpdate).toBeTruthy();
    // Durable daily caches invalidated.
    expect(
      h.deleted.find((d) => d.table === T.dailyLoungeSpotlightsTable),
    ).toBeTruthy();
    // Moderation log written safely (no coordinates present).
    const log = h.inserted.find((i) => i.table === T.businessModerationLogsTable);
    expect(log).toBeTruthy();
    expect((log!.values as Record<string, unknown>).action).toBe("spotlight_disable");
    expect(JSON.stringify(log!.values)).not.toMatch(/lat|lng|locationKey/i);
  });

  it("spotlight_enable flips the flag back on", async () => {
    const { status } = await moderate("spotlight_enable");
    expect(status).toBe(200);
    const flagUpdate = h.updated.find(
      (u) => (u.set as Record<string, unknown>).eligibleForLoungeSpotlight === true,
    );
    expect(flagUpdate).toBeTruthy();
  });
});
