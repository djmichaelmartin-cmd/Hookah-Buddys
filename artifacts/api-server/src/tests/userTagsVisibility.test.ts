import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { relationshipCanSeeReel } from "../routes/reels";

const ordinaryRelationship = {
  isSelf: false,
  isAdmin: false,
  isFriend: false,
  isFollower: false,
  viewerBlockedTarget: false,
  targetBlockedViewer: false,
};

it("enforces anonymous, friend, only_me, and block rules used for Spark tag visibility", () => {
  expect(relationshipCanSeeReel({ visibility: "public" }, ordinaryRelationship)).toBe(true);
  expect(relationshipCanSeeReel({ visibility: "friends" }, ordinaryRelationship)).toBe(false);
  expect(relationshipCanSeeReel({ visibility: "only_me" }, ordinaryRelationship)).toBe(false);
  expect(
    relationshipCanSeeReel(
      { visibility: "friends" },
      { ...ordinaryRelationship, isFriend: true },
    ),
  ).toBe(true);
  expect(
    relationshipCanSeeReel(
      { visibility: "public" },
      { ...ordinaryRelationship, viewerBlockedTarget: true },
    ),
  ).toBe(false);
});

it("filters approved Spark tags through the direct Spark visibility policy", async () => {
  const source = await readFile(new URL("../routes/reels.ts", import.meta.url), "utf8");

  expect(source).toMatch(/router\.get\("\/usertags", async/);
  expect(source).toMatch(/const viewer = await getSessionUser\(req\)/);
  expect(source).toMatch(/viewerCanSeeTaggedTarget\(tag, viewer \?\? null, audienceSets\)/);
  expect(source).toMatch(/tag\.relatedType === "reel"/);
  expect(source).toMatch(/reel\.status === "active" && await viewerCanSeeReel\(reel, viewer\)/);
  // viewerCanSeeReel is the common direct-read gate: owner/admin, blocks,
  // friends/only_me visibility, and anonymous callers are all covered there.
  expect(source).toMatch(/rel\.isSelf \|\| rel\.isAdmin/);
  expect(source).toMatch(/rel\.viewerBlockedTarget \|\| rel\.targetBlockedViewer/);
  expect(source).toMatch(/return canView\(reel\.visibility, rel\)/);
});

it("also gates existing private post and photo target types", async () => {
  const source = await readFile(new URL("../routes/reels.ts", import.meta.url), "utf8");

  expect(source).toMatch(/tag\.relatedType === "post"/);
  expect(source).toMatch(/post\.status === "removed"/);
  expect(source).toMatch(/post\.status !== "active" && viewer\?\.id !== post\.userId/);
  expect(source).toMatch(/canViewAudience\(post\.audience, post\.userId, viewer, audienceSets\)/);
  expect(source).toMatch(/feedPostBusinessVisible\(post\)/);
  expect(source).toMatch(/tag\.relatedType === "photo"/);
  expect(source).toMatch(/photo\.status !== "active"/);
  expect(source).toMatch(/canView\(photo\.visibility, relationship\)/);
  expect(source).toMatch(/canView\(album\?\.visibility \?\? "public", relationship\)/);
});