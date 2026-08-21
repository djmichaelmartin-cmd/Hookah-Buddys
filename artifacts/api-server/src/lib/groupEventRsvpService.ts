/**
 * Centralized Group Event RSVP Service
 *
 * Single source of truth for all RSVP business logic shared between:
 *   POST /groups/:groupId/events/:eventId/rsvp  (direct group member RSVP)
 *   POST /events/:negativeId/rsvp               (projected public Meetup event RSVP)
 *
 * Enforced invariants
 * ──────────────────
 * Visibility/access
 *   - User must not be suspended (accountStatus !== "active" → 403)
 *   - Suspended/deleted/hidden groups reject ALL writes (groupAllowsWrites gate)
 *   - Private groups: user must be a member (or platform admin) to RSVP
 *   - Public groups (including public Meetup projections): anyone may RSVP, BUT
 *     block relationships with the event creator are still enforced
 *   - Private EVENTS (group_events.visibility="private"): ACTIVE MEMBERS ONLY,
 *     plus the event creator/organizer and platform admins, regardless of the
 *     parent group's privacy. A private event in a PUBLIC group/Meetup is still
 *     members-only (403 for non-members on the direct route; 404 on the
 *     projected/public path — the projection hides it). Membership is
 *     re-validated AUTHORITATIVELY inside the FOR UPDATE transaction (not the
 *     stale pre-transaction read) so a user removed between preflight and lock
 *     is denied. The creator/admin bypass does not require a membership row.
 *
 * RSVP window
 *   - rsvpOpensAt / rsvpClosesAt respected; cancellations always bypass the window
 *
 * Paid-event guard
 *   - New going/waitlisted RSVPs on isPaid=true events → 409 PAID_EVENT_CHECKOUT_UNAVAILABLE
 *   - Cancellations (not_going, cancelled) and toggle-off on paid events are always allowed
 *
 * Guest rules
 *   - guestCount > 0 requires event.allowGuests
 *   - guestCount <= event.maxGuestsPerRsvp when set
 *   - Capacity includes attendee + guestCount (1 + guestCount effective seats)
 *
 * Capacity & waitlist (all under a FOR UPDATE lock)
 *   - The group_events row is locked at the START of the transaction via SELECT FOR UPDATE
 *   - Capacity check counts current going RSVPs (sum of 1+guestCount per RSVP)
 *   - When full and waitlistEnabled: auto-downgrade to "waitlisted" with unique position
 *   - When full and !waitlistEnabled: return rsvpStatus null (seat unavailable)
 *
 * Transitions & counter repair
 *   - Every RSVP status transition updates rsvpCount/waitlistCount correctly
 *   - Cancelling a going RSVP: decrement rsvpCount, promote first waitlisted atomically
 *   - Cancelling a waitlisted RSVP: decrement waitlistCount
 *   - Organizer set_going on waitlisted: decrement waitlistCount, increment rsvpCount
 *   - Organizer set_waitlisted on going: decrement rsvpCount, increment waitlistCount
 *   - Organizer guest_count change: re-check capacity under lock
 *
 * Counter formula
 *   rsvpCount   = number of going RSVPs (one row per RSVP, irrespective of guestCount;
 *                 guests don't get individual rows but are counted in capacity checks)
 *   waitlistCount = number of waitlisted RSVP rows
 *
 * All RSVP-mutating operations are wrapped in a single DB transaction.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  blocksTable,
  groupsTable,
  groupEventsTable,
  groupEventRsvpsTable,
  groupMembersTable,
  usersTable,
  type GroupEvent,
} from "@workspace/db";
import { isBlockedPure } from "../routes/groups";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RsvpResult =
  | {
      ok: true;
      rsvpStatus: string | null;
      rsvpCount: number;
      waitlisted: boolean;
      waitlistPosition: number | null;
    }
  | { ok: false; status: number; code?: string; error: string };

/** Subset of the event row needed for all policy checks. */
type EventForRsvp = GroupEvent;

/** Subset of the group row needed for all policy checks. */
type GroupForRsvp = {
  id: number;
  status: string;
  privacy: string;
  groupType: string | null;
};

/** Caller-supplied context. */
export type RsvpContext = {
  /**
   * The user performing the RSVP.
   * accountStatus must be "active"; suspended users are rejected.
   */
  user: { id: number; role?: string | null; accountStatus?: string | null };
  groupId: number;
  eventId: number;
  /**
   * Requested RSVP status (from validated body).
   * going | interested | not_going | cancelled | waitlisted
   */
  requestedStatus: string;
  guestCount?: number;
  isPrivate?: boolean;
  /**
   * When true (projected global event), skip the private-group membership
   * requirement — but all other guards still apply.
   * Public meetup projection: group must be public (enforced by caller before
   * calling the service).
   */
  allowPublicRsvp?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getGroupMemberRoleLocal(
  groupId: number,
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ role: groupMembersTable.role, status: groupMembersTable.status })
    .from(groupMembersTable)
    .where(
      and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)),
    );
  if (!row || row.status !== "active") return null;
  return row.role;
}

/**
 * Authoritative active-membership check performed INSIDE a transaction, so it
 * reflects the state as of the FOR UPDATE lock — not a stale pre-transaction
 * read. Used to re-validate private-event access under the lock: a user removed
 * (or deactivated) between preflight and lock acquisition must be denied.
 * Returns true only for an ACTIVE membership row.
 */
async function isActiveMemberTx(
  tx: Tx,
  groupId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await tx
    .select({ status: groupMembersTable.status })
    .from(groupMembersTable)
    .where(
      and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, userId)),
    );
  return !!row && row.status === "active";
}

async function isBlockedLocal(userA: number, userB: number): Promise<boolean> {
  if (userA === userB) return false;
  const rows = await db
    .select({ blockerId: blocksTable.blockerId, blockedUserId: blocksTable.blockedUserId })
    .from(blocksTable)
    .where(
      and(
        sql`(${blocksTable.blockerId} = ${userA} AND ${blocksTable.blockedUserId} = ${userB})
         OR (${blocksTable.blockerId} = ${userB} AND ${blocksTable.blockedUserId} = ${userA})`,
      ),
    )
    .limit(1);
  return isBlockedPure(userA, userB, rows);
}

/** Effective seats consumed by a single RSVP row (1 attendee + guests). */
function effectiveSeats(rsvp: { guestCount: number | null }): number {
  return 1 + (rsvp.guestCount ?? 0);
}

/** Drizzle transaction handle type (used by all internal capacity helpers). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Total occupied seats for an event, summed as (1 + guestCount) over all
 * currently-going RSVP rows, read under the caller's row lock.
 *
 * @param excludeRsvpId  When set, that RSVP's contribution is excluded — used
 *                       when re-evaluating capacity for an RSVP that is itself
 *                       transitioning (so we don't double-count its old party).
 */
export async function occupiedGoingSeats(
  tx: Tx,
  eventId: number,
  excludeRsvpId?: number,
): Promise<number> {
  const goingRsvps = await tx
    .select({
      id: groupEventRsvpsTable.id,
      guestCount: groupEventRsvpsTable.guestCount,
    })
    .from(groupEventRsvpsTable)
    .where(
      and(
        eq(groupEventRsvpsTable.eventId, eventId),
        eq(groupEventRsvpsTable.rsvpStatus, "going"),
      ),
    );

  return goingRsvps.reduce((sum, r) => {
    if (excludeRsvpId !== undefined && r.id === excludeRsvpId) return sum;
    return sum + effectiveSeats(r);
  }, 0);
}

/**
 * Determine whether a party of `partySeats` seats fits for an event.
 * Returns true when there is no attendee limit, or when the new party fits
 * within (attendeeLimit - occupiedSeats).
 */
function partyFits(
  attendeeLimit: number | null,
  occupiedSeats: number,
  partySeats: number,
): boolean {
  if (attendeeLimit === null) return true;
  return occupiedSeats + partySeats <= attendeeLimit;
}

/**
 * Assign the next unique waitlist position for an event, computed under the
 * row lock as max(existing waitlisted position) + 1.
 */
async function nextWaitlistPosition(tx: Tx, eventId: number): Promise<number> {
  const [{ pos }] = await tx
    .select({
      pos: sql<number>`coalesce(max(${groupEventRsvpsTable.waitlistPosition}), 0) + 1`,
    })
    .from(groupEventRsvpsTable)
    .where(
      and(
        eq(groupEventRsvpsTable.eventId, eventId),
        eq(groupEventRsvpsTable.rsvpStatus, "waitlisted"),
      ),
    );
  return Number(pos);
}

/**
 * Re-compact waitlist positions to a contiguous 1..N sequence in queue order.
 * Called after any removal/promotion that leaves gaps. Runs under the row lock.
 */
async function compactWaitlistPositions(tx: Tx, eventId: number): Promise<void> {
  const waiting = await tx
    .select({ id: groupEventRsvpsTable.id })
    .from(groupEventRsvpsTable)
    .where(
      and(
        eq(groupEventRsvpsTable.eventId, eventId),
        eq(groupEventRsvpsTable.rsvpStatus, "waitlisted"),
      ),
    )
    .orderBy(asc(groupEventRsvpsTable.waitlistPosition));

  for (let i = 0; i < waiting.length; i++) {
    const desired = i + 1;
    await tx
      .update(groupEventRsvpsTable)
      .set({ waitlistPosition: desired })
      .where(eq(groupEventRsvpsTable.id, waiting[i].id));
  }
}

/**
 * Capacity-aware waitlist promotion — the SINGLE common promotion path used by
 * every capacity-releasing transition (RSVP cancel/downgrade, guest-count
 * reduction, and all organizer actions).
 *
 * Behaviour:
 *  - Reads the FIRST active waitlisted RSVP (lowest waitlistPosition) under the
 *    lock and computes its full party size (1 + guestCount).
 *  - Promotes it to going ONLY if the party fits within remaining capacity.
 *  - If the first party does NOT fit, promotion STOPS — the oversized party is
 *    left queued and NOT skipped (strict FIFO queue order is preserved).
 *  - When the event has no attendee limit, promotion is a no-op (nobody is ever
 *    waitlisted for an unlimited event).
 *  - Loops to promote multiple small parties if capacity allows and the queue
 *    head keeps fitting.
 *  - Compacts waitlist positions afterwards so the queue stays 1..N contiguous.
 *
 * Counter effects: each promotion does rsvpCount +1, waitlistCount -1.
 *
 * @returns number of attendees promoted (0 when none fit / none waiting).
 */
async function promoteWaitlistIfFits(
  tx: Tx,
  event: { id: number; attendeeLimit: number | null; waitlistEnabled: boolean },
  opts?: { excludeUserId?: number },
): Promise<number> {
  // Unlimited events never hold a waitlist.
  if (!event.waitlistEnabled || event.attendeeLimit === null) return 0;

  const excludeUserId = opts?.excludeUserId;
  let promoted = 0;

  // Promote as many queue-head parties as fit, strictly in order.
  // Stop at the first party that does not fit (do not skip it).
  // Bounded loop guard against pathological data.
  for (let guard = 0; guard < 10000; guard++) {
    const waiting = await tx
      .select({
        id: groupEventRsvpsTable.id,
        userId: groupEventRsvpsTable.userId,
        guestCount: groupEventRsvpsTable.guestCount,
      })
      .from(groupEventRsvpsTable)
      .where(
        and(
          eq(groupEventRsvpsTable.eventId, event.id),
          eq(groupEventRsvpsTable.rsvpStatus, "waitlisted"),
        ),
      )
      .orderBy(asc(groupEventRsvpsTable.waitlistPosition));

    // The queue head is the first waitlisted party. When excludeUserId is set
    // (e.g. an organizer just moved that user TO the waitlist and must not be
    // instantly re-promoted), skip that specific user for consideration as the
    // head — but only that user; queue order for everyone else is preserved.
    const firstWaiting = waiting.find((w) => w.userId !== excludeUserId);

    if (!firstWaiting) break;

    const occupied = await occupiedGoingSeats(tx, event.id);
    const partySeats = effectiveSeats(firstWaiting);

    if (!partyFits(event.attendeeLimit, occupied, partySeats)) {
      // Queue head does not fit — preserve FIFO, do not skip. Stop.
      break;
    }

    await tx
      .update(groupEventRsvpsTable)
      .set({ rsvpStatus: "going", waitlistPosition: null, attendanceStatus: null })
      .where(eq(groupEventRsvpsTable.id, firstWaiting.id));

    await tx
      .update(groupEventsTable)
      .set({
        rsvpCount: sql`${groupEventsTable.rsvpCount} + 1`,
        waitlistCount: sql`greatest(${groupEventsTable.waitlistCount} - 1, 0)`,
      })
      .where(eq(groupEventsTable.id, event.id));

    promoted++;
  }

  // Keep the queue contiguous after any promotions.
  if (promoted > 0) {
    await compactWaitlistPositions(tx, event.id);
  }

  return promoted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute an RSVP operation with all policy enforcement and counter-safe
 * transactional mutations.
 *
 * Returns RsvpResult: { ok: true, rsvpStatus, rsvpCount, waitlisted, waitlistPosition }
 *                  or { ok: false, status, error, code? }
 */
export async function executeGroupEventRsvp(ctx: RsvpContext): Promise<RsvpResult> {
  const { user, groupId, eventId, allowPublicRsvp = false } = ctx;
  const guestCount = ctx.guestCount ?? 0;
  const isPrivate = ctx.isPrivate ?? false;

  // ── Automatic-only waitlisting ────────────────────────────────────────────
  // Waitlisting is NEVER a member/public intent — it is a system outcome decided
  // ONLY by the locked capacity path (full AND waitlistEnabled). The OpenAPI
  // input no longer accepts "waitlisted", but we still defend against legacy or
  // malicious direct "waitlisted" input here: normalize it to a plain "going"
  // request and let the normal locked capacity decision produce the correct
  // outcome (going when space/unlimited, waitlisted only when full+enabled, or
  // 409 when full+disabled). This guarantees no stranded waitlist is ever
  // created on an available / unlimited / waitlist-disabled event.
  //
  // Organizer-driven set_waitlisted remains a separate path
  // (executeOrganizerAttendeeAction) and is unaffected.
  const requestedStatus =
    ctx.requestedStatus === "waitlisted" ? "going" : ctx.requestedStatus;

  // ── 1. Suspended user check ───────────────────────────────────────────────
  if (user.accountStatus && user.accountStatus !== "active") {
    return { ok: false, status: 403, error: "Your account is not active" };
  }

  // ── 2. Group load & lifecycle gate ───────────────────────────────────────
  const [group] = await db
    .select({
      id: groupsTable.id,
      status: groupsTable.status,
      privacy: groupsTable.privacy,
      groupType: groupsTable.groupType,
    })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));

  if (!group || group.status === "deleted") {
    return { ok: false, status: 404, error: "Group not found" };
  }
  if (group.status === "suspended" || group.status === "hidden") {
    return { ok: false, status: 403, error: "This group is not accepting RSVPs at this time" };
  }

  // ── 3. Visibility / membership check ─────────────────────────────────────
  const memberRole = await getGroupMemberRoleLocal(groupId, user.id);
  const isPlatformAdmin = user.role === "admin";

  if (group.privacy === "private" && !memberRole && !isPlatformAdmin && !allowPublicRsvp) {
    return { ok: false, status: 403, error: "Join this group to RSVP to events" };
  }

  // ── 4. Event load ─────────────────────────────────────────────────────────
  const [event] = await db
    .select()
    .from(groupEventsTable)
    .where(
      and(
        eq(groupEventsTable.id, eventId),
        eq(groupEventsTable.groupId, groupId),
        eq(groupEventsTable.status, "active"),
      ),
    );

  if (!event) {
    return { ok: false, status: 404, error: "Event not found" };
  }

  // ── 4a. Event-level private visibility gate ──────────────────────────────
  // group_events.visibility="private" means ACTIVE MEMBERS ONLY, independent of
  // the parent group's privacy. A private event inside a PUBLIC group/Meetup is
  // still members-only. Authorized viewers: any active member (owner/admin/
  // moderator/member) OR a platform admin.
  //
  // This holds even when allowPublicRsvp=true (public projected RSVP path): the
  // projected feed never surfaces private events, so a projected RSVP against a
  // private event must be treated as not-found — do NOT leak its existence or
  // let a non-member RSVP through. We return 404 in that case (consistent with
  // the projection never resolving the event), and 403 on the direct group
  // route where the caller already knows the group/event id.
  const eventIsPrivate = event.visibility === "private";
  // The event creator/organizer retains access even without an active membership
  // (reviewer requirement). Platform admins are always authorized too.
  const isEventCreator = event.createdByUserId === user.id;
  const isPrivilegedForPrivateEvent = isPlatformAdmin || isEventCreator;
  const isAuthorizedForPrivateEvent = isPrivilegedForPrivateEvent || memberRole !== null;

  if (allowPublicRsvp && event.visibility !== "public") {
    // Projected/public RSVP: any non-public event is invisible → not found.
    return { ok: false, status: 404, error: "Event not found" };
  }
  if (eventIsPrivate && !isAuthorizedForPrivateEvent) {
    // Direct group route on a private event by a non-member/non-admin.
    return { ok: false, status: 403, error: "Join this group to RSVP to events" };
  }

  // ── 5. RSVP window — cancellations bypass ────────────────────────────────
  const isCancellation =
    requestedStatus === "not_going" || requestedStatus === "cancelled";
  if (!isCancellation) {
    const now = new Date();
    if (event.rsvpOpensAt && now < event.rsvpOpensAt) {
      return { ok: false, status: 400, error: "RSVPs are not open yet" };
    }
    if (event.rsvpClosesAt && now > event.rsvpClosesAt) {
      return { ok: false, status: 400, error: "RSVPs have closed for this event" };
    }
  }

  // ── 6. Block check against event creator ─────────────────────────────────
  if (event.createdByUserId !== user.id) {
    const blocked = await isBlockedLocal(user.id, event.createdByUserId);
    if (blocked) {
      return { ok: false, status: 403, error: "Cannot RSVP to this event" };
    }
  }

  // ── 7. Guest count validation ─────────────────────────────────────────────
  if (guestCount > 0 && !event.allowGuests) {
    return { ok: false, status: 400, error: "This event does not allow guests" };
  }
  if (event.maxGuestsPerRsvp !== null && guestCount > (event.maxGuestsPerRsvp ?? 0)) {
    return {
      ok: false,
      status: 400,
      error: `Maximum ${event.maxGuestsPerRsvp} guests allowed per RSVP`,
    };
  }

  // ── 8. Paid-event guard (new attending RSVPs only) ────────────────────────
  const isAttendingRequest =
    requestedStatus === "going" || requestedStatus === "waitlisted";
  if (event.isPaid && isAttendingRequest) {
    return {
      ok: false,
      status: 409,
      code: "PAID_EVENT_CHECKOUT_UNAVAILABLE",
      error:
        "This event requires payment. Online checkout is not yet available — please contact the organizer.",
    };
  }

  // ── 9. Transactional RSVP mutation with FOR UPDATE row lock ──────────────
  const result = await db.transaction(async (tx) => {
    // Lock the event row to prevent concurrent capacity races
    const [lockedEvent] = await tx
      .select()
      .from(groupEventsTable)
      .where(eq(groupEventsTable.id, eventId))
      .for("update");

    if (!lockedEvent) {
      return { ok: false as const, status: 404, error: "Event not found" };
    }

    // Re-verify the event-visibility gate under the lock to close the TOCTOU
    // window. Two independent conditions can change between preflight and lock:
    //   (a) the event's visibility (public↔private), and
    //   (b) the user's group membership (they may have been removed/deactivated).
    //
    // For a projected/public RSVP, a non-public event is not found.
    if (allowPublicRsvp && lockedEvent.visibility !== "public") {
      return { ok: false as const, status: 404, error: "Event not found" };
    }
    // For a private event, re-authorize AUTHORITATIVELY under the lock. Platform
    // admins and the event creator remain authorized without a membership row;
    // everyone else must have an ACTIVE membership *as of the lock* — we do NOT
    // trust the pre-transaction memberRole, which may now be stale (e.g. the
    // user was removed between preflight and lock).
    if (lockedEvent.visibility === "private") {
      let authorizedUnderLock = isPrivilegedForPrivateEvent;
      if (!authorizedUnderLock) {
        authorizedUnderLock = await isActiveMemberTx(tx, groupId, user.id);
      }
      if (!authorizedUnderLock) {
        return {
          ok: false as const,
          status: 403,
          error: "Join this group to RSVP to events",
        };
      }
    }

    // Re-read the existing RSVP inside the transaction
    const [existing] = await tx
      .select()
      .from(groupEventRsvpsTable)
      .where(
        and(
          eq(groupEventRsvpsTable.eventId, eventId),
          eq(groupEventRsvpsTable.userId, user.id),
        ),
      );

    // ── Cancellation branch ───────────────────────────────────────────────
    if (isCancellation) {
      if (!existing) {
        return {
          ok: true as const,
          rsvpStatus: null as string | null,
          rsvpCount: lockedEvent.rsvpCount,
          waitlisted: false,
          waitlistPosition: null as number | null,
        };
      }

      const wasGoing = existing.rsvpStatus === "going";
      const wasWaitlisted = existing.rsvpStatus === "waitlisted";

      await tx
        .delete(groupEventRsvpsTable)
        .where(eq(groupEventRsvpsTable.id, existing.id));

      if (wasGoing) {
        await tx
          .update(groupEventsTable)
          .set({ rsvpCount: sql`greatest(${groupEventsTable.rsvpCount} - 1, 0)` })
          .where(eq(groupEventsTable.id, eventId));

        // Capacity-releasing transition → run the common promotion path.
        await promoteWaitlistIfFits(tx, lockedEvent);
      } else if (wasWaitlisted) {
        await tx
          .update(groupEventsTable)
          .set({ waitlistCount: sql`greatest(${groupEventsTable.waitlistCount} - 1, 0)` })
          .where(eq(groupEventsTable.id, eventId));
        // Removing a waitlisted party leaves a gap → compact positions.
        await compactWaitlistPositions(tx, eventId);
      }

      const [ev] = await tx
        .select()
        .from(groupEventsTable)
        .where(eq(groupEventsTable.id, eventId));

      return {
        ok: true as const,
        rsvpStatus: null as string | null,
        rsvpCount: ev.rsvpCount,
        waitlisted: false,
        waitlistPosition: null as number | null,
      };
    }

    // ── Update existing RSVP ─────────────────────────────────────────────
    // Every existing-RSVP transition computes effective occupied seats under the
    // event-row lock, EXCLUDING this RSVP's own current going party, then
    // validates the requested new party size (1 + guestCount).
    if (existing) {
      const wasGoing = existing.rsvpStatus === "going";
      const wasWaitlisted = existing.rsvpStatus === "waitlisted";
      const becomingGoing = requestedStatus === "going";
      const becomingWaitlisted = requestedStatus === "waitlisted";

      // ── Requested GOING (from interested / waitlisted / cancelled / not_going,
      //    or a guest-count change on an already-going RSVP) ──────────────────
      if (becomingGoing) {
        const newParty = 1 + guestCount;
        // Occupied seats EXCLUDING this RSVP's own current going contribution.
        const occupied = await occupiedGoingSeats(tx, eventId, existing.id);
        const fits = partyFits(lockedEvent.attendeeLimit, occupied, newParty);

        if (fits) {
          // Seat as going.
          await tx
            .update(groupEventRsvpsTable)
            .set({
              rsvpStatus: "going",
              isPrivate,
              guestCount,
              waitlistPosition: null,
              attendanceStatus: null,
            })
            .where(eq(groupEventRsvpsTable.id, existing.id));

          if (!wasGoing) {
            await tx
              .update(groupEventsTable)
              .set({ rsvpCount: sql`${groupEventsTable.rsvpCount} + 1` })
              .where(eq(groupEventsTable.id, eventId));
          }
          if (wasWaitlisted) {
            await tx
              .update(groupEventsTable)
              .set({
                waitlistCount: sql`greatest(${groupEventsTable.waitlistCount} - 1, 0)`,
              })
              .where(eq(groupEventsTable.id, eventId));
            // Leaving the queue leaves a gap → compact.
            await compactWaitlistPositions(tx, eventId);
          }
          // A guest-count REDUCTION on an already-going RSVP frees seats →
          // run the common promotion path (no-op when nothing frees up).
          if (wasGoing && newParty < effectiveSeats(existing)) {
            await promoteWaitlistIfFits(tx, lockedEvent);
          }

          const [ev] = await tx
            .select()
            .from(groupEventsTable)
            .where(eq(groupEventsTable.id, eventId));

          return {
            ok: true as const,
            rsvpStatus: "going",
            rsvpCount: ev.rsvpCount,
            waitlisted: false,
            waitlistPosition: null as number | null,
          };
        }

        // Does NOT fit.
        if (lockedEvent.waitlistEnabled) {
          // Downgrade/keep on the waitlist atomically.
          let waitlistPosition = wasWaitlisted ? existing.waitlistPosition ?? null : null;
          if (waitlistPosition === null) {
            waitlistPosition = await nextWaitlistPosition(tx, eventId);
          }

          await tx
            .update(groupEventRsvpsTable)
            .set({
              rsvpStatus: "waitlisted",
              isPrivate,
              guestCount,
              waitlistPosition,
              attendanceStatus: null,
            })
            .where(eq(groupEventRsvpsTable.id, existing.id));

          if (wasGoing) {
            // Was going, now bumped to waitlist (guest-count increase overflow).
            await tx
              .update(groupEventsTable)
              .set({
                rsvpCount: sql`greatest(${groupEventsTable.rsvpCount} - 1, 0)`,
                waitlistCount: sql`${groupEventsTable.waitlistCount} + 1`,
              })
              .where(eq(groupEventsTable.id, eventId));
            // Freed the going seat → someone smaller may now fit.
            await promoteWaitlistIfFits(tx, lockedEvent);
          } else if (!wasWaitlisted) {
            await tx
              .update(groupEventsTable)
              .set({ waitlistCount: sql`${groupEventsTable.waitlistCount} + 1` })
              .where(eq(groupEventsTable.id, eventId));
          }

          const [ev] = await tx
            .select()
            .from(groupEventsTable)
            .where(eq(groupEventsTable.id, eventId));

          return {
            ok: true as const,
            rsvpStatus: "waitlisted",
            rsvpCount: ev.rsvpCount,
            waitlisted: true,
            waitlistPosition,
          };
        }

        // No waitlist and does not fit → capacity error, no mutation.
        return {
          ok: false as const,
          status: 409,
          code: "EVENT_AT_CAPACITY",
          error: "This event is at capacity",
        };
      }

      // ── Requested WAITLISTED / INTERESTED / other (non-going) ─────────────
      // These never consume a going seat, so no capacity check is required.
      let waitlistPosition = wasWaitlisted ? existing.waitlistPosition ?? null : null;
      if (becomingWaitlisted && waitlistPosition === null) {
        waitlistPosition = await nextWaitlistPosition(tx, eventId);
      }

      await tx
        .update(groupEventRsvpsTable)
        .set({
          rsvpStatus: requestedStatus,
          isPrivate,
          guestCount,
          waitlistPosition: becomingWaitlisted ? waitlistPosition : null,
          attendanceStatus: null,
        })
        .where(eq(groupEventRsvpsTable.id, existing.id));

      // Counter repair.
      if (wasGoing) {
        await tx
          .update(groupEventsTable)
          .set({ rsvpCount: sql`greatest(${groupEventsTable.rsvpCount} - 1, 0)` })
          .where(eq(groupEventsTable.id, eventId));
      }
      if (wasWaitlisted && !becomingWaitlisted) {
        await tx
          .update(groupEventsTable)
          .set({
            waitlistCount: sql`greatest(${groupEventsTable.waitlistCount} - 1, 0)`,
          })
          .where(eq(groupEventsTable.id, eventId));
        await compactWaitlistPositions(tx, eventId);
      }
      if (!wasWaitlisted && becomingWaitlisted) {
        await tx
          .update(groupEventsTable)
          .set({ waitlistCount: sql`${groupEventsTable.waitlistCount} + 1` })
          .where(eq(groupEventsTable.id, eventId));
      }

      // Leaving "going" frees a seat → run the common promotion path so the
      // prior FIFO waitlist head can take the vacated seat. When we ourselves
      // just joined the waitlist we pass excludeUserId so the just-moved member
      // is NOT immediately re-promoted ahead of the existing queue.
      if (wasGoing) {
        await promoteWaitlistIfFits(tx, lockedEvent, {
          excludeUserId: becomingWaitlisted ? user.id : undefined,
        });
      }

      const [ev] = await tx
        .select()
        .from(groupEventsTable)
        .where(eq(groupEventsTable.id, eventId));

      return {
        ok: true as const,
        rsvpStatus: requestedStatus,
        rsvpCount: ev.rsvpCount,
        waitlisted: becomingWaitlisted,
        waitlistPosition: becomingWaitlisted ? waitlistPosition : null,
      };
    }

    // ── New RSVP — check capacity under lock ──────────────────────────────
    let finalStatus = requestedStatus;
    let waitlistPosition: number | null = null;

    if (requestedStatus === "going" && lockedEvent.attendeeLimit !== null) {
      const occupiedSeats = await occupiedGoingSeats(tx, eventId);
      const newSeats = 1 + guestCount;

      if (!partyFits(lockedEvent.attendeeLimit, occupiedSeats, newSeats)) {
        if (!lockedEvent.waitlistEnabled) {
          // Full AND waitlist disabled → capacity error, no mutation. This
          // matches the existing-RSVP going branch and guarantees a direct
          // "waitlisted" request (normalized to going) never creates a stranded
          // waitlist row on a waitlist-disabled event.
          return {
            ok: false as const,
            status: 409,
            code: "EVENT_AT_CAPACITY",
            error: "This event is at capacity",
          };
        }

        // Full AND waitlist enabled → automatic waitlisting. Assign a unique
        // waitlist position (max existing + 1, under lock).
        finalStatus = "waitlisted";
        waitlistPosition = await nextWaitlistPosition(tx, eventId);
      }
    }

    const inserted = await tx
      .insert(groupEventRsvpsTable)
      .values({
        eventId,
        groupId,
        userId: user.id,
        rsvpStatus: finalStatus,
        isPrivate,
        guestCount,
        waitlistPosition,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length) {
      if (finalStatus === "going") {
        await tx
          .update(groupEventsTable)
          .set({ rsvpCount: sql`${groupEventsTable.rsvpCount} + 1` })
          .where(eq(groupEventsTable.id, eventId));
      } else if (finalStatus === "waitlisted") {
        await tx
          .update(groupEventsTable)
          .set({ waitlistCount: sql`${groupEventsTable.waitlistCount} + 1` })
          .where(eq(groupEventsTable.id, eventId));
      }
    }

    const [ev] = await tx
      .select()
      .from(groupEventsTable)
      .where(eq(groupEventsTable.id, eventId));

    return {
      ok: true as const,
      rsvpStatus: inserted.length ? finalStatus : (null as string | null),
      rsvpCount: ev.rsvpCount,
      waitlisted: finalStatus === "waitlisted" && !!inserted.length,
      waitlistPosition:
        finalStatus === "waitlisted" && inserted.length ? waitlistPosition : null,
    };
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Organizer Attendee Action Service
// ─────────────────────────────────────────────────────────────────────────────

export type OrganizerAttendeeAction =
  | "set_going"
  | "set_waitlisted"
  | "check_in"
  | "mark_no_show"
  | "mark_not_coming"
  | "cancel"
  | "set_guest_count";

export type OrganizerActionResult =
  | {
      ok: true;
      rsvp: {
        userId: number;
        rsvpStatus: string;
        attendanceStatus: string | null;
        guestCount: number;
        waitlistPosition: number | null;
      };
    }
  | { ok: false; status: number; error: string };

/**
 * Execute an organizer attendee action with transactional counter-safe logic.
 * Enforces capacity when moving to going; promotes waitlist when cancelling a going RSVP.
 */
export async function executeOrganizerAttendeeAction(opts: {
  eventId: number;
  groupId: number;
  targetUserId: number;
  action: OrganizerAttendeeAction;
  guestCount?: number;
}): Promise<OrganizerActionResult> {
  const { eventId, groupId, targetUserId, action, guestCount } = opts;

  const result = await db.transaction(async (tx) => {
    // Lock event row
    const [lockedEvent] = await tx
      .select()
      .from(groupEventsTable)
      .where(and(eq(groupEventsTable.id, eventId), eq(groupEventsTable.groupId, groupId)))
      .for("update");

    if (!lockedEvent) {
      return { ok: false as const, status: 404, error: "Event not found" };
    }

    const [rsvp] = await tx
      .select()
      .from(groupEventRsvpsTable)
      .where(
        and(
          eq(groupEventRsvpsTable.eventId, eventId),
          eq(groupEventRsvpsTable.userId, targetUserId),
        ),
      );

    if (!rsvp) {
      return { ok: false as const, status: 404, error: "Attendee RSVP not found" };
    }

    const wasGoing = rsvp.rsvpStatus === "going";
    const wasWaitlisted = rsvp.rsvpStatus === "waitlisted";

    const update: Partial<typeof groupEventRsvpsTable.$inferInsert> = {};

    // Deferred post-write bookkeeping — set inside the switch, applied after the
    // RSVP row itself is written so occupancy/queue reads see committed state.
    let compactAfter = false;
    let runPromotion = false;
    let promoteExcludingUserId: number | undefined;

    switch (action) {
      case "set_going": {
        // Check capacity if there's a limit — exclude the target's own current
        // going contribution so re-affirming going never falsely trips.
        if (lockedEvent.attendeeLimit !== null) {
          const occupiedSeats = await occupiedGoingSeats(tx, eventId, rsvp.id);
          const newSeats = 1 + (rsvp.guestCount ?? 0);
          if (!partyFits(lockedEvent.attendeeLimit, occupiedSeats, newSeats)) {
            // Does not fit — keep/set waitlisted rather than overselling.
            let pos = wasWaitlisted ? rsvp.waitlistPosition ?? null : null;
            if (pos === null) pos = await nextWaitlistPosition(tx, eventId);
            update.rsvpStatus = "waitlisted";
            update.attendanceStatus = null;
            update.waitlistPosition = pos;
            if (wasGoing) {
              await tx
                .update(groupEventsTable)
                .set({
                  rsvpCount: sql`greatest(${groupEventsTable.rsvpCount} - 1, 0)`,
                  waitlistCount: sql`${groupEventsTable.waitlistCount} + 1`,
                })
                .where(eq(groupEventsTable.id, eventId));
              // The demoted attendee vacated a going seat → run the common
              // promotion path (deferred to after the row write) so the prior
              // FIFO waitlist head can take it, excluding the just-demoted user
              // so they are not immediately re-promoted.
              runPromotion = true;
              promoteExcludingUserId = targetUserId;
            } else if (!wasWaitlisted) {
              await tx
                .update(groupEventsTable)
                .set({ waitlistCount: sql`${groupEventsTable.waitlistCount} + 1` })
                .where(eq(groupEventsTable.id, eventId));
            }
            break;
          }
        }

        update.rsvpStatus = "going";
        update.attendanceStatus = null;
        update.waitlistPosition = null;

        // Repair counters
        if (wasWaitlisted) {
          await tx
            .update(groupEventsTable)
            .set({
              waitlistCount: sql`greatest(${groupEventsTable.waitlistCount} - 1, 0)`,
              rsvpCount: sql`${groupEventsTable.rsvpCount} + 1`,
            })
            .where(eq(groupEventsTable.id, eventId));
          // Removing from queue leaves a gap — compact after the row update below.
          compactAfter = true;
        } else if (!wasGoing) {
          await tx
            .update(groupEventsTable)
            .set({ rsvpCount: sql`${groupEventsTable.rsvpCount} + 1` })
            .where(eq(groupEventsTable.id, eventId));
        }
        break;
      }

      case "set_waitlisted": {
        if (!wasWaitlisted) {
          // Assign next waitlist position
          update.waitlistPosition = await nextWaitlistPosition(tx, eventId);
        }
        update.rsvpStatus = "waitlisted";
        update.attendanceStatus = null;

        if (wasGoing) {
          await tx
            .update(groupEventsTable)
            .set({
              rsvpCount: sql`greatest(${groupEventsTable.rsvpCount} - 1, 0)`,
              waitlistCount: sql`${groupEventsTable.waitlistCount} + 1`,
            })
            .where(eq(groupEventsTable.id, eventId));
          // The moved user vacated a going seat. Promote OTHERS from the queue
          // if they now fit — but the just-moved user must NOT be re-promoted in
          // the same action. Promotion is deferred until AFTER the RSVP row is
          // written as waitlisted (so occupancy reflects committed state), and
          // excludes this user explicitly.
          runPromotion = true;
          promoteExcludingUserId = targetUserId;
        } else if (!wasWaitlisted) {
          await tx
            .update(groupEventsTable)
            .set({ waitlistCount: sql`${groupEventsTable.waitlistCount} + 1` })
            .where(eq(groupEventsTable.id, eventId));
        }
        break;
      }

      case "check_in":
        update.attendanceStatus = "checked_in";
        break;

      case "mark_no_show":
        update.attendanceStatus = "no_show";
        break;

      case "mark_not_coming": {
        update.attendanceStatus = "not_coming";
        update.rsvpStatus = "not_going";
        update.waitlistPosition = null;
        if (wasGoing) {
          await tx
            .update(groupEventsTable)
            .set({ rsvpCount: sql`greatest(${groupEventsTable.rsvpCount} - 1, 0)` })
            .where(eq(groupEventsTable.id, eventId));
          // Capacity-releasing → common promotion path (deferred to after write).
          runPromotion = true;
        } else if (wasWaitlisted) {
          await tx
            .update(groupEventsTable)
            .set({ waitlistCount: sql`greatest(${groupEventsTable.waitlistCount} - 1, 0)` })
            .where(eq(groupEventsTable.id, eventId));
          compactAfter = true;
        }
        break;
      }

      case "cancel": {
        update.rsvpStatus = "cancelled";
        update.waitlistPosition = null;
        if (wasGoing) {
          await tx
            .update(groupEventsTable)
            .set({ rsvpCount: sql`greatest(${groupEventsTable.rsvpCount} - 1, 0)` })
            .where(eq(groupEventsTable.id, eventId));
          runPromotion = true;
        } else if (wasWaitlisted) {
          await tx
            .update(groupEventsTable)
            .set({ waitlistCount: sql`greatest(${groupEventsTable.waitlistCount} - 1, 0)` })
            .where(eq(groupEventsTable.id, eventId));
          compactAfter = true;
        }
        break;
      }

      case "set_guest_count": {
        if (guestCount === undefined || guestCount === null) {
          return {
            ok: false as const,
            status: 400,
            error: "guestCount is required for set_guest_count",
          };
        }
        if (guestCount > 0 && !lockedEvent.allowGuests) {
          return { ok: false as const, status: 400, error: "This event does not allow guests" };
        }
        if (
          lockedEvent.maxGuestsPerRsvp !== null &&
          guestCount > (lockedEvent.maxGuestsPerRsvp ?? 0)
        ) {
          return {
            ok: false as const,
            status: 400,
            error: `Maximum ${lockedEvent.maxGuestsPerRsvp} guests allowed per RSVP`,
          };
        }

        const oldSeats = 1 + (rsvp.guestCount ?? 0);
        const newSeats = 1 + guestCount;

        // Capacity only matters for a GOING attendee whose party is GROWING.
        if (wasGoing && newSeats > oldSeats && lockedEvent.attendeeLimit !== null) {
          // Occupied EXCLUDING this attendee's own current going party.
          const occupied = await occupiedGoingSeats(tx, eventId, rsvp.id);
          if (!partyFits(lockedEvent.attendeeLimit, occupied, newSeats)) {
            return {
              ok: false as const,
              status: 409,
              error: "Event is at capacity; cannot increase guest count",
            };
          }
        }

        update.guestCount = guestCount;

        // A guest-count REDUCTION on a going attendee frees seats → promote.
        if (wasGoing && newSeats < oldSeats) {
          runPromotion = true;
        }
        break;
      }
    }

    const [updatedRsvp] = await tx
      .update(groupEventRsvpsTable)
      .set(update)
      .where(eq(groupEventRsvpsTable.id, rsvp.id))
      .returning();

    // ── Deferred post-write bookkeeping (occupancy/queue now reflect the row) ─
    if (runPromotion) {
      // Common capacity-aware promotion path. excludeUserId guarantees a
      // just-waitlisted user is not instantly re-promoted in the same action.
      await promoteWaitlistIfFits(tx, lockedEvent, {
        excludeUserId: promoteExcludingUserId,
      });
    } else if (compactAfter) {
      await compactWaitlistPositions(tx, eventId);
    }

    return {
      ok: true as const,
      rsvp: {
        userId: targetUserId,
        rsvpStatus: updatedRsvp.rsvpStatus,
        attendanceStatus: updatedRsvp.attendanceStatus ?? null,
        guestCount: updatedRsvp.guestCount,
        waitlistPosition: updatedRsvp.waitlistPosition ?? null,
      },
    };
  });

  return result;
}

