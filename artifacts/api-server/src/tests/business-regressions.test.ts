import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ALL_ASSIGNABLE_BUSINESS_ROLES,
  appointmentIntervalsConflict,
  hasBusinessCapability,
  isBusinessPubliclyVisible,
  isBusinessWriteBlocked,
  parseAppointmentDuration,
  resolveAppointmentDuration,
  selectPublicOwnerIdentity,
  type BusinessCapability,
  type BusinessTeamRole,
} from "../lib/businessPolicies";

const apiRoot = path.resolve(process.cwd(), "src");
const workspaceRoot = path.resolve(process.cwd(), "../..");
const businessesRoute = readFileSync(path.join(apiRoot, "routes/businesses.ts"), "utf8");
const businessDeletion = readFileSync(
  path.join(apiRoot, "lib/businessDeletion.ts"),
  "utf8",
);
const objectAcl = readFileSync(path.join(apiRoot, "lib/objectAcl.ts"), "utf8");
const feedRoute = readFileSync(path.join(apiRoot, "routes/feed.ts"), "utf8");
const feedHelpers = readFileSync(path.join(apiRoot, "lib/feedHelpers.ts"), "utf8");
const appRoutes = readFileSync(path.join(workspaceRoot, "artifacts/web/src/App.tsx"), "utf8");
const dashboardPage = readFileSync(
  path.join(workspaceRoot, "artifacts/web/src/pages/BusinessDashboard.tsx"),
  "utf8",
);
const adminDashboardPage = readFileSync(
  path.join(workspaceRoot, "artifacts/web/src/pages/AdminDashboard.tsx"),
  "utf8",
);
const adminPage = readFileSync(
  path.join(workspaceRoot, "artifacts/web/src/pages/AdminBusinesses.tsx"),
  "utf8",
);

test("owner identity remains private until the page explicitly opts in", () => {
  const publicOwner = { name: "Page Owner", photoUrl: "/private-owner-photo.jpg" };
  assert.equal(selectPublicOwnerIdentity(false, publicOwner), null);
  assert.deepEqual(selectPublicOwnerIdentity(true, publicOwner), publicOwner);

  const summaryBody = businessesRoute.match(
    /function serializeBusinessSummary[\s\S]*?\n}\n\n\/\*\*/,
  )?.[0];
  const detailReturn = businessesRoute.match(
    /async function serializeBusinessDetail[\s\S]*?return \{([\s\S]*?)\n  };\n}/,
  )?.[1];
  assert.ok(summaryBody, "business summary serializer must remain present");
  assert.ok(detailReturn, "business detail serializer must remain present");
  assert.doesNotMatch(summaryBody, /\bownerUserId\s*:/);
  assert.doesNotMatch(detailReturn, /\bownerUserId\s*:/);
  assert.match(detailReturn, /\bowner\s*,/);
});

test("only active, published businesses are publicly visible", () => {
  assert.equal(isBusinessPubliclyVisible({ status: "active", isPublished: true }), true);
  for (const state of [
    { status: "draft", isPublished: false },
    { status: "active", isPublished: false },
    { status: "suspended", isPublished: true },
    { status: "closed", isPublished: true },
  ]) {
    assert.equal(isBusinessPubliclyVisible(state), false);
  }
  assert.match(
    businessesRoute,
    /const conditions = \[\s*eq\(businessesTable\.isPublished, true\),\s*eq\(businessesTable\.status, "active"\)/,
    "public business list must filter to active and published pages",
  );
  assert.match(
    businessesRoute,
    /router\.get\("\/businesses\/:handle"[\s\S]*?if \(!isBusinessPubliclyVisible\(biz\)\)/,
    "public detail route must use the same lifecycle policy",
  );
});

test("every business team role keeps its least-privilege capability matrix", () => {
  assert.deepEqual(ALL_ASSIGNABLE_BUSINESS_ROLES, [
    "admin",
    "editor",
    "moderator",
    "advertiser",
    "analyst",
    "support_agent",
  ]);

  const expected: Record<BusinessTeamRole, BusinessCapability[]> = {
    owner: ["management", "settings", "publish", "content", "offers", "moderation", "inbox"],
    admin: ["management", "settings", "content", "offers", "moderation", "inbox"],
    editor: ["content", "offers"],
    moderator: ["moderation"],
    advertiser: ["offers"],
    analyst: ["management"],
    support_agent: ["inbox"],
  };
  const capabilities: BusinessCapability[] = [
    "management",
    "settings",
    "publish",
    "content",
    "offers",
    "moderation",
    "inbox",
  ];

  for (const [role, allowed] of Object.entries(expected) as [
    BusinessTeamRole,
    BusinessCapability[],
  ][]) {
    for (const capability of capabilities) {
      assert.equal(
        hasBusinessCapability(role, capability),
        allowed.includes(capability),
        `${role} ${capability}`,
      );
    }
  }
  for (const capability of capabilities) {
    assert.equal(hasBusinessCapability(null, capability), false);
  }
});

test("suspended and closed pages block team writes but not platform-admin recovery", () => {
  for (const status of ["suspended", "closed"]) {
    assert.equal(isBusinessWriteBlocked({ status }, false), true);
    assert.equal(isBusinessWriteBlocked({ status }, true), false);
  }
  assert.equal(isBusinessWriteBlocked({ status: "active" }, false), false);
  assert.equal(isBusinessWriteBlocked({ status: "draft" }, false), false);
});

test("hidden or removed business content cannot leak through business engagement routes", () => {
  assert.match(
    businessesRoute,
    /function engagementHandler[\s\S]*?resolveChildReadAccess\(biz, user\)[\s\S]*?loadEngageableChild\(biz, entityType, entityId, isManagementView\)/,
  );
  assert.match(
    businessesRoute,
    /"\/businesses\/:handle\/:entityType\/:entityId\/report"[\s\S]*?resolveChildReadAccess\(biz, user\)[\s\S]*?loadEngageableChild/,
  );
  assert.match(
    businessesRoute,
    /"\/businesses\/:handle\/:entityType\/:entityId\/comments"[\s\S]*?resolveChildReadAccess\(biz, viewer\)[\s\S]*?loadEngageableChild/,
  );
  assert.match(
    businessesRoute,
    /comment\.status === "removed"[\s\S]*?comment\.status !== "active" && !isManagementView/,
  );
});

test("public business child lists and post detail apply parent and content visibility", () => {
  const routes = new Map<string, RegExp>([
    ['router.get("/businesses/:handle/reviews"', /businessReviewsTable\.status, "active"/],
    ['router.get("/businesses/:handle/posts"', /businessPostsTable\.status, "active"/],
    ['router.get("/businesses/:handle/services"', /businessServicesTable\.status, "active"/],
    ['router.get("/businesses/:handle/products"', /businessProductsTable\.status, "active"/],
    ['router.get("/businesses/:handle/offers"', /businessOffersTable\.isActive, true/],
    ['router.get("/businesses/:handle/albums"', /businessAlbumsTable\.status, "active"/],
    ['router.get("/businesses/:handle/media"', /businessMediaItemsTable\.status, "active"/],
    ['router.get("/businesses/:handle/events"', /businessEventsTable\.status, "active"/],
  ]);

  for (const [route, publicContentGate] of routes) {
    const start = businessesRoute.indexOf(route);
    assert.notEqual(start, -1, `${route} must remain registered`);
    const nextRoute = businessesRoute.indexOf("\nrouter.", start + route.length);
    const block = businessesRoute.slice(start, nextRoute === -1 ? undefined : nextRoute);
    assert.match(block, /resolveChildReadAccess\(biz, viewer\)/, `${route} must gate the parent page`);
    assert.match(
      block,
      publicContentGate,
      `${route} must hide inactive child content from public callers`,
    );
  }

  assert.match(
    businessesRoute,
    /"\/businesses\/:handle\/posts\/:postId"[\s\S]*?resolveChildReadAccess\(biz, viewer\)[\s\S]*?post\.status !== "active" && !isManagementView/,
    "business post detail must match list visibility",
  );
});

test("business-attributed feed rows are lifecycle-gated in lists, detail, and engagement", () => {
  assert.match(feedHelpers, /businessesTable\.status, "active"/);
  assert.match(feedHelpers, /businessesTable\.isPublished, true/);

  const listGateCalls = feedRoute.match(/feedBusinessLifecycleVisible\(\)/g) ?? [];
  assert.ok(
    listGateCalls.length >= 4,
    "feed browse, trending, saved, and liked lists must use the business lifecycle gate",
  );

  for (const route of [
    'router.get("/feed/posts/:id"',
    'router.post("/feed/posts/:id/like"',
    'router.post("/feed/posts/:id/save"',
    'router.post("/feed/posts/:id/report"',
    'router.get("/feed/posts/:id/comments"',
    'router.post("/feed/posts/:id/comments"',
  ]) {
    const start = feedRoute.indexOf(route);
    assert.notEqual(start, -1, `${route} must remain registered`);
    const nextRoute = feedRoute.indexOf("\nrouter.", start + route.length);
    const block = feedRoute.slice(start, nextRoute === -1 ? undefined : nextRoute);
    assert.match(block, /feedPostBusinessVisible\(/, `${route} must enforce business lifecycle`);
  }
});

test("appointment overlap includes both buffers and ignores non-occupying statuses", () => {
  const atNoon = new Date("2030-01-15T12:00:00.000Z");
  const existing = {
    startsAt: atNoon,
    durationMinutes: 60,
    status: "confirmed",
  };

  assert.equal(
    appointmentIntervalsConflict(
      { startsAt: new Date("2030-01-15T11:30:00.000Z"), durationMinutes: 30, bufferMinutes: 0 },
      existing,
    ),
    false,
    "touching the existing start without a buffer is allowed",
  );
  assert.equal(
    appointmentIntervalsConflict(
      { startsAt: new Date("2030-01-15T11:30:00.000Z"), durationMinutes: 30, bufferMinutes: 15 },
      existing,
    ),
    true,
    "the pre/post buffer makes the adjacent slot conflict",
  );
  assert.equal(
    appointmentIntervalsConflict(
      { startsAt: new Date("2030-01-15T12:30:00.000Z"), durationMinutes: 30, bufferMinutes: 0 },
      existing,
    ),
    true,
    "direct overlaps conflict",
  );
  for (const status of ["cancelled", "completed", "removed"]) {
    assert.equal(
      appointmentIntervalsConflict(
        { startsAt: atNoon, durationMinutes: 60, bufferMinutes: 30 },
        { ...existing, status },
      ),
      false,
      `${status} appointments do not occupy a slot`,
    );
  }
});

test("appointment durations reject bypass values and default omitted stored durations", () => {
  assert.deepEqual(parseAppointmentDuration(undefined), { valid: true, value: undefined });
  assert.deepEqual(parseAppointmentDuration(30), { valid: true, value: 30 });
  for (const invalid of [null, "30", 0, -1, 1.5, 1441, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(parseAppointmentDuration(invalid), { valid: false }, String(invalid));
  }
  assert.equal(resolveAppointmentDuration(undefined, 45), 45);
  assert.equal(resolveAppointmentDuration(-5, 45), 45);

  assert.equal(
    appointmentIntervalsConflict(
      {
        startsAt: new Date("2030-01-15T12:30:00.000Z"),
        durationMinutes: 30,
        bufferMinutes: 0,
      },
      {
        startsAt: new Date("2030-01-15T12:00:00.000Z"),
        durationMinutes: null,
        status: "pending",
      },
      60,
    ),
    true,
    "a stored null duration occupies the configured default duration",
  );

  const durationValidationCalls = businessesRoute.match(
    /parseAppointmentDuration\(req\.body\?\.durationMinutes\)/g,
  ) ?? [];
  assert.equal(durationValidationCalls.length, 2, "create and reschedule must validate duration");
});

test("create and reschedule serialize conflict checks with a per-business transaction lock", () => {
  const lockCalls = businessesRoute.match(/pg_advisory_xact_lock\(\$\{biz\.id\}\)/g) ?? [];
  assert.equal(
    lockCalls.length,
    3,
    "appointment create, appointment reschedule, and verification submission must lock",
  );

  for (const route of [
    'router.post(\n  "/businesses/:handle/appointments"',
    'router.patch(\n  "/businesses/:handle/appointments/:appointmentId/reschedule"',
  ]) {
    const start = businessesRoute.indexOf(route);
    assert.notEqual(start, -1, `${route} must remain registered`);
    const end = businessesRoute.indexOf("\nrouter.", start + route.length);
    const block = businessesRoute.slice(start, end === -1 ? undefined : end);
    const lock = block.indexOf("pg_advisory_xact_lock");
    const conflict = block.indexOf("hasAppointmentConflict");
    const insertOrUpdate = Math.max(
      block.indexOf(".insert(businessAppointmentsTable)"),
      block.indexOf(".update(businessAppointmentsTable)"),
    );
    assert.ok(lock >= 0 && conflict > lock, "conflict check must run after the lock");
    assert.ok(insertOrUpdate > conflict, "appointment write must run after the conflict check");
  }
  assert.match(
    businessesRoute,
    /inArray\(businessAppointmentsTable\.status, \["pending", "confirmed"\]\)/,
  );
  assert.match(
    businessesRoute,
    /sql`\$\{businessAppointmentsTable\.scheduledAt\} < \$\{reqEnd\}`[\s\S]*?make_interval\(mins => CASE WHEN[\s\S]*?existingDefaultDurationMinutes[\s\S]*?> \$\{reqStart\}`/,
    "database overlap query must compare both interval boundaries",
  );
});

test("verification documents stay opaque and only the protected admin route can download them", () => {
  assert.match(
    businessesRoute,
    /"\/admin\/businesses\/verification\/:submissionId\/documents\/:index",\s*requireAuth\("admin"\)/,
  );
  assert.match(
    businessesRoute,
    /downloadUrl: `\/api\/admin\/businesses\/verification\/\$\{v\.id\}\/documents\/\$\{i\}`/,
  );
  assert.match(
    businessesRoute,
    /serializeVerification\(submissionResult\.row, false\)/,
  );
  assert.match(
    businessesRoute,
    /assertPrivateVerificationDocument\(d, user\.id, biz\.id\)/,
  );
  const verificationRouteStart = businessesRoute.indexOf(
    '"/businesses/:handle/verification"',
  );
  const verificationRouteEnd = businessesRoute.indexOf(
    '"/admin/businesses/verification/:submissionId/documents/:index"',
    verificationRouteStart,
  );
  const verificationRoute = businessesRoute.slice(
    verificationRouteStart,
    verificationRouteEnd,
  );
  const verificationLock = verificationRoute.indexOf(
    "pg_advisory_xact_lock(${biz.id})",
  );
  const verificationRecheck = verificationRoute.indexOf(".for(\"update\")");
  const verificationInsert = verificationRoute.indexOf(
    ".insert(businessVerificationSubmissionsTable)",
  );
  assert.ok(
    verificationLock >= 0 &&
      verificationRecheck > verificationLock &&
      verificationInsert > verificationRecheck,
    "verification creation must lock, revalidate, then insert",
  );
  assert.match(businessesRoute, /"Cache-Control", "private, no-store"/);
  assert.doesNotMatch(
    businessesRoute.match(/function serializeVerification[\s\S]*?\n}\n/)?.[0] ?? "",
    /documentUrls\s*:/,
    "verification API responses must not expose raw document storage paths",
  );
});

test("public, dashboard, and admin business browser surfaces remain wired for release checks", () => {
  assert.match(appRoutes, /<Route path="\/businesses" component=\{BusinessDiscover\}/);
  assert.match(appRoutes, /<Route path="\/business\/:handle" component=\{BusinessProfile\}/);
  assert.match(
    appRoutes,
    /<Route path="\/dashboard\/business\/:handle" component=\{BusinessDashboard\}/,
  );
  assert.match(dashboardPage, /Business Workspace/);
  assert.match(dashboardPage, /Appointments/);
  assert.match(dashboardPage, /Verification/);
  assert.match(adminPage, /Business Administration/);
  assert.match(adminPage, /useListAdminBusinesses/);
  assert.match(adminDashboardPage, /useGetCurrentUser\(\)/);
  assert.match(adminDashboardPage, /session\.user\?\.role !== "admin"/);
  assert.match(adminDashboardPage, /Admin access required/);
});

test("permanent business deletion is admin-only and requires exact generated confirmation", () => {
  assert.match(
    businessesRoute,
    /router\.delete\(\s*"\/admin\/businesses\/:handle",\s*requireAuth\("admin"\)/,
  );
  assert.match(businessesRoute, /DeleteAdminBusinessBody\.safeParse\(req\.body\)/);
  assert.match(businessesRoute, /DeleteAdminBusinessResponse\.parse\(result\)/);
  assert.match(
    businessDeletion,
    /SELECT id, handle[\s\S]*?FROM businesses[\s\S]*?FOR UPDATE/,
    "the target business row must be locked before confirmation and deletion",
  );
  const deletionLock = businessDeletion.indexOf(
    "pg_advisory_xact_lock(${target.id})",
  );
  const deletionRowLock = businessDeletion.indexOf("\n      FOR UPDATE");
  const deletionDependencies = businessDeletion.indexOf(
    "FROM business_verification_submissions",
  );
  assert.ok(
    deletionLock >= 0 &&
      deletionRowLock > deletionLock &&
      deletionDependencies > deletionRowLock,
    "deletion must take the shared advisory lock before the row lock and dependency scan",
  );
  assert.match(
    businessDeletion,
    /confirmation !== business\.handle\.toLowerCase\(\)/,
    "the submitted confirmation must match the locked row, not only the URL",
  );
});

test("permanent business deletion removes every owned dependency in one transaction", () => {
  assert.match(
    businessDeletion,
    /db\.transaction\(async \(tx\) =>/,
    "all database deletion work must share one transaction",
  );

  for (const table of [
    "business_engagements",
    "business_child_comments",
    "business_content_reports",
    "business_notifications",
    "business_insight_events",
    "business_verification_submissions",
    "business_media_items",
    "business_albums",
    "business_appointments",
    "business_events",
    "business_event_rsvps",
    "business_offers",
    "business_products",
    "business_services",
    "business_reviews",
    "business_review_replies",
    "business_posts",
    "business_post_likes",
    "business_post_comments",
    "business_post_saves",
    "business_post_reports",
    "business_check_ins",
    "business_conversations",
    "business_messages",
    "business_follows",
    "business_saves",
    "business_page_roles",
    "business_moderation_logs",
    "business_mentions",
    "business_spotlight_locations",
    "daily_lounge_spotlights",
  ]) {
    assert.match(businessDeletion, new RegExp(`\\b${table}\\b`), `${table} must be cleaned`);
  }

  assert.match(businessDeletion, /DELETE FROM feed_posts WHERE business_id/);
  assert.match(businessDeletion, /DELETE FROM group_posts WHERE business_id/);
  assert.match(businessDeletion, /DELETE FROM businesses WHERE id/);
  assert.doesNotMatch(
    businessDeletion,
    /DELETE FROM users|\.delete\(usersTable\)/,
    "the owning member account must never be deleted",
  );
});

test("business file cleanup runs after commit and only deletes provably exclusive objects", () => {
  const transactionEnd = businessDeletion.indexOf(
    "const cleanup = await deleteExclusivelyBusinessOwnedObjects(",
  );
  const deleteBusinessRow = businessDeletion.indexOf(
    "DELETE FROM businesses WHERE id",
  );
  assert.ok(deleteBusinessRow >= 0 && transactionEnd > deleteBusinessRow);
  assert.match(
    businessDeletion,
    /requiredPrefix = `\/objects\/verification\/\$\{businessId\}\/`/,
    "only immutable Business-scoped verification keys may be deleted",
  );
  assert.match(
    businessDeletion,
    /metadata\.metadata\?\.verificationBusinessId/,
    "storage metadata must independently confirm exclusive Business ownership",
  );
  assert.match(
    objectAcl,
    /\.\.\.\(currentMetadata\.metadata \?\? \{\}\)[\s\S]*?ACL_POLICY_METADATA_KEY/,
    "writing an ACL must preserve the Business ownership metadata",
  );
  assert.match(
    businessDeletion,
    /Member-owned upload keys[\s\S]*?deliberately retained/,
    "shared-capable member uploads must never be physically deleted",
  );
  assert.match(
    businessDeletion,
    /Business deletion committed but an exclusively owned object could not be removed/,
    "file cleanup failure must not undo the committed database deletion",
  );
});