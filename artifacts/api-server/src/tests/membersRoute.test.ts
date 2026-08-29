import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type IRouter } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => {
  let memberRows: unknown[] = [];
  let dollRows: unknown[] = [];
  let blockRows: unknown[] = [];
  const whereValues: string[] = [];
  const stringsIn = (value: unknown, seen = new WeakSet<object>()): string[] => {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object" || seen.has(value)) return [];
    seen.add(value);
    return Object.values(value as Record<string, unknown>).flatMap((item) => stringsIn(item, seen));
  };
  const db = {
    select: () => {
      let joined = false; let table: unknown;
      const b: Record<string, unknown> = {
        from: (t: unknown) => { table = t; return b; },
        innerJoin: () => { joined = true; return b; },
        where: (condition: unknown) => { whereValues.push(...stringsIn(condition)); return b; },
        then: (resolve: (rows: unknown[]) => unknown) => {
          // Predicate-aware in-memory DB: only evaluate eligibility when the
          // actual production WHERE clause carries every required value.
          const has = (...values: string[]) => values.every((value) => whereValues.includes(value));
          const rows = joined
            ? dollRows.filter((row) => !has("doll", "active", "approved") || (
              (row as { role?: string }).role === "doll" &&
              (row as { accountStatus?: string }).accountStatus === "active" &&
              (row as { applicationStatus?: string }).applicationStatus === "approved"
            ))
            : table === T?.blocksTable ? blockRows
              : memberRows.filter((row) => !has("member", "active") || (
                (row as { role?: string }).role === "member" &&
                (row as { accountStatus?: string }).accountStatus === "active"
              ));
          return Promise.resolve(rows).then(resolve);
        },
      };
      return b;
    },
  };
  let T: Record<string, unknown> | undefined;
  return {
    db,
    setTables(t: Record<string, unknown>) { T = t; },
    set(rows: { members?: unknown[]; dolls?: unknown[]; blocks?: unknown[] }) {
      whereValues.length = 0;
      memberRows = rows.members ?? []; dollRows = rows.dolls ?? []; blockRows = rows.blocks ?? [];
    },
  };
});

vi.mock("@workspace/db", async () => ({ ...(await vi.importActual<Record<string, unknown>>("@workspace/db")), db: h.db }));
vi.mock("../lib/auth", () => ({
  getSessionUser: async (req: { header(name: string): string | undefined }) =>
    req.header("x-test-user") ? { id: Number(req.header("x-test-user")) } : null,
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let router: IRouter;
let server: Server;
let base: string;
const member = { id: 1, role: "member", accountStatus: "active", name: "Member", username: "member", city: "Austin", state: "TX", profilePhotoUrl: null, buddyType: null, createdAt: new Date("2026-01-01") };
const doll = { id: 2, role: "doll", accountStatus: "active", applicationStatus: "approved", name: "Owner", username: "doll", city: null, state: null, profilePhotoUrl: null, buddyType: "male_buddy", createdAt: new Date("2026-02-01"), dollId: 8, stageName: "Doll", dollAge: 24, dollCity: "Dallas", dollState: "TX", dollProfilePhotoUrl: null };

beforeEach(async () => {
  if (!router) {
    router = (await import("../routes/members")).default as IRouter;
    h.setTables(await vi.importActual<Record<string, unknown>>("@workspace/db"));
  }
  const app = express(); app.use("/api", router);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("GET /members", () => {
  it("is anonymous and returns the normalized active/approved union", async () => {
    h.set({ members: [member], dolls: [doll] });
    const response = await fetch(`${base}/members`);
    expect(response.status).toBe(200);
    const body = await response.json() as Array<Record<string, unknown>>;
    expect(body.map((p) => p.id)).toEqual([2, 1]);
    expect(body[0]).toMatchObject({ accountType: "doll", name: "Doll", profileUrl: "/dolls/8" });
  });

  it("proves persisted eligibility predicates exclude inactive and unapproved candidates", async () => {
    h.set({
      members: [member, { ...member, id: 3, accountStatus: "suspended" }],
      dolls: [
        doll,
        { ...doll, id: 4, dollId: 9, accountStatus: "suspended" },
        { ...doll, id: 5, dollId: 10, applicationStatus: "pending" },
      ],
    });
    const body = await (await fetch(`${base}/members`)).json() as Array<Record<string, unknown>>;
    expect(body.map((profile) => profile.id)).toEqual([2, 1]);
  });

  it("removes candidates blocked in either direction for an authenticated viewer", async () => {
    h.set({ members: [member], dolls: [doll], blocks: [{ blockerId: 99, blockedUserId: 1 }, { blockerId: 2, blockedUserId: 99 }] });
    const response = await fetch(`${base}/members`, { headers: { "x-test-user": "99" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("returns clear validation errors before querying", async () => {
    h.set({ members: [member], dolls: [doll] });
    expect((await fetch(`${base}/members?minAge=17`)).status).toBe(400);
    expect((await fetch(`${base}/members?minAge=40&maxAge=20`)).status).toBe(400);
  });
});