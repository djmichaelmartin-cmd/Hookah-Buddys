/**
 * Sharing routes — feed post sharing, group post sharing, admin moderation.
 *
 * All authorization flows through sharingPolicy.ts. Wrappers are pure references —
 * no text/media/identity is ever copied from the source.
 *
 * Security/product rules enforced here:
 *  - parseId NaN → 400 before any DB
 *  - destinationGroupId present with non-group destination → 400
 *  - recipientUserIds present with non-private destination → 400
 *  - self recipient IDs stripped; empty after filtering → 400
 *  - oversized sharerComment → 400
 *  - duplicate/invalid recipient IDs → deduplicated, validated
 *  - idempotent: duplicate shares return existing record without counter re-increment
 *  - atomic breakdown counters (publicShareCount, privateShareCount, groupShareCount, linkShareCount)
 *  - owner/admin see all share count breakdowns; others see public+group only
 *  - group posting permission enforced (admins_only / approved_members / all_members)
 *  - postApproval: pending_approval wrappers trigger moderator notifications (no source content)
 *  - private recipient pre-auth: each recipient validated against canonical source
 *  - business identity: Business Page name/logo used; owner identity never exposed
 *
 * Routes:
 *   PATCH /feed/posts/:id/sharing
 *   POST  /feed/posts/:id/share
 *   POST  /feed/posts/:id/copy-link
 *   GET   /feed/share-recipients
 *   GET   /feed/share-groups
 *   GET   /feed/shares/private
 *   PATCH /groups/:groupId/posts/:postId/sharing
 *   POST  /groups/:groupId/posts/:postId/share
 *   POST  /groups/:groupId/posts/:postId/copy-link
 *   GET   /admin/shares
 *   GET   /admin/shares/suspensions     ← MUST be before /:shareId
 *   PATCH /admin/shares/:shareId
 *   POST  /admin/shares/suspensions/:userId/suspend
 *   POST  /admin/shares/suspensions/:userId/restore
 */

import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, or, sql, inArray } from "drizzle-orm";
import {
  db,
  feedPostsTable,
  groupPostsTable,
  groupsTable,
  groupMembersTable,
  postSharesTable,
  postShareRecipientsTable,
  postShareCopyLinksTable,
  sharingSuspensionsTable,
  postSharingSettingsTable,
  usersTable,
  friendshipsTable,
  followsTable,
  blocksTable,
} from "@workspace/db";
import {
  UpdateFeedPostSharingBody,
  ShareFeedPostBody,
  UpdateGroupPostSharingBody,
  ShareGroupPostBody,
  AdminModerateShareBody,
  AdminSuspendSharingBody,
} from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import {
  authorizeShareSource,
  checkSharingEligibility,
  checkCopyLinkEligibility,
  resolveCanonicalSource,
  buildSharedPostPreview,
  buildDedupeKey,
  getCanonicalShareUrl,
  getEligibleShareRecipients,
  validatePrivateRecipientAccess,
  createShareNotification,
  notifyGroupModeratorsSharePending,
  getActiveSuspension,
  type ShareSourceType,
  type ShareDestination,
} from "../lib/sharingPolicy";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const SHARING_LOCK_NAMESPACE = 7070;

class SharePolicyError extends Error {}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Parse and validate an integer ID param; returns NaN if invalid. */
function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

/** Validate a parsed ID; returns 400 response shape if invalid. */
function validateId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

/** Map destination → feed audience */
function destinationToAudience(destination: ShareDestination): string {
  if (destination === "public" || destination === "lounge") return "public";
  if (destination === "friends") return "friends";
  return "public";
}

/** Determine the feed category for a share wrapper */
function destinationToCategory(destination: ShareDestination, originalCategory?: string): string {
  if (destination === "lounge") return "lounge";
  return originalCategory ?? "discussion";
}

/** Get the original author user ID for a source post (for notifications) */
async function getSourcePostAuthorId(
  sourceType: ShareSourceType,
  sourcePostId: number,
): Promise<number | null> {
  if (sourceType === "feed_post") {
    const [p] = await db
      .select({ userId: feedPostsTable.userId, businessId: feedPostsTable.businessId })
      .from(feedPostsTable)
      .where(eq(feedPostsTable.id, sourcePostId));
    // Business-attributed posts: notify the Business Page owner only if accessible
    // For privacy, notify the userId regardless; createShareNotification checks blocks
    return p?.businessId ? null : (p?.userId ?? null);
  }
  const [p] = await db
    .select({ authorUserId: groupPostsTable.authorUserId, businessId: groupPostsTable.businessId })
    .from(groupPostsTable)
    .where(eq(groupPostsTable.id, sourcePostId));
  // Business posts: no personal notification
  return p?.businessId ? null : (p?.authorUserId ?? null);
}

const SHARER_COMMENT_MAX = 500;

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /feed/posts/:id/sharing — author sharing controls
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/feed/posts/:id/sharing", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  if (!validateId(id)) {
    res.status(400).json({ error: "Invalid post ID" });
    return;
  }
  const parsed = UpdateFeedPostSharingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
  if (!post || post.status === "removed") {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only update sharing settings for your own posts" });
    return;
  }

  const incoming = parsed.data as Record<string, unknown>;
  const setValues: Record<string, unknown> = {};
  if (typeof incoming.sharingDisabled === "boolean") setValues.sharingDisabled = incoming.sharingDisabled;
  if (typeof incoming.allowPublicShares === "boolean") setValues.allowPublicShares = incoming.allowPublicShares;
  if (typeof incoming.allowFriendsShares === "boolean") setValues.allowFriendsShares = incoming.allowFriendsShares;
  if (typeof incoming.allowPrivateShares === "boolean") setValues.allowPrivateShares = incoming.allowPrivateShares;
  if (typeof incoming.allowGroupShares === "boolean") setValues.allowGroupShares = incoming.allowGroupShares;

  const [settings] = await db
    .insert(postSharingSettingsTable)
    .values({
      sourceType: "feed_post",
      sourcePostId: id,
      sharingDisabled: (setValues.sharingDisabled as boolean) ?? false,
      allowPublicShares: (setValues.allowPublicShares as boolean) ?? true,
      allowFriendsShares: (setValues.allowFriendsShares as boolean) ?? true,
      allowPrivateShares: (setValues.allowPrivateShares as boolean) ?? true,
      allowGroupShares: (setValues.allowGroupShares as boolean) ?? true,
    })
    .onConflictDoUpdate({
      target: [postSharingSettingsTable.sourceType, postSharingSettingsTable.sourcePostId],
      set: setValues as Parameters<typeof db.insert>[0] extends never ? never : Record<string, unknown>,
    })
    .returning();
  res.json({
    sourceType: settings.sourceType,
    sourcePostId: settings.sourcePostId,
    sharingDisabled: settings.sharingDisabled,
    allowPublicShares: settings.allowPublicShares,
    allowFriendsShares: settings.allowFriendsShares,
    allowPrivateShares: settings.allowPrivateShares,
    allowGroupShares: settings.allowGroupShares,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /feed/posts/:id/share — share a feed post
// ─────────────────────────────────────────────────────────────────────────────

router.post("/feed/posts/:id/share", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  if (!validateId(id)) {
    res.status(400).json({ error: "Invalid post ID" });
    return;
  }
  const parsed = ShareFeedPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { destination, destinationGroupId, recipientUserIds, sharerComment } = parsed.data;
  const dest = destination as ShareDestination;

  // 400: structural validation before any DB
  if (sharerComment && sharerComment.length > SHARER_COMMENT_MAX) {
    res.status(400).json({ error: `sharerComment exceeds ${SHARER_COMMENT_MAX} characters` });
    return;
  }
  if (destinationGroupId != null && dest !== "group") {
    res.status(400).json({ error: "destinationGroupId is only valid for destination=group" });
    return;
  }
  if (recipientUserIds != null && dest !== "private") {
    res.status(400).json({ error: "recipientUserIds is only valid for destination=private" });
    return;
  }
  if (dest === "group" && (destinationGroupId == null || !validateId(destinationGroupId))) {
    res.status(400).json({ error: "destinationGroupId is required for destination=group" });
    return;
  }
  if (dest === "private") {
    const rawIds = (recipientUserIds ?? []).filter((r) => r !== user.id);
    const uniqueIds = [...new Set(rawIds)];
    if (!uniqueIds.length) {
      res.status(400).json({ error: "At least one valid recipient is required for private shares" });
      return;
    }
    if (uniqueIds.length > 20) {
      res.status(400).json({ error: "Maximum 20 recipients per private share" });
      return;
    }
  }

  // 1. Authorize the source
  const sourceAuth = await authorizeShareSource("feed_post", id, null, user);
  if (!sourceAuth.ok) {
    res.status(sourceAuth.status).json({ error: sourceAuth.error });
    return;
  }

  // 2. Resolve canonical source (collapse share-of-share)
  const canonical = resolveCanonicalSource({
    sourceType: "feed_post",
    sourcePostId: id,
    sourceGroupId: null,
    feedPost: sourceAuth.feedPost,
  });

  // 3. Re-authorize canonical if different from the passed post
  let finalAuth = sourceAuth;
  if (canonical.sourcePostId !== id || canonical.sourceType !== "feed_post") {
    const reAuth = await authorizeShareSource(
      canonical.sourceType,
      canonical.sourcePostId,
      canonical.sourceGroupId,
      user,
    );
    if (!reAuth.ok) {
      res.status(reAuth.status).json({ error: reAuth.error });
      return;
    }
    finalAuth = reAuth;
  }

  // 4. Eligibility check
  const eligibility = await checkSharingEligibility({
    sharer: user,
    sourceType: canonical.sourceType,
    sourcePostId: canonical.sourcePostId,
    sourceGroupId: canonical.sourceGroupId,
    destination: dest,
    destinationGroupId: destinationGroupId ?? null,
    sourceAuth: finalAuth as Parameters<typeof checkSharingEligibility>[0]["sourceAuth"],
  });
  if (!eligibility.allowed) {
    res.status(400).json({ error: eligibility.reason });
    return;
  }

  // 5. Private: validate and pre-authorize recipients against canonical source
  let eligibleRecipientIds: number[] = [];
  if (dest === "private") {
    const rawIds = (recipientUserIds ?? []).filter((r) => r !== user.id);
    const uniqueIds = [...new Set(rawIds)].slice(0, 20);

    // Check eligibility (account status, blocks, relationship)
    const eligible = await getEligibleShareRecipients(user.id, uniqueIds);
    if (!eligible.length) {
      res.status(400).json({ error: "No eligible recipients found" });
      return;
    }

    // Validate each recipient can view the canonical source
    const { eligible: canView, rejected } = await validatePrivateRecipientAccess(eligible, canonical);
    if (rejected.length > 0) {
      res.status(400).json({
        error: "Some recipients cannot access the source post",
        rejectedRecipientIds: rejected,
      });
      return;
    }
    eligibleRecipientIds = canView;
  }

  // 6. Idempotency: build dedupeKey and check for existing
  const dedupeKey = buildDedupeKey({
    sharerId: user.id,
    sourceType: canonical.sourceType,
    sourcePostId: canonical.sourcePostId,
    sourceGroupId: canonical.sourceGroupId,
    destination: dest,
    destinationGroupId: destinationGroupId ?? null,
    recipientIds: eligibleRecipientIds,
  });

  if (dedupeKey) {
    const [existing] = await db
      .select()
      .from(postSharesTable)
      .where(eq(postSharesTable.dedupeKey, dedupeKey))
      .limit(1);
    if (existing) {
      // Return the existing share without re-incrementing counters
      res.status(200).json({
        shareId: existing.id,
        destination: existing.destination,
        wrapperFeedPostId: existing.wrapperFeedPostId ?? null,
        destinationGroupPostId: existing.destinationGroupPostId ?? null,
        recipientCount: dest === "private" ? eligibleRecipientIds.length : null,
        deduplicated: true,
      });
      return;
    }
  }

  // 7. Execute transactionally. The per-sharer advisory lock makes the
  // dedupe/rate-limit recheck and write one serialized action.
  let wrapperFeedPostId: number | null = null;
  let destinationGroupPostId: number | null = null;
  let pendingApproval = false;
  let deduplicatedInTransaction = false;
  let shareRecord!: typeof postSharesTable.$inferSelect;

  try {
    shareRecord = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${SHARING_LOCK_NAMESPACE}, ${user.id})`,
      );

      if (dedupeKey) {
        const [existing] = await tx
          .select()
          .from(postSharesTable)
          .where(eq(postSharesTable.dedupeKey, dedupeKey))
          .limit(1);
        if (existing) {
          deduplicatedInTransaction = true;
          wrapperFeedPostId = existing.wrapperFeedPostId ?? null;
          destinationGroupPostId = existing.destinationGroupPostId ?? null;
          return existing;
        }
      }

      const lockedEligibility = await checkSharingEligibility(
        {
          sharer: user,
          sourceType: canonical.sourceType,
          sourcePostId: canonical.sourcePostId,
          sourceGroupId: canonical.sourceGroupId,
          destination: dest,
          destinationGroupId: destinationGroupId ?? null,
          sourceAuth: finalAuth as Parameters<typeof checkSharingEligibility>[0]["sourceAuth"],
        },
        tx as NonNullable<Parameters<typeof checkSharingEligibility>[1]>,
      );
      if (!lockedEligibility.allowed) throw new SharePolicyError(lockedEligibility.reason);

      const [share] = await tx
        .insert(postSharesTable)
        .values({
          sharerId: user.id,
          sourceType: canonical.sourceType,
          sourcePostId: canonical.sourcePostId,
          sourceGroupId: canonical.sourceGroupId ?? null,
          destination: dest,
          destinationGroupId: destinationGroupId ?? null,
          sharerComment: sharerComment ?? null,
          dedupeKey: dedupeKey ?? null,
          status: "active",
        })
        .returning();

      if (dest === "public" || dest === "lounge" || dest === "friends") {
        const audience = destinationToAudience(dest);
        const srcPost = finalAuth.feedPost;
        const category = destinationToCategory(dest, srcPost?.category);
        const [wrapperPost] = await tx
          .insert(feedPostsTable)
          .values({
            userId: user.id,
            userRole: user.role,
            text: sharerComment ?? "",
            mediaType: "none",
            category,
            isHookahRelatedConfirmed: true,
            status: "active",
            audience,
            shareSourceType: canonical.sourceType,
            shareSourcePostId: canonical.sourcePostId,
            shareSourceGroupId: canonical.sourceGroupId ?? null,
          })
          .returning();
        wrapperFeedPostId = wrapperPost.id;
        await tx
          .update(postSharesTable)
          .set({ wrapperFeedPostId: wrapperPost.id })
          .where(eq(postSharesTable.id, share.id));
      } else if (dest === "group" && destinationGroupId) {
        const [destGroup] = await tx
          .select()
          .from(groupsTable)
          .where(eq(groupsTable.id, destinationGroupId));
        const [memberRow] = await tx
          .select()
          .from(groupMembersTable)
          .where(
            and(
              eq(groupMembersTable.groupId, destinationGroupId),
              eq(groupMembersTable.userId, user.id),
            ),
          );
        const memberRole = memberRow?.status === "active" ? memberRow.role : null;
        const isGroupManager = memberRole === "owner" || memberRole === "admin";
        const isPlatformAdmin = user.role === "admin";
        let postStatus = "active";
        if (destGroup?.postApproval && !isGroupManager && !isPlatformAdmin) {
          postStatus = "pending_approval";
          pendingApproval = true;
        }
        const [wrapperGroupPost] = await tx
          .insert(groupPostsTable)
          .values({
            groupId: destinationGroupId,
            authorUserId: user.id,
            text: sharerComment ?? "",
            mediaType: "none",
            postType: "text",
            status: postStatus,
            shareSourceType: canonical.sourceType,
            shareSourcePostId: canonical.sourcePostId,
            shareSourceGroupId: canonical.sourceGroupId ?? null,
          })
          .returning();
        destinationGroupPostId = wrapperGroupPost.id;
        if (postStatus === "active") {
          await tx
            .update(groupsTable)
            .set({ postCount: sql`${groupsTable.postCount} + 1` })
            .where(eq(groupsTable.id, destinationGroupId));
        }
        await tx
          .update(postSharesTable)
          .set({ destinationGroupPostId: wrapperGroupPost.id })
          .where(eq(postSharesTable.id, share.id));
      } else if (dest === "private") {
        await tx.insert(postShareRecipientsTable).values(
          eligibleRecipientIds.map((rid) => ({ shareId: share.id, recipientUserId: rid })),
        );
      }

      await incrementShareCounters(tx, canonical.sourceType, canonical.sourcePostId, dest);
      return share;
    });
  } catch (err) {
    if (err instanceof SharePolicyError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (deduplicatedInTransaction) {
    res.status(200).json({
      shareId: shareRecord.id,
      destination: shareRecord.destination,
      wrapperFeedPostId,
      destinationGroupPostId,
      recipientCount: dest === "private" ? eligibleRecipientIds.length : null,
      deduplicated: true,
    });
    return;
  }

  // 8. Notifications (best-effort, outside transaction)
  try {
    if (dest === "private") {
      for (const rid of eligibleRecipientIds) {
        await createShareNotification({
          recipientUserId: rid,
          sharerId: user.id,
          sharerName: user.name,
          shareId: shareRecord.id,
          sourceType: canonical.sourceType,
          sourcePostId: canonical.sourcePostId,
          sourceGroupId: canonical.sourceGroupId ?? null,
          destination: "private",
        });
      }
    } else if (dest === "group" && destinationGroupId && pendingApproval && destinationGroupPostId) {
      await notifyGroupModeratorsSharePending({
        destinationGroupId,
        destinationGroupPostId,
        shareId: shareRecord.id,
        sharerId: user.id,
        sharerName: user.name,
      });
    } else {
      const authorId = await getSourcePostAuthorId(canonical.sourceType, canonical.sourcePostId);
      if (authorId && authorId !== user.id) {
        await createShareNotification({
          recipientUserId: authorId,
          sharerId: user.id,
          sharerName: user.name,
          shareId: shareRecord.id,
          sourceType: canonical.sourceType,
          sourcePostId: canonical.sourcePostId,
          sourceGroupId: canonical.sourceGroupId ?? null,
          destination: dest,
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "share notification failed");
  }

  res.status(201).json({
    shareId: shareRecord.id,
    destination: dest,
    wrapperFeedPostId,
    destinationGroupPostId,
    recipientCount: dest === "private" ? eligibleRecipientIds.length : null,
    deduplicated: false,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /feed/posts/:id/copy-link — copy canonical link for a feed post
// ─────────────────────────────────────────────────────────────────────────────

router.post("/feed/posts/:id/copy-link", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  if (!validateId(id)) {
    res.status(400).json({ error: "Invalid post ID" });
    return;
  }

  // Authorize and resolve canonical source
  const auth = await authorizeShareSource("feed_post", id, null, user);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const canonical = resolveCanonicalSource({
    sourceType: "feed_post",
    sourcePostId: id,
    feedPost: auth.feedPost,
  });

  // Re-authorize canonical if different
  let finalAuth = auth;
  if (canonical.sourcePostId !== id || canonical.sourceType !== "feed_post") {
    const reAuth = await authorizeShareSource(
      canonical.sourceType,
      canonical.sourcePostId,
      canonical.sourceGroupId,
      user,
    );
    if (!reAuth.ok) {
      res.status(reAuth.status).json({ error: reAuth.error });
      return;
    }
    finalAuth = reAuth;
  }

  // Copy-link eligibility (rate limits, suspension, only_me, sharingDisabled)
  const eligibility = await checkCopyLinkEligibility({
    sharer: user,
    sourceType: canonical.sourceType,
    sourcePostId: canonical.sourcePostId,
    sourceAuth: finalAuth as Parameters<typeof checkCopyLinkEligibility>[0]["sourceAuth"],
  });
  if (!eligibility.allowed) {
    res.status(400).json({ error: eligibility.reason });
    return;
  }

  const canonicalUrl = getCanonicalShareUrl(
    canonical.sourceType,
    canonical.sourcePostId,
    canonical.sourceGroupId,
  );

  // Atomically insert copy-link record and increment linkShareCount
  let linkRecord!: typeof postShareCopyLinksTable.$inferSelect;
  try {
    [linkRecord] = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${SHARING_LOCK_NAMESPACE}, ${user.id})`,
      );
      const lockedEligibility = await checkCopyLinkEligibility(
        {
          sharer: user,
          sourceType: canonical.sourceType,
          sourcePostId: canonical.sourcePostId,
          sourceAuth: finalAuth as Parameters<typeof checkCopyLinkEligibility>[0]["sourceAuth"],
        },
        tx as NonNullable<Parameters<typeof checkCopyLinkEligibility>[1]>,
      );
      if (!lockedEligibility.allowed) throw new SharePolicyError(lockedEligibility.reason);

      const [rec] = await tx
        .insert(postShareCopyLinksTable)
        .values({
          sharerId: user.id,
          sourceType: canonical.sourceType,
          sourcePostId: canonical.sourcePostId,
          sourceGroupId: canonical.sourceGroupId ?? null,
          canonicalUrl,
        })
        .returning();
      await incrementShareCounters(tx, canonical.sourceType, canonical.sourcePostId, "copy_link");
      return [rec];
    });
  } catch (err) {
    if (err instanceof SharePolicyError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  res.json({ canonicalUrl, shareId: linkRecord.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /feed/share-recipients — eligible recipients for private shares
// ─────────────────────────────────────────────────────────────────────────────

router.get("/feed/share-recipients", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 20 : 20,
    50,
  );

  // Load friends
  const friendships = await db
    .select()
    .from(friendshipsTable)
    .where(
      or(
        eq(friendshipsTable.userAId, user.id),
        eq(friendshipsTable.userBId, user.id),
      ),
    );
  const friendIds = friendships.map((f) =>
    f.userAId === user.id ? f.userBId : f.userAId,
  );

  // Load follows
  const follows = await db
    .select({ followingId: followsTable.followingId })
    .from(followsTable)
    .where(eq(followsTable.followerId, user.id));
  const followingIds = follows.map((f) => f.followingId);

  const candidateIds = [...new Set([...friendIds, ...followingIds])];
  if (!candidateIds.length) {
    res.json([]);
    return;
  }

  // Block filter
  const blockRows = await db
    .select()
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, user.id), inArray(blocksTable.blockedUserId, candidateIds)),
        and(inArray(blocksTable.blockerId, candidateIds), eq(blocksTable.blockedUserId, user.id)),
      ),
    );
  const blockedIds = new Set<number>();
  for (const b of blockRows) {
    blockedIds.add(b.blockerId === user.id ? b.blockedUserId : b.blockerId);
  }

  const unblocked = candidateIds.filter((cid) => !blockedIds.has(cid));
  if (!unblocked.length) {
    res.json([]);
    return;
  }

  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
      profilePhotoUrl: usersTable.profilePhotoUrl,
    })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, unblocked),
        eq(usersTable.accountStatus, "active"),
        q ? ilike(usersTable.name, `%${q}%`) : undefined,
      ),
    )
    .limit(limit);

  const friendSet = new Set(friendIds);
  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username ?? null,
      profilePhotoUrl: u.profilePhotoUrl ?? null,
      isFriend: friendSet.has(u.id),
    })),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /feed/share-groups — groups the viewer can share to
// ─────────────────────────────────────────────────────────────────────────────

router.get("/feed/share-groups", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 20 : 20,
    50,
  );

  const memberships = await db
    .select({ groupId: groupMembersTable.groupId, role: groupMembersTable.role })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.userId, user.id),
        eq(groupMembersTable.status, "active"),
      ),
    );

  if (!memberships.length) {
    res.json([]);
    return;
  }

  const memberGroupIds = memberships.map((m) => m.groupId);
  const roleByGroupId = new Map(memberships.map((m) => [m.groupId, m.role]));

  const groups = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      iconUrl: groupsTable.iconUrl,
      privacy: groupsTable.privacy,
      postingPermission: groupsTable.postingPermission,
      status: groupsTable.status,
    })
    .from(groupsTable)
    .where(
      and(
        inArray(groupsTable.id, memberGroupIds),
        eq(groupsTable.status, "active"),
        q ? ilike(groupsTable.name, `%${q}%`) : undefined,
      ),
    )
    .limit(limit);

  res.json(
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      iconUrl: g.iconUrl ?? null,
      privacy: g.privacy,
      memberRole: roleByGroupId.get(g.id) ?? "member",
      postingPermission: g.postingPermission,
    })),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /feed/shares/private — list private shares sent/received
// ─────────────────────────────────────────────────────────────────────────────

router.get("/feed/shares/private", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const direction =
    typeof req.query.direction === "string" ? req.query.direction : "received";
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 20 : 20,
    50,
  );

  let shareIds: number[];

  if (direction === "sent") {
    const shares = await db
      .select({ id: postSharesTable.id })
      .from(postSharesTable)
      .where(
        and(
          eq(postSharesTable.sharerId, user.id),
          eq(postSharesTable.destination, "private"),
          eq(postSharesTable.status, "active"),
        ),
      )
      .orderBy(desc(postSharesTable.createdAt))
      .limit(limit);
    shareIds = shares.map((s) => s.id);
  } else {
    const recipients = await db
      .select({ shareId: postShareRecipientsTable.shareId })
      .from(postShareRecipientsTable)
      .where(eq(postShareRecipientsTable.recipientUserId, user.id))
      .orderBy(desc(postShareRecipientsTable.createdAt))
      .limit(limit);
    shareIds = recipients.map((r) => r.shareId);
  }

  if (!shareIds.length) {
    res.json([]);
    return;
  }

  const shares = await db
    .select()
    .from(postSharesTable)
    .where(and(inArray(postSharesTable.id, shareIds), eq(postSharesTable.status, "active")));

  // Re-validate: check that the sharer is not blocked
  const sharerIds = [...new Set(shares.map((s) => s.sharerId))];
  const blockRows = await db
    .select()
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, user.id), inArray(blocksTable.blockedUserId, sharerIds)),
        and(inArray(blocksTable.blockerId, sharerIds), eq(blocksTable.blockedUserId, user.id)),
      ),
    );
  const blockedSharerId = new Set<number>();
  for (const b of blockRows) {
    blockedSharerId.add(b.blockerId === user.id ? b.blockedUserId : b.blockerId);
  }

  const sharerUsers = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(inArray(usersTable.id, sharerIds));
  const sharerNameById = new Map(sharerUsers.map((u) => [u.id, u.name]));

  const results = await Promise.all(
    shares
      .filter((s) => !blockedSharerId.has(s.sharerId))
      .map(async (s) => {
        const preview = await buildSharedPostPreview({
          sourceType: s.sourceType as "feed_post" | "group_post",
          sourcePostId: s.sourcePostId,
          sourceGroupId: s.sourceGroupId,
          viewer: user,
        });
        return {
          id: s.id,
          sharerId: s.sharerId,
          sharerName: sharerNameById.get(s.sharerId) ?? "Unknown",
          destination: s.destination,
          sourceType: s.sourceType,
          sourcePostId: s.sourcePostId,
          sourceGroupId: s.sourceGroupId ?? null,
          sharerComment: s.sharerComment ?? null,
          sharedPost: preview,
          createdAt: s.createdAt.toISOString(),
        };
      }),
  );

  res.json(results);
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /groups/:groupId/posts/:postId/sharing — group post author controls
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  "/groups/:groupId/posts/:postId/sharing",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);
    if (!validateId(groupId) || !validateId(postId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const parsed = UpdateGroupPostSharingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
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
    if (post.authorUserId !== user.id && user.role !== "admin") {
      res.status(403).json({ error: "You can only update sharing settings for your own posts" });
      return;
    }

    const incoming = parsed.data as Record<string, unknown>;
    const setValues: Record<string, unknown> = {};
    if (typeof incoming.sharingDisabled === "boolean") setValues.sharingDisabled = incoming.sharingDisabled;
    if (typeof incoming.allowPublicShares === "boolean") setValues.allowPublicShares = incoming.allowPublicShares;
    if (typeof incoming.allowFriendsShares === "boolean") setValues.allowFriendsShares = incoming.allowFriendsShares;
    if (typeof incoming.allowPrivateShares === "boolean") setValues.allowPrivateShares = incoming.allowPrivateShares;
    if (typeof incoming.allowGroupShares === "boolean") setValues.allowGroupShares = incoming.allowGroupShares;

    const [settings] = await db
      .insert(postSharingSettingsTable)
      .values({
        sourceType: "group_post",
        sourcePostId: postId,
        sharingDisabled: (setValues.sharingDisabled as boolean) ?? false,
        allowPublicShares: (setValues.allowPublicShares as boolean) ?? true,
        allowFriendsShares: (setValues.allowFriendsShares as boolean) ?? true,
        allowPrivateShares: (setValues.allowPrivateShares as boolean) ?? true,
        allowGroupShares: (setValues.allowGroupShares as boolean) ?? true,
      })
      .onConflictDoUpdate({
        target: [postSharingSettingsTable.sourceType, postSharingSettingsTable.sourcePostId],
        set: setValues as Parameters<typeof db.insert>[0] extends never ? never : Record<string, unknown>,
      })
      .returning();
    res.json({
      sourceType: settings.sourceType,
      sourcePostId: settings.sourcePostId,
      sharingDisabled: settings.sharingDisabled,
      allowPublicShares: settings.allowPublicShares,
      allowFriendsShares: settings.allowFriendsShares,
      allowPrivateShares: settings.allowPrivateShares,
      allowGroupShares: settings.allowGroupShares,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /groups/:groupId/posts/:postId/share — share a group post
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/groups/:groupId/posts/:postId/share",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);
    if (!validateId(groupId) || !validateId(postId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const parsed = ShareGroupPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { destination, destinationGroupId, recipientUserIds, sharerComment } = parsed.data;
    const dest = destination as ShareDestination;

    // Structural validation
    if (sharerComment && sharerComment.length > SHARER_COMMENT_MAX) {
      res.status(400).json({ error: `sharerComment exceeds ${SHARER_COMMENT_MAX} characters` });
      return;
    }
    if (destinationGroupId != null && dest !== "group") {
      res.status(400).json({ error: "destinationGroupId is only valid for destination=group" });
      return;
    }
    if (recipientUserIds != null && dest !== "private") {
      res.status(400).json({ error: "recipientUserIds is only valid for destination=private" });
      return;
    }
    if (dest === "group" && (destinationGroupId == null || !validateId(destinationGroupId))) {
      res.status(400).json({ error: "destinationGroupId is required for destination=group" });
      return;
    }
    if (dest === "private") {
      const rawIds = (recipientUserIds ?? []).filter((r) => r !== user.id);
      const uniqueIds = [...new Set(rawIds)];
      if (!uniqueIds.length) {
        res.status(400).json({ error: "At least one valid recipient is required for private shares" });
        return;
      }
      if (uniqueIds.length > 20) {
        res.status(400).json({ error: "Maximum 20 recipients per private share" });
        return;
      }
    }

    // Authorize source
    const sourceAuth = await authorizeShareSource("group_post", postId, groupId, user);
    if (!sourceAuth.ok) {
      res.status(sourceAuth.status).json({ error: sourceAuth.error });
      return;
    }

    // Resolve canonical
    const canonical = resolveCanonicalSource({
      sourceType: "group_post",
      sourcePostId: postId,
      sourceGroupId: groupId,
      groupPost: sourceAuth.groupPost,
    });

    // Re-authorize canonical if different
    let finalAuth = sourceAuth;
    if (canonical.sourcePostId !== postId || canonical.sourceType !== "group_post") {
      const reAuth = await authorizeShareSource(
        canonical.sourceType,
        canonical.sourcePostId,
        canonical.sourceGroupId,
        user,
      );
      if (!reAuth.ok) {
        res.status(reAuth.status).json({ error: reAuth.error });
        return;
      }
      finalAuth = reAuth;
    }

    // Eligibility
    const eligibility = await checkSharingEligibility({
      sharer: user,
      sourceType: canonical.sourceType,
      sourcePostId: canonical.sourcePostId,
      sourceGroupId: canonical.sourceGroupId,
      destination: dest,
      destinationGroupId: destinationGroupId ?? null,
      sourceAuth: finalAuth as Parameters<typeof checkSharingEligibility>[0]["sourceAuth"],
    });
    if (!eligibility.allowed) {
      res.status(400).json({ error: eligibility.reason });
      return;
    }

    // Validate private recipients
    let eligibleRecipientIds: number[] = [];
    if (dest === "private") {
      const rawIds = (recipientUserIds ?? []).filter((r) => r !== user.id);
      const uniqueIds = [...new Set(rawIds)].slice(0, 20);
      const eligible = await getEligibleShareRecipients(user.id, uniqueIds);
      if (!eligible.length) {
        res.status(400).json({ error: "No eligible recipients found" });
        return;
      }
      const { eligible: canView, rejected } = await validatePrivateRecipientAccess(eligible, canonical);
      if (rejected.length > 0) {
        res.status(400).json({
          error: "Some recipients cannot access the source post",
          rejectedRecipientIds: rejected,
        });
        return;
      }
      eligibleRecipientIds = canView;
    }

    // Idempotency
    const dedupeKey = buildDedupeKey({
      sharerId: user.id,
      sourceType: canonical.sourceType,
      sourcePostId: canonical.sourcePostId,
      sourceGroupId: canonical.sourceGroupId,
      destination: dest,
      destinationGroupId: destinationGroupId ?? null,
      recipientIds: eligibleRecipientIds,
    });

    if (dedupeKey) {
      const [existing] = await db
        .select()
        .from(postSharesTable)
        .where(eq(postSharesTable.dedupeKey, dedupeKey))
        .limit(1);
      if (existing) {
        res.status(200).json({
          shareId: existing.id,
          destination: existing.destination,
          wrapperFeedPostId: existing.wrapperFeedPostId ?? null,
          destinationGroupPostId: existing.destinationGroupPostId ?? null,
          recipientCount: dest === "private" ? eligibleRecipientIds.length : null,
          deduplicated: true,
        });
        return;
      }
    }

    let wrapperFeedPostId: number | null = null;
    let destinationGroupPostId: number | null = null;
    let pendingApproval = false;
    let deduplicatedInTransaction = false;
    let shareRecord!: typeof postSharesTable.$inferSelect;

    try {
      shareRecord = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${SHARING_LOCK_NAMESPACE}, ${user.id})`,
        );

        if (dedupeKey) {
          const [existing] = await tx
            .select()
            .from(postSharesTable)
            .where(eq(postSharesTable.dedupeKey, dedupeKey))
            .limit(1);
          if (existing) {
            deduplicatedInTransaction = true;
            wrapperFeedPostId = existing.wrapperFeedPostId ?? null;
            destinationGroupPostId = existing.destinationGroupPostId ?? null;
            return existing;
          }
        }

        const lockedEligibility = await checkSharingEligibility(
          {
            sharer: user,
            sourceType: canonical.sourceType,
            sourcePostId: canonical.sourcePostId,
            sourceGroupId: canonical.sourceGroupId,
            destination: dest,
            destinationGroupId: destinationGroupId ?? null,
            sourceAuth: finalAuth as Parameters<typeof checkSharingEligibility>[0]["sourceAuth"],
          },
          tx as NonNullable<Parameters<typeof checkSharingEligibility>[1]>,
        );
        if (!lockedEligibility.allowed) throw new SharePolicyError(lockedEligibility.reason);

        const [share] = await tx
          .insert(postSharesTable)
          .values({
            sharerId: user.id,
            sourceType: canonical.sourceType,
            sourcePostId: canonical.sourcePostId,
            sourceGroupId: canonical.sourceGroupId ?? null,
            destination: dest,
            destinationGroupId: destinationGroupId ?? null,
            sharerComment: sharerComment ?? null,
            dedupeKey: dedupeKey ?? null,
            status: "active",
          })
          .returning();

        if (dest === "public" || dest === "lounge" || dest === "friends") {
          const audience = destinationToAudience(dest);
          const [wrapperPost] = await tx
            .insert(feedPostsTable)
            .values({
              userId: user.id,
              userRole: user.role,
              text: sharerComment ?? "",
              mediaType: "none",
              category: destinationToCategory(dest),
              isHookahRelatedConfirmed: true,
              status: "active",
              audience,
              shareSourceType: canonical.sourceType,
              shareSourcePostId: canonical.sourcePostId,
              shareSourceGroupId: canonical.sourceGroupId ?? null,
            })
            .returning();
          wrapperFeedPostId = wrapperPost.id;
          await tx
            .update(postSharesTable)
            .set({ wrapperFeedPostId: wrapperPost.id })
            .where(eq(postSharesTable.id, share.id));
        } else if (dest === "group" && destinationGroupId) {
          const [destGroup] = await tx
            .select()
            .from(groupsTable)
            .where(eq(groupsTable.id, destinationGroupId));
          const [memberRow] = await tx
            .select()
            .from(groupMembersTable)
            .where(
              and(
                eq(groupMembersTable.groupId, destinationGroupId),
                eq(groupMembersTable.userId, user.id),
              ),
            );
          const memberRole = memberRow?.status === "active" ? memberRow.role : null;
          const isGroupManager = memberRole === "owner" || memberRole === "admin";
          const isPlatformAdmin = user.role === "admin";
          let postStatus = "active";
          if (destGroup?.postApproval && !isGroupManager && !isPlatformAdmin) {
            postStatus = "pending_approval";
            pendingApproval = true;
          }
          const [wrapperGroupPost] = await tx
            .insert(groupPostsTable)
            .values({
              groupId: destinationGroupId,
              authorUserId: user.id,
              text: sharerComment ?? "",
              mediaType: "none",
              postType: "text",
              status: postStatus,
              shareSourceType: canonical.sourceType,
              shareSourcePostId: canonical.sourcePostId,
              shareSourceGroupId: canonical.sourceGroupId ?? null,
            })
            .returning();
          destinationGroupPostId = wrapperGroupPost.id;
          if (postStatus === "active") {
            await tx
              .update(groupsTable)
              .set({ postCount: sql`${groupsTable.postCount} + 1` })
              .where(eq(groupsTable.id, destinationGroupId));
          }
          await tx
            .update(postSharesTable)
            .set({ destinationGroupPostId: wrapperGroupPost.id })
            .where(eq(postSharesTable.id, share.id));
        } else if (dest === "private") {
          await tx.insert(postShareRecipientsTable).values(
            eligibleRecipientIds.map((rid) => ({ shareId: share.id, recipientUserId: rid })),
          );
        }

        await incrementShareCounters(tx, canonical.sourceType, canonical.sourcePostId, dest);
        return share;
      });
    } catch (err) {
      if (err instanceof SharePolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    if (deduplicatedInTransaction) {
      res.status(200).json({
        shareId: shareRecord.id,
        destination: shareRecord.destination,
        wrapperFeedPostId,
        destinationGroupPostId,
        recipientCount: dest === "private" ? eligibleRecipientIds.length : null,
        deduplicated: true,
      });
      return;
    }

    // Notifications
    try {
      if (dest === "private") {
        for (const rid of eligibleRecipientIds) {
          await createShareNotification({
            recipientUserId: rid,
            sharerId: user.id,
            sharerName: user.name,
            shareId: shareRecord.id,
            sourceType: canonical.sourceType,
            sourcePostId: canonical.sourcePostId,
            sourceGroupId: canonical.sourceGroupId ?? null,
            destination: "private",
          });
        }
      } else if (dest === "group" && destinationGroupId && pendingApproval && destinationGroupPostId) {
        await notifyGroupModeratorsSharePending({
          destinationGroupId,
          destinationGroupPostId,
          shareId: shareRecord.id,
          sharerId: user.id,
          sharerName: user.name,
        });
      } else {
        const authorId = await getSourcePostAuthorId(canonical.sourceType, canonical.sourcePostId);
        if (authorId && authorId !== user.id) {
          await createShareNotification({
            recipientUserId: authorId,
            sharerId: user.id,
            sharerName: user.name,
            shareId: shareRecord.id,
            sourceType: canonical.sourceType,
            sourcePostId: canonical.sourcePostId,
            sourceGroupId: canonical.sourceGroupId ?? null,
            destination: dest,
          });
        }
      }
    } catch (err) {
      logger.warn({ err }, "group post share notification failed");
    }

    res.status(201).json({
      shareId: shareRecord.id,
      destination: dest,
      wrapperFeedPostId,
      destinationGroupPostId,
      recipientCount: dest === "private" ? eligibleRecipientIds.length : null,
      deduplicated: false,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /groups/:groupId/posts/:postId/copy-link — copy canonical link
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/groups/:groupId/posts/:postId/copy-link",
  requireAuth(),
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    const groupId = parseId(req.params.groupId);
    const postId = parseId(req.params.postId);
    if (!validateId(groupId) || !validateId(postId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const auth = await authorizeShareSource("group_post", postId, groupId, user);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const canonical = resolveCanonicalSource({
      sourceType: "group_post",
      sourcePostId: postId,
      sourceGroupId: groupId,
      groupPost: auth.groupPost,
    });

    // Re-authorize canonical
    let finalAuth = auth;
    if (canonical.sourcePostId !== postId || canonical.sourceType !== "group_post") {
      const reAuth = await authorizeShareSource(
        canonical.sourceType,
        canonical.sourcePostId,
        canonical.sourceGroupId,
        user,
      );
      if (!reAuth.ok) {
        res.status(reAuth.status).json({ error: reAuth.error });
        return;
      }
      finalAuth = reAuth;
    }

    // Group copy-link: private group → only current member can copy link (auth already checked above)
    const eligibility = await checkCopyLinkEligibility({
      sharer: user,
      sourceType: canonical.sourceType,
      sourcePostId: canonical.sourcePostId,
      sourceAuth: finalAuth as Parameters<typeof checkCopyLinkEligibility>[0]["sourceAuth"],
    });
    if (!eligibility.allowed) {
      res.status(400).json({ error: eligibility.reason });
      return;
    }

    const canonicalUrl = getCanonicalShareUrl(
      canonical.sourceType,
      canonical.sourcePostId,
      canonical.sourceGroupId,
    );

    let linkRecord!: typeof postShareCopyLinksTable.$inferSelect;
    try {
      [linkRecord] = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${SHARING_LOCK_NAMESPACE}, ${user.id})`,
        );
        const lockedEligibility = await checkCopyLinkEligibility(
          {
            sharer: user,
            sourceType: canonical.sourceType,
            sourcePostId: canonical.sourcePostId,
            sourceAuth: finalAuth as Parameters<typeof checkCopyLinkEligibility>[0]["sourceAuth"],
          },
          tx as NonNullable<Parameters<typeof checkCopyLinkEligibility>[1]>,
        );
        if (!lockedEligibility.allowed) throw new SharePolicyError(lockedEligibility.reason);

        const [rec] = await tx
          .insert(postShareCopyLinksTable)
          .values({
            sharerId: user.id,
            sourceType: canonical.sourceType,
            sourcePostId: canonical.sourcePostId,
            sourceGroupId: canonical.sourceGroupId ?? null,
            canonicalUrl,
          })
          .returning();
        await incrementShareCounters(tx, canonical.sourceType, canonical.sourcePostId, "copy_link");
        return [rec];
      });
    } catch (err) {
      if (err instanceof SharePolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    res.json({ canonicalUrl, shareId: linkRecord.id });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/shares — list/filter share records
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/shares", requireAuth("admin"), async (req, res): Promise<void> => {
  const sharerId =
    typeof req.query.sharerId === "string" ? parseInt(req.query.sharerId, 10) : undefined;
  const sourceType =
    typeof req.query.sourceType === "string" ? req.query.sourceType : undefined;
  const destination =
    typeof req.query.destination === "string" ? req.query.destination : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = Math.min(
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
    200,
  );
  const offset =
    typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;

  const conditions = [];
  if (sharerId != null && !Number.isNaN(sharerId))
    conditions.push(eq(postSharesTable.sharerId, sharerId));
  if (sourceType) conditions.push(eq(postSharesTable.sourceType, sourceType));
  if (destination) conditions.push(eq(postSharesTable.destination, destination));
  if (status) conditions.push(eq(postSharesTable.status, status));

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postSharesTable)
    .where(conditions.length ? and(...conditions) : undefined);

  const shares = await db
    .select()
    .from(postSharesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(postSharesTable.createdAt))
    .limit(limit)
    .offset(offset);

  const sharerIds = [...new Set(shares.map((s) => s.sharerId))];
  const sharerUsers = sharerIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, sharerIds))
    : [];
  const sharerNameById = new Map(sharerUsers.map((u) => [u.id, u.name]));

  res.json({
    total: totalRow?.count ?? 0,
    shares: shares.map((s) => ({
      id: s.id,
      sharerId: s.sharerId,
      sharerName: sharerNameById.get(s.sharerId) ?? null,
      destination: s.destination,
      sourceType: s.sourceType,
      sourcePostId: s.sourcePostId,
      sourceGroupId: s.sourceGroupId ?? null,
      destinationGroupId: s.destinationGroupId ?? null,
      wrapperFeedPostId: s.wrapperFeedPostId ?? null,
      destinationGroupPostId: s.destinationGroupPostId ?? null,
      sharerComment: s.sharerComment ?? null,
      status: s.status,
      moderationLocked: s.moderationLocked,
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/shares/suspensions — list sharing suspensions
// NOTE: MUST be registered before /admin/shares/:shareId
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/admin/shares/suspensions",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const userId =
      typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(
      typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50,
      200,
    );

    const conditions = [];
    if (userId != null && !Number.isNaN(userId))
      conditions.push(eq(sharingSuspensionsTable.userId, userId));
    if (status) conditions.push(eq(sharingSuspensionsTable.status, status));

    const rows = await db
      .select()
      .from(sharingSuspensionsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(sharingSuspensionsTable.createdAt))
      .limit(limit);

    res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        status: r.status,
        reason: r.reason ?? null,
        suspendedByUserId: r.suspendedByUserId,
        liftedByUserId: r.liftedByUserId ?? null,
        liftedAt: r.liftedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/shares/:shareId — admin moderate a share
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/admin/shares/:shareId", requireAuth("admin"), async (req, res): Promise<void> => {
  const shareId = parseId(req.params.shareId);
  if (!validateId(shareId)) {
    res.status(400).json({ error: "Invalid share ID" });
    return;
  }
  const parsed = AdminModerateShareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { action } = parsed.data;

  const [share] = await db
    .select()
    .from(postSharesTable)
    .where(eq(postSharesTable.id, shareId));
  if (!share) {
    res.status(404).json({ error: "Share record not found" });
    return;
  }

  let newStatus: string;
  if (action === "hide") newStatus = "hidden";
  else if (action === "remove") newStatus = "removed";
  else newStatus = "active"; // restore

  const [updated] = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(postSharesTable)
      .set({
        status: newStatus,
        moderationLocked: action !== "restore",
      })
      .where(eq(postSharesTable.id, shareId))
      .returning();

    // Cascade to wrapper posts
    if (u.wrapperFeedPostId) {
      await tx
        .update(feedPostsTable)
        .set({ status: newStatus === "active" ? "active" : newStatus })
        .where(eq(feedPostsTable.id, u.wrapperFeedPostId));
    }
    if (u.destinationGroupPostId) {
      await tx
        .update(groupPostsTable)
        .set({ status: newStatus === "active" ? "active" : newStatus })
        .where(eq(groupPostsTable.id, u.destinationGroupPostId));
    }
    return [u];
  });

  const sharerUser = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, updated.sharerId))
    .then((rows) => rows[0]);

  res.json({
    id: updated.id,
    sharerId: updated.sharerId,
    sharerName: sharerUser?.name ?? null,
    destination: updated.destination,
    sourceType: updated.sourceType,
    sourcePostId: updated.sourcePostId,
    sourceGroupId: updated.sourceGroupId ?? null,
    destinationGroupId: updated.destinationGroupId ?? null,
    wrapperFeedPostId: updated.wrapperFeedPostId ?? null,
    destinationGroupPostId: updated.destinationGroupPostId ?? null,
    sharerComment: updated.sharerComment ?? null,
    status: updated.status,
    moderationLocked: updated.moderationLocked,
    createdAt: updated.createdAt.toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/shares/suspensions/:userId/suspend — suspend sharing
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/admin/shares/suspensions/:userId/suspend",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const adminUser = req.currentUser!;
    const userId = parseId(req.params.userId);
    if (!validateId(userId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }
    const parsed = AdminSuspendSharingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Lift any existing active suspension first
    await db
      .update(sharingSuspensionsTable)
      .set({ status: "lifted", liftedByUserId: adminUser.id, liftedAt: new Date() })
      .where(
        and(
          eq(sharingSuspensionsTable.userId, userId),
          eq(sharingSuspensionsTable.status, "active"),
        ),
      );

    const [suspension] = await db
      .insert(sharingSuspensionsTable)
      .values({
        userId,
        status: "active",
        reason: parsed.data.reason,
        suspendedByUserId: adminUser.id,
      })
      .returning();

    res.json({
      id: suspension.id,
      userId: suspension.userId,
      status: suspension.status,
      reason: suspension.reason ?? null,
      suspendedByUserId: suspension.suspendedByUserId,
      liftedByUserId: null,
      liftedAt: null,
      createdAt: suspension.createdAt.toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/shares/suspensions/:userId/restore — lift suspension
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/admin/shares/suspensions/:userId/restore",
  requireAuth("admin"),
  async (req, res): Promise<void> => {
    const adminUser = req.currentUser!;
    const userId = parseId(req.params.userId);
    if (!validateId(userId)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const existing = await getActiveSuspension(userId);
    if (!existing) {
      res.status(404).json({ error: "No active sharing suspension found for this user" });
      return;
    }

    const [updated] = await db
      .update(sharingSuspensionsTable)
      .set({
        status: "lifted",
        liftedByUserId: adminUser.id,
        liftedAt: new Date(),
      })
      .where(eq(sharingSuspensionsTable.id, existing.id))
      .returning();

    res.json({
      id: updated.id,
      userId: updated.userId,
      status: updated.status,
      reason: updated.reason ?? null,
      suspendedByUserId: updated.suspendedByUserId,
      liftedByUserId: updated.liftedByUserId ?? null,
      liftedAt: updated.liftedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Atomically increments the appropriate share count breakdown column plus shareCount.
 * copy_link: increments linkShareCount only (not shareCount total).
 * public/lounge: increments publicShareCount + shareCount.
 * friends: increments publicShareCount + shareCount (feeds friends audience).
 * private: increments privateShareCount + shareCount.
 * group: increments groupShareCount + shareCount.
 */
async function incrementShareCounters(
  tx: Tx,
  sourceType: ShareSourceType,
  sourcePostId: number,
  destination: ShareDestination,
): Promise<void> {
  if (sourceType === "feed_post") {
    const updates: Record<string, ReturnType<typeof sql>> = {};
    if (destination === "copy_link") {
      updates.linkShareCount = sql`${feedPostsTable.linkShareCount} + 1`;
    } else {
      updates.shareCount = sql`${feedPostsTable.shareCount} + 1`;
      if (destination === "public" || destination === "lounge" || destination === "friends") {
        updates.publicShareCount = sql`${feedPostsTable.publicShareCount} + 1`;
      } else if (destination === "private") {
        updates.privateShareCount = sql`${feedPostsTable.privateShareCount} + 1`;
      } else if (destination === "group") {
        updates.groupShareCount = sql`${feedPostsTable.groupShareCount} + 1`;
      }
    }
    await tx.update(feedPostsTable).set(updates).where(eq(feedPostsTable.id, sourcePostId));
  } else {
    const updates: Record<string, ReturnType<typeof sql>> = {};
    if (destination === "copy_link") {
      updates.linkShareCount = sql`${groupPostsTable.linkShareCount} + 1`;
    } else {
      updates.shareCount = sql`${groupPostsTable.shareCount} + 1`;
      if (destination === "public" || destination === "lounge" || destination === "friends") {
        updates.publicShareCount = sql`${groupPostsTable.publicShareCount} + 1`;
      } else if (destination === "private") {
        updates.privateShareCount = sql`${groupPostsTable.privateShareCount} + 1`;
      } else if (destination === "group") {
        updates.groupShareCount = sql`${groupPostsTable.groupShareCount} + 1`;
      }
    }
    await tx.update(groupPostsTable).set(updates).where(eq(groupPostsTable.id, sourcePostId));
  }
}

export default router;
