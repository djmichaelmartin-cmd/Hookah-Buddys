import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  RegisterDollBody,
  RegisterMemberBody,
  UpdateMyProfileBody,
  UpdateUserBuddyTypeBody,
  ListMembersQueryParams,
  ListUsersQueryParams,
  ListFollowsResponseItem,
  ListOnlineUsersResponseItem,
  ListDollsResponseItem,
  ListBlockedUsersResponseItem,
  GetBroProfileResponse,
  ListMembersResponseItem,
} from "@workspace/api-zod";
import { requireCompleteBuddyProfile } from "../lib/buddyProfile";

const registrationBase = {
  email: "person@example.com",
  password: "secret1",
  ageConfirmed: true,
  rulesAccepted: true,
};

describe("Buddy type contracts", () => {
  it.each(["female_buddy", "male_buddy"] as const)(
    "accepts %s on both registrations",
    (buddyType) => {
      expect(
        RegisterMemberBody.safeParse({
          ...registrationBase,
          firstName: "Test",
          lastName: "Person",
          name: "Person",
          username: "person",
          buddyType,
        }).success,
      ).toBe(true);
      expect(
        RegisterDollBody.safeParse({
          ...registrationBase,
          legalName: "Person",
          stageName: "Buddy",
          city: "Las Vegas",
          state: "NV",
          bio: "",
          favoriteFlavor: "",
          experienceLevel: "",
          planId: 80,
          buddyType,
        }).success,
      ).toBe(true);
    },
  );

  it.each([undefined, null, "", "female", "other"])(
    "rejects invalid registration value %s",
    (buddyType) => {
      expect(
        RegisterMemberBody.safeParse({
          ...registrationBase,
          name: "Person",
          username: "person",
          buddyType,
        }).success,
      ).toBe(false);
    },
  );

  it("allows omission for profile updates but rejects null, empty, and unknown values", () => {
    expect(UpdateMyProfileBody.safeParse({}).success).toBe(true);
    expect(
      UpdateMyProfileBody.safeParse({ buddyType: "female_buddy" }).success,
    ).toBe(true);
    expect(
      UpdateMyProfileBody.safeParse({ buddyType: "male_buddy" }).success,
    ).toBe(true);
    for (const buddyType of [null, "", "other"]) {
      expect(UpdateMyProfileBody.safeParse({ buddyType }).success).toBe(false);
    }
  });

  it("validates public and admin filters and the admin edit body", () => {
    expect(
      ListMembersQueryParams.safeParse({ buddyType: "female_buddy" }).success,
    ).toBe(true);
    expect(
      ListMembersQueryParams.safeParse({
        name: "alex",
        handle: "smoke",
        city: "Austin",
        state: "TX",
        search: "legacy",
        minAge: 18,
        maxAge: 120,
      }).success,
    ).toBe(true);
    expect(ListMembersQueryParams.safeParse({ minAge: 17 }).success).toBe(
      false,
    );
    expect(ListMembersQueryParams.safeParse({ maxAge: 121 }).success).toBe(
      false,
    );
    expect(
      ListMembersQueryParams.safeParse({ buddyType: "missing" }).success,
    ).toBe(false);
    expect(
      ListUsersQueryParams.safeParse({ buddyType: "missing" }).success,
    ).toBe(true);
    expect(UpdateUserBuddyTypeBody.safeParse({ buddyType: null }).success).toBe(
      false,
    );
    expect(
      UpdateUserBuddyTypeBody.safeParse({ buddyType: "male_buddy" }).success,
    ).toBe(true);
  });

  it("uses the privacy-safe union contract for member discovery", () => {
    const common = {
      id: 7,
      handle: null,
      age: null,
      city: null,
      state: null,
      profilePhotoUrl: null,
      buddyType: null,
      memberSince: "2026-01-01T00:00:00.000Z",
    };
    expect(
      ListMembersResponseItem.safeParse({
        ...common,
        accountType: "member",
        dollId: null,
        name: "Alex",
        profileUrl: "/bros/7",
      }).success,
    ).toBe(true);
    expect(
      ListMembersResponseItem.safeParse({
        ...common,
        accountType: "doll",
        dollId: 11,
        name: "Stage Name",
        age: 25,
        profileUrl: "/dolls/11",
      }).success,
    ).toBe(true);
    expect(
      ListMembersResponseItem.safeParse({
        ...common,
        accountType: "member",
        dollId: null,
        name: "Alex",
        profileUrl: "/bros/7",
        email: "private@example.com",
      }).success,
    ).toBe(true);
    expect(
      ListMembersResponseItem.safeParse({
        id: 7,
        name: "legacy shape",
        username: "alex",
        buddyType: null,
      }).success,
    ).toBe(false);
  });

  it("requires a nullable Buddy type in Doll, online, and follow projections", () => {
    const doll = {
      id: 1,
      creatorUserId: 2,
      stageName: "Buddy",
      city: "Las Vegas",
      state: "NV",
      verified: true,
      featured: false,
      elite: false,
      online: false,
      tier: "free",
    };
    expect(
      ListDollsResponseItem.safeParse({ ...doll, buddyType: null }).success,
    ).toBe(true);
    expect(ListDollsResponseItem.safeParse(doll).success).toBe(false);
    const online = {
      id: 1,
      role: "member",
      displayName: "Person",
      lastActiveAt: new Date(),
    };
    expect(
      ListOnlineUsersResponseItem.safeParse({
        ...online,
        buddyType: "female_buddy",
      }).success,
    ).toBe(true);
    expect(ListOnlineUsersResponseItem.safeParse(online).success).toBe(false);
    const follow = { id: 1, name: "Person", role: "member" };
    expect(
      ListFollowsResponseItem.safeParse({ ...follow, buddyType: null }).success,
    ).toBe(true);
    expect(ListFollowsResponseItem.safeParse(follow).success).toBe(false);
    expect(
      ListBlockedUsersResponseItem.safeParse({ ...follow, buddyType: null })
        .success,
    ).toBe(true);
    expect(ListBlockedUsersResponseItem.safeParse(follow).success).toBe(false);
    const bro = {
      id: 1,
      name: "Person",
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
    };
    expect(
      GetBroProfileResponse.safeParse({ ...bro, buddyType: null }).success,
    ).toBe(true);
    expect(GetBroProfileResponse.safeParse(bro).success).toBe(false);
  });
});

describe("requireCompleteBuddyProfile", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      const identity = req.header("x-test-user");
      const users = {
        legacyMember: { id: 1, role: "member", buddyType: null },
        legacyDoll: { id: 2, role: "doll", buddyType: null },
        completeMember: { id: 3, role: "member", buddyType: "female_buddy" },
        admin: { id: 4, role: "admin", buddyType: null },
      } as const;
      req.currentUser = users[identity as keyof typeof users] as never;
      next();
    });
    // This focused composition uses the same middleware arrangement as creation
    // routes while avoiding unrelated database setup.
    app.post("/creation", requireCompleteBuddyProfile, (_req, res) => {
      res.status(201).json({ created: true });
    });
    app.get("/read-only", (_req, res) => {
      res.json({ accessible: true });
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function request(path: string, identity?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: path === "/creation" ? "POST" : "GET",
      headers: identity ? { "x-test-user": identity } : undefined,
    });
  }

  it.each(["legacyMember", "legacyDoll"])(
    "rejects missing Buddy type over HTTP for %s creation",
    async (identity) => {
      const response = await request("/creation", identity);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "BUDDY_TYPE_REQUIRED",
      });
    },
  );

  it.each(["completeMember", "admin"])(
    "allows %s through the creation middleware to route behavior",
    async (identity) => {
      const response = await request("/creation", identity);
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ created: true });
    },
  );

  it("leaves a non-creation route accessible to legacy personal accounts", async () => {
    const response = await request("/read-only", "legacyMember");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accessible: true });
  });
});

describe("creation route wiring", () => {
  it.each([
    [
      "feed.ts",
      'router.post("/feed/posts", requireAuth(), requireCompleteBuddyProfile',
    ],
    [
      "reels.ts",
      'router.post("/reels", requireAuth(), requireCompleteBuddyProfile',
    ],
    [
      "groups.ts",
      'router.post("/groups", requireAuth(), requireCompleteBuddyProfile',
    ],
    [
      "groups.ts",
      'router.post("/groups/:groupId/events", requireAuth(), requireCompleteBuddyProfile',
    ],
    [
      "businesses.ts",
      'router.post("/businesses", requireAuth(), requireCompleteBuddyProfile',
    ],
    [
      "businesses.ts",
      'router.post("/businesses/:handle/events", requireAuth(), requireCompleteBuddyProfile',
    ],
  ])(
    "wires the completion guard after authentication in %s",
    (file, expected) => {
      const source = readFileSync(
        new URL(`../routes/${file}`, import.meta.url),
        "utf8",
      );
      expect(source).toContain(expected);
    },
  );

  it("does not block feed comments", () => {
    const source = readFileSync(
      new URL("../routes/feed.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'router.post("/feed/posts/:id/comments", requireAuth(), async',
    );
  });
});
