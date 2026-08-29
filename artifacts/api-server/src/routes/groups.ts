/**
 * Groups routes — /groups and /admin/groups
 *
 * NOTE: "Groups" were previously referred to as "Communities".
 * All user-facing language uses "Groups".
 *
 * Privacy model:
 *   Public  – anyone can see members, posts, media, events.
 *   Private visible – discovered in search, request-to-join required.
 *   Private hidden  – invite-only; membership questions only shown after valid invite.
 *
 * Role capability matrix (server-enforced least-privilege):
 *   owner     – full control; only role that can promote/demote admins
 *   admin     – settings, rules, questions, moderation, membership management
 *   moderator – approve/reject posts, manage reports, hide/remove content, hide/restore comments
 *   member    – post, comment, react, save, RSVP to events
 *
 * Business Page attribution:
 *   Posts and media can be made "as" a Business Page the user manages.
 *   authorUserId / uploadedByUserId are suppressed (null) in API responses
 *   when businessId is set — only business name, handle, and logo are shown.
 *
 * Lifecycle policy:
 *   deleted   – 404 for everyone, including platform admins at route layer
 *   suspended – only members can read; no writes (post/comment/react/RSVP/join) by anyone
 *   hidden    – platform-admin only (not regular-group-visibility hidden, that's private+hidden)
 *
 * Block policy:
 *   A block in either direction prevents: invite, join, commenting, reacting, RSVP.
 *   Blocked users are filtered out of serialized member/attendee/comment lists.
 *   Blocks are checked against the group owner for join/invite operations.
 *
 * Counter safety:
 *   All insert+increment and delete+decrement are executed inside a single transaction.
 *   onConflictDoNothing on inserts; counters only change when the insert/delete actually
 *   affected a row.
 */

import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray, ilike, or, asc, not, gte } from "drizzle-orm";
import {
  db,
  usersTable,
  groupsTable,
  groupMembersTable,
  groupInvitesTable,
  groupJoinRequestsTable,
  groupQuestionsTable,
  groupQuestionAnswersTable,
  groupRulesTable,
  groupPostsTable,
  groupPostReactionsTable,
  groupPostSavesTable,
  groupPostCommentsTable,
  groupMediaTable,
  groupEventsTable,
  groupEventRsvpsTable,
  groupEventSavesTable,
  groupNotificationsTable,
  groupReportsTable,
  groupKeywordAlertsTable,
  groupActivityLogTable,
  groupInsightEventsTable,
  groupFeaturedContentTable,
  notificationsTable,
  blocksTable,
  businessesTable,
  businessPageRolesTable,
} from "@workspace/db";
import {
  CreateGroupBody,
  CreateMeetupBody,
  CreateMeetupDraftBody,
  UpdateMeetupDraftBody,
  UpdateGroupBody,
  InviteToGroupBody,
  RespondToGroupInviteBody,
  ReviewGroupJoinRequestBody,
  SetGroupQuestionsBody,
  CreateGroupRuleBody,
  UpdateGroupRuleBody,
  CreateGroupPostBody,
  UpdateGroupPostBody,
  ReactToGroupPostBody,
  CreateGroupPostCommentBody,
  ModerateGroupPostCommentBody,
  UploadGroupMediaBody,
  CreateGroupEventBody,
  UpdateGroupEventBody,
  RsvpGroupEventBody,
  ReportGroupPostBody,
  ReviewGroupReportBody,
  CreateGroupKeywordAlertBody,
  AddGroupFeaturedContentBody,
  UpdateGroupMemberBody,
  AdminUpdateGroupStatusBody,
  AdminModerateGroupPostBody,
  JoinGroupBody,
  AdminTransferGroupOwnerBody,
  ManageGroupEventAttendeeBody,
  BroadcastGroupEventBody,
} from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import { requireCompleteBuddyProfile } from "../lib/buddyProfile";
import {
  executeGroupEventRsvp,
  executeOrganizerAttendeeAction,
  occupiedGoingSeats,
} from "../lib/groupEventRsvpService";
import {
  finalizeUploadedImage,
  finalizeMediaUrlWithVideoTranscode,
  finalizeUploadedGroupFile,
  toObjectEntityPath,
  InvalidUploadError,
} from "../lib/imageUploads";
import {
  toProtectedGroupAssetUrl,
  normalizeStoredObjectPath,
  isObjectReferencedByGroup,
} from "../lib/groupAssets";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { streamValidatedObject } from "./storage";
import { logger } from "../lib/logger";
import {
  eligibleEventBroadcastRecipientIds,
  evaluateEventBroadcastRateLimit,
  summarizeEventBroadcastDeliveries,
} from "../lib/eventBroadcastPolicy";
import {
  haversineMiles,
  isValidLat,
  isValidLng,
  resolveMemberLocation,
} from "../lib/loungeSpotlight";
import { resolvePrivateCityGeocode } from "../lib/privateGeocoding";
import {
  postSharingSettingsTable,
  sharingSuspensionsTable,
} from "@workspace/db";
import { buildSharedPostPreview, getEffectiveShareDestinations } from "../lib/sharingPolicy";
import {
  getAuthorizedEventBusiness,
  loadBusinessAttributions,
  serializeEventBusinessAttribution,
  type BusinessAttribution,
} from "../lib/businessAttribution";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Type helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

type GroupRole = "owner" | "admin" | "moderator" | "member";
const MEETUP_RADIUS_CHOICES = [5, 10, 25, 50, 100] as const;

class MeetupDraftPublishConflictError extends Error {}

function isAllowedMeetupRadius(value: number): value is (typeof MEETUP_RADIUS_CHOICES)[number] {
  return MEETUP_RADIUS_CHOICES.includes(value as (typeof MEETUP_RADIUS_CHOICES)[number]);
}

/**
 * Meetup discovery only needs an approximate city-level point. Round a validated
 * city geocode before it touches the Meetup record so an address-level point is
 * never stored here.
 */
function toCoarseMeetupCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeMeetupLocationKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

async function resolveCoarseMeetupCoordinates(
  groupType: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
): Promise<{ lat: number; lng: number } | null> {
  if (groupType !== "meetup") return null;
  const cityKey = normalizeMeetupLocationKey(city);
  const stateKey = normalizeMeetupLocationKey(state);
  if (!cityKey || !stateKey) return null;

  const location = await resolvePrivateCityGeocode(cityKey, stateKey);
  if (!location) return null;

  return {
    lat: toCoarseMeetupCoordinate(location.lat),
    lng: toCoarseMeetupCoordinate(location.lng),
  };
}

/**
 * Backfill legacy Meetup rows opportunistically during radius discovery. A
 * failed/ambiguous geocode remains null and is excluded from radius results,
 * rather than being assigned an inaccurate distance.
 */
async function ensureCoarseMeetupCoordinates(
  group: typeof groupsTable.$inferSelect,
): Promise<typeof groupsTable.$inferSelect> {
  if (isValidLat(group.meetupLat) && isValidLng(group.meetupLng)) return group;
  const location = await resolveCoarseMeetupCoordinates(
    group.groupType,
    group.meetupCity,
    group.meetupState,
  );
  if (!location) return group;

  const [updated] = await db
    .update(groupsTable)
    .set({ meetupLat: location.lat, meetupLng: location.lng })
    .where(eq(groupsTable.id, group.id))
    .returning();
  return updated ?? group;
}

function publicMeetupLocation(group: typeof groupsTable.$inferSelect): string | null {
  if (group.groupType !== "meetup") return group.location;
  if (group.meetupCity && group.meetupState) return `${group.meetupCity}, ${group.meetupState}`;
  return group.meetupCity ?? group.meetupState ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Centralized permission helpers
// ─────────────────────────────────────────────────────────────────────────────

export function canManageGroup(role: GroupRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canModerateContent(role: GroupRole | null): boolean {
  return role === "owner" || role === "admin" || role === "moderator";
}

/**
 * Only the group owner may promote another member to admin or demote an admin.
 * Regular admins can change moderator/member roles but NOT touch other admins.
 */
export function canChangeRole(
  actorGroupRole: GroupRole | null,
  targetCurrentRole: GroupRole,
  newRole: GroupRole,
): boolean {
  if (actorGroupRole === "owner") return true;
  if (actorGroupRole !== "admin") return false;
  // Admins cannot touch owner role or promote/demote admin→admin/owner
  if (targetCurrentRole === "admin" || newRole === "admin" || newRole === "owner") return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers — membership
// ─────────────────────────────────────────────────────────────────────────────

async function getGroupMemberRole(groupId: number, userId: number): Promise<GroupRole | null> {
  const [row] = await db
    .select({ role: groupMembersTable.role, status: groupMembersTable.status })
    .from(groupMembersTable)
    .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)));
  if (!row || row.status !== "active") return null;
  return row.role as GroupRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// Centralized block check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure core for pairwise block detection. Given the block rows relevant to the
 * two users, returns true when any row links them in either direction. The DB
 * wrapper `isBlocked` fetches the rows and delegates here so tests can execute
 * this exact decision logic without a database.
 */
export function isBlockedPure(
  userA: number,
  userB: number,
  rows: Array<{ blockerId: number; blockedUserId: number }>,
): boolean {
  if (userA === userB) return false;
  return rows.some(
    (r) =>
      (r.blockerId === userA && r.blockedUserId === userB) ||
      (r.blockerId === userB && r.blockedUserId === userA),
  );
}

/**
 * Pure core for bulk block filtering. Returns the set of candidate userIds that
 * have a block relationship with the viewer, given the relevant block rows.
 */
export function blockedUserIdsPure(
  viewerId: number,
  rows: Array<{ blockerId: number; blockedUserId: number }>,
): Set<number> {
  const blocked = new Set<number>();
  for (const r of rows) {
    if (r.blockerId === viewerId) blocked.add(r.blockedUserId);
    else if (r.blockedUserId === viewerId) blocked.add(r.blockerId);
  }
  return blocked;
}

/**
 * Pure predicate: should a resource authored by `authorUserId` be hidden from a
 * viewer on a DIRECT read, given whether they have a block relationship?
 * Managers/admins are exempt (moderation must still see the content), and
 * business-page content (authorUserId === null) or self-authored content is
 * never hidden. `hasBlock` is the resolved pairwise block result.
 */
export function shouldHideBlockedResource(
  viewer: { id: number } | null,
  authorUserId: number | null,
  isManager: boolean,
  hasBlock: boolean,
): boolean {
  if (isManager) return false;
  if (!viewer) return false;
  if (authorUserId === null) return false;
  if (authorUserId === viewer.id) return false;
  return hasBlock;
}

/**
 * Returns true if there is a block in either direction between the two users.
 * Used for: invite, join, comment, react, RSVP, and list filtering.
 */
async function isBlocked(userA: number, userB: number): Promise<boolean> {
  if (userA === userB) return false;
  const rows = await db
    .select({ blockerId: blocksTable.blockerId, blockedUserId: blocksTable.blockedUserId })
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, userA), eq(blocksTable.blockedUserId, userB)),
        and(eq(blocksTable.blockerId, userB), eq(blocksTable.blockedUserId, userA)),
      ),
    )
    .limit(1);
  return isBlockedPure(userA, userB, rows);
}

/**
 * Returns the set of userIds that have a block relationship with viewerId.
 * Used to filter serialized lists.
 */
async function getBlockedUserIds(viewerId: number, candidateIds: number[]): Promise<Set<number>> {
  if (!candidateIds.length) return new Set();
  const relevant = candidateIds.filter((id) => id !== viewerId);
  if (!relevant.length) return new Set();

  const rows = await db
    .select({ blockerId: blocksTable.blockerId, blockedUserId: blocksTable.blockedUserId })
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, viewerId), inArray(blocksTable.blockedUserId, relevant)),
        and(inArray(blocksTable.blockerId, relevant), eq(blocksTable.blockedUserId, viewerId)),
      ),
    );

  return blockedUserIdsPure(viewerId, rows);
}

async function getEligibleEventBroadcastRecipientIds(
  groupId: number,
  eventId: number,
  senderUserId: number,
): Promise<number[]> {
  const candidates = await db
    .select({
      userId: groupEventRsvpsTable.userId,
      rsvpStatus: groupEventRsvpsTable.rsvpStatus,
      isPrivate: groupEventRsvpsTable.isPrivate,
      accountStatus: usersTable.accountStatus,
      memberStatus: groupMembersTable.status,
    })
    .from(groupEventRsvpsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, groupEventRsvpsTable.userId),
    )
    .innerJoin(
      groupMembersTable,
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.userId, groupEventRsvpsTable.userId),
      ),
    )
    .where(
      and(
        eq(groupEventRsvpsTable.groupId, groupId),
        eq(groupEventRsvpsTable.eventId, eventId),
        eq(groupEventRsvpsTable.rsvpStatus, "going"),
        eq(groupEventRsvpsTable.isPrivate, false),
        eq(usersTable.accountStatus, "active"),
        eq(groupMembersTable.status, "active"),
        not(eq(groupEventRsvpsTable.userId, senderUserId)),
      ),
    );

  const candidateIds = candidates.map((candidate) => candidate.userId);
  const blockedIds = await getBlockedUserIds(senderUserId, candidateIds);
  return eligibleEventBroadcastRecipientIds(candidates, senderUserId, blockedIds);
}

async function loadAuthorizedEventBroadcaster(
  groupId: number,
  eventId: number,
  actor: { id: number; role: string },
): Promise<
  | {
      ok: true;
      group: typeof groupsTable.$inferSelect;
      event: typeof groupEventsTable.$inferSelect;
    }
  | { ok: false; status: number; error: string }
> {
  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) return guard;
  if (guard.group.groupType !== "meetup") {
    return { ok: false, status: 404, error: "Meetup not found" };
  }

  const [event] = await db
    .select()
    .from(groupEventsTable)
    .where(and(eq(groupEventsTable.id, eventId), eq(groupEventsTable.groupId, groupId)));
  if (!event) {
    return { ok: false, status: 404, error: "Event not found" };
  }
  if (event.status !== "active") {
    return { ok: false, status: 409, error: "Updates cannot be sent for this event" };
  }

  const memberRole = await getGroupMemberRole(groupId, actor.id);
  if (!canModerateContent(memberRole)) {
    return { ok: false, status: 403, error: "Only Meetup organizers can message attendees" };
  }

  return { ok: true, group: guard.group, event };
}

async function deliverEventBroadcastNotification(input: {
  groupId: number;
  eventId: number;
  senderUserId: number;
  recipientUserId: number;
  title: string;
  message: string;
}): Promise<"delivered" | "skipped"> {
  const result = await db.execute(sql`
    insert into ${notificationsTable} (
      user_id,
      type,
      title,
      message,
      related_user_id,
      related_event_id,
      related_group_id
    )
    select
      ${groupEventRsvpsTable.userId},
      'event_update',
      ${input.title},
      ${input.message},
      ${input.senderUserId},
      ${-input.eventId},
      ${input.groupId}
    from ${groupEventRsvpsTable}
    inner join ${usersTable}
      on ${usersTable.id} = ${groupEventRsvpsTable.userId}
    inner join ${groupMembersTable}
      on ${groupMembersTable.groupId} = ${input.groupId}
      and ${groupMembersTable.userId} = ${groupEventRsvpsTable.userId}
    where ${groupEventRsvpsTable.groupId} = ${input.groupId}
      and ${groupEventRsvpsTable.eventId} = ${input.eventId}
      and ${groupEventRsvpsTable.userId} = ${input.recipientUserId}
      and ${groupEventRsvpsTable.rsvpStatus} = 'going'
      and ${groupEventRsvpsTable.isPrivate} = false
      and ${usersTable.accountStatus} = 'active'
      and ${groupMembersTable.status} = 'active'
      and not exists (
        select 1
        from ${blocksTable}
        where (
          ${blocksTable.blockerId} = ${input.senderUserId}
          and ${blocksTable.blockedUserId} = ${groupEventRsvpsTable.userId}
        ) or (
          ${blocksTable.blockerId} = ${groupEventRsvpsTable.userId}
          and ${blocksTable.blockedUserId} = ${input.senderUserId}
        )
      )
    returning id
  `);

  return result.rows.length > 0 ? "delivered" : "skipped";
}

// ─────────────────────────────────────────────────────────────────────────────
// Centralized lifecycle policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group lifecycle statuses that restrict ordinary (non-platform-admin) access.
 * Both "suspended" and "hidden" are treated identically for ordinary reads:
 * the group is invisible/inaccessible via ordinary detail/content/media/event URLs.
 * Only platform admins may inspect these — and only through admin routes,
 * NOT through the ordinary resolveGroupAccess path (which never grants admin access).
 */
export const RESTRICTED_LIFECYCLE_STATUSES = new Set(["draft", "suspended", "hidden"]);

/**
 * Pure core for ordinary-route access. Callers resolve the viewer's group
 * membership role (a DB read) and pass it in; this function performs the
 * lifecycle + privacy decision with NO database access, so the exact production
 * decision logic is directly executable in tests.
 *
 * Lifecycle (enforced identically for every ordinary read/write route):
 *   deleted            → forbidden for everyone (routes should 404 first).
 *   suspended | hidden → forbidden for everyone on ordinary routes.
 *                        Platform admins inspect these ONLY through admin routes.
 *
 * Privacy (only evaluated once the group is in an accessible lifecycle state):
 *   public             → all viewers.
 *   private visible    → members only (discoverable in search).
 *   private hidden     → members only (discovery via invite only).
 *
 * NOTE: This intentionally does NOT grant platform admins bypass of the
 * lifecycle gate. Direct detail/content/media/event URLs must never expose
 * hidden or suspended groups, even to platform admins.
 */
export function resolveGroupAccessPure(
  group: { status: string; privacy: string },
  viewer: { id: number; role?: string | null } | null,
  memberRole: GroupRole | null,
): { allowed: boolean; isMember: boolean; memberRole: GroupRole | null; isAdmin: boolean } {
  const isAdmin = viewer?.role === "admin";
  const isMember = memberRole !== null;

  // deleted is checked before calling this function in most routes;
  // here we treat it as forbidden for everyone.
  if (group.status === "deleted") {
    return { allowed: false, isMember, memberRole, isAdmin };
  }

  // suspended AND hidden are treated identically: no ordinary access for anyone,
  // including platform admins. Admins must use dedicated admin routes.
  if (RESTRICTED_LIFECYCLE_STATUSES.has(group.status)) {
    return { allowed: false, isMember, memberRole, isAdmin };
  }

  if (group.privacy === "public") {
    return { allowed: true, isMember, memberRole, isAdmin };
  }
  // private (visible or hidden privacy) — only members
  return { allowed: isMember, isMember, memberRole, isAdmin };
}

/**
 * DB wrapper: resolves the viewer's membership role then delegates to
 * `resolveGroupAccessPure` for the actual decision.
 */
async function resolveGroupAccess(
  group: typeof groupsTable.$inferSelect,
  viewer: { id: number; role?: string | null } | null,
): Promise<{ allowed: boolean; isMember: boolean; memberRole: GroupRole | null; isAdmin: boolean }> {
  const memberRole = viewer ? await getGroupMemberRole(group.id, viewer.id) : null;
  return resolveGroupAccessPure(group, viewer, memberRole);
}

/**
 * Event-level private-visibility gate.
 *
 * group_events.visibility="private" means ACTIVE MEMBERS ONLY, independent of the
 * parent group's privacy. A private event inside a PUBLIC group/Meetup is still
 * members-only. Authorized:
 *   - any active member (owner/admin/moderator/member), OR
 *   - a platform admin, OR
 *   - the event creator/organizer (group_events.created_by_user_id) — retained
 *     even if they are no longer an active group member (reviewer requirement).
 * Public events are visible to anyone who already passed the group-level gate.
 *
 * Pure so tests exercise the exact decision without a database. Callers pass the
 * already-resolved group access (memberRole + isAdmin from resolveGroupAccess)
 * and the viewer id so creator access can be evaluated.
 */
export function canViewGroupEventPure(
  event: { visibility: string | null; createdByUserId?: number | null },
  access: { memberRole: GroupRole | null; isAdmin: boolean; viewerId: number | null },
): boolean {
  if (event.visibility === "private") {
    if (access.isAdmin) return true;
    if (access.memberRole !== null) return true;
    // Creator/organizer retains access without an active membership.
    if (
      access.viewerId !== null &&
      event.createdByUserId != null &&
      event.createdByUserId === access.viewerId
    ) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Returns true when the group accepts write operations via ordinary routes.
 * Deleted, suspended, AND hidden groups block ALL ordinary writes for everyone
 * (including platform admins — admin lifecycle actions go through admin routes).
 *
 * The `isAdmin` parameter is accepted for signature stability but is deliberately
 * ignored for the restricted lifecycle gate: platform admins must not perform
 * ordinary content writes on suspended/hidden/deleted groups.
 */
export function groupAllowsWrites(group: { status: string }, _isAdmin = false): boolean {
  if (group.status === "deleted") return false;
  if (RESTRICTED_LIFECYCLE_STATUSES.has(group.status)) return false;
  return true;
}

/**
 * Shared object-authorization gate for uploaded media/poster references.
 * Uses the SAME `toObjectEntityPath` guard applied on every upload route:
 * a URL is acceptable ONLY when it resolves to an internal storage object
 * path (/objects/...). Arbitrary external URLs — and any string that is not
 * an uploaded storage object — are rejected. Finalization (ownership/ACL/type)
 * is layered on top of this in the routes via finalize* helpers.
 *
 * Exported so tests execute the real acceptance decision rather than
 * re-implementing it.
 */
export function isAcceptableObjectReference(url: string | null | undefined): boolean {
  if (url === null || url === undefined || url === "") return false;
  if (/^data:/i.test(url.trim())) return false;
  return toObjectEntityPath(url) !== null;
}

/**
 * MANDATORY shared lifecycle guard for EVERY ordinary read/write and management
 * mutation route. Fetches the group and applies the single centralized policy:
 *
 *   deleted            → { ok: false, status: 404 } (never reveal existence)
 *   suspended | hidden → for reads: { ok:false,404 } style handled by callers via
 *                        `resolveGroupAccess`; for writes: { ok:false, 403 }.
 *
 * Use `mode: "write"` for any mutation (create/edit/delete/moderate/manage) and
 * `mode: "read"` for read routes that still need the group row. This removes the
 * scattered `status === "deleted"`-only checks that previously let post edit/delete
 * and media delete slip past the suspended/hidden gate.
 */
async function loadGroupForLifecycle(
  groupId: number,
  mode: "read" | "write",
): Promise<
  | { ok: true; group: typeof groupsTable.$inferSelect }
  | { ok: false; status: number; error: string }
> {
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    return { ok: false, status: 404, error: "Group not found" };
  }
  if (mode === "write" && !groupAllowsWrites(group)) {
    return {
      ok: false,
      status: 403,
      error: "This group is not accepting changes at this time",
    };
  }
  return { ok: true, group };
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity log
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notify all active members of a group about a Meetup event lifecycle change.
 * Notification types: new_event | event_cancelled | event_updated
 * Excludes the actor (organizer) from notifications.
 * Fire-and-forget: errors are logged but do not fail the request.
 */
async function notifyGroupMembersForEvent(
  groupId: number,
  eventId: number,
  type: "new_event" | "event_cancelled" | "event_updated",
  eventTitle: string,
  actorUserId: number,
): Promise<void> {
  try {
    const members = await db
      .select({ userId: groupMembersTable.userId })
      .from(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.status, "active"),
          not(eq(groupMembersTable.userId, actorUserId)),
        ),
      );
    if (!members.length) return;

    const titles: Record<string, string> = {
      new_event: "New Event",
      event_cancelled: "Event Cancelled",
      event_updated: "Event Updated",
    };
    const messages: Record<string, string> = {
      new_event: `A new event has been posted: "${eventTitle}"`,
      event_cancelled: `An event has been cancelled: "${eventTitle}"`,
      event_updated: `An event has been updated: "${eventTitle}"`,
    };

    const notifValues = members.map((m) => ({
      groupId,
      recipientUserId: m.userId,
      type,
      title: titles[type] ?? type,
      message: messages[type] ?? eventTitle,
      relatedEntityId: eventId,
      relatedEntityType: "event",
    }));

    // Batch insert (chunk to avoid huge parameter lists)
    const CHUNK = 100;
    for (let i = 0; i < notifValues.length; i += CHUNK) {
      await db.insert(groupNotificationsTable).values(notifValues.slice(i, i + CHUNK));
    }
  } catch (err) {
    logger.error({ err, groupId, eventId, type }, "Failed to send group event notifications");
  }
}

async function logGroupActivity(
  groupId: number,
  actorUserId: number,
  action: string,
  opts?: { targetType?: string; targetId?: number; note?: string; metadata?: Record<string, unknown> },
) {
  await db.insert(groupActivityLogTable).values({
    groupId,
    actorUserId,
    action,
    targetType: opts?.targetType ?? null,
    targetId: opts?.targetId ?? null,
    note: opts?.note ?? null,
    metadata: opts?.metadata ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Serializers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when a group's icon/cover branding must be served through the protected
 * Group asset route rather than the universal public storage route. Only HIDDEN
 * private groups qualify: they are undiscoverable, so their branding is not
 * public. VISIBLE private groups are intentionally discoverable, so their
 * branding stays public.
 */
function groupBrandingIsProtected(group: {
  privacy: string;
  visibility: string;
}): boolean {
  return group.privacy === "private" && group.visibility === "hidden";
}

/** Rewrite a branding (icon/cover) URL to the protected form for hidden groups. */
function brandingUrl(
  group: { id: number; privacy: string; visibility: string },
  url: string | null,
): string | null {
  if (!groupBrandingIsProtected(group)) return url;
  return toProtectedGroupAssetUrl(group.id, url);
}

/** Serialize a group for API response. */
function serializeGroup(
  group: typeof groupsTable.$inferSelect,
  opts: {
    viewerMemberRole?: GroupRole | null;
    viewerHasPendingRequest?: boolean;
    distanceMiles?: number | null;
  } = {},
) {
  return {
    id: group.id,
    creatorUserId: group.creatorUserId,
    name: group.name,
    handle: group.handle,
    description: group.description,
    category: group.category,
    customCategory: group.customCategory,
    tags: group.tags ?? [],
    privacy: group.privacy,
    visibility: group.visibility,
    // Hidden-private branding is served through the access-controlled route.
    coverUrl: brandingUrl(group, group.coverUrl),
    iconUrl: brandingUrl(group, group.iconUrl),
    // Meetup addresses are never public discovery data. Expose city/state only.
    location: publicMeetupLocation(group),
    postingPermission: group.postingPermission,
    postApproval: group.postApproval,
    status: group.status,
    isFeatured: group.isFeatured,
    memberCount: group.memberCount,
    postCount: group.postCount,
    eventCount: group.eventCount,
    viewerMemberRole: opts.viewerMemberRole ?? null,
    viewerHasPendingRequest: opts.viewerHasPendingRequest ?? false,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    // Meetup discriminator — null DB rows coerce to "group" for backward compat
    groupType: (group.groupType ?? "group") as "group" | "meetup",
    meetupInterests: group.meetupInterests ?? null,
    meetupCity: group.meetupCity ?? null,
    meetupState: group.meetupState ?? null,
    meetupCountry: group.meetupCountry ?? null,
    // Present only on radius searches; coordinates themselves are never serialized.
    distanceMiles: opts.distanceMiles ?? null,
  };
}

/**
 * ALLOWLISTED preview serializer for a non-member of a discoverable group
 * (private + visible, or private + hidden with a valid invite). Returns ONLY
 * the public discovery / request-to-join fields the GroupDetail UI needs. It
 * deliberately OMITS internal/owner-identifying fields — creatorUserId,
 * postingPermission, postApproval, status/lifecycle, isFeatured, postCount,
 * eventCount, updatedAt — so a non-member can never learn internal settings or
 * who owns the group from the preview.
 *
 * For hidden-private previews, branding is emitted through the protected asset
 * route (an invited non-member is allowed to view it via that route).
 */
function serializeGroupPreview(
  group: typeof groupsTable.$inferSelect,
  opts: {
    viewerMemberRole?: GroupRole | null;
    viewerHasPendingRequest?: boolean;
    distanceMiles?: number | null;
  } = {},
) {
  return {
    id: group.id,
    name: group.name,
    handle: group.handle,
    description: group.description,
    category: group.category,
    customCategory: group.customCategory,
    tags: group.tags ?? [],
    privacy: group.privacy,
    visibility: group.visibility,
    coverUrl: brandingUrl(group, group.coverUrl),
    iconUrl: brandingUrl(group, group.iconUrl),
    location: publicMeetupLocation(group),
    memberCount: group.memberCount,
    viewerMemberRole: opts.viewerMemberRole ?? null,
    viewerHasPendingRequest: opts.viewerHasPendingRequest ?? false,
    createdAt: group.createdAt.toISOString(),
    isPreview: true as const,
    // Meetup discriminator in preview (useful for the join request UI)
    groupType: (group.groupType ?? "group") as "group" | "meetup",
    meetupInterests: group.meetupInterests ?? null,
    meetupCity: group.meetupCity ?? null,
    meetupState: group.meetupState ?? null,
    meetupCountry: group.meetupCountry ?? null,
    distanceMiles: opts.distanceMiles ?? null,
  };
}

/**
 * Serialize a post.
 * authorUserId is null when businessId is set (privacy — never expose who posted as business).
 */
async function serializePost(
  post: typeof groupPostsTable.$inferSelect,
  viewerId: number | null,
  opts: {
    groupIsPrivate?: boolean;
    viewerSuspended?: boolean;
    viewerRole?: string;
    /** Pre-loaded sharing settings (avoids N+1 in lists) */
    sharingSettingsOverride?: {
      sharingDisabled: boolean;
      allowPublicShares: boolean;
      allowFriendsShares: boolean;
      allowPrivateShares: boolean;
      allowGroupShares: boolean;
    };
  } = {},
) {
  const [author] = await db
    .select({
      name: usersTable.name,
      profilePhotoUrl: usersTable.profilePhotoUrl,
      role: usersTable.role,
      buddyType: usersTable.buddyType,
    })
    .from(usersTable)
    .where(eq(usersTable.id, post.authorUserId));

  let businessInfo: {
    businessName: string | null;
    businessHandle: string | null;
    businessLogoUrl: string | null;
  } = { businessName: null, businessHandle: null, businessLogoUrl: null };

  if (post.businessId) {
    const [biz] = await db
      .select({
        name: businessesTable.name,
        handle: businessesTable.handle,
        logoUrl: businessesTable.logoUrl,
      })
      .from(businessesTable)
      .where(eq(businessesTable.id, post.businessId));
    if (biz) {
      businessInfo = {
        businessName: biz.name,
        businessHandle: biz.handle,
        businessLogoUrl: biz.logoUrl,
      };
    }
  }

  let viewerReaction: string | null = null;
  let viewerSaved = false;
  if (viewerId) {
    const [rxn] = await db
      .select({ reactionType: groupPostReactionsTable.reactionType })
      .from(groupPostReactionsTable)
      .where(
        and(
          eq(groupPostReactionsTable.postId, post.id),
          eq(groupPostReactionsTable.userId, viewerId),
        ),
      );
    viewerReaction = rxn?.reactionType ?? null;

    const [save] = await db
      .select({ id: groupPostSavesTable.id })
      .from(groupPostSavesTable)
      .where(and(eq(groupPostSavesTable.postId, post.id), eq(groupPostSavesTable.userId, viewerId)));
    viewerSaved = !!save;
  }

  const isPlatformAdmin = opts.viewerRole === "admin";
  const isOwner = viewerId != null && post.authorUserId === viewerId;

  return {
    id: post.id,
    groupId: post.groupId,
    // authorUserId is null when businessId is set — suppressed for privacy
    authorUserId: post.businessId ? null : post.authorUserId,
    authorName: post.businessId
      ? (businessInfo.businessName ?? null)
      : (author?.name ?? "Unknown"),
    authorPhotoUrl: post.businessId
      ? businessInfo.businessLogoUrl
      : (author?.profilePhotoUrl ?? null),
    buddyType: post.businessId ? null : (author?.buddyType ?? null),
    authorRole: post.businessId ? "business" : (author?.role ?? "member"),
    businessId: post.businessId,
    businessName: businessInfo.businessName,
    businessHandle: businessInfo.businessHandle,
    businessLogoUrl: businessInfo.businessLogoUrl,
    text: post.text,
    // For PRIVATE groups, serve media/poster through the access-controlled
    // Group asset route so the universal storage route cannot leak them.
    mediaUrl: opts.groupIsPrivate
      ? toProtectedGroupAssetUrl(post.groupId, post.mediaUrl)
      : post.mediaUrl,
    posterUrl: opts.groupIsPrivate
      ? toProtectedGroupAssetUrl(post.groupId, post.posterUrl)
      : post.posterUrl,
    mediaType: post.mediaType,
    postType: post.postType,
    pollData: post.pollData,
    status: post.status,
    moderationLocked: post.moderationLocked,
    isPinned: post.isPinned,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    saveCount: post.saveCount,
    shareCount:
      isPlatformAdmin || isOwner
        ? post.shareCount
        : post.publicShareCount + post.groupShareCount,
    publicShareCount: post.publicShareCount,
    // Private count: only owner/admin see it
    privateShareCount: (() => {
      return isPlatformAdmin || isOwner ? post.privateShareCount : undefined;
    })(),
    groupShareCount: post.groupShareCount,
    linkShareCount: (() => {
      return isPlatformAdmin || isOwner ? post.linkShareCount : undefined;
    })(),
    viewerReaction,
    viewerSaved,
    // Sharing enrichment
    ...(await (async () => {
      // Load sharing settings (use pre-loaded override to avoid N+1 in lists)
      let sharingSettings: {
        sharingDisabled: boolean;
        allowPublicShares: boolean;
        allowFriendsShares: boolean;
        allowPrivateShares: boolean;
        allowGroupShares: boolean;
      };
      if (opts.sharingSettingsOverride !== undefined) {
        sharingSettings = opts.sharingSettingsOverride;
      } else {
        const [settings] = await db
          .select()
          .from(postSharingSettingsTable)
          .where(
            and(
              eq(postSharingSettingsTable.sourceType, "group_post"),
              eq(postSharingSettingsTable.sourcePostId, post.id),
            ),
          )
          .limit(1);
        sharingSettings = {
          sharingDisabled: settings?.sharingDisabled ?? false,
          allowPublicShares: settings?.allowPublicShares ?? true,
          allowFriendsShares: settings?.allowFriendsShares ?? true,
          allowPrivateShares: settings?.allowPrivateShares ?? true,
          allowGroupShares: settings?.allowGroupShares ?? true,
        };
      }

      // Build shared post preview for wrappers
      const isWrapper = !!post.shareSourceType && !!post.shareSourcePostId;
      let sharedPost = null;
      if (isWrapper) {
        const viewer = viewerId
          ? { id: viewerId, role: opts.viewerRole ?? "member", name: "" }
          : null;
        sharedPost = await buildSharedPostPreview({
          sourceType: post.shareSourceType as "feed_post" | "group_post",
          sourcePostId: post.shareSourcePostId!,
          sourceGroupId: post.shareSourceGroupId ?? null,
          viewer,
        });
      }

      const allowedShareDestinations = isWrapper
        ? sharedPost?.available
          ? sharedPost.allowedShareDestinations
          : []
        : getEffectiveShareDestinations({
            ...sharingSettings,
            sourceGroupPrivacy: opts.groupIsPrivate ? "private" : "public",
            viewerSuspended: opts.viewerSuspended,
          });
      const viewerCanCopyLink = isWrapper
        ? (sharedPost?.available && sharedPost.viewerCanCopyLink) || false
        : !!viewerId && !opts.viewerSuspended && !sharingSettings.sharingDisabled;
      let viewerCanShare = false;
      let viewerCanShareReason: string | null = null;
      if (!viewerId) {
        viewerCanShareReason = "Login to share posts";
      } else if (opts.viewerSuspended) {
        viewerCanShareReason = "Sharing privilege suspended";
      } else if (sharingSettings.sharingDisabled) {
        viewerCanShareReason = "Author disabled sharing for this post";
      } else if (allowedShareDestinations.length > 0) {
        viewerCanShare = true;
      } else {
        viewerCanShareReason = "No sharing destinations are available for this post";
      }

      return {
        sharingDisabled: sharingSettings.sharingDisabled,
        allowPublicShares: sharingSettings.allowPublicShares,
        allowFriendsShares: sharingSettings.allowFriendsShares,
        allowPrivateShares: sharingSettings.allowPrivateShares,
        allowGroupShares: sharingSettings.allowGroupShares,
        viewerCanShare,
        viewerCanShareReason,
        allowedShareDestinations,
        viewerCanCopyLink,
        isShareWrapper: isWrapper,
        sharedPost: isWrapper ? sharedPost : null,
      };
    })()),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

/**
 * Serialize a media item.
 * uploadedByUserId / uploaderName / uploaderPhotoUrl are null when businessId is set.
 */
async function serializeMediaItem(
  m: typeof groupMediaTable.$inferSelect,
  uploaderName: string | null,
  uploaderPhotoUrl: string | null,
  businessName: string | null,
  opts: { groupIsPrivate?: boolean } = {},
) {
  return {
    id: m.id,
    groupId: m.groupId,
    // null when posted as a Business Page
    uploadedByUserId: m.businessId ? null : m.uploadedByUserId,
    uploaderName: m.businessId ? null : uploaderName,
    uploaderPhotoUrl: m.businessId ? null : uploaderPhotoUrl,
    businessId: m.businessId,
    businessName: m.businessId ? businessName : null,
    postId: m.postId,
    kind: m.kind,
    caption: m.caption,
    // For PRIVATE groups, serve through the access-controlled Group asset route.
    mediaUrl: opts.groupIsPrivate
      ? (toProtectedGroupAssetUrl(m.groupId, m.mediaUrl) ?? m.mediaUrl)
      : m.mediaUrl,
    posterUrl: opts.groupIsPrivate
      ? toProtectedGroupAssetUrl(m.groupId, m.posterUrl)
      : m.posterUrl,
    fileName: m.fileName,
    mimeType: m.mimeType,
    fileSizeBytes: m.fileSizeBytes,
    status: m.status,
    likeCount: m.likeCount,
    saveCount: m.saveCount,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Serialize a Group event. For PRIVATE groups the event image is served through
 * the access-controlled Group asset route so the universal storage route cannot
 * leak it; public-Group event images remain universal.
 *
 * The online URL is protected behind the `onlineUrlProtected` flag: only
 * confirmed attendees (going / checked_in) see it.
 */
function serializeGroupEvent(
  event: typeof groupEventsTable.$inferSelect,
  opts: {
    viewerRsvpStatus?: string | null;
    groupIsPrivate?: boolean;
    viewerRsvp?: typeof groupEventRsvpsTable.$inferSelect | null;
    viewerSaved?: boolean;
    business?: BusinessAttribution | null;
  } = {},
) {
  // Protect the online URL: only reveal it to confirmed attendees
  const viewerIsConfirmed =
    opts.viewerRsvp?.rsvpStatus === "going" ||
    opts.viewerRsvp?.attendanceStatus === "checked_in";
  const onlineUrl =
    event.onlineUrlProtected && !viewerIsConfirmed ? null : event.onlineUrl;

  return {
    id: event.id,
    groupId: event.groupId,
    createdByUserId: event.createdByUserId,
    ...serializeEventBusinessAttribution(event.businessId, opts.business),
    title: event.title,
    description: event.description,
    location: event.location,
    onlineUrl,
    imageUrl: opts.groupIsPrivate
      ? toProtectedGroupAssetUrl(event.groupId, event.imageUrl)
      : event.imageUrl,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    status: event.status,
    visibility: event.visibility,
    rsvpCount: event.rsvpCount,
    hideAttendees: event.hideAttendees,
    viewerRsvpStatus: opts.viewerRsvpStatus ?? null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    // Meetup-enriched fields
    eventFormat: event.eventFormat ?? null,
    venueName: event.venueName ?? null,
    address: event.address ?? null,
    city: event.city ?? null,
    state: event.state ?? null,
    eventCategory: event.eventCategory ?? null,
    topics: event.topics ?? null,
    eventTags: event.eventTags ?? null,
    howToFind: event.howToFind ?? null,
    onlineUrlProtected: event.onlineUrlProtected,
    attendeeLimit: event.attendeeLimit ?? null,
    waitlistEnabled: event.waitlistEnabled,
    waitlistCount: event.waitlistCount,
    allowGuests: event.allowGuests,
    maxGuestsPerRsvp: event.maxGuestsPerRsvp ?? null,
    rsvpOpensAt: event.rsvpOpensAt?.toISOString() ?? null,
    rsvpClosesAt: event.rsvpClosesAt?.toISOString() ?? null,
    isPaid: event.isPaid,
    paidMetadata: (event.paidMetadata as Record<string, unknown> | null) ?? null,
    recurrenceRule: event.recurrenceRule ?? null,
    recurrenceParentId: event.recurrenceParentId ?? null,
    // Viewer-specific RSVP enrichment
    viewerGuestCount: opts.viewerRsvp?.guestCount ?? 0,
    viewerAttendanceStatus: opts.viewerRsvp?.attendanceStatus ?? null,
    viewerWaitlistPosition: opts.viewerRsvp?.waitlistPosition ?? null,
    viewerSaved: opts.viewerSaved ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyword alerts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure core for keyword-alert evaluation. Given the active alerts and post text,
 * returns the highest-priority action (null | flag | auto_hide | auto_remove).
 * Exported so tests execute this exact logic; the DB wrapper only supplies rows.
 */
export function checkKeywordAlertsPure(
  alerts: Array<{ keyword: string; action: string; isActive?: boolean }>,
  text: string,
): string | null {
  const lower = text.toLowerCase();
  let highestAction: string | null = null;
  const actionPriority: Record<string, number> = { flag: 1, auto_hide: 2, auto_remove: 3 };

  for (const alert of alerts) {
    if (alert.isActive === false) continue;
    if (lower.includes(alert.keyword.toLowerCase())) {
      const priority = actionPriority[alert.action] ?? 0;
      const currentPriority = highestAction ? (actionPriority[highestAction] ?? 0) : 0;
      if (priority > currentPriority) highestAction = alert.action;
    }
  }
  return highestAction;
}

/** Apply keyword alerts to post text. Returns action: null | flag | auto_hide | auto_remove */
async function checkKeywordAlerts(groupId: number, text: string): Promise<string | null> {
  const alerts = await db
    .select()
    .from(groupKeywordAlertsTable)
    .where(
      and(
        eq(groupKeywordAlertsTable.groupId, groupId),
        eq(groupKeywordAlertsTable.isActive, true),
      ),
    );
  return checkKeywordAlertsPure(alerts, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Image URL helpers
// ─────────────────────────────────────────────────────────────────────────────

async function finalizeGroupImageUrl(rawUrl: string, ownerId: number): Promise<string> {
  if (!toObjectEntityPath(rawUrl)) {
    throw new InvalidUploadError(
      "Image must reference an uploaded storage object; external URLs are not allowed",
    );
  }
  return finalizeUploadedImage(rawUrl, ownerId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery & Create
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups
router.get("/groups", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const privacy = typeof req.query.privacy === "string" ? req.query.privacy : undefined;
  const featured = req.query.featured === "true";
  // groupType filter: "group" (default) excludes meetups; "meetup" = meetups only; "all" = both
  const groupTypeParam = typeof req.query.groupType === "string" ? req.query.groupType : "group";
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 30 : 30,
    100,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const conditions = [eq(groupsTable.status, "active")] as Parameters<typeof and>;

  // Enforce group/meetup separation by default.
  // "group" (default): exclude rows where groupType='meetup'; include NULL (legacy rows = regular groups)
  // "meetup": include only rows where groupType='meetup'
  // "all": no groupType filter — include everything
  if (groupTypeParam === "group") {
    // Exclude meetups: groupType IS NULL OR groupType = 'group'
    conditions.push(
      or(
        sql`${groupsTable.groupType} IS NULL`,
        eq(groupsTable.groupType, "group"),
      )!,
    );
  } else if (groupTypeParam === "meetup") {
    conditions.push(eq(groupsTable.groupType, "meetup"));
  }
  // "all" → no additional filter

  if (search) {
    conditions.push(
      or(
        ilike(groupsTable.name, `%${search}%`),
        ilike(groupsTable.description, `%${search}%`),
      )!,
    );
  }
  if (category) conditions.push(eq(groupsTable.category, category));
  if (privacy) conditions.push(eq(groupsTable.privacy, privacy));
  if (featured) conditions.push(eq(groupsTable.isFeatured, true));

  const rows = await db
    .select()
    .from(groupsTable)
    .where(and(...conditions))
    .orderBy(desc(groupsTable.isFeatured), desc(groupsTable.memberCount))
    .limit(limit + 100) // over-fetch to allow filtering hidden private groups
    .offset(offset);

  // Filter hidden private groups — only visible to their members
  const filtered: typeof rows = [];
  for (const g of rows) {
    if (g.privacy === "private" && g.visibility === "hidden") {
      if (viewer) {
        const role = await getGroupMemberRole(g.id, viewer.id);
        if (role) {
          filtered.push(g);
        }
      }
      // Never surface hidden-private groups in discovery for non-members
      continue;
    }
    filtered.push(g);
    if (filtered.length >= limit) break;
  }

  const groups = await Promise.all(
    filtered.map(async (g) => {
      const viewerRole = viewer ? await getGroupMemberRole(g.id, viewer.id) : null;
      let hasPending = false;
      if (viewer && !viewerRole) {
        const [jr] = await db
          .select({ id: groupJoinRequestsTable.id })
          .from(groupJoinRequestsTable)
          .where(
            and(
              eq(groupJoinRequestsTable.groupId, g.id),
              eq(groupJoinRequestsTable.userId, viewer.id),
              eq(groupJoinRequestsTable.status, "pending"),
            ),
          );
        hasPending = !!jr;
      }
      return serializeGroup(g, { viewerMemberRole: viewerRole, viewerHasPendingRequest: hasPending });
    }),
  );

  res.json({ groups, total: filtered.length });
});

// GET /meetups — Meetup group discovery (public + visible-private only)
router.get("/meetups", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const city = typeof req.query.city === "string" ? req.query.city.trim() : undefined;
  const state = typeof req.query.state === "string" ? req.query.state.trim() : undefined;
  const privacyParam = typeof req.query.privacy === "string" ? req.query.privacy : undefined;
  const hasUpcomingEventParam = req.query.hasUpcomingEvent === "true";
  const sortParam = typeof req.query.sort === "string" ? req.query.sort : "most_members";
  const interestsRaw = typeof req.query.interests === "string" ? req.query.interests : undefined;
  const interests = interestsRaw ? interestsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const rawRadius = typeof req.query.radius === "string" ? Number(req.query.radius) : undefined;
  if (rawRadius !== undefined && !isAllowedMeetupRadius(rawRadius)) {
    res.status(400).json({ error: "radius must be one of 5, 10, 25, 50, or 100 miles" });
    return;
  }
  const radiusMiles = rawRadius;
  if (radiusMiles !== undefined && !viewer) {
    res.status(401).json({ error: "Sign in and add your city to search meetups by distance" });
    return;
  }
  const memberLocation =
    radiusMiles !== undefined && viewer ? await resolveMemberLocation(db, viewer) : null;
  if (radiusMiles !== undefined && !memberLocation) {
    res.status(422).json({
      error: "Add your city or enable location sharing before searching meetups by distance",
    });
    return;
  }
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 30 : 30,
    100,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const meetupConditions: Parameters<typeof and> = [
    eq(groupsTable.status, "active"),
    eq(groupsTable.groupType, "meetup"),
  ];

  if (search) {
    meetupConditions.push(
      or(
        ilike(groupsTable.name, `%${search}%`),
        ilike(groupsTable.description, `%${search}%`),
      )!,
    );
  }
  if (city) meetupConditions.push(ilike(groupsTable.meetupCity, `%${city}%`));
  if (state) meetupConditions.push(eq(groupsTable.meetupState, state));
  if (privacyParam === "public" || privacyParam === "private") {
    meetupConditions.push(eq(groupsTable.privacy, privacyParam));
  }
  if (hasUpcomingEventParam) {
    // Only meetups with at least one active upcoming event (cheap EXISTS subquery)
    meetupConditions.push(
      sql`EXISTS (
        SELECT 1 FROM group_events ge
        WHERE ge.group_id = ${groupsTable.id}
          AND ge.status = 'active'
          AND ge.starts_at > NOW()
      )`,
    );
  }

  // Sort: featured always floats first; secondary sort per param
  const sortOrder =
    sortParam === "newest"
      ? [desc(groupsTable.isFeatured), desc(groupsTable.createdAt)]
      : sortParam === "most_active"
        ? [desc(groupsTable.isFeatured), desc(groupsTable.eventCount)]
        : [desc(groupsTable.isFeatured), desc(groupsTable.memberCount)]; // most_members (default)

  // A distance search must calculate and order every eligible candidate before
  // pagination. The normal discovery path retains its database-level pagination.
  const rows =
    radiusMiles !== undefined
      ? await db
          .select()
          .from(groupsTable)
          .where(and(...meetupConditions))
          .orderBy(...sortOrder)
      : await db
          .select()
          .from(groupsTable)
          .where(and(...meetupConditions))
          .orderBy(...sortOrder)
          .limit(limit + 100)
          .offset(offset);

  // Filter: hidden private meetups only visible to their members (same as groups)
  const filtered: typeof rows = [];
  for (const g of rows) {
    if (g.privacy === "private" && g.visibility === "hidden") {
      if (viewer) {
        const role = await getGroupMemberRole(g.id, viewer.id);
        if (role) filtered.push(g);
      }
      continue;
    }
    filtered.push(g);
    if (radiusMiles === undefined && filtered.length >= limit) break;
  }

  const distanceCandidates =
    radiusMiles !== undefined && memberLocation
      ? await Promise.all(
          filtered.map(async (group) => {
            const geocoded = await ensureCoarseMeetupCoordinates(group);
            if (!isValidLat(geocoded.meetupLat) || !isValidLng(geocoded.meetupLng)) return null;
            const distanceMiles = haversineMiles(
              memberLocation.lat,
              memberLocation.lng,
              geocoded.meetupLat,
              geocoded.meetupLng,
            );
            return distanceMiles <= radiusMiles ? { group: geocoded, distanceMiles } : null;
          }),
        )
      : null;
  const rankedByDistance = distanceCandidates
    ?.filter((candidate): candidate is { group: typeof groupsTable.$inferSelect; distanceMiles: number } => candidate !== null)
    .sort((a, b) => a.distanceMiles - b.distanceMiles || a.group.id - b.group.id) ?? [];
  const page =
    radiusMiles !== undefined
      ? rankedByDistance.slice(offset, offset + limit)
      : filtered.slice(0, limit).map((group) => ({ group, distanceMiles: null }));

  const groups = await Promise.all(
    page.map(async ({ group: g, distanceMiles }) => {
      const viewerRole = viewer ? await getGroupMemberRole(g.id, viewer.id) : null;
      let hasPending = false;
      if (viewer && !viewerRole) {
        const [jr] = await db
          .select({ id: groupJoinRequestsTable.id })
          .from(groupJoinRequestsTable)
          .where(
            and(
              eq(groupJoinRequestsTable.groupId, g.id),
              eq(groupJoinRequestsTable.userId, viewer.id),
              eq(groupJoinRequestsTable.status, "pending"),
            ),
          );
        hasPending = !!jr;
      }
      return serializeGroup(g, {
        viewerMemberRole: viewerRole,
        viewerHasPendingRequest: hasPending,
        distanceMiles: distanceMiles === null ? null : Math.round(distanceMiles * 10) / 10,
      });
    }),
  );

  res.json({ groups, total: radiusMiles !== undefined ? rankedByDistance.length : filtered.length });
});

// GET /groups/my
router.get("/groups/my", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const memberships = await db
    .select({ groupId: groupMembersTable.groupId, role: groupMembersTable.role })
    .from(groupMembersTable)
    .where(and(eq(groupMembersTable.userId, user.id), eq(groupMembersTable.status, "active")))
    .orderBy(desc(groupMembersTable.joinedAt));

  // Also include groups where the viewer has a PENDING join request so the
  // dashboard can surface a "Pending Requests" section. These are groups the
  // viewer is NOT yet a member of; `viewerHasPendingRequest` distinguishes them.
  const pendingRequests = await db
    .select({ groupId: groupJoinRequestsTable.groupId })
    .from(groupJoinRequestsTable)
    .where(
      and(
        eq(groupJoinRequestsTable.userId, user.id),
        eq(groupJoinRequestsTable.status, "pending"),
      ),
    );

  const roleMap = new Map(memberships.map((m) => [m.groupId, m.role as GroupRole]));
  const pendingIds = new Set(pendingRequests.map((r) => r.groupId));

  const groupIds = [...new Set([...memberships.map((m) => m.groupId), ...pendingIds])];
  if (!groupIds.length) {
    res.json([]);
    return;
  }
  const groups = await db
    .select()
    .from(groupsTable)
    .where(and(inArray(groupsTable.id, groupIds), sql`${groupsTable.status} != 'deleted'`));

  res.json(
    groups.map((g) =>
      serializeGroup(g, {
        viewerMemberRole: roleMap.get(g.id) ?? null,
        // A pending request only counts for a group the viewer is not a member of.
        viewerHasPendingRequest: !roleMap.has(g.id) && pendingIds.has(g.id),
      }),
    ),
  );
});

// GET /groups/invites
router.get("/groups/invites", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const now = new Date();

  // Auto-expire stale invites before returning
  await db
    .update(groupInvitesTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(groupInvitesTable.invitedUserId, user.id),
        eq(groupInvitesTable.status, "pending"),
        sql`${groupInvitesTable.expiresAt} IS NOT NULL AND ${groupInvitesTable.expiresAt} < ${now}`,
      ),
    );

  const invites = await db
    .select()
    .from(groupInvitesTable)
    .where(
      and(eq(groupInvitesTable.invitedUserId, user.id), eq(groupInvitesTable.status, "pending")),
    )
    .orderBy(desc(groupInvitesTable.createdAt));

  // Batch-load the referenced group summaries and inviters so the dashboard can
  // render each invite with the group's name + icon and the inviter's display
  // fields without extra round-trips.
  const inviteGroupIds = [...new Set(invites.map((inv) => inv.groupId))];
  const inviterUserIds = [...new Set(invites.map((inv) => inv.invitedByUserId))];

  const groupRows = inviteGroupIds.length
    ? await db
        .select({
          id: groupsTable.id,
          name: groupsTable.name,
          iconUrl: groupsTable.iconUrl,
          // privacy+visibility drive branding protection: hidden-private icons
          // must be served via the access-controlled Group asset route, since
          // universal storage now denies them.
          privacy: groupsTable.privacy,
          visibility: groupsTable.visibility,
          // Discriminator so the frontend can filter Meetup invites from Group invites
          groupType: groupsTable.groupType,
        })
        .from(groupsTable)
        .where(inArray(groupsTable.id, inviteGroupIds))
    : [];
  const groupMap = new Map(groupRows.map((g) => [g.id, g]));

  const inviterRows = inviterUserIds.length
    ? await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          profilePhotoUrl: usersTable.profilePhotoUrl,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, inviterUserIds))
    : [];
  const inviterMap = new Map(inviterRows.map((u) => [u.id, u]));

  const result = invites.map((inv) => {
    const group = groupMap.get(inv.groupId) ?? null;
    const inviter = inviterMap.get(inv.invitedByUserId) ?? null;
    return {
      id: inv.id,
      groupId: inv.groupId,
      // Flat fields retained for backward compatibility.
      groupName: group?.name ?? null,
      invitedByUserId: inv.invitedByUserId,
      invitedByUserName: inviter?.name ?? "Unknown",
      invitedUserId: inv.invitedUserId,
      status: inv.status,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt?.toISOString() ?? null,
      // Enriched, typed payload consumed by the dashboard. Hidden-private group
      // icons are rewritten to the protected asset route (an invited viewer can
      // load them through it); visible-private/public icons stay public.
      group: group
        ? {
            id: group.id,
            name: group.name,
            iconUrl: brandingUrl(group, group.iconUrl ?? null),
            groupType: (group.groupType ?? "group") as "group" | "meetup",
          }
        : null,
      inviterId: inv.invitedByUserId,
      inviterName: inviter?.name ?? "Unknown",
      inviterPhotoUrl: inviter?.profilePhotoUrl ?? null,
    };
  });
  res.json(result);
});

// POST /groups/meetup-drafts — persist an incomplete unified form without an event.
router.post("/groups/meetup-drafts", requireAuth(), requireCompleteBuddyProfile, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateMeetupDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  let coverUrl = data.coverUrl ?? null;
  let imageUrl = data.imageUrl ?? null;
  try {
    if (coverUrl) coverUrl = await finalizeGroupImageUrl(coverUrl, user.id);
    if (imageUrl) imageUrl = await finalizeGroupImageUrl(imageUrl, user.id);
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }
  const draftData = { ...data, coverUrl: coverUrl ?? undefined, imageUrl: imageUrl ?? undefined };

  const [group] = await db.transaction(async (tx) => {
    const [createdGroup] = await tx
      .insert(groupsTable)
      .values({
        creatorUserId: user.id,
        name: data.name?.trim() || "Untitled Meetup",
        description: data.description ?? null,
        category: data.category ?? null,
        tags: data.tags ?? null,
        privacy: data.privacy ?? "public",
        visibility: data.privacy === "private" ? (data.visibility ?? "visible") : "visible",
        coverUrl,
        status: "draft",
        memberCount: 1,
        eventCount: 0,
        groupType: "meetup",
        meetupInterests: data.interests ?? null,
        meetupCity: data.city ?? null,
        meetupState: data.state ?? null,
        meetupDraftData: draftData,
      })
      .returning();
    await tx.insert(groupMembersTable).values({
      groupId: createdGroup.id,
      userId: user.id,
      role: "owner",
      joinedVia: "direct",
      status: "active",
    });
    return [createdGroup] as const;
  });

  res.status(201).json({
    group: serializeGroup(group, { viewerMemberRole: "owner" }),
    data: draftData,
  });
});

// GET/PUT /groups/meetup-drafts/:groupId — organizer/admin-only draft access.
router.get("/groups/meetup-drafts/:groupId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (
    !group ||
    group.groupType !== "meetup" ||
    group.status !== "draft" ||
    (user.role !== "admin" && group.creatorUserId !== user.id)
  ) {
    res.status(404).json({ error: "Meetup draft not found" });
    return;
  }
  res.json({
    group: serializeGroup(group, { viewerMemberRole: group.creatorUserId === user.id ? "owner" : "admin" }),
    data: group.meetupDraftData ?? {},
  });
});

router.put("/groups/meetup-drafts/:groupId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const parsed = UpdateMeetupDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (
    !existing ||
    existing.groupType !== "meetup" ||
    existing.status !== "draft" ||
    existing.creatorUserId !== user.id
  ) {
    res.status(404).json({ error: "Meetup draft not found" });
    return;
  }

  const data = parsed.data;
  let coverUrl = data.coverUrl ?? null;
  let imageUrl = data.imageUrl ?? null;
  try {
    if (coverUrl && coverUrl !== existing.coverUrl) {
      coverUrl = await finalizeGroupImageUrl(coverUrl, user.id);
    }
    if (imageUrl) imageUrl = await finalizeGroupImageUrl(imageUrl, user.id);
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }
  const draftData = { ...data, coverUrl: coverUrl ?? undefined, imageUrl: imageUrl ?? undefined };
  const [group] = await db
    .update(groupsTable)
    .set({
      name: data.name?.trim() || "Untitled Meetup",
      description: data.description ?? null,
      category: data.category ?? null,
      tags: data.tags ?? null,
      privacy: data.privacy ?? "public",
      visibility: data.privacy === "private" ? (data.visibility ?? "visible") : "visible",
      coverUrl,
      meetupInterests: data.interests ?? null,
      meetupCity: data.city ?? null,
      meetupState: data.state ?? null,
      meetupDraftData: draftData,
    })
    .where(and(eq(groupsTable.id, groupId), eq(groupsTable.status, "draft")))
    .returning();

  res.json({
    group: serializeGroup(group, { viewerMemberRole: group.creatorUserId === user.id ? "owner" : "admin" }),
    data: draftData,
  });
});

// POST /groups
// POST /groups/meetups — create the Meetup space and its first event together.
// This must remain above parameterized /groups/:groupId routes.
router.post("/groups/meetups", requireAuth(), requireCompleteBuddyProfile, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateMeetupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  let draftGroup: typeof groupsTable.$inferSelect | null = null;
  if (data.draftId !== undefined) {
    const [candidate] = await db.select().from(groupsTable).where(eq(groupsTable.id, data.draftId));
    if (
      !candidate ||
      candidate.groupType !== "meetup" ||
      candidate.status !== "draft" ||
      candidate.creatorUserId !== user.id
    ) {
      res.status(404).json({ error: "Meetup draft not found" });
      return;
    }
    draftGroup = candidate;
  }
  const eventBusiness = data.businessId
    ? await getAuthorizedEventBusiness(data.businessId, user.id)
    : null;
  if (data.businessId && !eventBusiness) {
    res.status(403).json({ error: "You cannot host events as this Business Page" });
    return;
  }
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    res.status(400).json({ error: "startsAt and endsAt must be valid dates" });
    return;
  }
  if (endsAt <= startsAt) {
    res.status(400).json({ error: "endsAt must be after startsAt" });
    return;
  }

  const needsPhysicalLocation = data.eventFormat === "in_person" || data.eventFormat === "hybrid";
  if (
    needsPhysicalLocation &&
    (!data.venueName?.trim() || !data.address?.trim() || !data.city?.trim() ||
      !data.state?.trim())
  ) {
    res.status(400).json({
      error: "venueName, address, city, and state are required for in-person or hybrid events",
    });
    return;
  }
  const needsOnlineLocation = data.eventFormat === "online" || data.eventFormat === "hybrid";
  let onlineUrl: string | null = null;
  if (data.onlineUrl?.trim()) {
    try {
      const parsedOnlineUrl = new URL(data.onlineUrl.trim());
      if (!["http:", "https:"].includes(parsedOnlineUrl.protocol)) {
        throw new Error("unsupported protocol");
      }
      onlineUrl = parsedOnlineUrl.toString();
    } catch {
      res.status(400).json({ error: "onlineUrl must be a valid http or https URL" });
      return;
    }
  }
  if (needsOnlineLocation && !onlineUrl) {
    res.status(400).json({ error: "onlineUrl is required for online or hybrid events" });
    return;
  }
  const rsvpOpensAt = data.rsvpOpensAt ? new Date(data.rsvpOpensAt) : null;
  const rsvpClosesAt = data.rsvpClosesAt ? new Date(data.rsvpClosesAt) : null;
  if (
    (rsvpOpensAt && Number.isNaN(rsvpOpensAt.getTime())) ||
    (rsvpClosesAt && Number.isNaN(rsvpClosesAt.getTime()))
  ) {
    res.status(400).json({ error: "RSVP dates must be valid dates" });
    return;
  }
  if (rsvpOpensAt && rsvpClosesAt && rsvpClosesAt <= rsvpOpensAt) {
    res.status(400).json({ error: "rsvpClosesAt must be after rsvpOpensAt" });
    return;
  }
  if ((rsvpOpensAt && rsvpOpensAt >= startsAt) || (rsvpClosesAt && rsvpClosesAt >= startsAt)) {
    res.status(400).json({ error: "RSVP dates must be before the event starts" });
    return;
  }
  if (data.isPaid && !data.paidMetadata) {
    res.status(400).json({ error: "paidMetadata is required when isPaid is true" });
    return;
  }

  // Both uploads are finalized before opening the DB transaction, matching the
  // existing group/event routes and ensuring only owned internal objects are stored.
  let coverUrl: string | null = null;
  let imageUrl: string | null = null;
  try {
    if (data.coverUrl) coverUrl = await finalizeGroupImageUrl(data.coverUrl, user.id);
    if (data.imageUrl) imageUrl = await finalizeGroupImageUrl(data.imageUrl, user.id);
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  const meetupCoordinates = await resolveCoarseMeetupCoordinates(
    "meetup",
    data.city,
    data.state,
  );
  const groupLocation =
    data.city && data.state ? `${data.city.trim()}, ${data.state.trim()}` : null;
  const eventLocation = needsPhysicalLocation
    ? [data.venueName, data.address, data.city, data.state, data.zip].filter(Boolean).join(", ")
    : null;
  const eventInstructions = [
    data.howToFind?.trim() ? `How to find us: ${data.howToFind.trim()}` : null,
    data.instructions?.trim() ? `Online instructions: ${data.instructions.trim()}` : null,
  ].filter(Boolean).join("\n\n") || null;

  let publication: readonly [
    typeof groupsTable.$inferSelect,
    typeof groupEventsTable.$inferSelect,
  ];
  try {
    publication = await db.transaction(async (tx) => {
    const groupValues = {
        creatorUserId: draftGroup?.creatorUserId ?? user.id,
        name: data.name,
        description: data.description ?? null,
        category: data.category ?? null,
        tags: data.tags ?? null,
        privacy: data.privacy,
        visibility: data.privacy === "private" ? (data.visibility ?? "visible") : "visible",
        coverUrl,
        location: groupLocation,
        postingPermission: "all_members",
        postApproval: false,
        status: "active",
        memberCount: 1,
        eventCount: 1,
        groupType: "meetup",
        meetupInterests: data.interests ?? null,
        meetupCity: data.city ?? null,
        meetupState: data.state ?? null,
        meetupLat: meetupCoordinates?.lat ?? null,
        meetupLng: meetupCoordinates?.lng ?? null,
        meetupDraftData: null,
      };
    const [createdGroup] = draftGroup
      ? await tx
          .update(groupsTable)
          .set(groupValues)
          .where(and(eq(groupsTable.id, draftGroup.id), eq(groupsTable.status, "draft")))
          .returning()
      : await tx.insert(groupsTable).values(groupValues).returning();
    if (!createdGroup) {
      throw new MeetupDraftPublishConflictError("Meetup draft has already been published");
    }

    if (!draftGroup) {
      await tx.insert(groupMembersTable).values({
        groupId: createdGroup.id,
        userId: user.id,
        role: "owner",
        joinedVia: "direct",
        status: "active",
      });
    }
    await tx.insert(groupRulesTable).values([
      {
        groupId: createdGroup.id,
        title: "Be respectful",
        description: "Treat every Meetup member with respect.",
        sortOrder: 0,
      },
      {
        groupId: createdGroup.id,
        title: "Follow Meetup guidelines",
        description: data.rulesNotes ?? "Follow venue and organizer guidance.",
        sortOrder: 1,
      },
    ]);

    const [createdEvent] = await tx
      .insert(groupEventsTable)
      .values({
        groupId: createdGroup.id,
        createdByUserId: draftGroup?.creatorUserId ?? user.id,
        businessId: eventBusiness?.id ?? null,
        title: data.title,
        description: data.eventDescription ?? null,
        location: eventLocation,
        onlineUrl,
        imageUrl,
        startsAt,
        endsAt,
        status: "active",
        // Tying event visibility to group privacy avoids a public event being
        // accidentally exposed from a private Meetup.
        visibility: data.privacy,
        hideAttendees: data.hideAttendees ?? false,
        eventFormat: data.eventFormat,
        venueName: data.venueName ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        eventCategory: data.eventCategory ?? null,
        topics: data.topics ?? null,
        eventTags: data.eventTags ?? null,
        howToFind: eventInstructions,
        attendeeLimit: data.attendeeLimit ?? null,
        waitlistEnabled: data.waitlistEnabled ?? false,
        allowGuests: data.allowGuests ?? false,
        maxGuestsPerRsvp: data.maxGuestsPerRsvp ?? null,
        rsvpOpensAt,
        rsvpClosesAt,
        isPaid: data.isPaid ?? false,
        paidMetadata: (data.paidMetadata as Record<string, unknown>) ?? null,
      })
      .returning();
    return [createdGroup, createdEvent] as const;
    });
  } catch (err) {
    if (err instanceof MeetupDraftPublishConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
  const [group, event] = publication;

  await logGroupActivity(group.id, user.id, "create_group");
  await logGroupActivity(group.id, user.id, "create_event", {
    targetType: "event",
    targetId: event.id,
  });
  res.status(201).json({
    group: serializeGroup(group, { viewerMemberRole: "owner" }),
    primaryEvent: serializeGroupEvent(event, {
      viewerRsvpStatus: null,
      groupIsPrivate: group.privacy === "private",
      business: eventBusiness,
    }),
  });
});

router.post("/groups", requireAuth(), requireCompleteBuddyProfile, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  let coverUrl = data.coverUrl ?? null;
  let iconUrl = data.iconUrl ?? null;
  try {
    if (coverUrl) coverUrl = await finalizeGroupImageUrl(coverUrl, user.id);
    if (iconUrl) iconUrl = await finalizeGroupImageUrl(iconUrl, user.id);
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  let handle = data.handle ? data.handle.trim().toLowerCase() : null;
  if (handle) {
    if (!/^[a-z0-9_-]{2,50}$/.test(handle)) {
      res.status(400).json({
        error: "Handle must be 2–50 characters: letters, numbers, hyphens, underscores",
      });
      return;
    }
    const [existing] = await db
      .select({ id: groupsTable.id })
      .from(groupsTable)
      .where(eq(groupsTable.handle, handle));
    if (existing) {
      res.status(409).json({ error: "Handle already taken" });
      return;
    }
  }

  const meetupCoordinates = await resolveCoarseMeetupCoordinates(
    data.groupType,
    data.meetupCity,
    data.meetupState,
  );

  const [group, _member] = await db.transaction(async (tx) => {
    const [g] = await tx
      .insert(groupsTable)
      .values({
        creatorUserId: user.id,
        name: data.name,
        handle,
        description: data.description ?? null,
        category: data.category ?? null,
        customCategory: data.customCategory ?? null,
        tags: data.tags ?? null,
        privacy: data.privacy,
        visibility: data.privacy === "private" ? (data.visibility ?? "visible") : "visible",
        coverUrl,
        iconUrl,
        location: data.location ?? null,
        postingPermission: data.postingPermission ?? "all_members",
        postApproval: data.postApproval ?? false,
        status: "active",
        memberCount: 1,
        // Meetup subtype — server enforces creatorUserId; clients cannot forge ownership
        groupType: (data.groupType ?? "group") as "group" | "meetup",
        meetupInterests: data.meetupInterests ?? null,
        meetupCity: data.meetupCity ?? null,
        meetupState: data.meetupState ?? null,
        meetupCountry: data.meetupCountry ?? null,
        meetupLat: meetupCoordinates?.lat ?? null,
        meetupLng: meetupCoordinates?.lng ?? null,
      })
      .returning();

    const [m] = await tx
      .insert(groupMembersTable)
      .values({
        groupId: g.id,
        userId: user.id,
        role: "owner",
        joinedVia: "direct",
        status: "active",
      })
      .returning();

    return [g, m];
  });

  await logGroupActivity(group.id, user.id, "create_group");
  res.status(201).json(serializeGroup(group, { viewerMemberRole: "owner" }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Group detail / update / delete
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId
router.get("/groups/:groupId", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted" || group.status === "draft") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);

  // Pending join-request state (drives the dashboard "Pending Requests" section
  // and the request-to-join UI on a preview).
  const loadPendingRequest = async (): Promise<boolean> => {
    if (!viewer || access.isMember) return false;
    const [jr] = await db
      .select({ id: groupJoinRequestsTable.id })
      .from(groupJoinRequestsTable)
      .where(
        and(
          eq(groupJoinRequestsTable.groupId, groupId),
          eq(groupJoinRequestsTable.userId, viewer.id),
          eq(groupJoinRequestsTable.status, "pending"),
        ),
      );
    return !!jr;
  };

  if (!access.allowed) {
    // PRIVATE + VISIBLE: discoverable. Non-members get a SANITIZED PREVIEW
    // (group summary/branding only) so they can request to join. Posts,
    // members, media, and events remain behind their own membership-gated
    // endpoints — the preview does not expose any of them.
    if (group.privacy === "private" && group.visibility === "visible") {
      const hasPending = await loadPendingRequest();
      res.json(
        serializeGroupPreview(group, {
          viewerMemberRole: access.memberRole,
          viewerHasPendingRequest: hasPending,
        }),
      );
      return;
    }

    // PRIVATE + HIDDEN: undiscoverable. Only a valid (non-expired) pending
    // invite unlocks a preview; otherwise deny without confirming existence.
    if (group.privacy === "private" && group.visibility === "hidden") {
      if (viewer) {
        const now = new Date();
        const [inv] = await db
          .select({ id: groupInvitesTable.id })
          .from(groupInvitesTable)
          .where(
            and(
              eq(groupInvitesTable.groupId, groupId),
              eq(groupInvitesTable.invitedUserId, viewer.id),
              eq(groupInvitesTable.status, "pending"),
              or(
                sql`${groupInvitesTable.expiresAt} IS NULL`,
                sql`${groupInvitesTable.expiresAt} >= ${now}`,
              )!,
            ),
          )
          .limit(1);
        if (inv) {
          const hasPending = await loadPendingRequest();
          res.json(
            serializeGroupPreview(group, {
              viewerMemberRole: access.memberRole,
              viewerHasPendingRequest: hasPending,
            }),
          );
          return;
        }
      }
      res.status(403).json({ error: "This is a private Group. You must be invited to view it." });
      return;
    }

    // Any other unreachable state (e.g. suspended/hidden lifecycle).
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const hasPending = await loadPendingRequest();

  res.json(
    serializeGroup(group, {
      viewerMemberRole: access.memberRole,
      viewerHasPendingRequest: hasPending,
    }),
  );
});

// PATCH /groups/:groupId
router.patch("/groups/:groupId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!groupAllowsWrites(group, user.role === "admin")) {
    res.status(403).json({ error: "This group is suspended and cannot be modified" });
    return;
  }

  const actorGroupRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorGroupRole)) {
    res.status(403).json({ error: "Only group admins and owners can update settings" });
    return;
  }

  const parsed = UpdateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  let coverUrl = data.coverUrl !== undefined ? (data.coverUrl ?? null) : group.coverUrl;
  let iconUrl = data.iconUrl !== undefined ? (data.iconUrl ?? null) : group.iconUrl;
  try {
    if (data.coverUrl && data.coverUrl !== null) {
      coverUrl = await finalizeGroupImageUrl(data.coverUrl, user.id);
    }
    if (data.iconUrl && data.iconUrl !== null) {
      iconUrl = await finalizeGroupImageUrl(data.iconUrl, user.id);
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  let handle = group.handle;
  if (data.handle !== undefined) {
    handle = data.handle ? data.handle.trim().toLowerCase() : null;
    if (handle && !/^[a-z0-9_-]{2,50}$/.test(handle)) {
      res.status(400).json({
        error: "Handle must be 2–50 characters: letters, numbers, hyphens, underscores",
      });
      return;
    }
    if (handle && handle !== group.handle) {
      const [existing] = await db
        .select({ id: groupsTable.id })
        .from(groupsTable)
        .where(and(eq(groupsTable.handle, handle), not(eq(groupsTable.id, groupId))));
      if (existing) {
        res.status(409).json({ error: "Handle already taken" });
        return;
      }
    }
  }

  const nextGroupType =
    data.groupType !== undefined ? ((data.groupType ?? "group") as "group" | "meetup") : group.groupType ?? "group";
  const nextMeetupCity =
    data.meetupCity !== undefined ? (data.meetupCity ?? null) : group.meetupCity;
  const nextMeetupState =
    data.meetupState !== undefined ? (data.meetupState ?? null) : group.meetupState;
  const locationChanged =
    nextGroupType !== (group.groupType ?? "group") ||
    nextMeetupCity !== group.meetupCity ||
    nextMeetupState !== group.meetupState;
  const meetupCoordinates = locationChanged
    ? await resolveCoarseMeetupCoordinates(nextGroupType, nextMeetupCity, nextMeetupState)
    : null;

  const [updated] = await db
    .update(groupsTable)
    .set({
      name: data.name ?? group.name,
      handle,
      description: data.description !== undefined ? (data.description ?? null) : group.description,
      category: data.category !== undefined ? (data.category ?? null) : group.category,
      customCategory:
        data.customCategory !== undefined ? (data.customCategory ?? null) : group.customCategory,
      tags: data.tags !== undefined ? (data.tags ?? null) : group.tags,
      privacy: data.privacy ?? group.privacy,
      visibility:
        data.visibility !== undefined ? (data.visibility ?? group.visibility) : group.visibility,
      coverUrl,
      iconUrl,
      location: data.location !== undefined ? (data.location ?? null) : group.location,
      postingPermission: data.postingPermission ?? group.postingPermission,
      postApproval: data.postApproval !== undefined ? data.postApproval : group.postApproval,
      // Meetup subtype fields
      groupType: nextGroupType,
      meetupInterests: data.meetupInterests !== undefined ? (data.meetupInterests ?? null) : group.meetupInterests,
      meetupCity: nextMeetupCity,
      meetupState: nextMeetupState,
      meetupCountry: data.meetupCountry !== undefined ? (data.meetupCountry ?? null) : group.meetupCountry,
      meetupLat: locationChanged ? meetupCoordinates?.lat ?? null : group.meetupLat,
      meetupLng: locationChanged ? meetupCoordinates?.lng ?? null : group.meetupLng,
    })
    .where(eq(groupsTable.id, groupId))
    .returning();

  await logGroupActivity(groupId, user.id, "update_settings");

  const viewerRole =
    user.role === "admin" ? await getGroupMemberRole(groupId, user.id) : actorGroupRole;
  res.json(serializeGroup(updated, { viewerMemberRole: viewerRole ?? null }));
});

// DELETE /groups/:groupId (owner-only soft delete)
router.delete("/groups/:groupId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const role =
    user.role === "admin" ? "owner" : await getGroupMemberRole(groupId, user.id);
  if (role !== "owner" && user.role !== "admin") {
    res.status(403).json({ error: "Only the group owner can delete this group" });
    return;
  }

  await db.update(groupsTable).set({ status: "deleted" }).where(eq(groupsTable.id, groupId));
  await logGroupActivity(groupId, user.id, "update_group_status", { note: "deleted" });
  res.sendStatus(204);
});

// ─────────────────────────────────────────────────────────────────────────────
// Membership — join / leave
// ─────────────────────────────────────────────────────────────────────────────

// POST /groups/:groupId/join
// Accepts optional body: { answers: [{questionId, answerText}] }
router.post("/groups/:groupId/join", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!groupAllowsWrites(group, false)) {
    // Suspended groups do not accept new members
    res.status(403).json({ error: "This group is not accepting new members at this time" });
    return;
  }

  // Hidden private groups cannot be self-joined
  if (group.privacy === "private" && group.visibility === "hidden") {
    res.status(403).json({ error: "This group is invite-only" });
    return;
  }

  const existingRole = await getGroupMemberRole(groupId, user.id);
  if (existingRole) {
    res.status(409).json({ error: "You are already a member of this group" });
    return;
  }

  // Block check against the group owner
  const [ownerMember] = await db
    .select({ userId: groupMembersTable.userId })
    .from(groupMembersTable)
    .where(
      and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.role, "owner")),
    );
  if (ownerMember) {
    const blocked = await isBlocked(user.id, ownerMember.userId);
    if (blocked) {
      res.status(403).json({ error: "You cannot join this group" });
      return;
    }
  }

  // Parse optional answers
  const parsed = JoinGroupBody.safeParse(req.body ?? {});
  const answers = parsed.success ? (parsed.data.answers ?? []) : [];

  if (group.privacy === "public") {
    // Direct join — transactional insert+counter
    const joined = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(groupMembersTable)
        .values({
          groupId,
          userId: user.id,
          role: "member",
          joinedVia: "direct",
          status: "active",
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) return false;
      await tx
        .update(groupsTable)
        .set({ memberCount: sql`${groupsTable.memberCount} + 1` })
        .where(eq(groupsTable.id, groupId));
      return true;
    });

    if (joined) {
      await logGroupActivity(groupId, user.id, "approve_member", {
        targetType: "member",
        targetId: user.id,
        note: "public group direct join",
      });
      await db.insert(groupInsightEventsTable).values({
        groupId,
        eventType: "member_join",
        userId: user.id,
      });
    }
    res.json({ status: "joined", message: "You have joined the group" });
    return;
  }

  // Private visible group — create or re-open a join request (with answers)
  const [existing] = await db
    .select({ id: groupJoinRequestsTable.id, status: groupJoinRequestsTable.status })
    .from(groupJoinRequestsTable)
    .where(
      and(
        eq(groupJoinRequestsTable.groupId, groupId),
        eq(groupJoinRequestsTable.userId, user.id),
      ),
    );

  if (existing && existing.status === "pending") {
    res.status(409).json({ error: "You already have a pending join request for this group" });
    return;
  }

  // Validate required questions are answered
  const questions = await db
    .select()
    .from(groupQuestionsTable)
    .where(and(eq(groupQuestionsTable.groupId, groupId), eq(groupQuestionsTable.isRequired, true)));

  const answeredIds = new Set(answers.map((a) => a.questionId));
  const missing = questions.filter((q) => !answeredIds.has(q.id));
  if (missing.length > 0) {
    res.status(400).json({
      error: `Missing required answers for questions: ${missing.map((q) => q.id).join(", ")}`,
    });
    return;
  }

  let requestId: number;
  if (existing) {
    const [updated] = await db
      .update(groupJoinRequestsTable)
      .set({ status: "pending", reviewedByUserId: null, reviewedAt: null, declineReason: null })
      .where(eq(groupJoinRequestsTable.id, existing.id))
      .returning();
    requestId = updated.id;
    // Delete old answers and reinsert
    await db
      .delete(groupQuestionAnswersTable)
      .where(eq(groupQuestionAnswersTable.joinRequestId, requestId));
  } else {
    const [inserted] = await db
      .insert(groupJoinRequestsTable)
      .values({ groupId, userId: user.id, status: "pending" })
      .returning();
    requestId = inserted.id;
  }

  if (answers.length > 0) {
    await db.insert(groupQuestionAnswersTable).values(
      answers.map((a) => ({
        joinRequestId: requestId,
        questionId: a.questionId,
        groupId,
        userId: user.id,
        answerText: a.answerText,
      })),
    );
  }

  res.json({ status: "requested", message: "Join request submitted. Awaiting approval." });
});

// POST /groups/:groupId/leave
router.post("/groups/:groupId/leave", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const role = await getGroupMemberRole(groupId, user.id);
  if (!role) {
    res.status(400).json({ error: "You are not a member of this group" });
    return;
  }
  if (role === "owner") {
    res.status(400).json({ error: "The group owner cannot leave. Transfer ownership first." });
    return;
  }

  const didLeave = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(groupMembersTable)
      .where(
        and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, user.id)),
      )
      .returning();
    if (!deleted.length) return false;
    await tx
      .update(groupsTable)
      .set({ memberCount: sql`greatest(${groupsTable.memberCount} - 1, 0)` })
      .where(eq(groupsTable.id, groupId));
    return true;
  });

  if (didLeave) {
    await db.insert(groupInsightEventsTable).values({
      groupId,
      eventType: "member_leave",
      userId: user.id,
    });
  }

  res.json({ message: "You have left the group" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Members list & management
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/members
router.get("/groups/:groupId/members", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see its members" });
    return;
  }

  const role = typeof req.query.role === "string" ? req.query.role : undefined;
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    200,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const conditions: Parameters<typeof and> = [
    eq(groupMembersTable.groupId, groupId),
    eq(groupMembersTable.status, "active"),
  ];
  if (role) conditions.push(eq(groupMembersTable.role, role));

  const members = await db
    .select()
    .from(groupMembersTable)
    .where(and(...conditions))
    .orderBy(asc(groupMembersTable.joinedAt))
    .limit(limit)
    .offset(offset);

  const userIds = [...new Set(members.map((m) => m.userId))];

  // Block filtering — remove members blocked by/from viewer
  const blockedIds = viewer ? await getBlockedUserIds(viewer.id, userIds) : new Set<number>();

  const visibleMembers = members.filter((m) => !blockedIds.has(m.userId));
  const visibleUserIds = [...new Set(visibleMembers.map((m) => m.userId))];

  const users = visibleUserIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl, buddyType: usersTable.buddyType })
        .from(usersTable)
        .where(inArray(usersTable.id, visibleUserIds))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  res.json(
    visibleMembers.map((m) => {
      const u = userMap.get(m.userId);
      return {
        id: m.id,
        groupId: m.groupId,
        userId: m.userId,
        userName: u?.name ?? "Unknown",
        userPhotoUrl: u?.profilePhotoUrl ?? null,
        buddyType: u?.buddyType ?? null,
        role: m.role,
        joinedVia: m.joinedVia,
        status: m.status,
        joinedAt: m.joinedAt.toISOString(),
      };
    }),
  );
});

// PATCH /groups/:groupId/members/:userId
// Owner-only for admin promotion/demotion; admins can change moderator/member roles only.
router.patch("/groups/:groupId/members/:userId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const targetUserId = parseId(req.params.userId);

  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorRole)) {
    res.status(403).json({ error: "Only group admins/owners can manage members" });
    return;
  }

  const parsed = UpdateGroupMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [targetMember] = await db
    .select()
    .from(groupMembersTable)
    .where(
      and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, targetUserId)),
    );

  if (!targetMember) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  if (targetMember.role === "owner") {
    res.status(400).json({ error: "Cannot change the owner's role or status" });
    return;
  }

  // Enforce owner-only admin promotion rule
  if (parsed.data.role) {
    const newRole = parsed.data.role as GroupRole;
    const actorGroupRole =
      user.role === "admin" ? "owner" : (actorRole as GroupRole); // platform admin treated as owner for this check
    if (!canChangeRole(actorGroupRole, targetMember.role as GroupRole, newRole)) {
      res.status(403).json({
        error:
          "Only the group owner can promote to admin or change an admin's role. Admins may only manage moderator and member roles.",
      });
      return;
    }
  }

  const [updated] = await db
    .update(groupMembersTable)
    .set({
      role: (parsed.data.role as GroupRole) ?? targetMember.role,
      status: parsed.data.status ?? targetMember.status,
    })
    .where(eq(groupMembersTable.id, targetMember.id))
    .returning();

  const action = parsed.data.role ? "promote_member" : "update_member";
  await logGroupActivity(groupId, user.id, action, {
    targetType: "member",
    targetId: targetUserId,
    note: parsed.data.role ? `role changed to ${parsed.data.role}` : undefined,
  });

  const [u] = await db
    .select({ name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl, buddyType: usersTable.buddyType })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId));

  res.json({
    id: updated.id,
    groupId: updated.groupId,
    userId: updated.userId,
    userName: u?.name ?? "Unknown",
    userPhotoUrl: u?.profilePhotoUrl ?? null,
    buddyType: u?.buddyType ?? null,
    role: updated.role,
    joinedVia: updated.joinedVia,
    status: updated.status,
    joinedAt: updated.joinedAt.toISOString(),
  });
});

// DELETE /groups/:groupId/members/:userId
router.delete("/groups/:groupId/members/:userId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const targetUserId = parseId(req.params.userId);
  const isSelfLeave = user.id === targetUserId;

  // Self-leave is always permitted (except on deleted groups) as an exit safety
  // valve; MANAGEMENT removal (kicking another member) is a management mutation
  // gated by the shared lifecycle policy (blocked on suspended/hidden/deleted).
  const guard = await loadGroupForLifecycle(groupId, isSelfLeave ? "read" : "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorRole) && !isSelfLeave) {
    res.status(403).json({ error: "Only group admins/owners can remove members" });
    return;
  }

  const [targetMember] = await db
    .select()
    .from(groupMembersTable)
    .where(
      and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, targetUserId)),
    );

  if (!targetMember) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  if (targetMember.role === "owner") {
    res.status(400).json({ error: "Cannot remove the group owner" });
    return;
  }

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(groupMembersTable)
      .where(eq(groupMembersTable.id, targetMember.id))
      .returning();
    if (deleted.length) {
      await tx
        .update(groupsTable)
        .set({ memberCount: sql`greatest(${groupsTable.memberCount} - 1, 0)` })
        .where(eq(groupsTable.id, groupId));
    }
  });

  await logGroupActivity(groupId, user.id, "remove_member", {
    targetType: "member",
    targetId: targetUserId,
  });

  res.sendStatus(204);
});

// ─────────────────────────────────────────────────────────────────────────────
// Invites
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/invites
router.get("/groups/:groupId/invites", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorRole)) {
    res.status(403).json({ error: "Only group admins/owners can see invites" });
    return;
  }

  // Expire stale invites atomically
  const now = new Date();
  await db
    .update(groupInvitesTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(groupInvitesTable.groupId, groupId),
        eq(groupInvitesTable.status, "pending"),
        sql`${groupInvitesTable.expiresAt} IS NOT NULL AND ${groupInvitesTable.expiresAt} < ${now}`,
      ),
    );

  const invites = await db
    .select()
    .from(groupInvitesTable)
    .where(
      and(eq(groupInvitesTable.groupId, groupId), eq(groupInvitesTable.status, "pending")),
    )
    .orderBy(desc(groupInvitesTable.createdAt));

  const result = await Promise.all(
    invites.map(async (inv) => {
      const [inviter] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, inv.invitedByUserId));
      const [invitee] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, inv.invitedUserId));
      return {
        id: inv.id,
        groupId: inv.groupId,
        groupName: group.name,
        invitedByUserId: inv.invitedByUserId,
        invitedByUserName: inviter?.name ?? "Unknown",
        invitedUserId: inv.invitedUserId,
        invitedUserName: invitee?.name ?? "Unknown",
        status: inv.status,
        createdAt: inv.createdAt.toISOString(),
        expiresAt: inv.expiresAt?.toISOString() ?? null,
      };
    }),
  );
  res.json(result);
});

// POST /groups/:groupId/invites
router.post("/groups/:groupId/invites", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!groupAllowsWrites(group, user.role === "admin")) {
    res.status(403).json({ error: "This group is not accepting invites at this time" });
    return;
  }

  const senderRole = await getGroupMemberRole(groupId, user.id);
  if (!senderRole && user.role !== "admin") {
    res.status(403).json({ error: "You must be a member to invite others" });
    return;
  }

  const parsed = InviteToGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { invitedUserId } = parsed.data;

  // Target user exists?
  const [targetUser] = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, invitedUserId));
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Already a member?
  const existingRole = await getGroupMemberRole(groupId, invitedUserId);
  if (existingRole) {
    res.status(409).json({ error: "User is already a member of this group" });
    return;
  }

  // Block check (bidirectional)
  const blocked = await isBlocked(user.id, invitedUserId);
  if (blocked) {
    res.status(403).json({ error: "Cannot invite this user" });
    return;
  }

  const [existingInv] = await db
    .select({ id: groupInvitesTable.id, status: groupInvitesTable.status })
    .from(groupInvitesTable)
    .where(
      and(
        eq(groupInvitesTable.groupId, groupId),
        eq(groupInvitesTable.invitedUserId, invitedUserId),
      ),
    );

  if (existingInv && existingInv.status === "pending") {
    res.status(409).json({ error: "A pending invite already exists for this user" });
    return;
  }

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  let inv: typeof groupInvitesTable.$inferSelect;
  if (existingInv) {
    const [updated] = await db
      .update(groupInvitesTable)
      .set({ status: "pending", invitedByUserId: user.id, expiresAt })
      .where(eq(groupInvitesTable.id, existingInv.id))
      .returning();
    inv = updated;
  } else {
    const [inserted] = await db
      .insert(groupInvitesTable)
      .values({ groupId, invitedByUserId: user.id, invitedUserId, status: "pending", expiresAt })
      .returning();
    inv = inserted;
  }

  await logGroupActivity(groupId, user.id, "invite_member", {
    targetType: "member",
    targetId: invitedUserId,
  });

  const [inviter] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, user.id));

  res.status(201).json({
    id: inv.id,
    groupId: inv.groupId,
    groupName: group.name,
    invitedByUserId: inv.invitedByUserId,
    invitedByUserName: inviter?.name ?? "Unknown",
    invitedUserId: inv.invitedUserId,
    invitedUserName: targetUser.name,
    status: inv.status,
    createdAt: inv.createdAt.toISOString(),
    expiresAt: inv.expiresAt?.toISOString() ?? null,
  });
});

// PATCH /groups/:groupId/invites/:inviteId  — accept or decline
router.patch(
  "/groups/:groupId/invites/:inviteId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const inviteId = parseId(req.params.inviteId);

    const parsed = RespondToGroupInviteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Atomically: verify invite is pending & not expired, then accept or decline.
    // Using a transaction to prevent races on hidden private groups.
    const result = await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(groupInvitesTable)
        .where(
          and(eq(groupInvitesTable.id, inviteId), eq(groupInvitesTable.groupId, groupId)),
        );

      if (!inv) return { error: "Invite not found", status: 404 };
      if (inv.invitedUserId !== user.id)
        return { error: "Only the invited user can respond to this invite", status: 403 };
      if (inv.status !== "pending") return { error: "Invite is no longer pending", status: 409 };

      // Check expiry
      if (inv.expiresAt && inv.expiresAt < new Date()) {
        await tx
          .update(groupInvitesTable)
          .set({ status: "expired" })
          .where(eq(groupInvitesTable.id, inviteId));
        return { error: "This invite has expired", status: 410 };
      }

      if (parsed.data.action === "accept") {
        const [group] = await tx
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, groupId));

        if (!group || group.status === "deleted") {
          return { error: "Group not found", status: 404 };
        }
        if (group.status === "suspended") {
          return { error: "This group is suspended and not accepting new members", status: 403 };
        }

        // Insert member; idempotent via onConflictDoNothing
        const [inserted] = await tx
          .insert(groupMembersTable)
          .values({
            groupId,
            userId: user.id,
            role: "member",
            joinedVia: "invite",
            status: "active",
          })
          .onConflictDoNothing()
          .returning();

        if (inserted) {
          await tx
            .update(groupsTable)
            .set({ memberCount: sql`${groupsTable.memberCount} + 1` })
            .where(eq(groupsTable.id, groupId));
        }
      }

      const [updated] = await tx
        .update(groupInvitesTable)
        .set({ status: parsed.data.action === "accept" ? "accepted" : "declined" })
        .where(eq(groupInvitesTable.id, inviteId))
        .returning();

      return { invite: updated };
    });

    if ("error" in result) {
      res.status(result.status as number).json({ error: result.error });
      return;
    }

    const inv = result.invite;

    if (parsed.data.action === "accept") {
      await logGroupActivity(groupId, user.id, "approve_member", {
        targetType: "member",
        targetId: user.id,
        note: "joined via invite",
      });
      await db.insert(groupInsightEventsTable).values({
        groupId,
        eventType: "member_join",
        userId: user.id,
      });
    }

    const [inviter] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, inv.invitedByUserId));
    const [group] = await db
      .select({ name: groupsTable.name })
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId));

    res.json({
      id: inv.id,
      groupId: inv.groupId,
      groupName: group?.name ?? null,
      invitedByUserId: inv.invitedByUserId,
      invitedByUserName: inviter?.name ?? "Unknown",
      invitedUserId: inv.invitedUserId,
      status: inv.status,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt?.toISOString() ?? null,
    });
  },
);

// DELETE /groups/:groupId/invites/:inviteId — cancel
router.delete(
  "/groups/:groupId/invites/:inviteId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const inviteId = parseId(req.params.inviteId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const [inv] = await db
      .select()
      .from(groupInvitesTable)
      .where(and(eq(groupInvitesTable.id, inviteId), eq(groupInvitesTable.groupId, groupId)));

    if (!inv || inv.status !== "pending") {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    const actorRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    const canCancel =
      inv.invitedByUserId === user.id || canManageGroup(actorRole) || user.role === "admin";

    if (!canCancel) {
      res.status(403).json({ error: "Not authorized to cancel this invite" });
      return;
    }

    await db
      .update(groupInvitesTable)
      .set({ status: "cancelled" })
      .where(eq(groupInvitesTable.id, inviteId));

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Join Requests
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/join-requests
router.get("/groups/:groupId/join-requests", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canModerateContent(actorRole)) {
    res.status(403).json({ error: "Only group admins/mods can see join requests" });
    return;
  }

  const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";
  const requests = await db
    .select()
    .from(groupJoinRequestsTable)
    .where(
      and(
        eq(groupJoinRequestsTable.groupId, groupId),
        eq(groupJoinRequestsTable.status, statusFilter),
      ),
    )
    .orderBy(desc(groupJoinRequestsTable.createdAt));

  const userIds = [...new Set(requests.map((r) => r.userId))];
  const users = userIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const result = await Promise.all(
    requests.map(async (r) => {
      const u = userMap.get(r.userId);
      const answers = await db
        .select()
        .from(groupQuestionAnswersTable)
        .where(eq(groupQuestionAnswersTable.joinRequestId, r.id));

      const questions = answers.length
        ? await db
            .select({ id: groupQuestionsTable.id, questionText: groupQuestionsTable.questionText })
            .from(groupQuestionsTable)
            .where(inArray(groupQuestionsTable.id, answers.map((a) => a.questionId)))
        : [];
      const qMap = new Map(questions.map((q) => [q.id, q.questionText]));

      return {
        id: r.id,
        groupId: r.groupId,
        userId: r.userId,
        userName: u?.name ?? "Unknown",
        userPhotoUrl: u?.profilePhotoUrl ?? null,
        status: r.status,
        declineReason: r.declineReason,
        answers: answers.map((a) => ({
          questionId: a.questionId,
          questionText: qMap.get(a.questionId) ?? "",
          answerText: a.answerText,
        })),
        createdAt: r.createdAt.toISOString(),
      };
    }),
  );

  res.json(result);
});

// PATCH /groups/:groupId/join-requests/:requestId — approve or decline
router.patch(
  "/groups/:groupId/join-requests/:requestId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const requestId = parseId(req.params.requestId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const actorRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canModerateContent(actorRole)) {
      res.status(403).json({ error: "Only group admins/mods can review join requests" });
      return;
    }

    const parsed = ReviewGroupJoinRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [jr] = await db
      .select()
      .from(groupJoinRequestsTable)
      .where(
        and(
          eq(groupJoinRequestsTable.id, requestId),
          eq(groupJoinRequestsTable.groupId, groupId),
        ),
      );

    if (!jr || jr.status !== "pending") {
      res.status(404).json({ error: "Join request not found or already reviewed" });
      return;
    }

    // Transactional: update request + insert member + increment counter
    const [updated] = await db.transaction(async (tx) => {
      const [upd] = await tx
        .update(groupJoinRequestsTable)
        .set({
          status: parsed.data.action === "approve" ? "approved" : "declined",
          reviewedByUserId: user.id,
          reviewedAt: new Date(),
          declineReason: parsed.data.reason ?? null,
        })
        .where(eq(groupJoinRequestsTable.id, requestId))
        .returning();

      if (parsed.data.action === "approve") {
        const [inserted] = await tx
          .insert(groupMembersTable)
          .values({
            groupId,
            userId: jr.userId,
            role: "member",
            joinedVia: "request",
            status: "active",
          })
          .onConflictDoNothing()
          .returning();

        if (inserted) {
          await tx
            .update(groupsTable)
            .set({ memberCount: sql`${groupsTable.memberCount} + 1` })
            .where(eq(groupsTable.id, groupId));
        }
      }

      return [upd];
    });

    if (parsed.data.action === "approve") {
      await logGroupActivity(groupId, user.id, "approve_member", {
        targetType: "member",
        targetId: jr.userId,
      });
      await db.insert(groupInsightEventsTable).values({
        groupId,
        eventType: "member_join",
        userId: jr.userId,
      });
    } else {
      await logGroupActivity(groupId, user.id, "decline_member", {
        targetType: "member",
        targetId: jr.userId,
      });
    }

    const [u] = await db
      .select({ name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
      .from(usersTable)
      .where(eq(usersTable.id, jr.userId));

    // Load persisted answers for response
    const answers = await db
      .select()
      .from(groupQuestionAnswersTable)
      .where(eq(groupQuestionAnswersTable.joinRequestId, requestId));
    const questions = answers.length
      ? await db
          .select({ id: groupQuestionsTable.id, questionText: groupQuestionsTable.questionText })
          .from(groupQuestionsTable)
          .where(inArray(groupQuestionsTable.id, answers.map((a) => a.questionId)))
      : [];
    const qMap = new Map(questions.map((q) => [q.id, q.questionText]));

    res.json({
      id: updated.id,
      groupId: updated.groupId,
      userId: updated.userId,
      userName: u?.name ?? "Unknown",
      userPhotoUrl: u?.profilePhotoUrl ?? null,
      status: updated.status,
      declineReason: updated.declineReason,
      answers: answers.map((a) => ({
        questionId: a.questionId,
        questionText: qMap.get(a.questionId) ?? "",
        answerText: a.answerText,
      })),
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Membership Questions
// Discovery policy: hidden private groups only show questions to:
//   - members, or
//   - users with a valid (non-expired) pending invite
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/questions
router.get("/groups/:groupId/questions", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  // Enforce access for hidden private groups
  if (group.privacy === "private" && group.visibility === "hidden") {
    if (!viewer) {
      res.status(403).json({
        error: "You must be invited to this group to view its membership questions",
      });
      return;
    }
    const memberRole = await getGroupMemberRole(groupId, viewer.id);
    if (!memberRole && viewer.role !== "admin") {
      // Allow users with a valid pending invite (to answer questions with their join request)
      const now = new Date();
      const [inv] = await db
        .select({ id: groupInvitesTable.id })
        .from(groupInvitesTable)
        .where(
          and(
            eq(groupInvitesTable.groupId, groupId),
            eq(groupInvitesTable.invitedUserId, viewer.id),
            eq(groupInvitesTable.status, "pending"),
            or(
              sql`${groupInvitesTable.expiresAt} IS NULL`,
              sql`${groupInvitesTable.expiresAt} >= ${now}`,
            )!,
          ),
        )
        .limit(1);

      if (!inv) {
        res.status(403).json({
          error: "You must be invited to this group to view its membership questions",
        });
        return;
      }
    }
  } else {
    // Public or private-visible: any authenticated user can see questions (they need them to submit a join request)
    // For public groups, questions are optional pre-join surveys — visible to all
  }

  const questions = await db
    .select()
    .from(groupQuestionsTable)
    .where(eq(groupQuestionsTable.groupId, groupId))
    .orderBy(asc(groupQuestionsTable.sortOrder));

  res.json(
    questions.map((q) => ({
      id: q.id,
      groupId: q.groupId,
      questionText: q.questionText,
      isRequired: q.isRequired,
      sortOrder: q.sortOrder,
    })),
  );
});

// PUT /groups/:groupId/questions
router.put("/groups/:groupId/questions", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorRole)) {
    res.status(403).json({ error: "Only group admins/owners can manage membership questions" });
    return;
  }

  const parsed = SetGroupQuestionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.delete(groupQuestionsTable).where(eq(groupQuestionsTable.groupId, groupId));

  const questions = parsed.data.questions;
  if (questions.length > 0) {
    await db.insert(groupQuestionsTable).values(
      questions.map((q, i) => ({
        groupId,
        questionText: q.questionText,
        isRequired: q.isRequired ?? false,
        sortOrder: q.sortOrder ?? i,
      })),
    );
  }

  const result = await db
    .select()
    .from(groupQuestionsTable)
    .where(eq(groupQuestionsTable.groupId, groupId))
    .orderBy(asc(groupQuestionsTable.sortOrder));

  res.json(
    result.map((q) => ({
      id: q.id,
      groupId: q.groupId,
      questionText: q.questionText,
      isRequired: q.isRequired,
      sortOrder: q.sortOrder,
    })),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Group Rules
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/rules
router.get("/groups/:groupId/rules", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see its rules" });
    return;
  }

  const rules = await db
    .select()
    .from(groupRulesTable)
    .where(eq(groupRulesTable.groupId, groupId))
    .orderBy(asc(groupRulesTable.sortOrder));

  res.json(
    rules.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      title: r.title,
      description: r.description,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// POST /groups/:groupId/rules
router.post("/groups/:groupId/rules", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorRole)) {
    res.status(403).json({ error: "Only group admins/owners can manage rules" });
    return;
  }

  const parsed = CreateGroupRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [rule] = await db
    .insert(groupRulesTable)
    .values({
      groupId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      sortOrder: parsed.data.sortOrder ?? 0,
    })
    .returning();

  await logGroupActivity(groupId, user.id, "add_rule", { targetType: "rule", targetId: rule.id });

  res.status(201).json({
    id: rule.id,
    groupId: rule.groupId,
    title: rule.title,
    description: rule.description,
    sortOrder: rule.sortOrder,
    createdAt: rule.createdAt.toISOString(),
  });
});

// PATCH /groups/:groupId/rules/:ruleId
router.patch("/groups/:groupId/rules/:ruleId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const ruleId = parseId(req.params.ruleId);

  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorRole)) {
    res.status(403).json({ error: "Only group admins/owners can manage rules" });
    return;
  }

  const parsed = UpdateGroupRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(groupRulesTable)
    .where(and(eq(groupRulesTable.id, ruleId), eq(groupRulesTable.groupId, groupId)));

  if (!existing) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  const [updated] = await db
    .update(groupRulesTable)
    .set({
      title: parsed.data.title ?? existing.title,
      description:
        parsed.data.description !== undefined
          ? (parsed.data.description ?? null)
          : existing.description,
      sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
    })
    .where(eq(groupRulesTable.id, ruleId))
    .returning();

  res.json({
    id: updated.id,
    groupId: updated.groupId,
    title: updated.title,
    description: updated.description,
    sortOrder: updated.sortOrder,
    createdAt: updated.createdAt.toISOString(),
  });
});

// DELETE /groups/:groupId/rules/:ruleId
router.delete("/groups/:groupId/rules/:ruleId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const ruleId = parseId(req.params.ruleId);

  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const actorRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(actorRole)) {
    res.status(403).json({ error: "Only group admins/owners can delete rules" });
    return;
  }

  await db.delete(groupRulesTable).where(
    and(eq(groupRulesTable.id, ruleId), eq(groupRulesTable.groupId, groupId)),
  );

  await logGroupActivity(groupId, user.id, "remove_rule", { targetType: "rule", targetId: ruleId });
  res.sendStatus(204);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group Posts
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/posts
router.get("/groups/:groupId/posts", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see its posts" });
    return;
  }

  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 30 : 30,
    100,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;

  const isManager = access.memberRole ? canModerateContent(access.memberRole) : access.isAdmin;

  const conditions: Parameters<typeof and> = [eq(groupPostsTable.groupId, groupId)];
  if (statusFilter && isManager) {
    conditions.push(eq(groupPostsTable.status, statusFilter));
  } else {
    conditions.push(eq(groupPostsTable.status, "active"));
  }

  const posts = await db
    .select()
    .from(groupPostsTable)
    .where(and(...conditions))
    .orderBy(desc(groupPostsTable.isPinned), desc(groupPostsTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Filter posts from blocked authors (for viewer)
  const authorIds = posts.map((p) => p.authorUserId);
  const blockedAuthors = viewer ? await getBlockedUserIds(viewer.id, authorIds) : new Set<number>();
  const visiblePosts = posts.filter((p) => !blockedAuthors.has(p.authorUserId));

  // Preload sharing settings for all visible posts (avoids N+1)
  const visiblePostIds = visiblePosts.map((p) => p.id);
  const sharingSettingsRows = visiblePostIds.length
    ? await db
        .select()
        .from(postSharingSettingsTable)
        .where(
          and(
            eq(postSharingSettingsTable.sourceType, "group_post"),
            inArray(postSharingSettingsTable.sourcePostId, visiblePostIds),
          ),
        )
    : [];
  const sharingSettingsByPostId = new Map(sharingSettingsRows.map((s) => [s.sourcePostId, s]));

  // Check viewer suspension once
  let viewerSuspended = false;
  if (viewer?.id) {
    const [suspRow] = await db
      .select()
      .from(sharingSuspensionsTable)
      .where(
        and(
          eq(sharingSuspensionsTable.userId, viewer.id),
          eq(sharingSuspensionsTable.status, "active"),
        ),
      )
      .limit(1);
    viewerSuspended = !!suspRow;
  }

  const viewerRole = viewer?.role ?? "member";

  const serialized = await Promise.all(
    visiblePosts.map((p) => {
      const s = sharingSettingsByPostId.get(p.id);
      return serializePost(p, viewer?.id ?? null, {
        groupIsPrivate: group.privacy === "private",
        viewerSuspended,
        viewerRole,
        sharingSettingsOverride: {
          sharingDisabled: s?.sharingDisabled ?? false,
          allowPublicShares: s?.allowPublicShares ?? true,
          allowFriendsShares: s?.allowFriendsShares ?? true,
          allowPrivateShares: s?.allowPrivateShares ?? true,
          allowGroupShares: s?.allowGroupShares ?? true,
        },
      });
    }),
  );
  res.json(serialized);
});

// POST /groups/:groupId/posts
router.post("/groups/:groupId/posts", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!groupAllowsWrites(group, user.role === "admin")) {
    res.status(403).json({ error: "This group is not accepting new posts at this time" });
    return;
  }

  const memberRole = await getGroupMemberRole(groupId, user.id);
  if (!memberRole && user.role !== "admin") {
    res.status(403).json({ error: "You must be a member to post in this group" });
    return;
  }

  if (
    group.postingPermission === "admins_only" &&
    !canManageGroup(memberRole) &&
    user.role !== "admin"
  ) {
    res.status(403).json({ error: "Only admins can post in this group" });
    return;
  }

  const parsed = CreateGroupPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  // Business attribution — verify user manages this Business Page
  if (data.businessId) {
    const [bizRole] = await db
      .select({ role: businessPageRolesTable.role })
      .from(businessPageRolesTable)
      .where(
        and(
          eq(businessPageRolesTable.businessId, data.businessId),
          eq(businessPageRolesTable.userId, user.id),
        ),
      );
    if (!bizRole && user.role !== "admin") {
      res.status(403).json({ error: "You do not manage this Business Page" });
      return;
    }
    // Validate Business Page exists
    const [biz] = await db
      .select({ id: businessesTable.id })
      .from(businessesTable)
      .where(eq(businessesTable.id, data.businessId));
    if (!biz) {
      res.status(404).json({ error: "Business Page not found" });
      return;
    }
  }

  let mediaUrl = data.mediaUrl ?? null;
  let posterUrl: string | null = null;
  try {
    if (mediaUrl) {
      if (!isAcceptableObjectReference(mediaUrl))
        throw new InvalidUploadError("Media must be an uploaded storage object");
      if ((data.mediaType ?? "image") === "video") {
        const transcoded = await finalizeMediaUrlWithVideoTranscode(mediaUrl, user.id, "video");
        mediaUrl = transcoded.url;
        posterUrl = transcoded.posterUrl;
      } else {
        mediaUrl = await finalizeUploadedImage(mediaUrl, user.id);
      }
    }
    // A caller-supplied poster must be finalized/authorized exactly like the
    // primary media object — never persist an arbitrary internal path. It takes
    // precedence over any transcode-derived poster.
    if (data.posterUrl !== undefined && data.posterUrl !== null && data.posterUrl !== "") {
      if (!isAcceptableObjectReference(data.posterUrl))
        throw new InvalidUploadError("Poster must be an uploaded storage object");
      posterUrl = await finalizeUploadedImage(data.posterUrl, user.id);
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  let status = "active";
  const isPlatformAdmin = user.role === "admin";
  const isGroupManager = canManageGroup(memberRole);
  if (group.postApproval && !isGroupManager && !isPlatformAdmin) {
    status = "pending_approval";
  }
  if (status === "active") {
    const alertAction = await checkKeywordAlerts(groupId, data.text);
    if (alertAction === "auto_hide") status = "hidden";
    else if (alertAction === "auto_remove") status = "removed";
  }

  const [post] = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(groupPostsTable)
      .values({
        groupId,
        authorUserId: user.id,
        businessId: data.businessId ?? null,
        text: data.text,
        mediaUrl,
        posterUrl: posterUrl ?? null,
        mediaType: data.mediaType ?? (mediaUrl ? "image" : "none"),
        postType: data.postType ?? "text",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pollData: (data.pollData ?? null) as any,
        status,
      })
      .returning();

    if (status === "active") {
      await tx
        .update(groupsTable)
        .set({ postCount: sql`${groupsTable.postCount} + 1` })
        .where(eq(groupsTable.id, groupId));
    }
    return [p];
  });

  res.status(201).json(
    await serializePost(post, user.id, { groupIsPrivate: group.privacy === "private" }),
  );
});

// GET /groups/:groupId/posts/:postId
router.get("/groups/:groupId/posts/:postId", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const postId = parseId(req.params.postId);

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see posts" });
    return;
  }

  const [post] = await db
    .select()
    .from(groupPostsTable)
    .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));

  if (!post || post.status === "removed") {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const isManager = access.memberRole ? canModerateContent(access.memberRole) : access.isAdmin;
  if (!isManager && post.status !== "active") {
    if (!(post.status === "pending_approval" && viewer && post.authorUserId === viewer.id)) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
  }

  // Block filtering on the DIRECT post detail read: a post authored by a user
  // who has a block relationship with the viewer must not be serialized, even
  // via a direct URL. (Managers/admins are exempt so moderation still works.)
  if (
    viewer &&
    post.authorUserId !== null &&
    post.authorUserId !== viewer.id &&
    shouldHideBlockedResource(
      viewer,
      post.authorUserId,
      isManager,
      await isBlocked(viewer.id, post.authorUserId),
    )
  ) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  res.json(
    await serializePost(post, viewer?.id ?? null, {
      groupIsPrivate: group.privacy === "private",
    }),
  );
});

// PATCH /groups/:groupId/posts/:postId
router.patch("/groups/:groupId/posts/:postId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const postId = parseId(req.params.postId);

  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const [post] = await db
    .select()
    .from(groupPostsTable)
    .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));

  if (!post || post.status === "removed") {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  const isAuthor = post.authorUserId === user.id;
  const isMod = canModerateContent(memberRole);

  if (!isAuthor && !isMod) {
    res.status(403).json({ error: "Not authorized to edit this post" });
    return;
  }

  const parsed = UpdateGroupPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof groupPostsTable.$inferInsert> = {};
  if (parsed.data.text !== undefined && isAuthor) updates.text = parsed.data.text;
  if (parsed.data.status !== undefined && isMod) {
    if (post.moderationLocked && parsed.data.status === "active") {
      res.status(403).json({
        error: "This post is locked by platform moderation and cannot be restored",
      });
      return;
    }
    updates.status = parsed.data.status;
  }
  if (parsed.data.isPinned !== undefined && isMod) updates.isPinned = parsed.data.isPinned;

  const [updated] = await db
    .update(groupPostsTable)
    .set(updates)
    .where(eq(groupPostsTable.id, postId))
    .returning();

  if (parsed.data.isPinned !== undefined) {
    const action = parsed.data.isPinned ? "pin_post" : "unpin_post";
    await logGroupActivity(groupId, user.id, action, { targetType: "post", targetId: postId });
  }

  res.json(
    await serializePost(updated, user.id, {
      groupIsPrivate: guard.group.privacy === "private",
    }),
  );
});

// DELETE /groups/:groupId/posts/:postId
router.delete("/groups/:groupId/posts/:postId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const postId = parseId(req.params.postId);

  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const [post] = await db
    .select()
    .from(groupPostsTable)
    .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));

  if (!post || post.status === "removed") {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  const isAuthor = post.authorUserId === user.id;
  const isMod = canModerateContent(memberRole);

  if (!isAuthor && !isMod) {
    res.status(403).json({ error: "Not authorized to delete this post" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(groupPostsTable)
      .set({ status: "removed" })
      .where(eq(groupPostsTable.id, postId));
    if (post.status === "active") {
      await tx
        .update(groupsTable)
        .set({ postCount: sql`greatest(${groupsTable.postCount} - 1, 0)` })
        .where(eq(groupsTable.id, groupId));
    }
  });

  await logGroupActivity(groupId, user.id, "remove_post", { targetType: "post", targetId: postId });
  res.sendStatus(204);
});

// POST /groups/:groupId/posts/:postId/react
router.post(
  "/groups/:groupId/posts/:postId/react",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
    if (!group || group.status === "deleted") {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (!groupAllowsWrites(group, user.role === "admin")) {
      res.status(403).json({ error: "This group is not accepting reactions at this time" });
      return;
    }

    const memberRole = await getGroupMemberRole(groupId, user.id);
    if (!memberRole && group.privacy === "private" && user.role !== "admin") {
      res.status(403).json({ error: "Join this group to react to posts" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(
        and(
          eq(groupPostsTable.id, postId),
          eq(groupPostsTable.groupId, groupId),
          eq(groupPostsTable.status, "active"),
        ),
      );
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    // Block check against post author (skip business-page posts where
    // authorUserId is null).
    if (post.authorUserId !== null && post.authorUserId !== user.id) {
      const blocked = await isBlocked(user.id, post.authorUserId);
      if (blocked) {
        res.status(403).json({ error: "Cannot react to this post" });
        return;
      }
    }

    const parsed = ReactToGroupPostBody.safeParse(req.body);
    const reactionType =
      parsed.success && parsed.data.reactionType ? parsed.data.reactionType : "like";

    const [existing] = await db
      .select()
      .from(groupPostReactionsTable)
      .where(
        and(
          eq(groupPostReactionsTable.postId, postId),
          eq(groupPostReactionsTable.userId, user.id),
        ),
      );

    let active: boolean;
    let finalReactionType: string | null;

    if (existing) {
      if (existing.reactionType === reactionType) {
        // Toggle off — transactional delete + decrement
        const { active: a, finalType } = await db.transaction(async (tx) => {
          const deleted = await tx
            .delete(groupPostReactionsTable)
            .where(eq(groupPostReactionsTable.id, existing.id))
            .returning();
          if (deleted.length) {
            await tx
              .update(groupPostsTable)
              .set({ likeCount: sql`greatest(${groupPostsTable.likeCount} - 1, 0)` })
              .where(eq(groupPostsTable.id, postId));
          }
          return { active: false, finalType: null };
        });
        active = a;
        finalReactionType = finalType;
      } else {
        await db
          .update(groupPostReactionsTable)
          .set({ reactionType })
          .where(eq(groupPostReactionsTable.id, existing.id));
        active = true;
        finalReactionType = reactionType;
      }
    } else {
      // New reaction — transactional insert + increment
      const { didInsert } = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(groupPostReactionsTable)
          .values({ postId, groupId, userId: user.id, reactionType })
          .onConflictDoNothing()
          .returning();
        if (inserted.length) {
          await tx
            .update(groupPostsTable)
            .set({ likeCount: sql`${groupPostsTable.likeCount} + 1` })
            .where(eq(groupPostsTable.id, postId));
        }
        return { didInsert: inserted.length > 0 };
      });
      active = didInsert;
      finalReactionType = didInsert ? reactionType : null;
    }

    const [updated] = await db
      .select()
      .from(groupPostsTable)
      .where(eq(groupPostsTable.id, postId));
    res.json({ active, reactionType: finalReactionType, likeCount: updated.likeCount });
  },
);

// POST /groups/:groupId/posts/:postId/save
router.post(
  "/groups/:groupId/posts/:postId/save",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
    if (!group || group.status === "deleted") {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (!groupAllowsWrites(group, user.role === "admin")) {
      res.status(403).json({ error: "This group is not accepting saves at this time" });
      return;
    }

    const memberRole = await getGroupMemberRole(groupId, user.id);
    if (!memberRole && group.privacy === "private" && user.role !== "admin") {
      res.status(403).json({ error: "Join this group to save posts" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(
        and(
          eq(groupPostsTable.id, postId),
          eq(groupPostsTable.groupId, groupId),
          eq(groupPostsTable.status, "active"),
        ),
      );
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(groupPostSavesTable)
      .where(and(eq(groupPostSavesTable.postId, postId), eq(groupPostSavesTable.userId, user.id)));

    let saved: boolean;
    if (existing) {
      const { didDelete } = await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(groupPostSavesTable)
          .where(eq(groupPostSavesTable.id, existing.id))
          .returning();
        if (deleted.length) {
          await tx
            .update(groupPostsTable)
            .set({ saveCount: sql`greatest(${groupPostsTable.saveCount} - 1, 0)` })
            .where(eq(groupPostsTable.id, postId));
        }
        return { didDelete: deleted.length > 0 };
      });
      saved = !didDelete;
    } else {
      const { didInsert } = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(groupPostSavesTable)
          .values({ postId, groupId, userId: user.id })
          .onConflictDoNothing()
          .returning();
        if (inserted.length) {
          await tx
            .update(groupPostsTable)
            .set({ saveCount: sql`${groupPostsTable.saveCount} + 1` })
            .where(eq(groupPostsTable.id, postId));
        }
        return { didInsert: inserted.length > 0 };
      });
      saved = didInsert;
    }

    const [updated] = await db
      .select()
      .from(groupPostsTable)
      .where(eq(groupPostsTable.id, postId));
    res.json({ saved, saveCount: updated.saveCount });
  },
);

// POST /groups/:groupId/posts/:postId/approve
router.post(
  "/groups/:groupId/posts/:postId/approve",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canModerateContent(memberRole)) {
      res.status(403).json({ error: "Only admins/mods can approve posts" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(
        and(
          eq(groupPostsTable.id, postId),
          eq(groupPostsTable.groupId, groupId),
          eq(groupPostsTable.status, "pending_approval"),
        ),
      );
    if (!post) {
      res.status(404).json({ error: "Pending post not found" });
      return;
    }

    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(groupPostsTable)
        .set({ status: "active" })
        .where(eq(groupPostsTable.id, postId))
        .returning();
      await tx
        .update(groupsTable)
        .set({ postCount: sql`${groupsTable.postCount} + 1` })
        .where(eq(groupsTable.id, groupId));
      return [u];
    });

    await logGroupActivity(groupId, user.id, "approve_post", {
      targetType: "post",
      targetId: postId,
    });
    res.json(
      await serializePost(updated, user.id, {
        groupIsPrivate: guard.group.privacy === "private",
      }),
    );
  },
);

// POST /groups/:groupId/posts/:postId/reject
router.post(
  "/groups/:groupId/posts/:postId/reject",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canModerateContent(memberRole)) {
      res.status(403).json({ error: "Only admins/mods can reject posts" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(
        and(
          eq(groupPostsTable.id, postId),
          eq(groupPostsTable.groupId, groupId),
          eq(groupPostsTable.status, "pending_approval"),
        ),
      );
    if (!post) {
      res.status(404).json({ error: "Pending post not found" });
      return;
    }

    const [updated] = await db
      .update(groupPostsTable)
      .set({ status: "removed" })
      .where(eq(groupPostsTable.id, postId))
      .returning();

    await logGroupActivity(groupId, user.id, "reject_post", {
      targetType: "post",
      targetId: postId,
    });
    res.json(
      await serializePost(updated, user.id, {
        groupIsPrivate: guard.group.privacy === "private",
      }),
    );
  },
);

// POST /groups/:groupId/posts/:postId/pin
router.post(
  "/groups/:groupId/posts/:postId/pin",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canManageGroup(memberRole)) {
      res.status(403).json({ error: "Only admins/owners can pin posts" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));

    if (!post || post.status !== "active") {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const newPinned = !post.isPinned;
    const [updated] = await db
      .update(groupPostsTable)
      .set({ isPinned: newPinned })
      .where(eq(groupPostsTable.id, postId))
      .returning();

    await logGroupActivity(groupId, user.id, newPinned ? "pin_post" : "unpin_post", {
      targetType: "post",
      targetId: postId,
    });
    res.json(
      await serializePost(updated, user.id, {
        groupIsPrivate: guard.group.privacy === "private",
      }),
    );
  },
);

// POST /groups/:groupId/posts/:postId/report
router.post(
  "/groups/:groupId/posts/:postId/report",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }
    const group = guard.group;

    const memberRole = await getGroupMemberRole(groupId, user.id);
    if (group.privacy === "private" && !memberRole && user.role !== "admin") {
      res.status(403).json({ error: "Join this group to report posts" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));
    if (!post || post.status === "removed") {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const parsed = ReportGroupPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    await db.insert(groupReportsTable).values({
      groupId,
      reporterUserId: user.id,
      targetType: "post",
      targetId: postId,
      reason: parsed.data.reason,
      details: parsed.data.details ?? null,
      status: "pending",
    });
    await db
      .update(groupPostsTable)
      .set({ reportCount: sql`${groupPostsTable.reportCount} + 1` })
      .where(eq(groupPostsTable.id, postId));

    res.status(201).json({ message: "Report submitted" });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Post Comments
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/posts/:postId/comments
router.get(
  "/groups/:groupId/posts/:postId/comments",
  async (req, res): Promise<void> => {
    const viewer = await getSessionUser(req);
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
    if (!group || group.status === "deleted") {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    const access = await resolveGroupAccess(group, viewer);
    if (!access.allowed) {
      res.status(403).json({ error: "Join this group to see comments" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));
    if (!post || post.status !== "active") {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const comments = await db
      .select()
      .from(groupPostCommentsTable)
      .where(
        and(
          eq(groupPostCommentsTable.postId, postId),
          eq(groupPostCommentsTable.groupId, groupId),
          eq(groupPostCommentsTable.status, "active"),
        ),
      )
      .orderBy(asc(groupPostCommentsTable.createdAt));

    const userIds = [...new Set(comments.map((c) => c.userId))];
    // Block filtering
    const blockedIds = viewer ? await getBlockedUserIds(viewer.id, userIds) : new Set<number>();
    const visible = comments.filter((c) => !blockedIds.has(c.userId));
    const visibleUserIds = [...new Set(visible.map((c) => c.userId))];

    const users = visibleUserIds.length
      ? await db
          .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl, buddyType: usersTable.buddyType })
          .from(usersTable)
          .where(inArray(usersTable.id, visibleUserIds))
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    res.json(
      visible.map((c) => {
        const u = userMap.get(c.userId);
        return {
          id: c.id,
          postId: c.postId,
          groupId: c.groupId,
          userId: c.userId,
          userName: u?.name ?? "Unknown",
          userPhotoUrl: u?.profilePhotoUrl ?? null,
          buddyType: u?.buddyType ?? null,
          parentCommentId: c.parentCommentId,
          commentText: c.commentText,
          status: c.status,
          likeCount: c.likeCount,
          createdAt: c.createdAt.toISOString(),
        };
      }),
    );
  },
);

// POST /groups/:groupId/posts/:postId/comments
router.post(
  "/groups/:groupId/posts/:postId/comments",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
    if (!group || group.status === "deleted") {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (!groupAllowsWrites(group, user.role === "admin")) {
      res.status(403).json({ error: "This group is not accepting comments at this time" });
      return;
    }

    const memberRole = await getGroupMemberRole(groupId, user.id);
    if (!memberRole && user.role !== "admin") {
      res.status(403).json({ error: "You must be a member to comment" });
      return;
    }

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(
        and(
          eq(groupPostsTable.id, postId),
          eq(groupPostsTable.groupId, groupId),
          eq(groupPostsTable.status, "active"),
        ),
      );
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    // Block check against the post author (skip business-page posts where
    // authorUserId is null).
    if (post.authorUserId !== null && post.authorUserId !== user.id) {
      const blocked = await isBlocked(user.id, post.authorUserId);
      if (blocked) {
        res.status(403).json({ error: "Cannot comment on this post" });
        return;
      }
    }

    const parsed = CreateGroupPostCommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // When replying to a parent comment, enforce the block check against the
    // PARENT-COMMENT AUTHOR too — not only the post author. A blocked user must
    // not be able to reply directly to a comment by (or from) someone they have
    // a block relationship with. Also validate the parent belongs to this post.
    let parentCommentId: number | null = null;
    if (parsed.data.parentCommentId !== undefined && parsed.data.parentCommentId !== null) {
      const [parent] = await db
        .select({
          id: groupPostCommentsTable.id,
          userId: groupPostCommentsTable.userId,
          status: groupPostCommentsTable.status,
        })
        .from(groupPostCommentsTable)
        .where(
          and(
            eq(groupPostCommentsTable.id, parsed.data.parentCommentId),
            eq(groupPostCommentsTable.postId, postId),
            eq(groupPostCommentsTable.groupId, groupId),
          ),
        );
      if (!parent || parent.status !== "active") {
        res.status(404).json({ error: "Parent comment not found" });
        return;
      }
      if (parent.userId !== user.id && (await isBlocked(user.id, parent.userId))) {
        res.status(403).json({ error: "Cannot reply to this comment" });
        return;
      }
      parentCommentId = parent.id;
    }

    const [comment] = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(groupPostCommentsTable)
        .values({
          postId,
          groupId,
          userId: user.id,
          parentCommentId,
          commentText: parsed.data.commentText,
          status: "active",
        })
        .returning();
      await tx
        .update(groupPostsTable)
        .set({ commentCount: sql`${groupPostsTable.commentCount} + 1` })
        .where(eq(groupPostsTable.id, postId));
      return [c];
    });

    res.status(201).json({
      id: comment.id,
      postId: comment.postId,
      groupId: comment.groupId,
      userId: comment.userId,
      userName: user.name,
      userPhotoUrl: user.profilePhotoUrl ?? null,
      buddyType: user.buddyType ?? null,
      parentCommentId: comment.parentCommentId,
      commentText: comment.commentText,
      status: comment.status,
      likeCount: comment.likeCount,
      createdAt: comment.createdAt.toISOString(),
    });
  },
);

// DELETE /groups/:groupId/posts/:postId/comments/:commentId
router.delete(
  "/groups/:groupId/posts/:postId/comments/:commentId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);
    const commentId = parseId(req.params.commentId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const [comment] = await db
      .select()
      .from(groupPostCommentsTable)
      .where(
        and(
          eq(groupPostCommentsTable.id, commentId),
          eq(groupPostCommentsTable.postId, postId),
          eq(groupPostCommentsTable.groupId, groupId),
        ),
      );

    if (!comment || comment.status === "removed") {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    const isAuthor = comment.userId === user.id;
    const isMod = canModerateContent(memberRole);

    if (!isAuthor && !isMod) {
      res.status(403).json({ error: "Not authorized to delete this comment" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(groupPostCommentsTable)
        .set({ status: "removed" })
        .where(eq(groupPostCommentsTable.id, commentId));
      await tx
        .update(groupPostsTable)
        .set({ commentCount: sql`greatest(${groupPostsTable.commentCount} - 1, 0)` })
        .where(eq(groupPostsTable.id, postId));
    });

    if (isMod && !isAuthor) {
      await logGroupActivity(groupId, user.id, "remove_comment", {
        targetType: "comment",
        targetId: commentId,
      });
    }
    res.sendStatus(204);
  },
);

// PATCH /groups/:groupId/posts/:postId/comments/:commentId/moderate
// Hide or restore a comment without deleting it (mod/admin only)
router.patch(
  "/groups/:groupId/posts/:postId/comments/:commentId/moderate",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);
    const commentId = parseId(req.params.commentId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canModerateContent(memberRole)) {
      res.status(403).json({ error: "Only admins/mods can moderate comments" });
      return;
    }

    const parsed = ModerateGroupPostCommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [comment] = await db
      .select()
      .from(groupPostCommentsTable)
      .where(
        and(
          eq(groupPostCommentsTable.id, commentId),
          eq(groupPostCommentsTable.postId, postId),
          eq(groupPostCommentsTable.groupId, groupId),
        ),
      );

    if (!comment || comment.status === "removed") {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const newStatus = parsed.data.action === "hide" ? "hidden" : "active";
    const [updated] = await db
      .update(groupPostCommentsTable)
      .set({ status: newStatus })
      .where(eq(groupPostCommentsTable.id, commentId))
      .returning();

    await logGroupActivity(groupId, user.id, `${parsed.data.action}_comment`, {
      targetType: "comment",
      targetId: commentId,
      note: parsed.data.reason ?? undefined,
    });

    const [u] = await db
      .select({ name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl, buddyType: usersTable.buddyType })
      .from(usersTable)
      .where(eq(usersTable.id, updated.userId));

    res.json({
      id: updated.id,
      postId: updated.postId,
      groupId: updated.groupId,
      userId: updated.userId,
      userName: u?.name ?? "Unknown",
      userPhotoUrl: u?.profilePhotoUrl ?? null,
      buddyType: u?.buddyType ?? null,
      parentCommentId: updated.parentCommentId,
      commentText: updated.commentText,
      status: updated.status,
      likeCount: updated.likeCount,
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

// GET /groups/:groupId/saved-posts
router.get("/groups/:groupId/saved-posts", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const memberRole = await getGroupMemberRole(groupId, user.id);
  if (!memberRole && user.role !== "admin") {
    res.status(403).json({ error: "Join this group to see saved posts" });
    return;
  }

  const saves = await db
    .select({ postId: groupPostSavesTable.postId })
    .from(groupPostSavesTable)
    .where(and(eq(groupPostSavesTable.groupId, groupId), eq(groupPostSavesTable.userId, user.id)))
    .orderBy(desc(groupPostSavesTable.createdAt));

  const postIds = saves.map((s) => s.postId);
  if (!postIds.length) {
    res.json([]);
    return;
  }

  const posts = await db
    .select()
    .from(groupPostsTable)
    .where(and(inArray(groupPostsTable.id, postIds), eq(groupPostsTable.status, "active")));

  const serialized = await Promise.all(
    posts.map((p) => serializePost(p, user.id, { groupIsPrivate: group.privacy === "private" })),
  );
  res.json(serialized);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group Media
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/media
router.get("/groups/:groupId/media", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see media" });
    return;
  }

  const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 30 : 30,
    100,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const conditions: Parameters<typeof and> = [
    eq(groupMediaTable.groupId, groupId),
    eq(groupMediaTable.status, "active"),
  ];
  if (kind) conditions.push(eq(groupMediaTable.kind, kind));

  const media = await db
    .select()
    .from(groupMediaTable)
    .where(and(...conditions))
    .orderBy(desc(groupMediaTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Collect uploader and business info
  const uploaderIds = [...new Set(media.filter((m) => !m.businessId).map((m) => m.uploadedByUserId))];
  const businessIds = [...new Set(media.filter((m) => m.businessId).map((m) => m.businessId!))];

  const uploaders = uploaderIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, uploaderIds))
    : [];
  const uploaderMap = new Map(uploaders.map((u) => [u.id, u]));

  const businesses = businessIds.length
    ? await db
        .select({ id: businessesTable.id, name: businessesTable.name })
        .from(businessesTable)
        .where(inArray(businessesTable.id, businessIds))
    : [];
  const bizMap = new Map(businesses.map((b) => [b.id, b.name]));

  // Block filtering — filter out media from blocked uploaders
  const uploaderUserIds = media.map((m) => m.uploadedByUserId);
  const blockedIds = viewer ? await getBlockedUserIds(viewer.id, uploaderUserIds) : new Set<number>();

  const visibleMedia = media.filter((m) => !blockedIds.has(m.uploadedByUserId));

  const serialized = await Promise.all(
    visibleMedia.map((m) => {
      const uploader = uploaderMap.get(m.uploadedByUserId);
      return serializeMediaItem(
        m,
        uploader?.name ?? null,
        uploader?.profilePhotoUrl ?? null,
        bizMap.get(m.businessId ?? -1) ?? null,
        { groupIsPrivate: group.privacy === "private" },
      );
    }),
  );

  res.json(serialized);
});

// ─────────────────────────────────────────────────────────────────────────────
// Protected Group asset serving
//
// GET /group-assets/:groupId/objects/*path
//
// Serves Group-owned storage objects (post media/poster, group media/poster,
// file attachments incl. PDFs) with the SAME access policy as the rest of the
// Group API:
//   - public groups   → anyone (matches universal public serving),
//   - private groups   → members only (owner/admin/mod/member), platform admins.
//
// It ALSO verifies the requested object is actually referenced by THIS group
// before streaming — so a member of one group cannot use their access to fetch
// an object that only belongs to a different (private) group.
//
// PDF attachment + `nosniff` + range/video behavior are preserved via the shared
// `streamValidatedObject` helper (identical to the universal storage route).
// ─────────────────────────────────────────────────────────────────────────────
const groupAssetObjectStorage = new ObjectStorageService();

router.get(
  "/group-assets/:groupId/objects/*path",
  async (req, res): Promise<void> => {
    const viewer = await getSessionUser(req);
    const groupId = parseId(req.params.groupId);

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
    if (!group || group.status === "deleted") {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    // Same access gate as the rest of the Group API (public → all,
    // private → members-only; suspended/hidden/deleted forbidden).
    const access = await resolveGroupAccess(group, viewer);
    if (!access.allowed) {
      res.status(403).json({ error: "You do not have access to this group's media" });
      return;
    }

    const raw = req.params.path as unknown as string | string[];
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = normalizeStoredObjectPath(`/objects/${wildcardPath}`);
    if (!objectPath) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    // Reference check: the object must belong to THIS group.
    const referenced = await isObjectReferencedByGroup(groupId, objectPath);
    if (!referenced) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    try {
      const objectFile = await groupAssetObjectStorage.getObjectEntityFile(objectPath);
      await streamValidatedObject(objectFile, req, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      logger.error({ err: error }, "Error serving group asset");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

// POST /groups/:groupId/media
router.post("/groups/:groupId/media", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!groupAllowsWrites(group, user.role === "admin")) {
    res.status(403).json({ error: "This group is not accepting media uploads at this time" });
    return;
  }

  const memberRole = await getGroupMemberRole(groupId, user.id);
  if (!memberRole && user.role !== "admin") {
    res.status(403).json({ error: "You must be a member to upload media" });
    return;
  }

  const parsed = UploadGroupMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  // Business attribution — verify user manages this Business Page
  if (data.businessId) {
    const [bizRole] = await db
      .select({ role: businessPageRolesTable.role })
      .from(businessPageRolesTable)
      .where(
        and(
          eq(businessPageRolesTable.businessId, data.businessId),
          eq(businessPageRolesTable.userId, user.id),
        ),
      );
    if (!bizRole && user.role !== "admin") {
      res.status(403).json({ error: "You do not manage this Business Page" });
      return;
    }
    const [biz] = await db
      .select({ id: businessesTable.id, name: businessesTable.name })
      .from(businessesTable)
      .where(eq(businessesTable.id, data.businessId));
    if (!biz) {
      res.status(404).json({ error: "Business Page not found" });
      return;
    }
  }

  if (!isAcceptableObjectReference(data.mediaUrl)) {
    res.status(400).json({
      error: "Media must be an uploaded storage object; external URLs are not allowed",
    });
    return;
  }

  let finalMediaUrl = data.mediaUrl;
  let finalPosterUrl: string | null = null;

  try {
    if (data.kind === "photo") {
      finalMediaUrl = await finalizeUploadedImage(data.mediaUrl, user.id);
    } else if (data.kind === "video" || data.kind === "reel") {
      const result = await finalizeMediaUrlWithVideoTranscode(data.mediaUrl, user.id, "video");
      finalMediaUrl = result.url;
      finalPosterUrl = result.posterUrl;
    } else if (data.kind === "file") {
      // Generic file attachment: prove the uploader owns the pending object,
      // validate its namespace, MIME (sniffed), and size before persistence.
      // Never persist an arbitrary /objects path or one owned by another user.
      const result = await finalizeUploadedGroupFile(data.mediaUrl, user.id);
      finalMediaUrl = result.url;
    } else {
      // Unknown media kind — refuse rather than persisting an unvalidated path.
      throw new InvalidUploadError("Unsupported media kind.");
    }

    // Poster URL supplied by the caller must be finalized/authorized with the
    // exact same strictness as the primary media object. We never persist an
    // arbitrary (even syntactically valid) internal path: it must point to a
    // storage object that finalizes as an image owned by this uploader.
    // A caller-supplied poster takes precedence over any transcode-derived one.
    if (data.posterUrl !== undefined && data.posterUrl !== null && data.posterUrl !== "") {
      if (!isAcceptableObjectReference(data.posterUrl)) {
        res.status(400).json({
          error: "Poster must be an uploaded storage object; external URLs are not allowed",
        });
        return;
      }
      finalPosterUrl = await finalizeUploadedImage(data.posterUrl, user.id);
    }
  } catch (err) {
    if (err instanceof InvalidUploadError) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  const [mediaItem] = await db
    .insert(groupMediaTable)
    .values({
      groupId,
      uploadedByUserId: user.id,
      businessId: data.businessId ?? null,
      kind: data.kind,
      caption: data.caption ?? null,
      mediaUrl: finalMediaUrl,
      posterUrl: finalPosterUrl,
      fileName: data.fileName ?? null,
      mimeType: data.mimeType ?? null,
      fileSizeBytes: data.fileSizeBytes ?? null,
      status: "active",
    })
    .returning();

  // Lookup business name for response
  let bizName: string | null = null;
  if (mediaItem.businessId) {
    const [biz] = await db
      .select({ name: businessesTable.name })
      .from(businessesTable)
      .where(eq(businessesTable.id, mediaItem.businessId));
    bizName = biz?.name ?? null;
  }

  res.status(201).json(
    await serializeMediaItem(mediaItem, user.name, user.profilePhotoUrl ?? null, bizName, {
      groupIsPrivate: group.privacy === "private",
    }),
  );
});

// DELETE /groups/:groupId/media/:mediaId
router.delete(
  "/groups/:groupId/media/:mediaId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const mediaId = parseId(req.params.mediaId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const [item] = await db
      .select()
      .from(groupMediaTable)
      .where(and(eq(groupMediaTable.id, mediaId), eq(groupMediaTable.groupId, groupId)));

    if (!item || item.status === "removed") {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    const isUploader = item.uploadedByUserId === user.id;
    const isMod = canModerateContent(memberRole);

    if (!isUploader && !isMod) {
      res.status(403).json({ error: "Not authorized to delete this media" });
      return;
    }

    await db
      .update(groupMediaTable)
      .set({ status: "removed" })
      .where(eq(groupMediaTable.id, mediaId));

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Group Events
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/events
router.get("/groups/:groupId/events", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see events" });
    return;
  }

  const scope = typeof req.query.scope === "string" ? req.query.scope : "upcoming";
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 20 : 20,
    100,
  );

  const now = new Date();
  const conditions: Parameters<typeof and> = [
    eq(groupEventsTable.groupId, groupId),
    eq(groupEventsTable.status, "active"),
  ];
  if (scope === "past") {
    conditions.push(sql`${groupEventsTable.startsAt} < ${now}`);
  } else {
    conditions.push(sql`${groupEventsTable.startsAt} >= ${now}`);
  }

  const events = await db
    .select()
    .from(groupEventsTable)
    .where(and(...conditions))
    .orderBy(scope === "past" ? desc(groupEventsTable.startsAt) : asc(groupEventsTable.startsAt))
    .limit(limit);
  const businessById = await loadBusinessAttributions(events.map((event) => event.businessId));

  const viewerId = viewer?.id ?? null;

  // Event-level private visibility: omit private events for anyone who is not an
  // active member / platform admin / the event creator, even when the parent
  // group is public. Public events keep their group-level visibility behavior.
  const visibleEvents = events.filter((e) =>
    canViewGroupEventPure(e, {
      memberRole: access.memberRole,
      isAdmin: access.isAdmin,
      viewerId,
    }),
  );

  const result = await Promise.all(
    visibleEvents.map(async (e) => {
      let viewerRsvp: typeof groupEventRsvpsTable.$inferSelect | null = null;
      let viewerSaved = false;
      if (viewerId) {
        const [rsvpRow] = await db
          .select()
          .from(groupEventRsvpsTable)
          .where(
            and(eq(groupEventRsvpsTable.eventId, e.id), eq(groupEventRsvpsTable.userId, viewerId)),
          );
        viewerRsvp = rsvpRow ?? null;
        const [saveRow] = await db
          .select({ id: groupEventSavesTable.id })
          .from(groupEventSavesTable)
          .where(
            and(eq(groupEventSavesTable.eventId, e.id), eq(groupEventSavesTable.userId, viewerId)),
          );
        viewerSaved = !!saveRow;
      }
      return serializeGroupEvent(e, {
        viewerRsvpStatus: viewerRsvp?.rsvpStatus ?? null,
        viewerRsvp,
        viewerSaved,
        groupIsPrivate: group.privacy === "private",
        business: e.businessId ? businessById.get(e.businessId) ?? null : null,
      });
    }),
  );
  res.json(result);
});

// POST /groups/:groupId/events
router.post("/groups/:groupId/events", requireAuth(), requireCompleteBuddyProfile, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!groupAllowsWrites(group, user.role === "admin")) {
    res.status(403).json({ error: "This group is not accepting new events at this time" });
    return;
  }

  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canModerateContent(memberRole)) {
    res.status(403).json({ error: "Only admins/mods/owners can create group events" });
    return;
  }

  const parsed = CreateGroupEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const eventBusiness = data.businessId
    ? await getAuthorizedEventBusiness(data.businessId, user.id)
    : null;
  if (data.businessId && !eventBusiness) {
    res.status(403).json({ error: "You cannot host events as this Business Page" });
    return;
  }
  const startsAt = new Date(data.startsAt);
  const endsAt = data.endsAt ? new Date(data.endsAt) : null;
  if (
    Number.isNaN(startsAt.getTime()) ||
    (endsAt && Number.isNaN(endsAt.getTime()))
  ) {
    res.status(400).json({ error: "Event dates must be valid dates" });
    return;
  }
  if (endsAt && endsAt <= startsAt) {
    res.status(400).json({ error: "endsAt must be after startsAt" });
    return;
  }

  let onlineUrl: string | null = null;
  if (data.onlineUrl?.trim()) {
    try {
      const parsedOnlineUrl = new URL(data.onlineUrl.trim());
      if (!["http:", "https:"].includes(parsedOnlineUrl.protocol)) {
        throw new Error("unsupported protocol");
      }
      onlineUrl = parsedOnlineUrl.toString();
    } catch {
      res.status(400).json({ error: "onlineUrl must be a valid http or https URL" });
      return;
    }
  }
  if ((data.eventFormat === "online" || data.eventFormat === "hybrid") && !onlineUrl) {
    res.status(400).json({ error: "onlineUrl is required for online or hybrid events" });
    return;
  }

  const rsvpOpensAt = data.rsvpOpensAt ? new Date(data.rsvpOpensAt) : null;
  const rsvpClosesAt = data.rsvpClosesAt ? new Date(data.rsvpClosesAt) : null;
  if (
    (rsvpOpensAt && Number.isNaN(rsvpOpensAt.getTime())) ||
    (rsvpClosesAt && Number.isNaN(rsvpClosesAt.getTime()))
  ) {
    res.status(400).json({ error: "RSVP dates must be valid dates" });
    return;
  }
  if (rsvpOpensAt && rsvpClosesAt && rsvpClosesAt <= rsvpOpensAt) {
    res.status(400).json({ error: "rsvpClosesAt must be after rsvpOpensAt" });
    return;
  }
  if ((rsvpOpensAt && rsvpOpensAt >= startsAt) || (rsvpClosesAt && rsvpClosesAt >= startsAt)) {
    res.status(400).json({ error: "RSVP dates must be before the event starts" });
    return;
  }

  let imageUrl: string | null = null;
  if (data.imageUrl) {
    try {
      imageUrl = await finalizeGroupImageUrl(data.imageUrl, user.id);
    } catch (err) {
      if (err instanceof InvalidUploadError) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      throw err;
    }
  }

  const [event] = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(groupEventsTable)
      .values({
        groupId,
        createdByUserId: user.id,
        businessId: eventBusiness?.id ?? null,
        title: data.title,
        description: data.description ?? null,
        location: data.location ?? null,
        onlineUrl,
        imageUrl,
        startsAt,
        endsAt,
        status: "active",
        visibility: data.visibility ?? "public",
        hideAttendees: data.hideAttendees ?? false,
        // Meetup-enriched fields
        eventFormat: data.eventFormat ?? null,
        venueName: data.venueName ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        eventCategory: data.eventCategory ?? null,
        topics: data.topics ?? null,
        eventTags: data.eventTags ?? null,
        howToFind: data.howToFind ?? null,
        onlineUrlProtected: data.onlineUrlProtected ?? false,
        attendeeLimit: data.attendeeLimit ?? null,
        waitlistEnabled: data.waitlistEnabled ?? false,
        allowGuests: data.allowGuests ?? false,
        maxGuestsPerRsvp: data.maxGuestsPerRsvp ?? null,
        rsvpOpensAt,
        rsvpClosesAt,
        isPaid: data.isPaid ?? false,
        paidMetadata: (data.paidMetadata as Record<string, unknown>) ?? null,
        recurrenceRule: data.recurrenceRule ?? null,
      })
      .returning();
    await tx
      .update(groupsTable)
      .set({ eventCount: sql`${groupsTable.eventCount} + 1` })
      .where(eq(groupsTable.id, groupId));
    return [e];
  });

  await logGroupActivity(groupId, user.id, "create_event", {
    targetType: "event",
    targetId: event.id,
  });

  // Notify group members of new event
  await notifyGroupMembersForEvent(groupId, event.id, "new_event", event.title, user.id);

  res.status(201).json(
    serializeGroupEvent(event, {
      viewerRsvpStatus: null,
      groupIsPrivate: group.privacy === "private",
      business: eventBusiness,
    }),
  );
});

// GET /groups/:groupId/events/:eventId
router.get("/groups/:groupId/events/:eventId", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const eventId = parseId(req.params.eventId);

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see events" });
    return;
  }

  const [event] = await db
    .select()
    .from(groupEventsTable)
    .where(and(eq(groupEventsTable.id, eventId), eq(groupEventsTable.groupId, groupId)));

  if (
    !event ||
    event.status === "removed" ||
    (event.status === "draft" && !access.isAdmin && event.createdByUserId !== viewer?.id)
  ) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  // Event-level private visibility: a private event must 404 for anyone who is
  // not an active member / platform admin / the event creator, even in a public
  // group. This mirrors "not found" so we never disclose the event's existence.
  if (
    !canViewGroupEventPure(event, {
      memberRole: access.memberRole,
      isAdmin: access.isAdmin,
      viewerId: viewer?.id ?? null,
    })
  ) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  let viewerRsvp: typeof groupEventRsvpsTable.$inferSelect | null = null;
  let viewerSaved = false;
  if (viewer) {
    const [rsvpRow] = await db
      .select()
      .from(groupEventRsvpsTable)
      .where(
        and(eq(groupEventRsvpsTable.eventId, eventId), eq(groupEventRsvpsTable.userId, viewer.id)),
      );
    viewerRsvp = rsvpRow ?? null;
    const [saveRow] = await db
      .select({ id: groupEventSavesTable.id })
      .from(groupEventSavesTable)
      .where(
        and(eq(groupEventSavesTable.eventId, eventId), eq(groupEventSavesTable.userId, viewer.id)),
      );
    viewerSaved = !!saveRow;
  }
  const businessById = await loadBusinessAttributions([event.businessId]);

  res.json(
    serializeGroupEvent(event, {
      viewerRsvpStatus: viewerRsvp?.rsvpStatus ?? null,
      viewerRsvp,
      viewerSaved,
      groupIsPrivate: group.privacy === "private",
      business: event.businessId ? businessById.get(event.businessId) ?? null : null,
    }),
  );
});

// PATCH /groups/:groupId/events/:eventId
router.patch("/groups/:groupId/events/:eventId", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const eventId = parseId(req.params.eventId);

  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }

  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canModerateContent(memberRole)) {
    res.status(403).json({ error: "Only admins/mods/owners can update events" });
    return;
  }

  const [event] = await db
    .select()
    .from(groupEventsTable)
    .where(and(eq(groupEventsTable.id, eventId), eq(groupEventsTable.groupId, groupId)));
  if (!event || event.status === "removed") {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const parsed = UpdateGroupEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const changingBusiness =
    data.businessId !== undefined && data.businessId !== event.businessId;
  let eventBusiness: BusinessAttribution | null = null;
  if (changingBusiness && data.businessId != null) {
    eventBusiness = await getAuthorizedEventBusiness(data.businessId, user.id);
    if (!eventBusiness) {
      res.status(403).json({ error: "You cannot host events as this Business Page" });
      return;
    }
  } else if (!changingBusiness && event.businessId !== null) {
    const businessById = await loadBusinessAttributions([event.businessId]);
    eventBusiness = businessById.get(event.businessId) ?? null;
  }

  let imageUrl = event.imageUrl;
  if (data.imageUrl !== undefined) {
    if (data.imageUrl === null) {
      imageUrl = null;
    } else {
      try {
        imageUrl = await finalizeGroupImageUrl(data.imageUrl, user.id);
      } catch (err) {
        if (err instanceof InvalidUploadError) {
          res.status(400).json({ error: (err as Error).message });
          return;
        }
        throw err;
      }
    }
  }

  const prevStatus = event.status;

  // The new attendeeLimit (if the caller is changing it). A change to a NON-null
  // limit must be validated against currently-occupied seats to avoid stranding
  // seated attendees below the capacity line.
  const changingLimit = data.attendeeLimit !== undefined;
  const nextAttendeeLimit = changingLimit
    ? (data.attendeeLimit ?? null)
    : event.attendeeLimit;

  // Build the full patch once so the transactional and non-transactional paths
  // apply identical field semantics (only whitelisted fields; undefined → keep).
  const patch = {
    // Omission preserves attribution. Explicit null clears it. A changed,
    // non-null value has already passed the active page-role check above.
    businessId:
      data.businessId !== undefined ? (data.businessId ?? null) : event.businessId,
    title: data.title ?? event.title,
    description:
      data.description !== undefined ? (data.description ?? null) : event.description,
    location: data.location !== undefined ? (data.location ?? null) : event.location,
    onlineUrl: data.onlineUrl !== undefined ? (data.onlineUrl ?? null) : event.onlineUrl,
    imageUrl,
    startsAt: data.startsAt ? new Date(data.startsAt) : event.startsAt,
    endsAt:
      data.endsAt !== undefined ? (data.endsAt ? new Date(data.endsAt) : null) : event.endsAt,
    status: data.status ?? event.status,
    visibility: data.visibility ?? event.visibility,
    hideAttendees:
      data.hideAttendees !== undefined ? data.hideAttendees : event.hideAttendees,
    // Meetup-enriched fields
    eventFormat: data.eventFormat !== undefined ? (data.eventFormat ?? null) : event.eventFormat,
    venueName: data.venueName !== undefined ? (data.venueName ?? null) : event.venueName,
    address: data.address !== undefined ? (data.address ?? null) : event.address,
    city: data.city !== undefined ? (data.city ?? null) : event.city,
    state: data.state !== undefined ? (data.state ?? null) : event.state,
    eventCategory: data.eventCategory !== undefined ? (data.eventCategory ?? null) : event.eventCategory,
    topics: data.topics !== undefined ? (data.topics ?? null) : event.topics,
    eventTags: data.eventTags !== undefined ? (data.eventTags ?? null) : event.eventTags,
    howToFind: data.howToFind !== undefined ? (data.howToFind ?? null) : event.howToFind,
    onlineUrlProtected: data.onlineUrlProtected !== undefined ? data.onlineUrlProtected : event.onlineUrlProtected,
    attendeeLimit: nextAttendeeLimit,
    waitlistEnabled: data.waitlistEnabled !== undefined ? data.waitlistEnabled : event.waitlistEnabled,
    allowGuests: data.allowGuests !== undefined ? data.allowGuests : event.allowGuests,
    maxGuestsPerRsvp: data.maxGuestsPerRsvp !== undefined ? (data.maxGuestsPerRsvp ?? null) : event.maxGuestsPerRsvp,
    rsvpOpensAt: data.rsvpOpensAt !== undefined ? (data.rsvpOpensAt ? new Date(data.rsvpOpensAt) : null) : event.rsvpOpensAt,
    rsvpClosesAt: data.rsvpClosesAt !== undefined ? (data.rsvpClosesAt ? new Date(data.rsvpClosesAt) : null) : event.rsvpClosesAt,
    isPaid: data.isPaid !== undefined ? data.isPaid : event.isPaid,
    paidMetadata: data.paidMetadata !== undefined ? ((data.paidMetadata as Record<string, unknown>) ?? null) : event.paidMetadata,
    recurrenceRule: data.recurrenceRule !== undefined ? (data.recurrenceRule ?? null) : event.recurrenceRule,
  };

  // ── Capacity-safe attendeeLimit change ────────────────────────────────────
  // When lowering / setting a NON-null attendeeLimit, run the update inside a
  // transaction that locks the SAME event row RSVPs serialize on (SELECT ...
  // FOR UPDATE), then computes occupied seats as sum(1 + guestCount) over all
  // "going" RSVPs. A new limit BELOW occupied seats is rejected (409) with a
  // stable code — and NO field is mutated. Equal-to-occupied, higher, and
  // null/unlimited limits are allowed. Sharing the RSVP row lock serializes
  // concurrent RSVPs against the limit change so neither can overshoot.
  let updated: typeof groupEventsTable.$inferSelect;
  if (changingLimit && nextAttendeeLimit !== null) {
    const txResult = await db.transaction(async (tx) => {
      // Lock the event row — the identical serialization point used by RSVP.
      const [locked] = await tx
        .select()
        .from(groupEventsTable)
        .where(eq(groupEventsTable.id, eventId))
        .for("update");
      if (!locked) {
        return { ok: false as const, status: 404, error: "Event not found" };
      }

      const occupied = await occupiedGoingSeats(tx, eventId);
      if (nextAttendeeLimit < occupied) {
        // Reject WITHOUT mutating any field.
        return {
          ok: false as const,
          status: 409,
          code: "ATTENDEE_LIMIT_BELOW_OCCUPIED",
          error: `Cannot set attendee limit to ${nextAttendeeLimit}: ${occupied} seat(s) are already taken by going attendees (including guests). Remove attendees first or choose a limit of at least ${occupied}.`,
        };
      }

      const [row] = await tx
        .update(groupEventsTable)
        .set(patch)
        .where(eq(groupEventsTable.id, eventId))
        .returning();
      return { ok: true as const, row };
    });

    if (!txResult.ok) {
      res.status(txResult.status).json({
        error: txResult.error,
        ...(txResult.code ? { code: txResult.code } : {}),
      });
      return;
    }
    updated = txResult.row;
  } else {
    // No non-null limit change → no capacity serialization needed.
    const [row] = await db
      .update(groupEventsTable)
      .set(patch)
      .where(eq(groupEventsTable.id, eventId))
      .returning();
    updated = row;
  }

  if (data.status === "cancelled") {
    await logGroupActivity(groupId, user.id, "cancel_event", {
      targetType: "event",
      targetId: eventId,
    });
    // Notify members of cancellation
    if (prevStatus !== "cancelled") {
      await notifyGroupMembersForEvent(groupId, eventId, "event_cancelled", updated.title, user.id);
    }
  } else if (
    (data.startsAt && data.startsAt !== event.startsAt.toISOString()) ||
    (data.location !== undefined && data.location !== event.location)
  ) {
    // Notify members of time/venue change
    await notifyGroupMembersForEvent(groupId, eventId, "event_updated", updated.title, user.id);
  }

  res.json(
    serializeGroupEvent(updated, {
      viewerRsvpStatus: null,
      groupIsPrivate: guard.group.privacy === "private",
      business: eventBusiness,
    }),
  );
});

// DELETE /groups/:groupId/events/:eventId
router.delete(
  "/groups/:groupId/events/:eventId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const eventId = parseId(req.params.eventId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canManageGroup(memberRole)) {
      res.status(403).json({ error: "Only admins/owners can delete events" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(groupEventsTable)
        .set({ status: "removed" })
        .where(and(eq(groupEventsTable.id, eventId), eq(groupEventsTable.groupId, groupId)));
      await tx
        .update(groupsTable)
        .set({ eventCount: sql`greatest(${groupsTable.eventCount} - 1, 0)` })
        .where(eq(groupsTable.id, groupId));
    });

    await logGroupActivity(groupId, user.id, "cancel_event", {
      targetType: "event",
      targetId: eventId,
    });
    res.sendStatus(204);
  },
);

// POST /groups/:groupId/events/:eventId/rsvp — delegates to centralized RSVP service
// Enforces: lifecycle, visibility/membership, RSVP window, block, paid guard,
// guest rules, capacity/waitlist with FOR UPDATE lock, counter repair, promotion.
router.post(
  "/groups/:groupId/events/:eventId/rsvp",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const eventId = parseId(req.params.eventId);

    if (!Number.isFinite(groupId) || !Number.isFinite(eventId)) {
      res.status(400).json({ error: "Invalid group or event ID" });
      return;
    }

    const parsed = RsvpGroupEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const result = await executeGroupEventRsvp({
      user,
      groupId,
      eventId,
      requestedStatus: parsed.data.rsvpStatus,
      guestCount: parsed.data.guestCount ?? 0,
      isPrivate: parsed.data.isPrivate ?? false,
      allowPublicRsvp: false, // direct group route always enforces membership for private groups
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      });
      return;
    }

    // Log insight for new RSVPs (first-time going/waitlisted only)
    if (result.rsvpStatus) {
      await db.insert(groupInsightEventsTable).values({
        groupId,
        eventType: "event_rsvp",
        userId: user.id,
        metadata: { eventId },
      });
    }

    res.json({
      rsvpStatus: result.rsvpStatus,
      rsvpCount: result.rsvpCount,
      waitlisted: result.waitlisted,
      waitlistPosition: result.waitlistPosition,
    });
  },
);

// GET /groups/:groupId/events/:eventId/attendees
router.get("/groups/:groupId/events/:eventId/attendees", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const eventId = parseId(req.params.eventId);

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see event attendees" });
    return;
  }

  const [event] = await db
    .select()
    .from(groupEventsTable)
    .where(and(eq(groupEventsTable.id, eventId), eq(groupEventsTable.groupId, groupId)));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  // Event-level private visibility: 404 a private event for non-members (creator/
  // admin/active members exempt) before exposing any attendee identities/counts,
  // even in a public group.
  if (
    !canViewGroupEventPure(event, {
      memberRole: access.memberRole,
      isAdmin: access.isAdmin,
      viewerId: viewer?.id ?? null,
    })
  ) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (event.hideAttendees) {
    const memberRole = viewer ? await getGroupMemberRole(groupId, viewer.id) : null;
    if (!canModerateContent(memberRole) && viewer?.role !== "admin") {
      res.json([]);
      return;
    }
  }

  const rsvps = await db
    .select()
    .from(groupEventRsvpsTable)
    .where(
      and(
        eq(groupEventRsvpsTable.eventId, eventId),
        eq(groupEventRsvpsTable.isPrivate, false),
      ),
    )
    .orderBy(asc(groupEventRsvpsTable.createdAt));

  const userIds = [...new Set(rsvps.map((r) => r.userId))];
  // Block filtering
  const blockedIds = viewer ? await getBlockedUserIds(viewer.id, userIds) : new Set<number>();
  const visible = rsvps.filter((r) => !blockedIds.has(r.userId));
  const visibleIds = [...new Set(visible.map((r) => r.userId))];

  const users = visibleIds.length
    ? await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          profilePhotoUrl: usersTable.profilePhotoUrl,
          buddyType: usersTable.buddyType,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, visibleIds))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  res.json(
    visible.map((r) => {
      const u = userMap.get(r.userId);
      return {
        userId: r.userId,
        userName: u?.name ?? "Unknown",
        userPhotoUrl: u?.profilePhotoUrl ?? null,
        buddyType: u?.buddyType ?? null,
        rsvpStatus: r.rsvpStatus,
        attendanceStatus: r.attendanceStatus ?? null,
        guestCount: r.guestCount,
        waitlistPosition: r.waitlistPosition ?? null,
        rsvpAt: r.createdAt.toISOString(),
      };
    }),
  );
});

router.get(
  "/groups/:groupId/events/:eventId/broadcast-audience",
  requireAuth(),
  async (req, res): Promise<void> => {
    const actor = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const eventId = parseId(req.params.eventId);
    const authorization = await loadAuthorizedEventBroadcaster(groupId, eventId, actor);
    if (!authorization.ok) {
      res.status(authorization.status).json({ error: authorization.error });
      return;
    }

    const recipientIds = await getEligibleEventBroadcastRecipientIds(groupId, eventId, actor.id);
    res.json({ recipientCount: recipientIds.length });
  },
);

router.post(
  "/groups/:groupId/events/:eventId/broadcast",
  requireAuth(),
  async (req, res): Promise<void> => {
    const actor = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const eventId = parseId(req.params.eventId);
    const parsed = BroadcastGroupEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const message = parsed.data.message.trim();
    if (!message) {
      res.status(400).json({ error: "Message cannot be blank" });
      return;
    }

    const authorization = await loadAuthorizedEventBroadcaster(groupId, eventId, actor);
    if (!authorization.ok) {
      res.status(authorization.status).json({ error: authorization.error });
      return;
    }

    const keywordAction = await checkKeywordAlerts(groupId, message);
    if (keywordAction !== null) {
      res.status(422).json({ error: "This update conflicts with the Meetup's moderation rules" });
      return;
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
    const rateReservation = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(93217, ${eventId})`);
      const [attempts] = await tx
        .select({
          count: sql<number>`cast(count(*) as int)`,
          oldestAt: sql<Date | null>`min(${groupActivityLogTable.createdAt})`,
          latestAt: sql<Date | null>`max(${groupActivityLogTable.createdAt})`,
        })
        .from(groupActivityLogTable)
        .where(
          and(
            eq(groupActivityLogTable.groupId, groupId),
            eq(groupActivityLogTable.action, "broadcast_event_update"),
            eq(groupActivityLogTable.targetType, "event"),
            eq(groupActivityLogTable.targetId, eventId),
            gte(groupActivityLogTable.createdAt, windowStart),
          ),
        );
      const decision = evaluateEventBroadcastRateLimit(
        attempts?.count ?? 0,
        attempts?.oldestAt ? new Date(attempts.oldestAt) : null,
        attempts?.latestAt ? new Date(attempts.latestAt) : null,
        now,
      );
      if (!decision.allowed) return decision;

      const [activity] = await tx
        .insert(groupActivityLogTable)
        .values({
          groupId,
          actorUserId: actor.id,
          action: "broadcast_event_update",
          targetType: "event",
          targetId: eventId,
          note: null,
          metadata: { status: "sending" },
        })
        .returning({ id: groupActivityLogTable.id });
      return { allowed: true as const, activityId: activity.id };
    });

    if (!rateReservation.allowed) {
      res.setHeader("Retry-After", String(rateReservation.retryAfterSeconds));
      res.status(429).json({
        error: "Please wait before sending another attendee update",
        retryAfterSeconds: rateReservation.retryAfterSeconds,
      });
      return;
    }

    const recipientIds = await getEligibleEventBroadcastRecipientIds(groupId, eventId, actor.id);
    const notificationTitle = `Update for “${authorization.event.title}”`;
    const CHUNK_SIZE = 50;
    const deliveryOutcomes: Array<"delivered" | "skipped" | "failed"> = [];

    for (let i = 0; i < recipientIds.length; i += CHUNK_SIZE) {
      const chunk = recipientIds.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((recipientUserId) =>
          deliverEventBroadcastNotification({
            groupId,
            eventId,
            senderUserId: actor.id,
            recipientUserId,
            title: notificationTitle,
            message,
          }),
        ),
      );
      for (const result of results) {
        deliveryOutcomes.push(result.status === "fulfilled" ? result.value : "failed");
      }
    }

    const delivery = summarizeEventBroadcastDeliveries(deliveryOutcomes);

    try {
      await db
        .update(groupActivityLogTable)
        .set({
          metadata: {
            status: delivery.status,
            recipientCount: delivery.recipientCount,
            deliveredCount: delivery.deliveredCount,
            failedCount: delivery.failedCount,
            skippedCount: delivery.skippedCount,
          },
        })
        .where(eq(groupActivityLogTable.id, rateReservation.activityId));
    } catch (err) {
      req.log.error(
        { err, groupId, eventId, activityId: rateReservation.activityId },
        "Failed to finalize Meetup attendee update activity",
      );
    }

    if (delivery.failedCount > 0) {
      req.log.warn(
        { groupId, eventId, ...delivery },
        "Meetup attendee update had delivery failures",
      );
    }

    res.json(delivery);
  },
);

// POST /groups/:groupId/events/:eventId/save
router.post(
  "/groups/:groupId/events/:eventId/save",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const eventId = parseId(req.params.eventId);

    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
    if (!group || group.status === "deleted") {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const access = await resolveGroupAccess(group, user);
    if (!access.allowed) {
      res.status(403).json({ error: "Join this group to save events" });
      return;
    }

    const [event] = await db
      .select({
        id: groupEventsTable.id,
        visibility: groupEventsTable.visibility,
        createdByUserId: groupEventsTable.createdByUserId,
      })
      .from(groupEventsTable)
      .where(and(eq(groupEventsTable.id, eventId), eq(groupEventsTable.groupId, groupId)));
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    // Event-level private visibility: deny (404) saving a private event for a
    // non-member/non-admin (creator/admin/active members exempt), even when the
    // parent group is public.
    if (
      !canViewGroupEventPure(event, {
        memberRole: access.memberRole,
        isAdmin: access.isAdmin,
        viewerId: user.id,
      })
    ) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(groupEventSavesTable)
      .where(and(eq(groupEventSavesTable.eventId, eventId), eq(groupEventSavesTable.userId, user.id)));

    let saved: boolean;
    if (existing) {
      await db.delete(groupEventSavesTable).where(eq(groupEventSavesTable.id, existing.id));
      saved = false;
    } else {
      await db
        .insert(groupEventSavesTable)
        .values({ eventId, groupId, userId: user.id })
        .onConflictDoNothing();
      saved = true;
    }
    res.json({ saved });
  },
);

// PATCH /groups/:groupId/events/:eventId/attendees/:userId — organizer attendee management
// Routes through transactional counter-safe service: enforces capacity, promotion, counters.
router.patch(
  "/groups/:groupId/events/:eventId/attendees/:userId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const actor = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const eventId = parseId(req.params.eventId);
    const targetUserId = parseId(req.params.userId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      actor.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, actor.id);
    if (!canModerateContent(memberRole)) {
      res.status(403).json({ error: "Only admins/mods/owners can manage attendees" });
      return;
    }

    const parsed = ManageGroupEventAttendeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { action, guestCount } = parsed.data;

    const result = await executeOrganizerAttendeeAction({
      eventId,
      groupId,
      targetUserId,
      action,
      guestCount,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const [u] = await db
      .select({
        name: usersTable.name,
        profilePhotoUrl: usersTable.profilePhotoUrl,
        buddyType: usersTable.buddyType,
      })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));

    res.json({
      userId: targetUserId,
      userName: u?.name ?? "Unknown",
      userPhotoUrl: u?.profilePhotoUrl ?? null,
      buddyType: u?.buddyType ?? null,
      rsvpStatus: result.rsvp.rsvpStatus,
      attendanceStatus: result.rsvp.attendanceStatus,
      guestCount: result.rsvp.guestCount,
      waitlistPosition: result.rsvp.waitlistPosition,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/reports
router.get("/groups/:groupId/reports", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canModerateContent(memberRole)) {
    res.status(403).json({ error: "Only admins/mods can see reports" });
    return;
  }

  const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";
  const reports = await db
    .select()
    .from(groupReportsTable)
    .where(
      and(eq(groupReportsTable.groupId, groupId), eq(groupReportsTable.status, statusFilter)),
    )
    .orderBy(desc(groupReportsTable.createdAt));

  res.json(
    reports.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      reporterUserId: r.reporterUserId,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      reviewedByUserId: r.reviewedByUserId,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// PATCH /groups/:groupId/reports/:reportId
router.patch(
  "/groups/:groupId/reports/:reportId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const reportId = parseId(req.params.reportId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canModerateContent(memberRole)) {
      res.status(403).json({ error: "Only admins/mods can review reports" });
      return;
    }

    const parsed = ReviewGroupReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [report] = await db
      .select()
      .from(groupReportsTable)
      .where(
        and(eq(groupReportsTable.id, reportId), eq(groupReportsTable.groupId, groupId)),
      );

    if (!report || report.status !== "pending") {
      res.status(404).json({ error: "Report not found or already reviewed" });
      return;
    }

    const newStatus = parsed.data.action === "dismiss" ? "dismissed" : "actioned";
    const [updated] = await db
      .update(groupReportsTable)
      .set({ status: newStatus, reviewedByUserId: user.id, reviewedAt: new Date() })
      .where(eq(groupReportsTable.id, reportId))
      .returning();

    await logGroupActivity(groupId, user.id, "review_report", {
      targetType: "report",
      targetId: reportId,
      note: parsed.data.note ?? undefined,
    });

    res.json({
      id: updated.id,
      groupId: updated.groupId,
      reporterUserId: updated.reporterUserId,
      targetType: updated.targetType,
      targetId: updated.targetId,
      reason: updated.reason,
      details: updated.details,
      status: updated.status,
      reviewedByUserId: updated.reviewedByUserId,
      reviewedAt: updated.reviewedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Keyword Alerts
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/keyword-alerts
router.get("/groups/:groupId/keyword-alerts", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(memberRole)) {
    res.status(403).json({ error: "Only admins/owners can see keyword alerts" });
    return;
  }

  const alerts = await db
    .select()
    .from(groupKeywordAlertsTable)
    .where(eq(groupKeywordAlertsTable.groupId, groupId))
    .orderBy(asc(groupKeywordAlertsTable.createdAt));

  res.json(
    alerts.map((a) => ({
      id: a.id,
      groupId: a.groupId,
      keyword: a.keyword,
      action: a.action,
      isActive: a.isActive,
      createdAt: a.createdAt.toISOString(),
    })),
  );
});

// POST /groups/:groupId/keyword-alerts
router.post("/groups/:groupId/keyword-alerts", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(memberRole)) {
    res.status(403).json({ error: "Only admins/owners can manage keyword alerts" });
    return;
  }

  const parsed = CreateGroupKeywordAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [alert] = await db
    .insert(groupKeywordAlertsTable)
    .values({
      groupId,
      keyword: parsed.data.keyword.toLowerCase().trim(),
      action: parsed.data.action ?? "flag",
      createdByUserId: user.id,
      isActive: true,
    })
    .returning();

  await logGroupActivity(groupId, user.id, "add_keyword_alert", {
    targetType: "keyword_alert",
    targetId: alert.id,
    note: `keyword: ${alert.keyword}`,
  });

  res.status(201).json({
    id: alert.id,
    groupId: alert.groupId,
    keyword: alert.keyword,
    action: alert.action,
    isActive: alert.isActive,
    createdAt: alert.createdAt.toISOString(),
  });
});

// DELETE /groups/:groupId/keyword-alerts/:alertId
router.delete(
  "/groups/:groupId/keyword-alerts/:alertId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const alertId = parseId(req.params.alertId);
    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }
    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canManageGroup(memberRole)) {
      res.status(403).json({ error: "Only admins/owners can delete keyword alerts" });
      return;
    }

    await db.delete(groupKeywordAlertsTable).where(
      and(
        eq(groupKeywordAlertsTable.id, alertId),
        eq(groupKeywordAlertsTable.groupId, groupId),
      ),
    );

    await logGroupActivity(groupId, user.id, "remove_keyword_alert", {
      targetType: "keyword_alert",
      targetId: alertId,
    });

    res.sendStatus(204);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Activity Log
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/activity-log
router.get("/groups/:groupId/activity-log", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(memberRole)) {
    res.status(403).json({ error: "Only admins/owners can view the activity log" });
    return;
  }

  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    200,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const logs = await db
    .select()
    .from(groupActivityLogTable)
    .where(eq(groupActivityLogTable.groupId, groupId))
    .orderBy(desc(groupActivityLogTable.createdAt))
    .limit(limit)
    .offset(offset);

  const actorIds = [...new Set(logs.map((l) => l.actorUserId))];
  const actors = actorIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, actorIds))
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a.name]));

  res.json(
    logs.map((l) => ({
      id: l.id,
      groupId: l.groupId,
      actorUserId: l.actorUserId,
      actorName: actorMap.get(l.actorUserId) ?? "Unknown",
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    })),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Insights
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/insights
router.get("/groups/:groupId/insights", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(memberRole)) {
    res.status(403).json({ error: "Only admins/owners can view insights" });
    return;
  }

  const now = new Date();
  const days7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [newMembers7] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        sql`${groupMembersTable.joinedAt} >= ${days7}`,
      ),
    );
  const [newMembers30] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        sql`${groupMembersTable.joinedAt} >= ${days30}`,
      ),
    );
  const [posts7] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(groupPostsTable)
    .where(
      and(
        eq(groupPostsTable.groupId, groupId),
        eq(groupPostsTable.status, "active"),
        sql`${groupPostsTable.createdAt} >= ${days7}`,
      ),
    );
  const [posts30] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(groupPostsTable)
    .where(
      and(
        eq(groupPostsTable.groupId, groupId),
        eq(groupPostsTable.status, "active"),
        sql`${groupPostsTable.createdAt} >= ${days30}`,
      ),
    );

  const topPosts = await db
    .select()
    .from(groupPostsTable)
    .where(and(eq(groupPostsTable.groupId, groupId), eq(groupPostsTable.status, "active")))
    .orderBy(
      desc(sql`${groupPostsTable.likeCount} + ${groupPostsTable.commentCount} * 2`),
    )
    .limit(5);

  const serializedTopPosts = await Promise.all(
    topPosts.map((p) => serializePost(p, user.id, { groupIsPrivate: group.privacy === "private" })),
  );

  res.json({
    groupId,
    memberCount: group.memberCount,
    postCount: group.postCount,
    eventCount: group.eventCount,
    newMembersLast7Days: newMembers7.c,
    newMembersLast30Days: newMembers30.c,
    postsLast7Days: posts7.c,
    postsLast30Days: posts30.c,
    topReactedPosts: serializedTopPosts,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Featured Content
// ─────────────────────────────────────────────────────────────────────────────

// GET /groups/:groupId/featured
router.get("/groups/:groupId/featured", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const access = await resolveGroupAccess(group, viewer);
  if (!access.allowed) {
    res.status(403).json({ error: "Join this group to see featured content" });
    return;
  }

  const featured = await db
    .select()
    .from(groupFeaturedContentTable)
    .where(eq(groupFeaturedContentTable.groupId, groupId))
    .orderBy(asc(groupFeaturedContentTable.sortOrder));

  res.json(
    featured.map((f) => ({
      id: f.id,
      groupId: f.groupId,
      contentType: f.contentType,
      contentId: f.contentId,
      sortOrder: f.sortOrder,
      createdAt: f.createdAt.toISOString(),
    })),
  );
});

// POST /groups/:groupId/featured
router.post("/groups/:groupId/featured", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const guard = await loadGroupForLifecycle(groupId, "write");
  if (!guard.ok) {
    res.status(guard.status).json({ error: guard.error });
    return;
  }
  const memberRole =
    user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
  if (!canManageGroup(memberRole)) {
    res.status(403).json({ error: "Only admins/owners can manage featured content" });
    return;
  }

  const parsed = AddGroupFeaturedContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [fc] = await db
    .insert(groupFeaturedContentTable)
    .values({
      groupId,
      contentType: parsed.data.contentType,
      contentId: parsed.data.contentId,
      setByUserId: user.id,
      sortOrder: parsed.data.sortOrder ?? 0,
    })
    .onConflictDoNothing()
    .returning();

  if (!fc) {
    res.status(409).json({ error: "Content is already featured" });
    return;
  }

  await logGroupActivity(groupId, user.id, "add_featured", {
    targetType: parsed.data.contentType,
    targetId: parsed.data.contentId,
  });

  res.status(201).json({
    id: fc.id,
    groupId: fc.groupId,
    contentType: fc.contentType,
    contentId: fc.contentId,
    sortOrder: fc.sortOrder,
    createdAt: fc.createdAt.toISOString(),
  });
});

// DELETE /groups/:groupId/featured/:featuredId
router.delete(
  "/groups/:groupId/featured/:featuredId",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const featuredId = parseId(req.params.featuredId);

    const guard = await loadGroupForLifecycle(groupId, "write");
    if (!guard.ok) {
      res.status(guard.status).json({ error: guard.error });
      return;
    }

    const memberRole =
      user.role === "admin" ? ("admin" as GroupRole) : await getGroupMemberRole(groupId, user.id);
    if (!canManageGroup(memberRole)) {
      res.status(403).json({ error: "Only admins/owners can manage featured content" });
      return;
    }

    const [fc] = await db
      .select()
      .from(groupFeaturedContentTable)
      .where(
        and(
          eq(groupFeaturedContentTable.id, featuredId),
          eq(groupFeaturedContentTable.groupId, groupId),
        ),
      );

    if (fc) {
      await db
        .delete(groupFeaturedContentTable)
        .where(eq(groupFeaturedContentTable.id, featuredId));
      await logGroupActivity(groupId, user.id, "remove_featured", {
        targetType: fc.contentType,
        targetId: fc.contentId,
      });
    }

    res.sendStatus(204);
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Platform Admin Endpoints — /admin/groups
// ═══════════════════════════════════════════════════════════════════════════

// GET /admin/groups
router.get("/admin/groups", requireAuth("admin"), async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const privacyFilter = typeof req.query.privacy === "string" ? req.query.privacy : undefined;
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : undefined;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 30 : 30,
    200,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const conditions: Parameters<typeof and> = [];
  if (search) {
    conditions.push(
      or(ilike(groupsTable.name, `%${search}%`), ilike(groupsTable.description, `%${search}%`))!,
    );
  }
  if (privacyFilter) conditions.push(eq(groupsTable.privacy, privacyFilter));
  if (categoryFilter) conditions.push(eq(groupsTable.category, categoryFilter));
  if (statusFilter) conditions.push(eq(groupsTable.status, statusFilter));
  else conditions.push(sql`${groupsTable.status} NOT IN ('draft', 'deleted')`);

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(groupsTable)
    .where(conditions.length ? and(...conditions) : undefined);

  const groups = await db
    .select()
    .from(groupsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(groupsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const groupIds = groups.map((g) => g.id);
  const reportCounts = groupIds.length
    ? await db
        .select({ groupId: groupReportsTable.groupId, count: sql<number>`count(*)::int` })
        .from(groupReportsTable)
        .where(
          and(
            inArray(groupReportsTable.groupId, groupIds),
            eq(groupReportsTable.status, "pending"),
          ),
        )
        .groupBy(groupReportsTable.groupId)
    : [];
  const reportMap = new Map(reportCounts.map((r) => [r.groupId, r.count]));

  res.json({
    total: countRow.c,
    groups: groups.map((g) => ({ ...serializeGroup(g), reportCount: reportMap.get(g.id) ?? 0 })),
  });
});

// GET /admin/groups/:groupId
router.get("/admin/groups/:groupId", requireAuth("admin"), async (req, res): Promise<void> => {
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const [reportCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(groupReportsTable)
    .where(
      and(eq(groupReportsTable.groupId, groupId), eq(groupReportsTable.status, "pending")),
    );

  const recentLog = await db
    .select()
    .from(groupActivityLogTable)
    .where(eq(groupActivityLogTable.groupId, groupId))
    .orderBy(desc(groupActivityLogTable.createdAt))
    .limit(20);

  const actorIds = [...new Set(recentLog.map((l) => l.actorUserId))];
  const actors = actorIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, actorIds))
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a.name]));

  res.json({
    ...serializeGroup(group),
    reportCount: reportCount.c,
    activityLog: recentLog.map((l) => ({
      id: l.id,
      groupId: l.groupId,
      actorUserId: l.actorUserId,
      actorName: actorMap.get(l.actorUserId) ?? "Unknown",
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});

// PATCH /admin/groups/:groupId
router.patch("/admin/groups/:groupId", requireAuth("admin"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const groupId = parseId(req.params.groupId);
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const parsed = AdminUpdateGroupStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { action, reason, featuredUntil } = parsed.data;
  if (group.status === "draft" && ["restore", "hide", "suspend"].includes(action)) {
    res.status(409).json({
      error: "Meetup drafts must be completed and published through the Meetup creation flow",
    });
    return;
  }
  const updates: Partial<typeof groupsTable.$inferInsert> = {};
  let logAction = "update_group_status";

  switch (action) {
    case "suspend":
      updates.status = "suspended";
      break;
    case "hide":
      updates.status = "hidden";
      break;
    case "restore":
      updates.status = "active";
      break;
    case "delete":
      updates.status = "deleted";
      break;
    case "feature":
      updates.isFeatured = true;
      updates.featuredUntil = featuredUntil ? new Date(featuredUntil) : null;
      logAction = "add_featured";
      break;
    case "unfeature":
      updates.isFeatured = false;
      updates.featuredUntil = null;
      logAction = "remove_featured";
      break;
    default:
      res.status(400).json({ error: "Unknown action" });
      return;
  }

  const [updated] = await db
    .update(groupsTable)
    .set(updates)
    .where(eq(groupsTable.id, groupId))
    .returning();

  await logGroupActivity(groupId, user.id, logAction, { note: reason ?? action });
  res.json(serializeGroup(updated));
});

// GET /admin/groups/:groupId/posts
router.get("/admin/groups/:groupId/posts", requireAuth("admin"), async (req, res): Promise<void> => {
  const groupId = parseId(req.params.groupId);
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    200,
  );
  const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const conditions: Parameters<typeof and> = [eq(groupPostsTable.groupId, groupId)];
  if (statusFilter) conditions.push(eq(groupPostsTable.status, statusFilter));

  const [adminGroup] = await db
    .select({ privacy: groupsTable.privacy })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));

  const posts = await db
    .select()
    .from(groupPostsTable)
    .where(and(...conditions))
    .orderBy(desc(groupPostsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const serialized = await Promise.all(
    posts.map((p) =>
      serializePost(p, null, { groupIsPrivate: adminGroup?.privacy === "private" }),
    ),
  );
  res.json(serialized);
});

// PATCH /admin/groups/:groupId/posts/:postId/moderate
router.patch(
  "/admin/groups/:groupId/posts/:postId/moderate",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);

    const [post] = await db
      .select()
      .from(groupPostsTable)
      .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const parsed = AdminModerateGroupPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [modGroup] = await db
      .select({ privacy: groupsTable.privacy })
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId));

    const { action, reason } = parsed.data;
    let newStatus = post.status;
    let moderationLocked = post.moderationLocked;

    if (action === "hide") {
      newStatus = "hidden";
      moderationLocked = true;
    } else if (action === "remove") {
      newStatus = "removed";
      moderationLocked = true;
    } else if (action === "restore") {
      newStatus = "active";
      moderationLocked = false;
    }

    const [updated] = await db
      .update(groupPostsTable)
      .set({ status: newStatus, moderationLocked })
      .where(eq(groupPostsTable.id, postId))
      .returning();

    await logGroupActivity(groupId, user.id, `${action}_post`, {
      targetType: "post",
      targetId: postId,
      note: reason ?? undefined,
    });

    res.json(
      await serializePost(updated, null, {
        groupIsPrivate: modGroup?.privacy === "private",
      }),
    );
  },
);

// GET /admin/groups/:groupId/reports
router.get(
  "/admin/groups/:groupId/reports",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const groupId = parseId(req.params.groupId);
    const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";

    const reports = await db
      .select()
      .from(groupReportsTable)
      .where(
        and(eq(groupReportsTable.groupId, groupId), eq(groupReportsTable.status, statusFilter)),
      )
      .orderBy(desc(groupReportsTable.createdAt));

    res.json(
      reports.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        reporterUserId: r.reporterUserId,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        details: r.details,
        status: r.status,
        reviewedByUserId: r.reviewedByUserId,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

// POST /admin/groups/:groupId/transfer-owner
// Transactional: demote current owner → admin, upsert new owner, reject suspended/invalid targets
router.post(
  "/admin/groups/:groupId/transfer-owner",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    if (group.status === "deleted") {
      res.status(400).json({ error: "Cannot transfer ownership of a deleted group" });
      return;
    }

    const parsed = AdminTransferGroupOwnerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { newOwnerUserId, reason } = parsed.data;

    const [newOwner] = await db
      .select({ id: usersTable.id, role: usersTable.role, accountStatus: usersTable.accountStatus })
      .from(usersTable)
      .where(eq(usersTable.id, newOwnerUserId));

    if (!newOwner) {
      res.status(404).json({ error: "New owner user not found" });
      return;
    }
    // Reject suspended/banned users as new owners
    if (newOwner.accountStatus && newOwner.accountStatus !== "active") {
      res.status(400).json({ error: "Cannot transfer ownership to a suspended or banned user" });
      return;
    }

    // Transactional ownership transfer — guarantees exactly one owner
    await db.transaction(async (tx) => {
      // Step 1: demote current owner(s) to admin
      await tx
        .update(groupMembersTable)
        .set({ role: "admin" })
        .where(
          and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.role, "owner")),
        );

      // Step 2: upsert new owner as member if not already
      await tx
        .insert(groupMembersTable)
        .values({
          groupId,
          userId: newOwnerUserId,
          role: "owner",
          joinedVia: "admin_transfer",
          status: "active",
        })
        .onConflictDoNothing();

      // Step 3: ensure role is owner (covers the case where they were already a member)
      await tx
        .update(groupMembersTable)
        .set({ role: "owner", status: "active" })
        .where(
          and(
            eq(groupMembersTable.groupId, groupId),
            eq(groupMembersTable.userId, newOwnerUserId),
          ),
        );

      // Step 4: update group's creatorUserId
      await tx
        .update(groupsTable)
        .set({ creatorUserId: newOwnerUserId })
        .where(eq(groupsTable.id, groupId));
    });

    await logGroupActivity(groupId, user.id, "transfer_ownership", {
      targetType: "member",
      targetId: newOwnerUserId,
      note: reason ?? undefined,
    });

    res.json({ message: "Ownership transferred successfully", newOwnerUserId });
  },
);

export default router;
