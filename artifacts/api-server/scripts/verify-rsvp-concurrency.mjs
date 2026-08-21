#!/usr/bin/env node
/**
 * One-off REAL-DATABASE concurrency verification for the group-event RSVP
 * capacity/waitlist invariants.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Vitest suite mocks the database. A mock can verify the service REQUESTS a
 * row lock (it asserts `.for('update')` is issued) and that every transition's
 * branch/counter math is correct — but it CANNOT prove that PostgreSQL actually
 * serializes concurrent writers. Only a real Postgres with genuinely concurrent
 * transactions can prove that `SELECT ... FOR UPDATE` prevents overselling.
 *
 * This script does exactly that, in isolation, then cleans up after itself.
 *
 * WHAT IT DOES
 * ────────────
 *  1. Creates a temporary group + a capacity-limited event (attendeeLimit = N)
 *     with waitlist ENABLED.
 *  2. Fires (N + EXTRA) simultaneous RSVP transactions, each replicating the
 *     production capacity algorithm:
 *        BEGIN
 *        SELECT ... FROM group_events WHERE id = $e FOR UPDATE          -- row lock
 *        SELECT sum(1 + guest_count) FROM group_event_rsvps
 *          WHERE event_id = $e AND rsvp_status = 'going'                 -- occupancy
 *        if fits  -> INSERT going,      group_events.rsvp_count      += 1
 *        else     -> INSERT waitlisted, group_events.waitlist_count  += 1
 *        COMMIT
 *  3. Asserts the invariants:
 *        - going rows          === N            (never oversold)
 *        - waitlisted rows     === EXTRA
 *        - group_events.rsvp_count      === N
 *        - group_events.waitlist_count  === EXTRA
 *        - waitlist positions are a contiguous 1..EXTRA set (unique, no gaps)
 *  4. Deletes all temporary rows (event, rsvps, group, users) in a finally block.
 *
 * SAFETY
 * ──────
 *  - All inserted rows use a unique run tag so cleanup is exact.
 *  - Cleanup runs even on failure.
 *  - Uses its own connection pool; does not touch application state.
 *
 * USAGE
 * ─────
 *   cd artifacts/api-server
 *   DATABASE_URL=postgres://...  node scripts/verify-rsvp-concurrency.mjs
 *
 *   Optional env:
 *     RSVP_LIMIT   attendee limit / expected going count   (default 5)
 *     RSVP_EXTRA   surplus concurrent requests -> waitlist (default 5)
 *
 * EXIT CODE 0 on success, 1 on any invariant violation or error.
 */

import { pool } from "@workspace/db";

const LIMIT = Number(process.env.RSVP_LIMIT ?? 5);
const EXTRA = Number(process.env.RSVP_EXTRA ?? 5);
const TOTAL = LIMIT + EXTRA;
const RUN_TAG = `concurrency-verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function log(...args) {
  console.log("[verify-rsvp]", ...args);
}

/**
 * Run one RSVP attempt for a specific user, replicating the production
 * capacity/waitlist algorithm under a FOR UPDATE lock, in its own transaction.
 */
async function attemptRsvp(eventId, groupId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Lock the event row — this is the serialization point.
    const evRes = await client.query(
      `SELECT id, attendee_limit, waitlist_enabled
         FROM group_events
        WHERE id = $1
        FOR UPDATE`,
      [eventId],
    );
    const ev = evRes.rows[0];
    if (!ev) throw new Error("event vanished mid-run");

    // 2. Occupancy under the lock: sum of (1 + guest_count) over going rows.
    const occRes = await client.query(
      `SELECT coalesce(sum(1 + guest_count), 0)::int AS occupied
         FROM group_event_rsvps
        WHERE event_id = $1 AND rsvp_status = 'going'`,
      [eventId],
    );
    const occupied = occRes.rows[0].occupied;
    const newSeats = 1; // no guests in this test
    const fits =
      ev.attendee_limit === null || occupied + newSeats <= ev.attendee_limit;

    if (fits) {
      await client.query(
        `INSERT INTO group_event_rsvps
           (event_id, group_id, user_id, rsvp_status, is_private, guest_count)
         VALUES ($1, $2, $3, 'going', false, 0)`,
        [eventId, groupId, userId],
      );
      await client.query(
        `UPDATE group_events SET rsvp_count = rsvp_count + 1 WHERE id = $1`,
        [eventId],
      );
    } else if (ev.waitlist_enabled) {
      // Unique waitlist position assigned under the lock: max + 1.
      const posRes = await client.query(
        `SELECT coalesce(max(waitlist_position), 0) + 1 AS pos
           FROM group_event_rsvps
          WHERE event_id = $1 AND rsvp_status = 'waitlisted'`,
        [eventId],
      );
      const pos = posRes.rows[0].pos;
      await client.query(
        `INSERT INTO group_event_rsvps
           (event_id, group_id, user_id, rsvp_status, is_private, guest_count, waitlist_position)
         VALUES ($1, $2, $3, 'waitlisted', false, 0, $4)`,
        [eventId, groupId, userId, pos],
      );
      await client.query(
        `UPDATE group_events SET waitlist_count = waitlist_count + 1 WHERE id = $1`,
        [eventId],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  let groupId;
  let eventId;
  const userIds = [];

  try {
    log(`run tag: ${RUN_TAG}`);
    log(`attendee limit = ${LIMIT}, concurrent attempts = ${TOTAL} (expect ${EXTRA} waitlisted)`);

    // ── Seed: users ──────────────────────────────────────────────────────────
    for (let i = 0; i < TOTAL; i++) {
      const email = `${RUN_TAG}-u${i}@example.invalid`;
      const uRes = await pool.query(
        `INSERT INTO users (role, name, email, password_hash, account_status)
         VALUES ('user', $1, $2, 'x', 'active')
         RETURNING id`,
        [`${RUN_TAG} user ${i}`, email],
      );
      userIds.push(uRes.rows[0].id);
    }
    log(`created ${userIds.length} temp users`);

    // ── Seed: group ──────────────────────────────────────────────────────────
    const gRes = await pool.query(
      `INSERT INTO groups (creator_user_id, name, category, privacy, status, group_type)
       VALUES ($1, $2, 'social', 'public', 'active', 'meetup')
       RETURNING id`,
      [userIds[0], `${RUN_TAG} group`],
    );
    groupId = gRes.rows[0].id;

    // ── Seed: capacity-limited event with waitlist enabled ────────────────────
    const eRes = await pool.query(
      `INSERT INTO group_events
         (group_id, created_by_user_id, title, starts_at, status, visibility,
          attendee_limit, waitlist_enabled, rsvp_count, waitlist_count)
       VALUES ($1, $2, $3, now() + interval '1 day', 'active', 'public',
          $4, true, 0, 0)
       RETURNING id`,
      [groupId, userIds[0], `${RUN_TAG} event`, LIMIT],
    );
    eventId = eRes.rows[0].id;
    log(`created group ${groupId}, event ${eventId}`);

    // ── Fire all RSVP attempts concurrently ───────────────────────────────────
    log("firing concurrent RSVP transactions...");
    const results = await Promise.allSettled(
      userIds.map((uid) => attemptRsvp(eventId, groupId, uid)),
    );
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length) {
      for (const f of failures) console.error("  attempt error:", f.reason?.message ?? f.reason);
      throw new Error(`${failures.length} RSVP attempts threw`);
    }

    // ── Verify invariants ─────────────────────────────────────────────────────
    const going = await pool.query(
      `SELECT count(*)::int AS n FROM group_event_rsvps
        WHERE event_id = $1 AND rsvp_status = 'going'`,
      [eventId],
    );
    const waiting = await pool.query(
      `SELECT count(*)::int AS n FROM group_event_rsvps
        WHERE event_id = $1 AND rsvp_status = 'waitlisted'`,
      [eventId],
    );
    const counters = await pool.query(
      `SELECT rsvp_count, waitlist_count FROM group_events WHERE id = $1`,
      [eventId],
    );
    const positions = await pool.query(
      `SELECT waitlist_position AS p FROM group_event_rsvps
        WHERE event_id = $1 AND rsvp_status = 'waitlisted'
        ORDER BY waitlist_position`,
      [eventId],
    );

    const goingN = going.rows[0].n;
    const waitingN = waiting.rows[0].n;
    const rsvpCount = counters.rows[0].rsvp_count;
    const waitlistCount = counters.rows[0].waitlist_count;
    const posList = positions.rows.map((r) => r.p);

    const checks = [];
    const check = (name, ok, detail) => {
      checks.push({ name, ok, detail });
      log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
    };

    check("going rows never exceed capacity", goingN === LIMIT, `going=${goingN}, limit=${LIMIT}`);
    check("surplus went to waitlist", waitingN === EXTRA, `waitlisted=${waitingN}, expected=${EXTRA}`);
    check("rsvp_count matches going rows", rsvpCount === goingN, `rsvp_count=${rsvpCount}`);
    check("waitlist_count matches waitlisted rows", waitlistCount === waitingN, `waitlist_count=${waitlistCount}`);

    const uniquePositions = new Set(posList).size === posList.length;
    const contiguous = posList.every((p, i) => p === i + 1);
    check("waitlist positions unique", uniquePositions, `positions=[${posList.join(",")}]`);
    check("waitlist positions contiguous 1..N", contiguous, `positions=[${posList.join(",")}]`);

    const allOk = checks.every((c) => c.ok);
    if (!allOk) {
      throw new Error("one or more concurrency invariants FAILED (see above)");
    }
    log("ALL CONCURRENCY INVARIANTS PASSED ✔");
  } finally {
    // ── Cleanup (always) ──────────────────────────────────────────────────────
    log("cleaning up temporary rows...");
    try {
      if (eventId) {
        await pool.query(`DELETE FROM group_event_rsvps WHERE event_id = $1`, [eventId]);
        await pool.query(`DELETE FROM group_events WHERE id = $1`, [eventId]);
      }
      if (groupId) {
        await pool.query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
        await pool.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
      }
      if (userIds.length) {
        await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);
      }
      log("cleanup complete");
    } catch (cleanupErr) {
      console.error("[verify-rsvp] CLEANUP ERROR — manual cleanup may be needed for tag:", RUN_TAG);
      console.error(cleanupErr);
    }
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[verify-rsvp] FAILED:", err.message);
    process.exit(1);
  });
