#!/usr/bin/env node
/**
 * Real-Postgres concurrency verification for Creator credit invariants.
 *
 * This intentionally mirrors the production transaction boundaries and locking
 * rules. Every scenario uses disposable, run-tagged rows and cleanup always
 * runs, including after a failed assertion.
 */
import { pool } from "@workspace/db";

const RUN_TAG = `creator-credit-concurrency-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ids = { users: [], dolls: [], albums: [], requests: [] };

function log(message) {
  console.log(`[verify-creator-credits] ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  log(`PASS — ${message}`);
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function seedUser(role, suffix) {
  const result = await pool.query(
    `INSERT INTO users
       (role, name, email, password_hash, account_status, age_confirmed, rules_accepted, last_active_at)
     VALUES ($1, $2, $3, 'x', 'active', true, true, now())
     RETURNING id`,
    [role, `${RUN_TAG}-${suffix}`, `${RUN_TAG}-${suffix}@example.invalid`],
  );
  ids.users.push(result.rows[0].id);
  return result.rows[0].id;
}

async function seedCreator() {
  const userId = await seedUser("doll", "creator");
  const result = await pool.query(
    `INSERT INTO dolls
       (user_id, stage_name, city, state, application_status, verified)
     VALUES ($1, $2, 'Test City', 'TS', 'approved', true)
     RETURNING id`,
    [userId, `${RUN_TAG}-creator`],
  );
  ids.dolls.push(result.rows[0].id);
  return { userId, dollId: result.rows[0].id };
}

async function seedBalance(userId, membershipBalance, purchasedBalance) {
  await pool.query(
    `INSERT INTO credit_balances (user_id, membership_balance, purchased_balance)
     VALUES ($1, $2, $3)`,
    [userId, membershipBalance, purchasedBalance],
  );
}

async function seedAlbum(creator, albumType) {
  const result = await pool.query(
    `INSERT INTO creator_albums
       (creator_user_id, doll_id, album_type, title, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id`,
    [creator.userId, creator.dollId, albumType, `${RUN_TAG}-${albumType}`],
  );
  ids.albums.push(result.rows[0].id);
  return result.rows[0].id;
}

async function attemptAlbumUnlock(memberId, creatorId, albumId, albumType) {
  try {
    return await transaction(async (client) => {
      const balanceResult = await client.query(
        `SELECT membership_balance, purchased_balance
           FROM credit_balances
          WHERE user_id = $1
          FOR UPDATE`,
        [memberId],
      );
      const balance = balanceResult.rows[0];
      if (!balance) throw new Error("missing member balance");

      const cloudResult = await client.query(
        `SELECT id FROM creator_albums
          WHERE creator_user_id = $1 AND album_type = 'cloud_vibes'`,
        [creatorId],
      );
      const cloudId = cloudResult.rows[0]?.id;
      const cloudUnlockResult =
        albumType === "smokin_hot" && cloudId
          ? await client.query(
              `SELECT id FROM creator_album_unlocks
                WHERE member_user_id = $1 AND album_id = $2`,
              [memberId, cloudId],
            )
          : { rows: [] };
      const cost =
        albumType === "cloud_vibes" ? 25 : cloudUnlockResult.rows[0] ? 75 : 100;
      const total = balance.membership_balance + balance.purchased_balance;
      if (total < cost) return null;

      const membershipSpend = Math.min(balance.membership_balance, cost);
      const purchasedSpend = cost - membershipSpend;
      await client.query(
        `UPDATE credit_balances
            SET membership_balance = $2, purchased_balance = $3
          WHERE user_id = $1`,
        [
          memberId,
          balance.membership_balance - membershipSpend,
          balance.purchased_balance - purchasedSpend,
        ],
      );
      const unlockResult = await client.query(
        `INSERT INTO creator_album_unlocks
           (member_user_id, creator_user_id, album_id, album_type, price_credits)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [memberId, creatorId, albumId, albumType, cost],
      );
      const unlock = unlockResult.rows[0];
      if (!unlock) throw new Error("DUPLICATE_UNLOCK");
      if (albumType === "smokin_hot" && cloudId) {
        await client.query(
          `INSERT INTO creator_album_unlocks
             (member_user_id, creator_user_id, album_id, album_type, price_credits)
           VALUES ($1, $2, $3, 'cloud_vibes', 0)
           ON CONFLICT DO NOTHING`,
          [memberId, creatorId, cloudId],
        );
      }
      await client.query(
        `INSERT INTO credit_transactions
           (user_id, amount, type, description, creator_album_unlock_id)
         VALUES ($1, $2, 'spend', 'Unlocked creator album', $3)`,
        [memberId, -cost, unlock.id],
      );
      return unlock.id;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_UNLOCK") {
      const existing = await pool.query(
        `SELECT id FROM creator_album_unlocks
          WHERE member_user_id = $1 AND album_id = $2`,
        [memberId, albumId],
      );
      return existing.rows[0]?.id ?? null;
    }
    throw error;
  }
}

async function verifyDuplicateUnlock(
  memberId,
  creator,
  albumId,
  albumType,
  expectedSpend,
  expectedEntitlements,
) {
  const results = await Promise.all([
    attemptAlbumUnlock(memberId, creator.userId, albumId, albumType),
    attemptAlbumUnlock(memberId, creator.userId, albumId, albumType),
  ]);
  assert(
    results[0] === results[1],
    `${albumType} concurrent calls return one entitlement`,
  );
  const unlocks = await pool.query(
    `SELECT count(*)::int AS count, sum(price_credits)::int AS charged
       FROM creator_album_unlocks
      WHERE member_user_id = $1 AND creator_user_id = $2`,
    [memberId, creator.userId],
  );
  assert(
    unlocks.rows[0].count === expectedEntitlements,
    `${albumType} creates exactly ${expectedEntitlements} entitlement row(s)`,
  );
  assert(
    unlocks.rows[0].charged === expectedSpend,
    `${albumType} entitlement price totals ${expectedSpend} credits`,
  );
  const ledger = await pool.query(
    `SELECT count(*)::int AS count, coalesce(sum(amount), 0)::int AS amount
       FROM credit_transactions
      WHERE user_id = $1 AND description = 'Unlocked creator album'`,
    [memberId],
  );
  assert(
    ledger.rows[0].count === 1 && ledger.rows[0].amount === -expectedSpend,
    `${albumType} creates one spend ledger entry`,
  );
}

async function createCustomRequest(customerId, creator, key, price) {
  try {
    return await transaction(async (client) => {
      const balanceResult = await client.query(
        `SELECT membership_balance, purchased_balance
           FROM credit_balances WHERE user_id = $1 FOR UPDATE`,
        [customerId],
      );
      const balance = balanceResult.rows[0];
      if (
        !balance ||
        balance.membership_balance + balance.purchased_balance < price
      ) {
        return null;
      }
      const heldMembership = Math.min(balance.membership_balance, price);
      const heldPurchased = price - heldMembership;
      await client.query(
        `UPDATE credit_balances
            SET membership_balance = membership_balance - $2,
                purchased_balance = purchased_balance - $3
          WHERE user_id = $1`,
        [customerId, heldMembership, heldPurchased],
      );
      const result = await client.query(
        `INSERT INTO custom_content_requests
           (customer_user_id, creator_user_id, doll_id, idempotency_key,
            request_text, request_type, price_credits, held_membership_credits,
            held_purchased_credits, response_deadline_at)
         VALUES ($1, $2, $3, $4, $5, 'custom_photo', $6, $7, $8, now() + interval '2 hours')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          customerId,
          creator.userId,
          creator.dollId,
          key,
          `${RUN_TAG}-request`,
          price,
          heldMembership,
          heldPurchased,
        ],
      );
      const request = result.rows[0];
      if (!request) throw new Error("DUPLICATE_REQUEST");
      ids.requests.push(request.id);
      await client.query(
        `INSERT INTO credit_transactions
           (user_id, amount, type, description, custom_content_request_id, doll_id)
         VALUES ($1, $2, 'hold', 'Custom request hold', $3, $4)`,
        [customerId, -price, request.id, creator.dollId],
      );
      return request.id;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_REQUEST") {
      const existing = await pool.query(
        `SELECT id FROM custom_content_requests
          WHERE customer_user_id = $1 AND idempotency_key = $2`,
        [customerId, key],
      );
      return existing.rows[0]?.id ?? null;
    }
    throw error;
  }
}

async function reconcileRequest(requestId) {
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM custom_content_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = result.rows[0];
    if (!request || request.hold_status !== "held") return null;
    const expiredPending =
      request.status === "pending_creator_response" &&
      request.response_deadline_at < new Date();
    const expiredAccepted =
      ["accepted", "in_progress"].includes(request.status) &&
      request.delivery_deadline_at &&
      request.delivery_deadline_at < new Date();
    if (!expiredPending && !expiredAccepted) return null;
    await client.query(
      `UPDATE credit_balances
          SET membership_balance = membership_balance + $2,
              purchased_balance = purchased_balance + $3
        WHERE user_id = $1`,
      [
        request.customer_user_id,
        request.held_membership_credits,
        request.held_purchased_credits,
      ],
    );
    await client.query(
      `UPDATE custom_content_requests
          SET status = $2, hold_status = 'refunded', refunded_at = now()
        WHERE id = $1`,
      [requestId, expiredPending ? "expired_no_response" : "failed_delivery"],
    );
    await client.query(
      `INSERT INTO credit_transactions
         (user_id, amount, type, description, custom_content_request_id, doll_id)
       VALUES ($1, $2, 'refund', 'Refunded expired custom request', $3, $4)`,
      [
        request.customer_user_id,
        request.price_credits,
        requestId,
        request.doll_id,
      ],
    );
    return "refunded";
  });
}

async function acceptRequest(requestId) {
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM custom_content_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = result.rows[0];
    if (
      !request ||
      request.status !== "pending_creator_response" ||
      request.hold_status !== "held" ||
      request.response_deadline_at <= new Date()
    ) {
      return null;
    }
    await client.query(
      `UPDATE custom_content_requests
          SET status = 'accepted', accepted_at = now(),
              delivery_deadline_at = now() + interval '2 hours'
        WHERE id = $1`,
      [requestId],
    );
    return "accepted";
  });
}

async function deliverRequest(requestId) {
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM custom_content_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = result.rows[0];
    if (
      !request ||
      !["accepted", "in_progress"].includes(request.status) ||
      request.hold_status !== "held" ||
      !request.delivery_deadline_at ||
      request.delivery_deadline_at <= new Date()
    ) {
      return null;
    }
    await client.query(
      `UPDATE custom_content_requests
          SET status = 'delivered', hold_status = 'settled', delivered_at = now()
        WHERE id = $1`,
      [requestId],
    );
    await client.query(
      `UPDATE credit_balances
          SET purchased_balance = purchased_balance + $2
        WHERE user_id = $1`,
      [request.creator_user_id, request.price_credits],
    );
    await client.query(
      `INSERT INTO credit_transactions
         (user_id, amount, type, description, custom_content_request_id, doll_id)
       VALUES
         ($1, 0, 'settlement', 'Custom request delivered', $3, $4),
         ($2, $5, 'settlement', 'Custom request creator settlement', $3, $4)`,
      [
        request.customer_user_id,
        request.creator_user_id,
        requestId,
        request.doll_id,
        request.price_credits,
      ],
    );
    return "settled";
  });
}

async function adminRefund(requestId) {
  return transaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM custom_content_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = result.rows[0];
    if (!request) return null;
    if (request.hold_status === "refunded") return request.id;
    if (!["held", "settled"].includes(request.hold_status)) return null;
    await client.query(
      `UPDATE credit_balances
          SET membership_balance = membership_balance + $2,
              purchased_balance = purchased_balance + $3
        WHERE user_id = $1`,
      [
        request.customer_user_id,
        request.held_membership_credits,
        request.held_purchased_credits,
      ],
    );
    if (request.hold_status === "settled") {
      await client.query(
        `UPDATE credit_balances
            SET purchased_balance = purchased_balance - $2
          WHERE user_id = $1`,
        [request.creator_user_id, request.price_credits],
      );
    }
    await client.query(
      `UPDATE custom_content_requests
          SET status = 'refunded', hold_status = 'refunded',
              refunded_at = now(), admin_resolution = 'refunded'
        WHERE id = $1`,
      [requestId],
    );
    await client.query(
      `INSERT INTO credit_transactions
         (user_id, amount, type, description, custom_content_request_id, doll_id)
       VALUES ($1, $2, 'refund', 'Admin custom request refund', $3, $4)`,
      [
        request.customer_user_id,
        request.price_credits,
        requestId,
        request.doll_id,
      ],
    );
    if (request.hold_status === "settled") {
      await client.query(
        `INSERT INTO credit_transactions
           (user_id, amount, type, description, custom_content_request_id, doll_id)
         VALUES ($1, $2, 'refund', 'Admin reversed custom request settlement', $3, $4)`,
        [
          request.creator_user_id,
          -request.price_credits,
          requestId,
          request.doll_id,
        ],
      );
    }
    return requestId;
  });
}

async function seedHeldRequest(
  customerId,
  creator,
  suffix,
  status,
  deadlineColumn,
) {
  const price = 40;
  await pool.query(
    `UPDATE credit_balances
        SET purchased_balance = purchased_balance - $2
      WHERE user_id = $1`,
    [customerId, price],
  );
  const columns =
    deadlineColumn === "delivery" ? ", delivery_deadline_at, accepted_at" : "";
  const values =
    deadlineColumn === "delivery"
      ? ", now() - interval '1 second', now() - interval '1 hour'"
      : "";
  const result = await pool.query(
    `INSERT INTO custom_content_requests
       (customer_user_id, creator_user_id, doll_id, idempotency_key,
        request_text, request_type, price_credits, held_membership_credits,
        held_purchased_credits, status, response_deadline_at${columns})
     VALUES ($1, $2, $3, $4, $5, 'custom_photo', $6, 0, $6, $7,
             now() - interval '1 second'${values})
     RETURNING id`,
    [
      customerId,
      creator.userId,
      creator.dollId,
      `${RUN_TAG}-${suffix}`,
      `${RUN_TAG}-${suffix}`,
      price,
      status,
    ],
  );
  ids.requests.push(result.rows[0].id);
  await pool.query(
    `INSERT INTO credit_transactions
       (user_id, amount, type, description, custom_content_request_id, doll_id)
     VALUES ($1, $2, 'hold', 'Custom request hold', $3, $4)`,
    [customerId, -price, result.rows[0].id, creator.dollId],
  );
  return result.rows[0].id;
}

async function verifyTerminalRace(requestId, competingAction, expectedStatus) {
  await Promise.all([reconcileRequest(requestId), competingAction(requestId)]);
  const request = await pool.query(
    `SELECT status, hold_status FROM custom_content_requests WHERE id = $1`,
    [requestId],
  );
  assert(
    request.rows[0].status === expectedStatus &&
      request.rows[0].hold_status === "refunded",
    `deadline race ends once as ${expectedStatus}/refunded`,
  );
  const terminalEntries = await pool.query(
    `SELECT count(*)::int AS count
       FROM credit_transactions
      WHERE custom_content_request_id = $1
        AND type IN ('refund', 'settlement')`,
    [requestId],
  );
  assert(
    terminalEntries.rows[0].count === 1,
    `deadline race creates exactly one terminal ledger entry`,
  );
}

async function cleanup() {
  log("cleaning up disposable rows...");
  await pool.query(
    `DELETE FROM credit_transactions
      WHERE user_id = ANY($1::int[])
         OR custom_content_request_id = ANY($2::int[])
         OR creator_album_unlock_id IN (
              SELECT id FROM creator_album_unlocks
               WHERE member_user_id = ANY($1::int[])
            )`,
    [ids.users, ids.requests],
  );
  await pool.query(
    `DELETE FROM custom_content_deliveries WHERE request_id = ANY($1::int[])`,
    [ids.requests],
  );
  await pool.query(
    `DELETE FROM custom_content_requests WHERE id = ANY($1::int[])`,
    [ids.requests],
  );
  await pool.query(
    `DELETE FROM creator_album_unlocks
      WHERE member_user_id = ANY($1::int[]) OR album_id = ANY($2::int[])`,
    [ids.users, ids.albums],
  );
  await pool.query(`DELETE FROM creator_albums WHERE id = ANY($1::int[])`, [
    ids.albums,
  ]);
  await pool.query(
    `DELETE FROM credit_balances WHERE user_id = ANY($1::int[])`,
    [ids.users],
  );
  await pool.query(`DELETE FROM dolls WHERE id = ANY($1::int[])`, [ids.dolls]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  log("cleanup complete");
}

async function main() {
  try {
    log(`run tag: ${RUN_TAG}`);
    const creator = await seedCreator();
    await seedBalance(creator.userId, 0, 0);
    const cloudId = await seedAlbum(creator, "cloud_vibes");
    const smokinId = await seedAlbum(creator, "smokin_hot");

    const cloudMember = await seedUser("user", "cloud-member");
    await seedBalance(cloudMember, 10, 90);
    await verifyDuplicateUnlock(
      cloudMember,
      creator,
      cloudId,
      "cloud_vibes",
      25,
      1,
    );

    const smokinMember = await seedUser("user", "smokin-member");
    await seedBalance(smokinMember, 30, 170);
    await verifyDuplicateUnlock(
      smokinMember,
      creator,
      smokinId,
      "smokin_hot",
      100,
      2,
    );

    const requestMember = await seedUser("user", "request-member");
    await seedBalance(requestMember, 20, 180);
    const key = `${RUN_TAG}-same-key`;
    const requestResults = await Promise.all([
      createCustomRequest(requestMember, creator, key, 50),
      createCustomRequest(requestMember, creator, key, 50),
    ]);
    assert(
      requestResults[0] === requestResults[1],
      "same idempotency key returns the same custom request",
    );
    const requestCount = await pool.query(
      `SELECT count(*)::int AS requests
         FROM custom_content_requests
        WHERE customer_user_id = $1 AND idempotency_key = $2`,
      [requestMember, key],
    );
    assert(
      requestCount.rows[0].requests === 1,
      "idempotency creates one request",
    );
    const holdCount = await pool.query(
      `SELECT count(*)::int AS count, sum(amount)::int AS amount
         FROM credit_transactions
        WHERE custom_content_request_id = $1 AND type = 'hold'`,
      [requestResults[0]],
    );
    assert(
      holdCount.rows[0].count === 1 && holdCount.rows[0].amount === -50,
      "idempotency creates one hold ledger entry",
    );

    const raceMember = await seedUser("user", "race-member");
    await seedBalance(raceMember, 0, 200);
    const acceptRace = await seedHeldRequest(
      raceMember,
      creator,
      "accept-race",
      "pending_creator_response",
      "response",
    );
    await verifyTerminalRace(acceptRace, acceptRequest, "expired_no_response");
    const deliveryRace = await seedHeldRequest(
      raceMember,
      creator,
      "delivery-race",
      "accepted",
      "delivery",
    );
    await verifyTerminalRace(deliveryRace, deliverRequest, "failed_delivery");

    const refundMember = await seedUser("user", "refund-member");
    await seedBalance(refundMember, 0, 60);
    const refundRequest = await seedHeldRequest(
      refundMember,
      creator,
      "refund-race",
      "accepted",
      "delivery",
    );
    await pool.query(
      `UPDATE custom_content_requests
          SET status = 'disputed', hold_status = 'settled',
              delivery_deadline_at = now() + interval '1 hour',
              dispute_reason = 'test dispute'
        WHERE id = $1`,
      [refundRequest],
    );
    await pool.query(
      `UPDATE credit_balances SET purchased_balance = purchased_balance + 40
        WHERE user_id = $1`,
      [creator.userId],
    );
    await pool.query(
      `INSERT INTO credit_transactions
         (user_id, amount, type, description, custom_content_request_id, doll_id)
       VALUES
         ($1, 0, 'settlement', 'Custom request delivered', $3, $4),
         ($2, 40, 'settlement', 'Custom request creator settlement', $3, $4)`,
      [refundMember, creator.userId, refundRequest, creator.dollId],
    );
    const creatorBefore = await pool.query(
      `SELECT purchased_balance FROM credit_balances WHERE user_id = $1`,
      [creator.userId],
    );
    await Promise.all([adminRefund(refundRequest), adminRefund(refundRequest)]);
    const refundEntries = await pool.query(
      `SELECT description, count(*)::int AS count
         FROM credit_transactions
        WHERE custom_content_request_id = $1 AND type = 'refund'
        GROUP BY description`,
      [refundRequest],
    );
    const counts = new Map(
      refundEntries.rows.map((row) => [row.description, row.count]),
    );
    assert(
      counts.get("Admin custom request refund") === 1,
      "admin refund credits the member exactly once",
    );
    assert(
      counts.get("Admin reversed custom request settlement") === 1,
      "admin refund creates one Creator reversal entry",
    );
    const creatorAfter = await pool.query(
      `SELECT purchased_balance FROM credit_balances WHERE user_id = $1`,
      [creator.userId],
    );
    assert(
      creatorAfter.rows[0].purchased_balance ===
        creatorBefore.rows[0].purchased_balance - 40,
      "admin refund reverses Creator credits exactly once",
    );

    log("ALL CREATOR CREDIT CONCURRENCY INVARIANTS PASSED");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[verify-creator-credits] FAILED:", error);
  process.exitCode = 1;
});
