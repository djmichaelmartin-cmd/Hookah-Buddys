/**
 * Centralized sharing policy and service for HookahBuddys.
 *
 * All share creation and preview/read operations must go through this module.
 *
 * Key rules:
 *  - Source is re-authorized on creation AND every preview/read.
 *  - Text/media/identity are blanked when access is lost (never cached).
 *  - Resharing an existing share wrapper collapses to the original source.
 *  - Unknown source type → fail closed.
 *  - Rate limits: 20 shares/hour/user global (includes copy_link), 3 same-source/hour/user.
 *  - only_me audience is never shareable by anyone except the author via copy-link to self.
 *  - Private group posts may only be shared within the same private group.
 *  - Author controls: global sharingDisabled + per-destination flags.
 *  - Destination-specific author flags: allowPublicShares, allowFriendsShares,
 *    allowPrivateShares, allowGroupShares.
 *  - Non-public feed sources (friends/followers/only_me) may NOT be shared publicly/lounge.
 *  - Suspended sharers cannot share.
 *  - Each private recipient is individually reauthorized against the canonical source.
 *  - Business-attributed posts use safe Business Page identity, never owner usersTable.
 *  - Group destination respects postingPermission and postApproval lifecycle.
 *  - Deduplication via deterministic dedupeKey; idempotent: returns existing on duplicate.
 */

import { and, eq, gte, sql, or, inArray } from "drizzle-orm";
import {
  db,
  feedPostsTable,
  groupPostsTable,
  groupsTable,
  groupMembersTable,
  usersTable,
  blocksTable,
  friendshipsTable,
  followsTable,
  postSharesTable,
  postShareRecipientsTable,
  postShareCopyLinksTable,
  sharingSuspensionsTable,
  postSharingSettingsTable,
  notificationsTable,
  businessesTable,
  type FeedPost,
  type GroupPost,
} from "@workspace/db";
import { loadAudienceSets, canViewAudience } from "./socialHelpers";
import { feedPostBusinessVisible } from "./feedHelpers";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShareSourceType = "feed_post" | "group_post";
export type ShareDestination =
  | "public"
  | "lounge"
  | "friends"
  | "private"
  | "group"
  | "copy_link";
export type ShareDestinationOption = Exclude<ShareDestination, "copy_link">;

export type SharerUser = {
  id: number;
  role: string;
  name: string;
};

/** Result of authorizing the source post for a given viewer */
export type SourceAuthResult =
  | {
      ok: true;
      sourceType: ShareSourceType;
      feedPost?: FeedPost;
      groupPost?: GroupPost;
      group?: typeof groupsTable.$inferSelect;
    }
  | {
      ok: false;
      status: 403 | 404;
      error: string;
    };

/** Safe blank preview returned when source access is lost or is denied */
export const UNAVAILABLE_SOURCE_PREVIEW = {
  available: false as const,
  sourceType: null as string | null,
  sourcePostId: null as number | null,
  sourceGroupId: null as number | null,
  canonicalUrl: null as string | null,
  audience: null as string | null,
  groupPrivacy: null as string | null,
  allowedShareDestinations: [] as ShareDestinationOption[],
  viewerCanCopyLink: false,
  text: null as string | null,
  mediaUrl: null as string | null,
  posterUrl: null as string | null,
  mediaType: null as string | null,
  authorName: null as string | null,
  authorPhotoUrl: null as string | null,
  groupName: null as string | null,
  shareCount: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Source authorization — called on creation AND every read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authorizes a source post for the viewer. Returns the resolved source or an error.
 * Unknown source types always fail closed.
 */
export async function authorizeShareSource(
  sourceType: ShareSourceType,
  sourcePostId: number,
  sourceGroupId: number | null | undefined,
  viewer: SharerUser | null,
): Promise<SourceAuthResult> {
  if (sourceType === "feed_post") {
    return authorizeFeedPostSource(sourcePostId, viewer);
  }
  if (sourceType === "group_post") {
    return authorizeGroupPostSource(sourcePostId, sourceGroupId ?? null, viewer);
  }
  // Unknown source type — fail closed
  return { ok: false, status: 403, error: "Unknown or unsupported source type" };
}

async function authorizeFeedPostSource(
  postId: number,
  viewer: SharerUser | null,
): Promise<SourceAuthResult> {
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, postId));
  if (!post || post.status === "removed") {
    return { ok: false, status: 404, error: "Post not found" };
  }
  if (post.status !== "active") {
    return { ok: false, status: 404, error: "Post not found" };
  }
  // Block check (bidirectional)
  if (viewer && post.userId !== viewer.id) {
    const blocked = await hasBidirectionalBlock(viewer.id, post.userId);
    if (blocked) return { ok: false, status: 404, error: "Post not found" };
  }
  // Audience check
  const audienceSets = await loadAudienceSets(viewer?.id ?? null);
  if (!canViewAudience(post.audience, post.userId, viewer, audienceSets)) {
    return { ok: false, status: 404, error: "Post not found" };
  }
  // Business lifecycle
  if (!(await feedPostBusinessVisible(post))) {
    return { ok: false, status: 404, error: "Post not found" };
  }
  return { ok: true, sourceType: "feed_post", feedPost: post };
}

async function authorizeGroupPostSource(
  postId: number,
  groupId: number | null,
  viewer: SharerUser | null,
): Promise<SourceAuthResult> {
  if (!groupId) {
    return { ok: false, status: 403, error: "sourceGroupId required for group posts" };
  }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group || group.status === "deleted") {
    return { ok: false, status: 404, error: "Group not found" };
  }
  if (group.status === "suspended" || group.status === "hidden") {
    return { ok: false, status: 403, error: "Group not available" };
  }
  const [post] = await db
    .select()
    .from(groupPostsTable)
    .where(and(eq(groupPostsTable.id, postId), eq(groupPostsTable.groupId, groupId)));
  if (!post || post.status === "removed") {
    return { ok: false, status: 404, error: "Post not found" };
  }
  // Membership check for private groups
  if (group.privacy === "private") {
    if (!viewer) return { ok: false, status: 403, error: "Join this group to see posts" };
    const [membership] = await db
      .select({ status: groupMembersTable.status })
      .from(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.userId, viewer.id),
        ),
      );
    const isActiveMember = membership?.status === "active";
    const isPlatformAdmin = viewer.role === "admin";
    if (!isActiveMember && !isPlatformAdmin) {
      return { ok: false, status: 403, error: "Join this group to see posts" };
    }
  }
  if (post.status !== "active") {
    return { ok: false, status: 404, error: "Post not found" };
  }
  // Block check against post author
  if (viewer && post.authorUserId !== viewer.id) {
    const blocked = await hasBidirectionalBlock(viewer.id, post.authorUserId);
    if (blocked) return { ok: false, status: 404, error: "Post not found" };
  }
  return { ok: true, sourceType: "group_post", groupPost: post, group };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve canonical source (collapse share-of-share to original)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * If the given post is itself a share wrapper, returns the original source details.
 * Prevents nesting: sharing a wrapper re-shares the canonical original.
 */
export function resolveCanonicalSource(opts: {
  sourceType: ShareSourceType;
  sourcePostId: number;
  sourceGroupId?: number | null;
  feedPost?: FeedPost;
  groupPost?: GroupPost;
}): { sourceType: ShareSourceType; sourcePostId: number; sourceGroupId: number | null } {
  const { sourceType, sourcePostId, sourceGroupId, feedPost, groupPost } = opts;

  if (sourceType === "feed_post" && feedPost?.shareSourceType && feedPost?.shareSourcePostId) {
    return {
      sourceType: feedPost.shareSourceType as ShareSourceType,
      sourcePostId: feedPost.shareSourcePostId,
      sourceGroupId: feedPost.shareSourceGroupId ?? null,
    };
  }
  if (sourceType === "group_post" && groupPost?.shareSourceType && groupPost?.shareSourcePostId) {
    return {
      sourceType: groupPost.shareSourceType as ShareSourceType,
      sourcePostId: groupPost.shareSourcePostId,
      sourceGroupId: groupPost.shareSourceGroupId ?? null,
    };
  }
  return { sourceType, sourcePostId, sourceGroupId: sourceGroupId ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharing eligibility checks
// ─────────────────────────────────────────────────────────────────────────────

export type SharingEligibility =
  | { allowed: true }
  | { allowed: false; reason: string };

type SharingQueryExecutor = Pick<typeof db, "select">;

export function getCanonicalShareUrl(
  sourceType: ShareSourceType,
  sourcePostId: number,
  sourceGroupId?: number | null,
): string {
  return sourceType === "feed_post"
    ? `/posts/${sourcePostId}`
    : `/groups/${sourceGroupId}?post=${sourcePostId}`;
}

export function getEffectiveShareDestinations(opts: {
  sharingDisabled: boolean;
  allowPublicShares: boolean;
  allowFriendsShares: boolean;
  allowPrivateShares: boolean;
  allowGroupShares: boolean;
  sourceAudience?: string | null;
  sourceGroupPrivacy?: string | null;
  viewerSuspended?: boolean;
}): ShareDestinationOption[] {
  if (opts.viewerSuspended || opts.sharingDisabled || opts.sourceAudience === "only_me") {
    return [];
  }

  if (opts.sourceGroupPrivacy === "private") {
    return opts.allowGroupShares ? ["group"] : [];
  }

  const destinations: ShareDestinationOption[] = [];
  const sourceIsNonPublic =
    opts.sourceAudience === "friends" || opts.sourceAudience === "followers";
  if (opts.allowPublicShares && !sourceIsNonPublic) {
    destinations.push("public", "lounge");
  }
  if (opts.allowFriendsShares) destinations.push("friends");
  if (opts.allowPrivateShares) destinations.push("private");
  if (opts.allowGroupShares) destinations.push("group");
  return destinations;
}

async function checkCombinedShareActionRateLimit(
  opts: {
    sharerId: number;
    sourceType: ShareSourceType;
    sourcePostId: number;
  },
  queryable: SharingQueryExecutor,
): Promise<SharingEligibility> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [shareGlobal, copyGlobal, shareSource, copySource] = await Promise.all([
    queryable
      .select({ count: sql<number>`count(*)::int` })
      .from(postSharesTable)
      .where(
        and(
          eq(postSharesTable.sharerId, opts.sharerId),
          gte(postSharesTable.createdAt, oneHourAgo),
        ),
      ),
    queryable
      .select({ count: sql<number>`count(*)::int` })
      .from(postShareCopyLinksTable)
      .where(
        and(
          eq(postShareCopyLinksTable.sharerId, opts.sharerId),
          gte(postShareCopyLinksTable.createdAt, oneHourAgo),
        ),
      ),
    queryable
      .select({ count: sql<number>`count(*)::int` })
      .from(postSharesTable)
      .where(
        and(
          eq(postSharesTable.sharerId, opts.sharerId),
          eq(postSharesTable.sourceType, opts.sourceType),
          eq(postSharesTable.sourcePostId, opts.sourcePostId),
          gte(postSharesTable.createdAt, oneHourAgo),
        ),
      ),
    queryable
      .select({ count: sql<number>`count(*)::int` })
      .from(postShareCopyLinksTable)
      .where(
        and(
          eq(postShareCopyLinksTable.sharerId, opts.sharerId),
          eq(postShareCopyLinksTable.sourceType, opts.sourceType),
          eq(postShareCopyLinksTable.sourcePostId, opts.sourcePostId),
          gte(postShareCopyLinksTable.createdAt, oneHourAgo),
        ),
      ),
  ]);

  const hourlyCount = (shareGlobal[0]?.count ?? 0) + (copyGlobal[0]?.count ?? 0);
  if (hourlyCount >= 20) {
    return { allowed: false, reason: "You have reached the sharing limit of 20 actions per hour" };
  }

  const sameSourceCount = (shareSource[0]?.count ?? 0) + (copySource[0]?.count ?? 0);
  if (sameSourceCount >= 3) {
    return { allowed: false, reason: "You have already shared this post too many times recently" };
  }

  return { allowed: true };
}

/**
 * Full eligibility check for creating a share.
 *
 * Order of checks:
 *  1. Suspension
 *  2. only_me audience → never shareable
 *  3. Author controls (global disable + per-destination flag)
 *  4. Non-public source → deny public/lounge destination
 *  5. Rate limits (global 20/hr, same-source 3/hr — includes copy_link history)
 *  6. Source-destination rules (private group → same group only)
 *  7. Destination group lifecycle + membership + posting permissions
 */
export async function checkSharingEligibility(opts: {
  sharer: SharerUser;
  sourceType: ShareSourceType;
  sourcePostId: number;
  sourceGroupId?: number | null;
  destination: ShareDestination;
  destinationGroupId?: number | null;
  sourceAuth: SourceAuthResult & { ok: true };
}, queryable: SharingQueryExecutor = db): Promise<SharingEligibility> {
  const {
    sharer,
    sourceType,
    sourcePostId,
    sourceGroupId,
    destination,
    destinationGroupId,
    sourceAuth,
  } = opts;

  // 1. Check sharing suspension
  const [suspension] = await queryable
    .select()
    .from(sharingSuspensionsTable)
    .where(
      and(
        eq(sharingSuspensionsTable.userId, sharer.id),
        eq(sharingSuspensionsTable.status, "active"),
      ),
    )
    .limit(1);
  if (suspension) {
    return { allowed: false, reason: "Your sharing privilege has been suspended" };
  }

  // 2. only_me audience is never shareable (regardless of caller)
  if (sourceAuth.feedPost?.audience === "only_me") {
    return { allowed: false, reason: "only_me posts cannot be shared" };
  }

  // 3. Author per-post sharing controls (global + per-destination)
  const [sharingSettings] = await queryable
    .select()
    .from(postSharingSettingsTable)
    .where(
      and(
        eq(postSharingSettingsTable.sourceType, sourceType),
        eq(postSharingSettingsTable.sourcePostId, sourcePostId),
      ),
    )
    .limit(1);
  if (sharingSettings?.sharingDisabled) {
    return { allowed: false, reason: "The author has disabled sharing for this post" };
  }
  // Per-destination flags (default: allowed when no settings row exists)
  if (destination === "public" || destination === "lounge") {
    if (sharingSettings && !sharingSettings.allowPublicShares) {
      return { allowed: false, reason: "The author has disabled public sharing for this post" };
    }
  }
  if (destination === "friends") {
    if (sharingSettings && !sharingSettings.allowFriendsShares) {
      return { allowed: false, reason: "The author has disabled friends sharing for this post" };
    }
  }
  if (destination === "private") {
    if (sharingSettings && !sharingSettings.allowPrivateShares) {
      return { allowed: false, reason: "The author has disabled private sharing for this post" };
    }
  }
  if (destination === "group") {
    if (sharingSettings && !sharingSettings.allowGroupShares) {
      return { allowed: false, reason: "The author has disabled group sharing for this post" };
    }
  }

  // 4. Non-public feed sources may NOT be shared to public/lounge destinations.
  //    friends/followers audience: only friends/private destinations allowed.
  if (sourceAuth.feedPost) {
    const audience = sourceAuth.feedPost.audience;
    // only_me already blocked above; friends/followers cannot go public/lounge
    if (
      (audience === "friends" || audience === "followers") &&
      (destination === "public" || destination === "lounge")
    ) {
      return {
        allowed: false,
        reason: "Non-public posts cannot be shared publicly",
      };
    }
  }
  // Group source: private group posts only shareable within the same private group (see #6)
  // Public group posts are shareable to any allowed destination

  // 5. Combined rate limits across wrapper/private/group shares and copy-link actions.
  const rateLimit = await checkCombinedShareActionRateLimit(
    { sharerId: sharer.id, sourceType, sourcePostId },
    queryable,
  );
  if (!rateLimit.allowed) return rateLimit;

  // 6. Private group post: can only be shared within the same private group
  if (sourceType === "group_post" && sourceAuth.group?.privacy === "private") {
    if (destination !== "group" || destinationGroupId !== sourceGroupId) {
      return {
        allowed: false,
        reason: "Private group posts can only be shared within the same private group",
      };
    }
  }

  // 7. Destination=group checks
  if (destination === "group" && destinationGroupId) {
    const [destGroup] = await queryable
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.id, destinationGroupId));
    if (!destGroup || destGroup.status === "deleted" || destGroup.status === "suspended") {
      return { allowed: false, reason: "Destination group is not available" };
    }

    // Must be active member
    const [destMembership] = await queryable
      .select({ status: groupMembersTable.status, role: groupMembersTable.role })
      .from(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, destinationGroupId),
          eq(groupMembersTable.userId, sharer.id),
        ),
      );
    const isPlatformAdmin = sharer.role === "admin";
    const memberRole = destMembership?.status === "active" ? destMembership.role : null;

    if (!memberRole && !isPlatformAdmin) {
      return { allowed: false, reason: "You must be a member to share to this group" };
    }

    // Posting permissions: admins_only → only owner/admin role (or platform admin)
    if (destGroup.postingPermission === "admins_only") {
      const canPost =
        isPlatformAdmin ||
        memberRole === "owner" ||
        memberRole === "admin";
      if (!canPost) {
        return {
          allowed: false,
          reason: "Only group admins can post to this group",
        };
      }
    }
    // approved_members: only members with status=active (already checked above)
    // all_members: all active members allowed (already checked)
  }

  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy-link eligibility (rate-limited, source-restricted)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks eligibility for a copy-link operation.
 * - Suspension check
 * - only_me: denied unless the viewer is the author
 * - Global rate limit: 20 copy-link events/hr/user
 * - Same-source rate limit: 3/hr/user (checks postShareCopyLinksTable)
 */
export async function checkCopyLinkEligibility(opts: {
  sharer: SharerUser;
  sourceType: ShareSourceType;
  sourcePostId: number;
  sourceAuth: SourceAuthResult & { ok: true };
}, queryable: SharingQueryExecutor = db): Promise<SharingEligibility> {
  const { sharer, sourceType, sourcePostId, sourceAuth } = opts;

  // 1. Suspension
  const [suspension] = await queryable
    .select()
    .from(sharingSuspensionsTable)
    .where(
      and(
        eq(sharingSuspensionsTable.userId, sharer.id),
        eq(sharingSuspensionsTable.status, "active"),
      ),
    )
    .limit(1);
  if (suspension) {
    return { allowed: false, reason: "Your sharing privilege has been suspended" };
  }

  // 2. only_me: only allow the author to copy-link their own post
  if (sourceAuth.feedPost?.audience === "only_me") {
    const isAuthor = sourceAuth.feedPost.userId === sharer.id;
    if (!isAuthor) {
      return { allowed: false, reason: "only_me posts cannot be shared" };
    }
  }

  // 3. Author global disable (copy-link respects sharingDisabled)
  const [sharingSettings] = await queryable
    .select()
    .from(postSharingSettingsTable)
    .where(
      and(
        eq(postSharingSettingsTable.sourceType, sourceType),
        eq(postSharingSettingsTable.sourcePostId, sourcePostId),
      ),
    )
    .limit(1);
  if (sharingSettings?.sharingDisabled) {
    return { allowed: false, reason: "The author has disabled sharing for this post" };
  }

  // 4. Combined rate limits across copy-link and all other share actions.
  return checkCombinedShareActionRateLimit(
    { sharerId: sharer.id, sourceType, sourcePostId },
    queryable,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency key generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a deterministic deduplication key for a share operation.
 * Format: sharer:{id}|src:{type}:{postId}:{groupId}|dest:{dest}:{destGroupId}|rcpts:{sorted}
 * copy_link operations return null (always repeatable within rate limits).
 */
export function buildDedupeKey(opts: {
  sharerId: number;
  sourceType: ShareSourceType;
  sourcePostId: number;
  sourceGroupId: number | null;
  destination: ShareDestination;
  destinationGroupId: number | null;
  recipientIds: number[];
}): string | null {
  if (opts.destination === "copy_link") return null;
  const sorted = [...opts.recipientIds].sort((a, b) => a - b).join(",");
  return [
    `sharer:${opts.sharerId}`,
    `src:${opts.sourceType}:${opts.sourcePostId}:${opts.sourceGroupId ?? 0}`,
    `dest:${opts.destination}:${opts.destinationGroupId ?? 0}`,
    `rcpts:${sorted}`,
  ].join("|");
}

// ─────────────────────────────────────────────────────────────────────────────
// Live source preview — always re-authorized for the current viewer
// ─────────────────────────────────────────────────────────────────────────────

type SharedPostPreview =
  | typeof UNAVAILABLE_SOURCE_PREVIEW
  | {
      available: true;
      sourceType: string;
      sourcePostId: number;
      sourceGroupId: number | null;
      canonicalUrl: string;
      audience: string | null;
      groupPrivacy: string | null;
      allowedShareDestinations: ShareDestinationOption[];
      viewerCanCopyLink: boolean;
      text: string;
      mediaUrl: string | null;
      posterUrl: string | null;
      mediaType: string;
      authorName: string;
      authorPhotoUrl: string | null;
      groupName: string | null;
      shareCount: number;
    };

/**
 * Returns a safe live preview of the source post for a share wrapper.
 * If access to the source is lost for any reason, returns UNAVAILABLE_SOURCE_PREVIEW.
 * NEVER caches text/media/identity — always re-authorizes.
 * For business-attributed posts uses safe Business Page identity (name/logo).
 * Never loads owner usersTable identity for business posts.
 */
export async function buildSharedPostPreview(opts: {
  sourceType: ShareSourceType;
  sourcePostId: number;
  sourceGroupId?: number | null;
  viewer: SharerUser | null;
}): Promise<SharedPostPreview> {
  const auth = await authorizeShareSource(
    opts.sourceType,
    opts.sourcePostId,
    opts.sourceGroupId ?? null,
    opts.viewer,
  );
  if (!auth.ok) return UNAVAILABLE_SOURCE_PREVIEW;

  const [settings, suspension] = await Promise.all([
    db
      .select()
      .from(postSharingSettingsTable)
      .where(
        and(
          eq(postSharingSettingsTable.sourceType, opts.sourceType),
          eq(postSharingSettingsTable.sourcePostId, opts.sourcePostId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    opts.viewer
      ? db
          .select({ id: sharingSuspensionsTable.id })
          .from(sharingSuspensionsTable)
          .where(
            and(
              eq(sharingSuspensionsTable.userId, opts.viewer.id),
              eq(sharingSuspensionsTable.status, "active"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
  ]);
  const sharingDisabled = settings?.sharingDisabled ?? false;
  const sharingOptions = {
    sharingDisabled,
    allowPublicShares: settings?.allowPublicShares ?? true,
    allowFriendsShares: settings?.allowFriendsShares ?? true,
    allowPrivateShares: settings?.allowPrivateShares ?? true,
    allowGroupShares: settings?.allowGroupShares ?? true,
    viewerSuspended: !!suspension,
  };

  if (auth.sourceType === "feed_post" && auth.feedPost) {
    const post = auth.feedPost;

    // Business-attributed feed post: use Business Page identity, never usersTable
    if (post.businessId) {
      const [biz] = await db
        .select({ name: businessesTable.name, logoUrl: businessesTable.logoUrl })
        .from(businessesTable)
        .where(eq(businessesTable.id, post.businessId));
      return {
        available: true,
        sourceType: "feed_post",
        sourcePostId: post.id,
        sourceGroupId: null,
        canonicalUrl: getCanonicalShareUrl("feed_post", post.id),
        audience: post.audience,
        groupPrivacy: null,
        allowedShareDestinations: getEffectiveShareDestinations({
          ...sharingOptions,
          sourceAudience: post.audience,
        }),
        viewerCanCopyLink:
          !!opts.viewer &&
          !suspension &&
          !sharingDisabled &&
          (post.audience !== "only_me" || post.userId === opts.viewer.id),
        text: post.text,
        mediaUrl: post.mediaUrl ?? null,
        posterUrl: post.posterUrl ?? null,
        mediaType: post.mediaType,
        authorName: biz?.name ?? "Business Page",
        authorPhotoUrl: biz?.logoUrl ?? null,
        groupName: null,
        shareCount:
          opts.viewer?.role === "admin" || opts.viewer?.id === post.userId
            ? post.shareCount
            : post.publicShareCount + post.groupShareCount,
      };
    }

    // Personal post: load user identity
    const [author] = await db
      .select({ name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
      .from(usersTable)
      .where(eq(usersTable.id, post.userId));
    return {
      available: true,
      sourceType: "feed_post",
      sourcePostId: post.id,
      sourceGroupId: null,
      canonicalUrl: getCanonicalShareUrl("feed_post", post.id),
      audience: post.audience,
      groupPrivacy: null,
      allowedShareDestinations: getEffectiveShareDestinations({
        ...sharingOptions,
        sourceAudience: post.audience,
      }),
      viewerCanCopyLink:
        !!opts.viewer &&
        !suspension &&
        !sharingDisabled &&
        (post.audience !== "only_me" || post.userId === opts.viewer.id),
      text: post.text,
      mediaUrl: post.mediaUrl ?? null,
      posterUrl: post.posterUrl ?? null,
      mediaType: post.mediaType,
      authorName: author?.name ?? "Unknown",
      authorPhotoUrl: author?.profilePhotoUrl ?? null,
      groupName: null,
      shareCount:
        opts.viewer?.role === "admin" || opts.viewer?.id === post.userId
          ? post.shareCount
          : post.publicShareCount + post.groupShareCount,
    };
  }

  if (auth.sourceType === "group_post" && auth.groupPost && auth.group) {
    const post = auth.groupPost;
    const group = auth.group;

    // Business-attributed group post: use Business Page identity; never expose authorUserId/owner
    if (post.businessId) {
      const [biz] = await db
        .select({ name: businessesTable.name, logoUrl: businessesTable.logoUrl })
        .from(businessesTable)
        .where(eq(businessesTable.id, post.businessId));
      return {
        available: true,
        sourceType: "group_post",
        sourcePostId: post.id,
        sourceGroupId: group.id,
        canonicalUrl: getCanonicalShareUrl("group_post", post.id, group.id),
        audience: null,
        groupPrivacy: group.privacy,
        allowedShareDestinations: getEffectiveShareDestinations({
          ...sharingOptions,
          sourceGroupPrivacy: group.privacy,
        }),
        viewerCanCopyLink: !!opts.viewer && !suspension && !sharingDisabled,
        text: post.text,
        mediaUrl: post.mediaUrl ?? null,
        posterUrl: post.posterUrl ?? null,
        mediaType: post.mediaType,
        authorName: biz?.name ?? "Business Page",
        authorPhotoUrl: biz?.logoUrl ?? null,
        groupName: group.name,
        shareCount:
          opts.viewer?.role === "admin" || opts.viewer?.id === post.authorUserId
            ? post.shareCount
            : post.publicShareCount + post.groupShareCount,
      };
    }

    // Non-business group post: load user identity
    const [author] = await db
      .select({ name: usersTable.name, profilePhotoUrl: usersTable.profilePhotoUrl })
      .from(usersTable)
      .where(eq(usersTable.id, post.authorUserId));
    return {
      available: true,
      sourceType: "group_post",
      sourcePostId: post.id,
      sourceGroupId: group.id,
      canonicalUrl: getCanonicalShareUrl("group_post", post.id, group.id),
      audience: null,
      groupPrivacy: group.privacy,
      allowedShareDestinations: getEffectiveShareDestinations({
        ...sharingOptions,
        sourceGroupPrivacy: group.privacy,
      }),
      viewerCanCopyLink: !!opts.viewer && !suspension && !sharingDisabled,
      text: post.text,
      mediaUrl: post.mediaUrl ?? null,
      posterUrl: post.posterUrl ?? null,
      mediaType: post.mediaType,
      authorName: author?.name ?? "Unknown",
      authorPhotoUrl: author?.profilePhotoUrl ?? null,
      groupName: group.name,
      shareCount:
        opts.viewer?.role === "admin" || opts.viewer?.id === post.authorUserId
          ? post.shareCount
          : post.publicShareCount + post.groupShareCount,
    };
  }

  return UNAVAILABLE_SOURCE_PREVIEW;
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer can-share check (for hydration — uses canonical source for wrappers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns whether the viewer can share the given post, plus a reason if not.
 * For wrapper posts, authorizes the canonical original (not just the wrapper).
 * Used to enrich feed/group post responses.
 */
export async function viewerCanSharePost(opts: {
  viewer: SharerUser | null;
  sourceType: ShareSourceType;
  sourcePostId: number;
  sourceGroupId?: number | null;
  feedPost?: FeedPost;
  groupPost?: GroupPost;
}): Promise<{ canShare: boolean; reason: string | null }> {
  if (!opts.viewer) return { canShare: false, reason: "Login to share posts" };

  // Resolve canonical source for wrapper posts
  const canonical = resolveCanonicalSource({
    sourceType: opts.sourceType,
    sourcePostId: opts.sourcePostId,
    sourceGroupId: opts.sourceGroupId ?? null,
    feedPost: opts.feedPost,
    groupPost: opts.groupPost,
  });

  // Re-authorize the canonical source (not just the wrapper)
  const canonicalAuth = await authorizeShareSource(
    canonical.sourceType,
    canonical.sourcePostId,
    canonical.sourceGroupId,
    opts.viewer,
  );
  if (!canonicalAuth.ok) {
    return { canShare: false, reason: "Source post is no longer accessible" };
  }

  // only_me is never shareable
  if (canonicalAuth.feedPost?.audience === "only_me") {
    return { canShare: false, reason: "only_me posts cannot be shared" };
  }

  // Suspension check
  const [suspension] = await db
    .select()
    .from(sharingSuspensionsTable)
    .where(
      and(
        eq(sharingSuspensionsTable.userId, opts.viewer.id),
        eq(sharingSuspensionsTable.status, "active"),
      ),
    )
    .limit(1);
  if (suspension) return { canShare: false, reason: "Sharing privilege suspended" };

  // Author settings
  const [settings] = await db
    .select()
    .from(postSharingSettingsTable)
    .where(
      and(
        eq(postSharingSettingsTable.sourceType, canonical.sourceType),
        eq(postSharingSettingsTable.sourcePostId, canonical.sourcePostId),
      ),
    )
    .limit(1);
  if (settings?.sharingDisabled) {
    return { canShare: false, reason: "Author disabled sharing for this post" };
  }

  return { canShare: true, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipient eligibility (private shares)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns eligible recipient user IDs for a private share.
 * Checks: active account, no bidirectional block, friend or following relationship.
 * Conservative: requires at minimum a friendship or follow relationship.
 */
export async function getEligibleShareRecipients(
  sharerId: number,
  candidateIds: number[],
): Promise<number[]> {
  if (!candidateIds.length) return [];

  // Load blocks (bidirectional)
  const blockRows = await db
    .select()
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, sharerId), inArray(blocksTable.blockedUserId, candidateIds)),
        and(inArray(blocksTable.blockerId, candidateIds), eq(blocksTable.blockedUserId, sharerId)),
      ),
    );
  const blockedIds = new Set<number>();
  for (const b of blockRows) {
    blockedIds.add(b.blockerId === sharerId ? b.blockedUserId : b.blockerId);
  }

  // Load candidate users (accountStatus)
  const candidates = await db
    .select({ id: usersTable.id, accountStatus: usersTable.accountStatus })
    .from(usersTable)
    .where(inArray(usersTable.id, candidateIds));

  const activeCandidateIds = candidates
    .filter((u) => u.accountStatus === "active" && !blockedIds.has(u.id))
    .map((u) => u.id);

  if (!activeCandidateIds.length) return [];

  // Load mutual friendships
  const friendships = await db
    .select()
    .from(friendshipsTable)
    .where(
      or(
        and(
          eq(friendshipsTable.userAId, sharerId),
          inArray(friendshipsTable.userBId, activeCandidateIds),
        ),
        and(
          inArray(friendshipsTable.userAId, activeCandidateIds),
          eq(friendshipsTable.userBId, sharerId),
        ),
      ),
    );
  const friendIds = new Set<number>();
  for (const f of friendships) {
    friendIds.add(f.userAId === sharerId ? f.userBId : f.userAId);
  }

  // Load follows (sharer → candidate)
  const follows = await db
    .select()
    .from(followsTable)
    .where(
      and(
        eq(followsTable.followerId, sharerId),
        inArray(followsTable.followingId, activeCandidateIds),
      ),
    );
  const followingIds = new Set(follows.map((f) => f.followingId));

  // Must be active, unblocked, and have friend or follow relationship
  return candidates
    .filter((u) => {
      if (u.accountStatus !== "active") return false;
      if (blockedIds.has(u.id)) return false;
      return friendIds.has(u.id) || followingIds.has(u.id);
    })
    .map((u) => u.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate private share recipients against source access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that every recipient can currently view the canonical source.
 * Returns a tuple: [eligibleIds, rejectedIds].
 * Callers should reject the request if any recipientId is rejected.
 */
export async function validatePrivateRecipientAccess(
  recipientIds: number[],
  canonical: { sourceType: ShareSourceType; sourcePostId: number; sourceGroupId: number | null },
): Promise<{ eligible: number[]; rejected: number[] }> {
  const eligible: number[] = [];
  const rejected: number[] = [];
  await Promise.all(
    recipientIds.map(async (recipientId) => {
      const recipientUser: SharerUser = { id: recipientId, role: "member", name: "" };
      const auth = await authorizeShareSource(
        canonical.sourceType,
        canonical.sourcePostId,
        canonical.sourceGroupId,
        recipientUser,
      );
      if (auth.ok) {
        eligible.push(recipientId);
      } else {
        rejected.push(recipientId);
      }
    }),
  );
  return { eligible, rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification helper
// ─────────────────────────────────────────────────────────────────────────────

export async function createShareNotification(opts: {
  recipientUserId: number;
  sharerId: number;
  sharerName: string;
  shareId: number;
  sourceType: ShareSourceType;
  sourcePostId: number;
  sourceGroupId?: number | null;
  destination: ShareDestination;
}): Promise<void> {
  if (opts.recipientUserId === opts.sharerId) return; // never self-notify
  // Check block in both directions before notifying
  const isBlocked = await hasBidirectionalBlock(opts.recipientUserId, opts.sharerId);
  if (isBlocked) return;

  const isPrivate = opts.destination === "private";
  const title = isPrivate ? "Shared a post with you" : "Shared your post";
  const message = isPrivate
    ? `${opts.sharerName} shared a post with you`
    : `${opts.sharerName} shared your post`;
  await db.insert(notificationsTable).values({
    userId: opts.recipientUserId,
    type: "post_shared",
    title,
    message,
    relatedUserId: opts.sharerId,
    relatedPostId: opts.sourcePostId,
    relatedGroupId: opts.sourceGroupId ?? null,
  });
}

/**
 * Notifies all active owner/admin/moderator members of a group that a share
 * is pending approval. Does NOT leak source post content in the notification message.
 */
export async function notifyGroupModeratorsSharePending(opts: {
  destinationGroupId: number;
  destinationGroupPostId: number;
  shareId: number;
  sharerId: number;
  sharerName: string;
}): Promise<void> {
  // Load owner/admin/moderator members
  const mods = await db
    .select({ userId: groupMembersTable.userId })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, opts.destinationGroupId),
        eq(groupMembersTable.status, "active"),
        or(
          eq(groupMembersTable.role, "owner"),
          eq(groupMembersTable.role, "admin"),
          eq(groupMembersTable.role, "moderator"),
        ),
      ),
    );
  await Promise.all(
    mods.map(async (mod) => {
      if (mod.userId === opts.sharerId) return; // no self-notify
      const isBlocked = await hasBidirectionalBlock(mod.userId, opts.sharerId);
      if (isBlocked) return;
      await db.insert(notificationsTable).values({
        userId: mod.userId,
        type: "group_share_pending",
        title: "New share pending approval",
        message: `${opts.sharerName} shared a post to the group — review it for approval`,
        relatedUserId: opts.sharerId,
        relatedGroupId: opts.destinationGroupId,
        relatedPostId: opts.destinationGroupPostId,
      });
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Block helper
// ─────────────────────────────────────────────────────────────────────────────

async function hasBidirectionalBlock(userA: number, userB: number): Promise<boolean> {
  if (userA === userB) return false;
  const rows = await db
    .select()
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, userA), eq(blocksTable.blockedUserId, userB)),
        and(eq(blocksTable.blockerId, userB), eq(blocksTable.blockedUserId, userA)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current active suspension for a user, or null.
 */
export async function getActiveSuspension(userId: number) {
  const [row] = await db
    .select()
    .from(sharingSuspensionsTable)
    .where(
      and(
        eq(sharingSuspensionsTable.userId, userId),
        eq(sharingSuspensionsTable.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}
