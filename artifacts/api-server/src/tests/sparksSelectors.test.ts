import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  ListEditableReelBusinessesQueryParams,
  ListTaggableReelUsersQueryParams,
} from "@workspace/api-zod";

it("defines bounded selector searches in the generated contract", () => {
  expect(ListTaggableReelUsersQueryParams.parse({ search: "Ari" }).search).toBe("Ari");
  expect(ListEditableReelBusinessesQueryParams.parse({ search: "Lounge" }).search).toBe("Lounge");
  expect(
    ListTaggableReelUsersQueryParams.safeParse({ search: "x".repeat(101) }).success,
  ).toBe(false);
});

it("keeps selector routes ahead of the legacy reel id route and applies access filters", async () => {
  const source = await readFile(new URL("../routes/reels.ts", import.meta.url), "utf8");
  const taggableRoute = source.indexOf('router.get("/reels/taggable-users"');
  const editableRoute = source.indexOf('router.get("/reels/editable-businesses"');
  const idRoute = source.indexOf('router.get("/reels/:id"');

  expect(taggableRoute).toBeGreaterThan(-1);
  expect(editableRoute).toBeGreaterThan(-1);
  expect(taggableRoute).toBeLessThan(idRoute);
  expect(editableRoute).toBeLessThan(idRoute);
  expect(source).toMatch(/eq\(usersTable\.accountStatus, "active"\)/);
  expect(source).toMatch(/ne\(usersTable\.id, user\.id\)/);
  expect(source).toMatch(/relationship\.viewerBlockedTarget \|\| relationship\.targetBlockedViewer/);
  expect(source).toMatch(/settings\.allowTagging === "no_one"/);
  expect(source).toMatch(/settings\.allowTagging === "friends" && !relationship\.isFriend/);
  expect(source).toMatch(/eq\(businessesTable\.status, "active"\)/);
  expect(source).toMatch(/inArray\(businessPageRolesTable\.role, \["owner", "admin", "editor"\]\)/);
});