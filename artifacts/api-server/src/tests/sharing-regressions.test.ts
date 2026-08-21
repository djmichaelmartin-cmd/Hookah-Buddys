/**
 * Sharing regression tests for Task #70 (revised).
 *
 * Tests cover all 10 security/product gaps:
 *  1. Granular author controls (per-destination flags)
 *  2. Privacy-safe counts (owner/admin vs public exposure)
 *  3. Copy-link policy / rate limits
 *  4. Destination eligibility
 *  5. Business identity (no owner leak)
 *  6. Private recipient pre-auth
 *  7. Idempotency (dedupeKey)
 *  8. Group moderator notification on pending_approval
 *  9. Auth/preview parity (canonical source for wrappers)
 * 10. Input validation (NaN IDs, bad params, oversized comment, self-recipient)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

const apiRoot = path.resolve(process.cwd(), "src");
const sharingRoute = readFileSync(path.join(apiRoot, "routes/sharing.ts"), "utf8");
const sharingPolicy = readFileSync(path.join(apiRoot, "lib/sharingPolicy.ts"), "utf8");
const feedHelpers = readFileSync(path.join(apiRoot, "lib/feedHelpers.ts"), "utf8");
const groupsRoute = readFileSync(path.join(apiRoot, "routes/groups.ts"), "utf8");
const routeIndex = readFileSync(path.join(apiRoot, "routes/index.ts"), "utf8");
const schemaSharing = readFileSync(
  path.resolve(process.cwd(), "../../lib/db/src/schema/sharing.ts"),
  "utf8",
);
const schemaFeedPosts = readFileSync(
  path.resolve(process.cwd(), "../../lib/db/src/schema/feedPosts.ts"),
  "utf8",
);
const schemaGroups = readFileSync(
  path.resolve(process.cwd(), "../../lib/db/src/schema/groups.ts"),
  "utf8",
);

// ─────────────────────────────────────────────────────────────────────────────
// Route contract parity
// ─────────────────────────────────────────────────────────────────────────────

test("sharing router is registered in routes/index.ts", () => {
  assert.match(routeIndex, /import sharingRouter from "\.\/sharing"/);
  assert.match(routeIndex, /router\.use\(sharingRouter\)/);
});

test("all required feed sharing routes exist", () => {
  const routes = [
    'router.patch("/feed/posts/:id/sharing"',
    'router.post("/feed/posts/:id/share"',
    'router.post("/feed/posts/:id/copy-link"',
    'router.get("/feed/share-recipients"',
    'router.get("/feed/share-groups"',
    'router.get("/feed/shares/private"',
  ];
  for (const route of routes) {
    assert.ok(sharingRoute.includes(route), `Missing route: ${route}`);
  }
});

test("all required group sharing routes exist", () => {
  const routes = [
    '"/groups/:groupId/posts/:postId/sharing"',
    '"/groups/:groupId/posts/:postId/share"',
    '"/groups/:groupId/posts/:postId/copy-link"',
  ];
  for (const route of routes) {
    assert.ok(sharingRoute.includes(route), `Missing group route: ${route}`);
  }
});

test("admin routes registered in correct order (suspensions before :shareId)", () => {
  const suspIdx = sharingRoute.indexOf('"/admin/shares/suspensions"');
  const shareIdIdx = sharingRoute.indexOf('"/admin/shares/:shareId"');
  assert.ok(suspIdx !== -1, "suspensions route must exist");
  assert.ok(shareIdIdx !== -1, ":shareId route must exist");
  assert.ok(suspIdx < shareIdIdx, "suspensions GET must be registered before :shareId PATCH");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 1: Granular author controls
// ─────────────────────────────────────────────────────────────────────────────

test("schema: postSharingSettingsTable has granular per-destination flags", () => {
  assert.match(schemaSharing, /allowPublicShares.*boolean/, "missing allowPublicShares column");
  assert.match(schemaSharing, /allowFriendsShares.*boolean/, "missing allowFriendsShares column");
  assert.match(schemaSharing, /allowPrivateShares.*boolean/, "missing allowPrivateShares column");
  assert.match(schemaSharing, /allowGroupShares.*boolean/, "missing allowGroupShares column");
  assert.match(schemaSharing, /sharingDisabled.*boolean/, "missing sharingDisabled (global) column");
});

test("policy: checkSharingEligibility enforces per-destination flags", () => {
  // Look for per-destination flag checks
  const fnStart = sharingPolicy.indexOf("export async function checkSharingEligibility");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(
    fnBody,
    /allowPublicShares/,
    "must check allowPublicShares flag",
  );
  assert.match(
    fnBody,
    /allowFriendsShares/,
    "must check allowFriendsShares flag",
  );
  assert.match(
    fnBody,
    /allowPrivateShares/,
    "must check allowPrivateShares flag",
  );
  assert.match(
    fnBody,
    /allowGroupShares/,
    "must check allowGroupShares flag",
  );
  // Each must return a denial when the flag is unset
  assert.match(fnBody, /author.*disabled.*public|disabled.*public.*sharing|The author has disabled public sharing/, "must deny public");
  assert.match(fnBody, /author.*disabled.*friends|disabled.*friends.*sharing|The author has disabled friends sharing/, "must deny friends");
  assert.match(fnBody, /author.*disabled.*private|disabled.*private.*sharing|The author has disabled private sharing/, "must deny private");
  assert.match(fnBody, /author.*disabled.*group|disabled.*group.*sharing|The author has disabled group sharing/, "must deny group");
});

test("policy: only_me posts are never shareable (by anyone)", () => {
  const fnStart = sharingPolicy.indexOf("export async function checkSharingEligibility");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /only_me/, "checkSharingEligibility must block only_me posts");
  assert.match(fnBody, /never shareable|cannot be shared/, "must have clear denial message for only_me");
});

test("policy: non-public feed sources cannot be shared to public/lounge", () => {
  assert.match(
    sharingPolicy,
    /Non-public posts cannot be shared publicly/,
    "policy must block non-public sources from public/lounge destination",
  );
  assert.match(
    sharingPolicy,
    /audience === "friends" \|\| audience === "followers"/,
    "must check friends/followers audience",
  );
});

test("route: PATCH /feed/posts/:id/sharing upserts all granular flags", () => {
  const feedSharingStart = sharingRoute.indexOf('router.patch("/feed/posts/:id/sharing"');
  const nextRoute = sharingRoute.indexOf("\nrouter.", feedSharingStart + 1);
  const block = sharingRoute.slice(feedSharingStart, nextRoute === -1 ? undefined : nextRoute);
  assert.match(block, /allowPublicShares/, "patch must handle allowPublicShares");
  assert.match(block, /allowFriendsShares/, "patch must handle allowFriendsShares");
  assert.match(block, /allowPrivateShares/, "patch must handle allowPrivateShares");
  assert.match(block, /allowGroupShares/, "patch must handle allowGroupShares");
});

test("feed hydration: toFeedPostResponse includes all granular sharing flags", () => {
  assert.match(feedHelpers, /allowPublicShares:/, "must emit allowPublicShares");
  assert.match(feedHelpers, /allowFriendsShares:/, "must emit allowFriendsShares");
  assert.match(feedHelpers, /allowPrivateShares:/, "must emit allowPrivateShares");
  assert.match(feedHelpers, /allowGroupShares:/, "must emit allowGroupShares");
});

test("group post serializer: emits all granular sharing flags", () => {
  assert.match(groupsRoute, /allowPublicShares:/, "serializePost must emit allowPublicShares");
  assert.match(groupsRoute, /allowFriendsShares:/, "serializePost must emit allowFriendsShares");
  assert.match(groupsRoute, /allowPrivateShares:/, "serializePost must emit allowPrivateShares");
  assert.match(groupsRoute, /allowGroupShares:/, "serializePost must emit allowGroupShares");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 2: Privacy-safe counts
// ─────────────────────────────────────────────────────────────────────────────

test("schema: feedPosts has all share count breakdown columns", () => {
  assert.match(schemaFeedPosts, /shareCount/, "missing shareCount");
  assert.match(schemaFeedPosts, /publicShareCount/, "missing publicShareCount");
  assert.match(schemaFeedPosts, /privateShareCount/, "missing privateShareCount");
  assert.match(schemaFeedPosts, /groupShareCount/, "missing groupShareCount");
  assert.match(schemaFeedPosts, /linkShareCount/, "missing linkShareCount");
});

test("schema: groupPosts has all share count breakdown columns", () => {
  assert.match(schemaGroups, /shareCount.*share_count.*default.*0/, "missing shareCount");
  assert.match(schemaGroups, /publicShareCount/, "missing publicShareCount");
  assert.match(schemaGroups, /privateShareCount/, "missing privateShareCount");
  assert.match(schemaGroups, /groupShareCount/, "missing groupShareCount");
  assert.match(schemaGroups, /linkShareCount/, "missing linkShareCount");
});

test("feed hydration: privateShareCount only exposed to owner/admin (isOwnerOrAdmin)", () => {
  assert.match(
    feedHelpers,
    /isOwnerOrAdmin/,
    "hydration must use isOwnerOrAdmin gate for private/link counts",
  );
  assert.match(
    feedHelpers,
    /privateShareCount:.*isOwnerOrAdmin/,
    "privateShareCount must be gated by isOwnerOrAdmin",
  );
  assert.match(
    feedHelpers,
    /linkShareCount:.*isOwnerOrAdmin/,
    "linkShareCount must be gated by isOwnerOrAdmin",
  );
});

test("group serializer: privateShareCount only exposed to owner/admin", () => {
  // The group serializer must gate privateShareCount on ownership/admin check
  assert.match(
    groupsRoute,
    /privateShareCount.*isPlatformAdmin.*isOwner|isPlatformAdmin.*isOwner.*privateShareCount/,
    "group serializer must gate privateShareCount on owner/admin check",
  );
});

test("sharing route: atomically increments breakdown counters (not just shareCount)", () => {
  assert.match(sharingRoute, /publicShareCount/, "must reference publicShareCount");
  assert.match(sharingRoute, /privateShareCount/, "must reference privateShareCount");
  assert.match(sharingRoute, /groupShareCount/, "must reference groupShareCount");
  assert.match(sharingRoute, /linkShareCount/, "must reference linkShareCount");
  assert.match(sharingRoute, /incrementShareCounters/, "must use incrementShareCounters helper");
});

test("incrementShareCounters: copy_link only increments linkShareCount, not shareCount total", () => {
  const fnStart = sharingRoute.indexOf("async function incrementShareCounters");
  // Find the end of the function by looking for the closing brace
  const fnBodyStart = sharingRoute.indexOf("{", fnStart);
  let depth = 0;
  let fnEnd = fnBodyStart;
  for (let i = fnBodyStart; i < sharingRoute.length; i++) {
    if (sharingRoute[i] === "{") depth++;
    else if (sharingRoute[i] === "}") {
      depth--;
      if (depth === 0) { fnEnd = i; break; }
    }
  }
  const fn = sharingRoute.slice(fnStart, fnEnd + 1);
  // Must reference linkShareCount in copy_link branch
  assert.match(fn, /copy_link/, "function must handle copy_link destination");
  assert.match(fn, /linkShareCount/, "copy_link must increment linkShareCount");
  // The copy_link branch: find the lines between "copy_link" and the corresponding "else"
  // Key invariant: when copy_link, only linkShareCount is in updates, NOT shareCount
  // Verify by checking the structure: copy_link block sets linkShareCount, NOT shareCount
  const copyLinkIdx = fn.indexOf('"copy_link"');
  const elseIdx = fn.indexOf("} else {", copyLinkIdx);
  const copyLinkBranch = fn.slice(copyLinkIdx, elseIdx);
  assert.doesNotMatch(
    copyLinkBranch,
    /updates\.shareCount/,
    "copy_link branch must not set updates.shareCount",
  );
  assert.match(
    copyLinkBranch,
    /updates\.linkShareCount/,
    "copy_link branch must set updates.linkShareCount",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 3: Copy-link policy / rate limits
// ─────────────────────────────────────────────────────────────────────────────

test("policy: checkCopyLinkEligibility function exists and checks suspension", () => {
  assert.match(sharingPolicy, /export async function checkCopyLinkEligibility/, "must export checkCopyLinkEligibility");
  const fnStart = sharingPolicy.indexOf("export async function checkCopyLinkEligibility");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /sharingSuspensionsTable/, "copy-link eligibility must check suspension");
  assert.match(
    fnBody,
    /checkCombinedShareActionRateLimit/,
    "copy-link eligibility must use the combined share-action rate limit",
  );
  assert.match(fnBody, /only_me/, "copy-link eligibility must handle only_me");
  assert.match(fnBody, /sharingDisabled/, "copy-link eligibility must respect sharingDisabled");
});

test("copy-link route: re-authorizes canonical source before recording", () => {
  const copyLinkStart = sharingRoute.indexOf('router.post("/feed/posts/:id/copy-link"');
  const nextRoute = sharingRoute.indexOf("\nrouter.", copyLinkStart + 1);
  const block = sharingRoute.slice(copyLinkStart, nextRoute === -1 ? undefined : nextRoute);
  assert.match(block, /authorizeShareSource/, "copy-link must authorize source");
  assert.match(block, /resolveCanonicalSource/, "copy-link must resolve canonical source");
  assert.match(block, /checkCopyLinkEligibility/, "copy-link must call checkCopyLinkEligibility");
  assert.match(block, /postShareCopyLinksTable/, "copy-link must insert analytics record");
  assert.match(block, /incrementShareCounters/, "copy-link must atomically increment linkShareCount");
});

test("copy-link route: only_me post denied unless author (via checkCopyLinkEligibility)", () => {
  // Policy blocks only_me unless author
  const fnStart = sharingPolicy.indexOf("export async function checkCopyLinkEligibility");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /isAuthor/, "copy-link must check isAuthor for only_me");
  assert.match(fnBody, /only_me posts cannot be shared/, "copy-link must return denial reason for only_me");
});

test("copy-link rate limit: 20/hr global, 3/hr same-source across all sharing actions", () => {
  const fnStart = sharingPolicy.indexOf("async function checkCombinedShareActionRateLimit");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, />= 20/, "copy-link must enforce 20/hr global limit");
  assert.match(fnBody, />= 3/, "copy-link must enforce 3/hr same-source limit");
  assert.match(fnBody, /60 \* 60 \* 1000/, "copy-link rate limit must use 1-hour window");
  assert.match(fnBody, /postSharesTable/, "combined limit must count ordinary shares");
  assert.match(fnBody, /postShareCopyLinksTable/, "combined limit must count copy-link actions");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 4: Destination eligibility
// ─────────────────────────────────────────────────────────────────────────────

test("policy: public/lounge requires public source (non-public blocked)", () => {
  assert.match(
    sharingPolicy,
    /destination.*public.*lounge.*Non-public|Non-public.*public.*lounge/,
    "must block non-public sources from public/lounge destinations",
  );
});

test("policy: private group posts → same group only", () => {
  assert.match(
    sharingPolicy,
    /Private group posts can only be shared within the same private group/,
    "policy must enforce private group posts same-group sharing",
  );
  assert.match(
    sharingPolicy,
    /group\.privacy === "private"[\s\S]*?destination !== "group" \|\| destinationGroupId !== sourceGroupId/,
    "policy must check privacy=private and same group id",
  );
});

test("policy: group destination enforces postingPermission=admins_only", () => {
  assert.match(
    sharingPolicy,
    /postingPermission === "admins_only"/,
    "policy must check admins_only posting permission",
  );
  assert.match(
    sharingPolicy,
    /Only group admins can post to this group/,
    "must return clear error for non-admin sharing to admins_only group",
  );
  // owner and admin roles must be allowed (may be on separate lines)
  assert.match(sharingPolicy, /memberRole === "owner"/, "admins_only must allow owner role");
  assert.match(sharingPolicy, /memberRole === "admin"/, "admins_only must allow admin role");
});

test("route: destinationGroupId with non-group destination → 400", () => {
  // The route must check this condition and return 400
  assert.match(
    sharingRoute,
    /destinationGroupId != null && dest !== "group"/,
    "route must reject destinationGroupId with non-group destination",
  );
  assert.match(
    sharingRoute,
    /destinationGroupId is only valid for destination=group/,
    "must return specific error message",
  );
});

test("route: recipientUserIds with non-private destination → 400", () => {
  assert.match(
    sharingRoute,
    /recipientUserIds is only valid for destination=private/,
    "must reject recipientUserIds with non-private destination",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 5: Business identity
// ─────────────────────────────────────────────────────────────────────────────

test("policy: buildSharedPostPreview uses Business Page identity for business-attributed feed posts", () => {
  const previewFn = sharingPolicy.match(
    /export async function buildSharedPostPreview[\s\S]*?export async function/,
  )?.[0] ?? "";
  // Must check post.businessId and load from businessesTable (not usersTable) when set
  assert.match(previewFn, /post\.businessId/, "must check businessId in preview");
  assert.match(previewFn, /businessesTable/, "must load from businessesTable for business posts");
  // Must NOT load usersTable when businessId is set (no owner identity leak)
  // Find the businessId branch and verify it doesn't query usersTable there
  const bizBlock = previewFn.match(/if \(post\.businessId\) \{([\s\S]*?)\}/)?.[1] ?? "";
  assert.doesNotMatch(
    bizBlock,
    /usersTable/,
    "business post preview must not query usersTable (no owner identity leak)",
  );
});

test("policy: buildSharedPostPreview uses Business Page identity for business-attributed group posts", () => {
  // In the group_post branch, when post.businessId is set, use businessesTable
  const groupBizIdx = sharingPolicy.indexOf("if (post.businessId)", sharingPolicy.indexOf("group_post"));
  assert.ok(groupBizIdx !== -1, "group post branch must check businessId");
  const groupBizBlock = sharingPolicy.slice(groupBizIdx, groupBizIdx + 500);
  assert.match(groupBizBlock, /businessesTable/, "group business post must use businessesTable");
  assert.doesNotMatch(
    groupBizBlock.slice(0, 200),
    /usersTable/,
    "group business post must not query usersTable in business branch",
  );
});

test("group serializer: authorUserId is null when businessId is set (privacy)", () => {
  // serializePost: authorUserId: post.businessId ? null : post.authorUserId
  assert.match(
    groupsRoute,
    /authorUserId:.*post\.businessId.*null.*post\.authorUserId|authorUserId:.*businessId.*null/,
    "authorUserId must be null when businessId set",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 6: Private recipient pre-authorization
// ─────────────────────────────────────────────────────────────────────────────

test("policy: validatePrivateRecipientAccess function exists and rejects ineligible", () => {
  assert.match(
    sharingPolicy,
    /export async function validatePrivateRecipientAccess/,
    "must export validatePrivateRecipientAccess",
  );
  // Must call authorizeShareSource for each recipient
  const fnStart = sharingPolicy.indexOf("export async function validatePrivateRecipientAccess");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /authorizeShareSource/, "must call authorizeShareSource per recipient");
  assert.match(fnBody, /rejected/, "must return rejected list");
  assert.match(fnBody, /eligible/, "must return eligible list");
});

test("route: private share validates recipients against canonical source before insert", () => {
  const feedShareStart = sharingRoute.indexOf('router.post("/feed/posts/:id/share"');
  const nextFeedRoute = sharingRoute.indexOf("\nrouter.", feedShareStart + 1);
  const block = sharingRoute.slice(feedShareStart, nextFeedRoute === -1 ? undefined : nextFeedRoute);
  assert.match(block, /validatePrivateRecipientAccess/, "must call validatePrivateRecipientAccess");
  assert.match(block, /rejectedRecipientIds/, "must return rejected IDs on failure");
  assert.match(block, /getEligibleShareRecipients/, "must call getEligibleShareRecipients");
});

test("route: private share rejects if any recipient fails source auth", () => {
  // Check that rejected.length > 0 causes a 400
  assert.match(
    sharingRoute,
    /rejected\.length > 0[\s\S]*?400|400[\s\S]*?rejected\.length > 0/,
    "must return 400 when any recipient cannot access source",
  );
  assert.match(
    sharingRoute,
    /Some recipients cannot access the source post/,
    "must return specific error for recipient access failure",
  );
});

test("policy: getEligibleShareRecipients checks active account + no block + relationship", () => {
  const fnStart = sharingPolicy.indexOf("export async function getEligibleShareRecipients");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /accountStatus.*active|active.*accountStatus/, "must check accountStatus");
  assert.match(fnBody, /blockedIds/, "must check blocks");
  assert.match(fnBody, /friendIds.*followingIds|friendIds.*has.*followingIds.*has/, "must check friendship/follow");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 7: Idempotency
// ─────────────────────────────────────────────────────────────────────────────

test("schema: postSharesTable has dedupeKey column with unique constraint", () => {
  assert.match(schemaSharing, /dedupeKey/, "postSharesTable must have dedupeKey");
  assert.match(schemaSharing, /\.unique\(\)/, "dedupeKey must have unique constraint");
});

test("policy: buildDedupeKey generates deterministic key", () => {
  assert.match(sharingPolicy, /export function buildDedupeKey/, "must export buildDedupeKey");
  const fnStart = sharingPolicy.indexOf("export function buildDedupeKey");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /sharerId/, "key must include sharerId");
  assert.match(fnBody, /sourceType/, "key must include sourceType");
  assert.match(fnBody, /sourcePostId/, "key must include sourcePostId");
  assert.match(fnBody, /destination/, "key must include destination");
  assert.match(fnBody, /sort/, "key must sort recipient IDs");
  // copy_link returns null (repeatable)
  assert.match(fnBody, /copy_link.*null|null.*copy_link/, "copy_link must return null dedupeKey");
});

test("route: share route checks for existing dedupeKey before inserting", () => {
  const feedShareStart = sharingRoute.indexOf('router.post("/feed/posts/:id/share"');
  const nextFeedRoute = sharingRoute.indexOf("\nrouter.", feedShareStart + 1);
  const block = sharingRoute.slice(feedShareStart, nextFeedRoute === -1 ? undefined : nextFeedRoute);
  assert.match(block, /buildDedupeKey/, "must call buildDedupeKey");
  assert.match(block, /dedupeKey.*existing|existing.*dedupeKey/, "must check for existing share with dedupeKey");
  assert.match(block, /deduplicated: true/, "must return deduplicated=true for existing share");
  assert.match(block, /deduplicated: false/, "must return deduplicated=false for new share");
});

test("route: deduplicated return skips counter increment", () => {
  // The early return for deduplicated must happen before the transaction that calls incrementShareCounters
  const feedShareStart = sharingRoute.indexOf('router.post("/feed/posts/:id/share"');
  const nextFeedRoute = sharingRoute.indexOf("\nrouter.", feedShareStart + 1);
  const block = sharingRoute.slice(feedShareStart, nextFeedRoute === -1 ? undefined : nextFeedRoute);
  const dedupIdx = block.indexOf("deduplicated: true");
  const txIdx = block.indexOf("db.transaction");
  assert.ok(dedupIdx < txIdx, "deduplicated early return must come before the transaction");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 8: Group moderator notification
// ─────────────────────────────────────────────────────────────────────────────

test("policy: notifyGroupModeratorsSharePending function exists and sends to owner/admin/moderator", () => {
  assert.match(
    sharingPolicy,
    /export async function notifyGroupModeratorsSharePending/,
    "must export notifyGroupModeratorsSharePending",
  );
  const fnStart = sharingPolicy.indexOf("export async function notifyGroupModeratorsSharePending");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /role.*owner.*admin.*moderator|owner.*admin.*moderator/g as RegExp, "must notify owner/admin/moderator");
  assert.match(fnBody, /group_share_pending/, "must use group_share_pending notification type");
  // Must NOT leak source post content
  assert.doesNotMatch(
    fnBody,
    /sourceType.*text|text.*source|sharedPost|preview/,
    "moderator notification must not include source post content",
  );
});

test("route: pending_approval group share triggers moderator notification", () => {
  const feedShareStart = sharingRoute.indexOf('router.post("/feed/posts/:id/share"');
  const nextFeedRoute = sharingRoute.indexOf("\nrouter.", feedShareStart + 1);
  const block = sharingRoute.slice(feedShareStart, nextFeedRoute === -1 ? undefined : nextFeedRoute);
  assert.match(block, /notifyGroupModeratorsSharePending/, "must call moderator notification");
  assert.match(block, /pendingApproval/, "must track pending approval state");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 9: Auth/preview parity
// ─────────────────────────────────────────────────────────────────────────────

test("policy: viewerCanSharePost authorizes canonical source for wrapper posts", () => {
  const fnStart = sharingPolicy.indexOf("export async function viewerCanSharePost");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  // Must call resolveCanonicalSource
  assert.match(fnBody, /resolveCanonicalSource/, "must resolve canonical source for wrapper posts");
  // Must call authorizeShareSource on canonical (not just the wrapper)
  assert.match(
    fnBody,
    /authorizeShareSource[\s\S]*?canonical/,
    "must re-authorize the canonical source, not just the wrapper",
  );
});

test("policy: SourceAuthResult has no unsafe 'any' for error status", () => {
  // The authorizeGroupPostSource groupId check must return typed 403, not 'as any'
  // The status field must be typed as 403 | 404
  assert.doesNotMatch(
    sharingPolicy,
    /\} as any/,
    "SourceAuthResult must not use unsafe 'as any' cast",
  );
  assert.match(
    sharingPolicy,
    /status: 403 \| 404/,
    "SourceAuthResult error must have typed status 403 | 404",
  );
});

test("policy: UNAVAILABLE_SOURCE_PREVIEW has 'available: false as const' (typed)", () => {
  assert.match(
    sharingPolicy,
    /available: false as const/,
    "UNAVAILABLE_SOURCE_PREVIEW must use 'false as const' for type narrowing",
  );
});

test("policy: buildSharedPostPreview returns UNAVAILABLE when auth fails (not error)", () => {
  assert.match(
    sharingPolicy,
    /if \(!auth\.ok\) return UNAVAILABLE_SOURCE_PREVIEW/,
    "preview must return blank placeholder when auth fails (not throw)",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Gap 10: Input validation
// ─────────────────────────────────────────────────────────────────────────────

test("route: invalid NaN parseId returns 400 before DB", () => {
  assert.match(sharingRoute, /validateId/, "must use validateId helper");
  assert.match(sharingRoute, /Invalid post ID/, "must return 400 for invalid post ID");
  assert.match(sharingRoute, /Invalid share ID/, "must return 400 for invalid share ID");
  assert.match(sharingRoute, /Invalid ID/, "must return 400 for invalid group/post ID");
  assert.match(sharingRoute, /Invalid user ID/, "must return 400 for invalid user ID");
});

test("route: oversized sharerComment returns 400 before DB", () => {
  assert.match(
    sharingRoute,
    /SHARER_COMMENT_MAX/,
    "must define SHARER_COMMENT_MAX constant",
  );
  assert.match(
    sharingRoute,
    /sharerComment.*length.*SHARER_COMMENT_MAX|SHARER_COMMENT_MAX.*sharerComment/,
    "must validate sharerComment length",
  );
  assert.match(
    sharingRoute,
    /sharerComment exceeds/,
    "must return specific error for oversized comment",
  );
});

test("route: self-recipient ID stripped from private share recipients", () => {
  assert.match(
    sharingRoute,
    /filter\(.*r !== user\.id\)/,
    "must filter out self (user.id) from recipient list",
  );
});

test("route: empty recipient list after self-removal returns 400", () => {
  assert.match(
    sharingRoute,
    /At least one valid recipient is required for private shares/,
    "must return 400 when no valid recipients remain",
  );
});

test("route: duplicate recipient IDs are deduplicated with Set", () => {
  assert.match(
    sharingRoute,
    /\[\.\.\.(new Set\(rawIds\))/,
    "must use Set to deduplicate recipient IDs",
  );
});

test("route: maximum 20 recipients enforced before DB", () => {
  assert.match(
    sharingRoute,
    /Maximum 20 recipients per private share/,
    "must enforce maximum 20 recipients",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Existing rules maintained
// ─────────────────────────────────────────────────────────────────────────────

test("policy: re-authorizes source on every preview call", () => {
  assert.match(
    sharingPolicy,
    /export async function buildSharedPostPreview[\s\S]*?authorizeShareSource\(/,
    "buildSharedPostPreview must call authorizeShareSource for live authorization",
  );
});

test("policy: resolveCanonicalSource collapses share-of-share to original", () => {
  assert.match(sharingPolicy, /export function resolveCanonicalSource/, "must export resolveCanonicalSource");
  assert.match(sharingPolicy, /feedPost\?\.shareSourceType && feedPost\?\.shareSourcePostId/, "must detect feed wrapper");
  assert.match(sharingPolicy, /groupPost\?\.shareSourceType && groupPost\?\.shareSourcePostId/, "must detect group wrapper");
});

test("route: share wrappers contain only sharer comment as text (no source content copied)", () => {
  const wrapperInsert = sharingRoute.match(/tx\s*\.\s*insert\(feedPostsTable\)[\s\S]*?\.values\(\{([\s\S]*?)\}\)/)?.[1] ?? "";
  assert.match(wrapperInsert, /text: sharerComment/, "wrapper text must be sharerComment only");
  assert.doesNotMatch(wrapperInsert, /feedPost\.text|srcPost\.text|post\.text/, "wrapper must not copy source text");
  assert.match(wrapperInsert, /shareSourceType:/, "wrapper must set source reference fields");
  assert.match(wrapperInsert, /shareSourcePostId:/, "wrapper must set sourcePostId reference");
});

test("admin moderation: cascades to wrapper feed/group posts", () => {
  const adminModStart = sharingRoute.indexOf('router.patch("/admin/shares/:shareId"');
  const nextRoute = sharingRoute.indexOf("\nrouter.", adminModStart + 1);
  const block = sharingRoute.slice(adminModStart, nextRoute === -1 ? undefined : nextRoute);
  assert.match(block, /wrapperFeedPostId/, "must update wrapper feed post");
  assert.match(block, /destinationGroupPostId/, "must update destination group post");
  assert.match(block, /moderationLocked/, "must set moderationLocked");
});

test("policy: createShareNotification checks block before notifying", () => {
  const fnStart = sharingPolicy.indexOf("export async function createShareNotification");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, /hasBidirectionalBlock/, "createShareNotification must check bidirectional block");
  assert.match(fnBody, /opts\.recipientUserId === opts\.sharerId.*return/, "must skip self-notification");
});

test("route: share counter increments inside transaction", () => {
  assert.match(
    sharingRoute,
    /tx\s*\.\s*update\(feedPostsTable\)[\s\S]*?shareCount/,
    "feed post share count must be updated via tx",
  );
  assert.match(
    sharingRoute,
    /incrementShareCounters\(tx,/,
    "must call incrementShareCounters with tx argument",
  );
});

test("policy: rate limit: 20 shares/hr global and 3 same-source/hr", () => {
  const fnStart = sharingPolicy.indexOf("async function checkCombinedShareActionRateLimit");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  assert.match(fnBody, />= 20/, "must block at >= 20 hourly shares");
  assert.match(fnBody, />= 3/, "must block at >= 3 same-source hourly shares");
  assert.match(fnBody, /60 \* 60 \* 1000/, "rate limit window must be 1 hour");
  assert.match(fnBody, /gte\(postSharesTable\.createdAt, oneHourAgo\)/, "must filter by createdAt");
});

test("policy: suspension check comes before rate limit check", () => {
  const fnStart = sharingPolicy.indexOf("export async function checkSharingEligibility");
  const nextExport = sharingPolicy.indexOf("\nexport ", fnStart + 1);
  const fnBody = sharingPolicy.slice(fnStart, nextExport === -1 ? undefined : nextExport);
  const suspIdx = fnBody.indexOf("sharingSuspensionsTable.status");
  const rateIdx = fnBody.indexOf("checkCombinedShareActionRateLimit");
  assert.ok(suspIdx !== -1, "must check sharingSuspensionsTable.status");
  assert.ok(rateIdx !== -1, "must call the combined rate limit");
  assert.ok(suspIdx < rateIdx, "suspension check must come before rate limit check");
});

test("route: share writes serialize dedupe and rate checks with a per-sharer advisory lock", () => {
  assert.match(
    sharingRoute,
    /pg_advisory_xact_lock\(\$\{SHARING_LOCK_NAMESPACE\}, \$\{user\.id\}\)/,
    "share transactions must take the per-sharer advisory lock",
  );
  assert.match(
    sharingRoute,
    /pg_advisory_xact_lock[\s\S]*?dedupeKey[\s\S]*?checkSharingEligibility[\s\S]*?insert\(postSharesTable\)/,
    "locked transaction must re-read dedupe and policy before inserting",
  );
});

test("serializers: public viewers never receive private share volume in shareCount", () => {
  assert.match(
    feedHelpers,
    /shareCount:[\s\S]*?isOwnerOrAdmin[\s\S]*?publicShareCount[\s\S]*?groupShareCount/,
    "feed shareCount must use only public and group counts for ordinary viewers",
  );
  assert.match(
    groupsRoute,
    /shareCount:[\s\S]*?isPlatformAdmin \|\| isOwner[\s\S]*?publicShareCount \+ post\.groupShareCount/,
    "group shareCount must use only public and group counts for ordinary viewers",
  );
});

test("shared previews expose only live canonical navigation and privacy metadata", () => {
  assert.match(sharingPolicy, /canonicalUrl: getCanonicalShareUrl/, "preview must include canonical URL");
  assert.match(sharingPolicy, /allowedShareDestinations/, "preview must include effective destinations");
  assert.match(sharingPolicy, /groupPrivacy:/, "preview must include group privacy metadata");
  assert.match(sharingPolicy, /audience:/, "preview must include feed audience metadata");
});

test("share action responses do not disclose aggregate counts containing private shares", () => {
  assert.doesNotMatch(
    sharingRoute,
    /getShareCount/,
    "share actions must not return a total count that includes private shares",
  );
});

test("hidden or pending sources are unavailable even to their authors and admins", () => {
  const feedStart = sharingPolicy.indexOf("async function authorizeFeedPostSource");
  const groupStart = sharingPolicy.indexOf("async function authorizeGroupPostSource");
  const feedBlock = sharingPolicy.slice(feedStart, groupStart);
  const groupBlock = sharingPolicy.slice(
    groupStart,
    sharingPolicy.indexOf("// ─────────────────────────────────────────────────────────────────────────────\n// Resolve canonical source", groupStart),
  );
  assert.match(
    feedBlock,
    /if \(post\.status !== "active"\)/,
    "feed source must require active status without viewer exceptions",
  );
  assert.doesNotMatch(
    feedBlock,
    /if \(post\.status !== "active" &&/,
    "feed authors and admins must not bypass active status",
  );
  assert.match(
    groupBlock,
    /if \(post\.status !== "active"\)/,
    "group source must require active status without viewer exceptions",
  );
  assert.doesNotMatch(
    groupBlock,
    /if \(post\.status !== "active" &&/,
    "group admins must not bypass active status",
  );
});

test("policy: unknown source type fails closed", () => {
  assert.match(sharingPolicy, /Unknown or unsupported source type/, "must reject unknown source types");
});

test("private share list: filters blocked sharers and uses live buildSharedPostPreview", () => {
  const listStart = sharingRoute.indexOf('router.get("/feed/shares/private"');
  const nextRoute = sharingRoute.indexOf("\nrouter.", listStart + 1);
  const block = sharingRoute.slice(listStart, nextRoute === -1 ? undefined : nextRoute);
  assert.match(block, /blockedSharerId/, "must filter blocked sharers");
  assert.match(block, /buildSharedPostPreview/, "must build live preview for each share");
  assert.match(block, /status.*active/, "must only return active shares");
});

test("copy-link: analytics only — no postSharesTable record, no feed wrapper", () => {
  const copyLinkStart = sharingRoute.indexOf('router.post("/feed/posts/:id/copy-link"');
  const nextRoute = sharingRoute.indexOf("\nrouter.", copyLinkStart + 1);
  const block = sharingRoute.slice(copyLinkStart, nextRoute === -1 ? undefined : nextRoute);
  assert.match(block, /postShareCopyLinksTable/, "copy-link must insert into analytics table");
  assert.match(block, /canonicalUrl/, "copy-link must return canonical URL");
  assert.doesNotMatch(block, /postSharesTable/, "copy-link must not create a share record");
  assert.doesNotMatch(block, /feedPostsTable.*insert/, "copy-link must not create a feed wrapper");
});
