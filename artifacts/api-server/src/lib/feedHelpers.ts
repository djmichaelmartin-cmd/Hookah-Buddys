import { inArray, and, eq, or, isNull, sql, type SQL } from "drizzle-orm";
import {
  db,
  usersTable,
  dollsTable,
  postLikesTable,
  postSavesTable,
  followsTable,
  feedPostsTable,
  businessesTable,
  postSharingSettingsTable,
  sharingSuspensionsTable,
  type FeedPost,
  type User,
} from "@workspace/db";
import {
  buildSharedPostPreview,
  getEffectiveShareDestinations,
  type SharerUser,
} from "./sharingPolicy";

/**
 * Public feed lifecycle gate for BUSINESS-ATTRIBUTED feed rows.
 *
 * A canonical feed row that is attributed to a Business Page (businessId set)
 * must obey the page lifecycle: it is publicly visible ONLY when the linked
 * business is status="active" AND isPublished=true. Personal (non-business)
 * rows — businessId IS NULL — are unaffected by this gate.
 *
 * Returned as a SQL predicate to AND into any public feed list/detail query,
 * so management-preview and suspended/unpublished pages never leak canonical
 * business rows through public feed endpoints.
 */
export function feedBusinessLifecycleVisible(): SQL {
  return or(
    isNull(feedPostsTable.businessId),
    inArray(
      feedPostsTable.businessId,
      db
        .select({ id: businessesTable.id })
        .from(businessesTable)
        .where(
          and(
            eq(businessesTable.status, "active"),
            eq(businessesTable.isPublished, true),
          ),
        ),
    ),
  ) as SQL;
}

/**
 * Detail/engagement-path equivalent of feedBusinessLifecycleVisible: given a
 * single already-fetched feed post, resolve whether it passes the business
 * lifecycle gate. Personal rows always pass; business-attributed rows require
 * the linked business to be active AND published. Returns false if the linked
 * business is missing.
 */
export async function feedPostBusinessVisible(post: FeedPost): Promise<boolean> {
  if (post.businessId == null) return true;
  const [biz] = await db
    .select({
      status: businessesTable.status,
      isPublished: businessesTable.isPublished,
    })
    .from(businessesTable)
    .where(eq(businessesTable.id, post.businessId));
  if (!biz) return false;
  return biz.status === "active" && biz.isPublished === true;
}

// Re-export sql to keep a single drizzle import surface if needed later.
export { sql };

export type BusinessAuthor = {
  id: number;
  handle: string;
  name: string;
  logoUrl: string | null;
  verified: boolean;
};

/**
 * Loads safe public business author objects for feed items attributed to a
 * Business Page. Only id/handle/name/logo/verification are exposed — never the
 * owner's personal identity.
 */
export async function loadBusinessAuthors(
  businessIds: number[],
): Promise<Map<number, BusinessAuthor>> {
  const map = new Map<number, BusinessAuthor>();
  if (businessIds.length === 0) return map;
  const rows = await db
    .select({
      id: businessesTable.id,
      handle: businessesTable.handle,
      name: businessesTable.name,
      logoUrl: businessesTable.logoUrl,
      verificationStatus: businessesTable.verificationStatus,
    })
    .from(businessesTable)
    .where(inArray(businessesTable.id, businessIds));
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      handle: r.handle,
      name: r.name,
      logoUrl: r.logoUrl ?? null,
      verified: r.verificationStatus === "verified",
    });
  }
  return map;
}

export type AuthorInfo = {
  user: User | undefined;
  dollVerified: boolean;
};

export async function loadAuthors(userIds: number[]): Promise<Map<number, AuthorInfo>> {
  const map = new Map<number, AuthorInfo>();
  if (userIds.length === 0) return map;
  const users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
  const dollIds = users.map((u) => u.dollId).filter((d): d is number => d != null);
  const dolls = dollIds.length
    ? await db.select().from(dollsTable).where(inArray(dollsTable.id, dollIds))
    : [];
  const dollVerified = new Map(dolls.map((d) => [d.id, d.verified]));
  for (const u of users) {
    map.set(u.id, {
      user: u,
      dollVerified: u.dollId != null ? (dollVerified.get(u.dollId) ?? false) : false,
    });
  }
  return map;
}

export type ViewerFlags = {
  liked: Set<number>;
  saved: Set<number>;
  follows: Set<number>;
};

export async function loadViewerFlags(
  viewerId: number | null,
  postIds: number[],
  authorIds: number[],
): Promise<ViewerFlags> {
  const flags: ViewerFlags = { liked: new Set(), saved: new Set(), follows: new Set() };
  if (viewerId == null) return flags;
  if (postIds.length > 0) {
    const likes = await db
      .select()
      .from(postLikesTable)
      .where(and(eq(postLikesTable.userId, viewerId), inArray(postLikesTable.postId, postIds)));
    likes.forEach((l) => flags.liked.add(l.postId));
    const saves = await db
      .select()
      .from(postSavesTable)
      .where(and(eq(postSavesTable.userId, viewerId), inArray(postSavesTable.postId, postIds)));
    saves.forEach((s) => flags.saved.add(s.postId));
  }
  if (authorIds.length > 0) {
    const follows = await db
      .select()
      .from(followsTable)
      .where(and(eq(followsTable.followerId, viewerId), inArray(followsTable.followingId, authorIds)));
    follows.forEach((f) => flags.follows.add(f.followingId));
  }
  return flags;
}

export type SharingSettings = {
  sharingDisabled: boolean;
  allowPublicShares: boolean;
  allowFriendsShares: boolean;
  allowPrivateShares: boolean;
  allowGroupShares: boolean;
};

export type ShareFlagsMap = Map<
  number,
  {
    shareCount: number;
    publicShareCount: number;
    privateShareCount: number;
    groupShareCount: number;
    linkShareCount: number;
    sharingSettings: SharingSettings;
    sharedPost: Awaited<ReturnType<typeof buildSharedPostPreview>> | null;
  }
>;

export async function loadShareFlags(
  posts: FeedPost[],
  viewer: SharerUser | null,
): Promise<ShareFlagsMap> {
  const map = new Map<
    number,
    {
      shareCount: number;
      publicShareCount: number;
      privateShareCount: number;
      groupShareCount: number;
      linkShareCount: number;
      sharingSettings: SharingSettings;
      sharedPost: Awaited<ReturnType<typeof buildSharedPostPreview>> | null;
    }
  >();

  // Batch load sharing settings
  const postIds = posts.map((p) => p.id);
  const settings =
    postIds.length > 0
      ? await db
          .select()
          .from(postSharingSettingsTable)
          .where(
            and(
              eq(postSharingSettingsTable.sourceType, "feed_post"),
              inArray(postSharingSettingsTable.sourcePostId, postIds),
            ),
          )
      : [];
  const settingsByPostId = new Map(settings.map((s) => [s.sourcePostId, s]));

  // Load share wrappers in parallel
  await Promise.all(
    posts.map(async (post) => {
      const setting = settingsByPostId.get(post.id);
      const sharingSettings: SharingSettings = {
        sharingDisabled: setting?.sharingDisabled ?? false,
        allowPublicShares: setting?.allowPublicShares ?? true,
        allowFriendsShares: setting?.allowFriendsShares ?? true,
        allowPrivateShares: setting?.allowPrivateShares ?? true,
        allowGroupShares: setting?.allowGroupShares ?? true,
      };
      const isWrapper = !!post.shareSourceType && !!post.shareSourcePostId;
      let sharedPost = null;
      if (isWrapper) {
        sharedPost = await buildSharedPostPreview({
          sourceType: post.shareSourceType as "feed_post" | "group_post",
          sourcePostId: post.shareSourcePostId!,
          sourceGroupId: post.shareSourceGroupId ?? null,
          viewer,
        });
      }
      map.set(post.id, {
        shareCount: post.shareCount,
        publicShareCount: post.publicShareCount,
        privateShareCount: post.privateShareCount,
        groupShareCount: post.groupShareCount,
        linkShareCount: post.linkShareCount,
        sharingSettings,
        sharedPost: isWrapper ? sharedPost : null,
      });
    }),
  );

  return map;
}

export function toFeedPostResponse(
  post: FeedPost,
  author: AuthorInfo | undefined,
  flags: ViewerFlags,
  businessAuthor?: BusinessAuthor,
  shareFlags?: {
    shareCount: number;
    publicShareCount?: number;
    privateShareCount?: number;   // only exposed to owner/admin
    groupShareCount?: number;
    linkShareCount?: number;       // only exposed to owner/admin
    sharingSettings?: SharingSettings;
    sharedPost: Awaited<ReturnType<typeof buildSharedPostPreview>> | null;
    viewerCanShare: boolean;
    viewerCanShareReason: string | null;
    allowedShareDestinations: ReturnType<typeof getEffectiveShareDestinations>;
    viewerCanCopyLink: boolean;
    isOwnerOrAdmin?: boolean;     // controls private count visibility
  },
) {
  const u = author?.user;
  // Only business_post feed items are AUTHORED by the page (owner identity
  // hidden). Check-in / event shares keep the real user as author but still
  // carry a `business` navigation object.
  const isBusiness =
    post.source === "business_post" && post.businessId != null && businessAuthor != null;
  const isWrapper = !!post.shareSourceType && !!post.shareSourcePostId;
  return {
    id: post.id,
    userId: post.userId,
    userRole: post.userRole,
    userName: isBusiness ? businessAuthor!.name : (u?.name ?? "Unknown"),
    username: isBusiness ? businessAuthor!.handle : (u?.username ?? null),
    userPhotoUrl: isBusiness ? businessAuthor!.logoUrl : (u?.profilePhotoUrl ?? null),
    buddyType: isBusiness ? null : (u?.buddyType ?? null),
    userVerified: isBusiness ? businessAuthor!.verified : (author?.dollVerified ?? false),
    dollId: isBusiness ? null : (u?.dollId ?? null),
    city: isBusiness ? null : (u?.city ?? null),
    state: isBusiness ? null : (u?.state ?? null),
    // Safe business author + navigation target (/business/:handle).
    source: post.source ?? null,
    sourceId: post.sourceId ?? null,
    businessId: post.businessId ?? null,
    business: isBusiness
      ? {
          id: businessAuthor!.id,
          handle: businessAuthor!.handle,
          name: businessAuthor!.name,
          logoUrl: businessAuthor!.logoUrl,
          verified: businessAuthor!.verified,
          url: `/business/${businessAuthor!.handle}`,
        }
      : null,
    text: post.text,
    mediaUrl: post.mediaUrl ?? null,
    posterUrl: post.posterUrl ?? null,
    mediaType: post.mediaType,
    category: post.category,
    status: post.status,
    audience: post.audience,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    saveCount: post.saveCount,
    reportCount: post.reportCount,
    viewerLiked: flags.liked.has(post.id),
    viewerSaved: flags.saved.has(post.id),
    viewerFollowsAuthor: flags.follows.has(post.userId),
    // Sharing fields
    shareCount: shareFlags?.isOwnerOrAdmin
      ? (shareFlags.shareCount ?? post.shareCount)
      : (shareFlags?.publicShareCount ?? post.publicShareCount) +
        (shareFlags?.groupShareCount ?? post.groupShareCount),
    // Owner/admin see all breakdowns; others see public+group (not private volume)
    publicShareCount: shareFlags?.publicShareCount ?? post.publicShareCount,
    groupShareCount: shareFlags?.groupShareCount ?? post.groupShareCount,
    // Private count only for owner/admin
    privateShareCount: shareFlags?.isOwnerOrAdmin
      ? (shareFlags.privateShareCount ?? post.privateShareCount)
      : undefined,
    linkShareCount: shareFlags?.isOwnerOrAdmin
      ? (shareFlags.linkShareCount ?? post.linkShareCount)
      : undefined,
    viewerCanShare: shareFlags?.viewerCanShare ?? false,
    viewerCanShareReason: shareFlags?.viewerCanShareReason ?? null,
    allowedShareDestinations: shareFlags?.allowedShareDestinations ?? [],
    viewerCanCopyLink: shareFlags?.viewerCanCopyLink ?? false,
    sharingDisabled: shareFlags?.sharingSettings?.sharingDisabled ?? false,
    allowPublicShares: shareFlags?.sharingSettings?.allowPublicShares ?? true,
    allowFriendsShares: shareFlags?.sharingSettings?.allowFriendsShares ?? true,
    allowPrivateShares: shareFlags?.sharingSettings?.allowPrivateShares ?? true,
    allowGroupShares: shareFlags?.sharingSettings?.allowGroupShares ?? true,
    isShareWrapper: isWrapper,
    sharedPost: isWrapper ? (shareFlags?.sharedPost ?? null) : null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export async function hydratePosts(
  posts: FeedPost[],
  viewerId: number | null,
  viewerRole?: string,
) {
  const authorIds = [...new Set(posts.map((p) => p.userId))];
  const authors = await loadAuthors(authorIds);
  const businessIds = [
    ...new Set(posts.map((p) => p.businessId).filter((b): b is number => b != null)),
  ];
  const businessAuthors = await loadBusinessAuthors(businessIds);
  const flags = await loadViewerFlags(
    viewerId,
    posts.map((p) => p.id),
    authorIds,
  );

  // Load share flags (sharing settings + wrapper previews)
  const viewer: SharerUser | null = viewerId
    ? { id: viewerId, role: viewerRole ?? "member", name: "" }
    : null;
  const shareMap = await loadShareFlags(posts, viewer);

  // Batch check suspension once
  let viewerSuspended = false;
  if (viewerId) {
    const [suspRow] = await db
      .select()
      .from(sharingSuspensionsTable)
      .where(
        and(
          eq(sharingSuspensionsTable.userId, viewerId),
          eq(sharingSuspensionsTable.status, "active"),
        ),
      )
      .limit(1);
    viewerSuspended = !!suspRow;
  }

  const isPlatformAdmin = viewerRole === "admin";

  return posts.map((p) => {
    const sf = shareMap.get(p.id);
    const sharingSettings = sf?.sharingSettings ?? {
      sharingDisabled: false,
      allowPublicShares: true,
      allowFriendsShares: true,
      allowPrivateShares: true,
      allowGroupShares: true,
    };
    // only_me is never shareable
    const isOnlyMe = p.audience === "only_me";
    const isWrapper = !!p.shareSourceType && !!p.shareSourcePostId;
    const allowedShareDestinations = isWrapper
      ? sf?.sharedPost?.available
        ? sf.sharedPost.allowedShareDestinations
        : []
      : getEffectiveShareDestinations({
          ...sharingSettings,
          sourceAudience: p.audience,
          viewerSuspended,
        });
    const viewerCanCopyLink = isWrapper
      ? (sf?.sharedPost?.available && sf.sharedPost.viewerCanCopyLink) || false
      : !!viewerId &&
        !viewerSuspended &&
        !sharingSettings.sharingDisabled &&
        (!isOnlyMe || p.userId === viewerId);
    let viewerCanShare = false;
    let viewerCanShareReason: string | null = null;
    if (!viewerId) {
      viewerCanShareReason = "Login to share posts";
    } else if (isOnlyMe) {
      viewerCanShareReason = "only_me posts cannot be shared";
    } else if (viewerSuspended) {
      viewerCanShareReason = "Sharing privilege suspended";
    } else if (sharingSettings.sharingDisabled) {
      viewerCanShareReason = "Author disabled sharing for this post";
    } else if (allowedShareDestinations.length > 0) {
      viewerCanShare = true;
    } else {
      viewerCanShareReason = "No sharing destinations are available for this post";
    }
    // Owner or platform admin: see all breakdown counts
    const isOwnerOrAdmin = isPlatformAdmin || (viewerId != null && p.userId === viewerId);
    return toFeedPostResponse(
      p,
      authors.get(p.userId),
      flags,
      p.businessId != null ? businessAuthors.get(p.businessId) : undefined,
      {
        shareCount: sf?.shareCount ?? p.shareCount,
        publicShareCount: sf?.publicShareCount ?? p.publicShareCount,
        privateShareCount: sf?.privateShareCount ?? p.privateShareCount,
        groupShareCount: sf?.groupShareCount ?? p.groupShareCount,
        linkShareCount: sf?.linkShareCount ?? p.linkShareCount,
        sharingSettings,
        sharedPost: sf?.sharedPost ?? null,
        viewerCanShare,
        viewerCanShareReason,
        allowedShareDestinations,
        viewerCanCopyLink,
        isOwnerOrAdmin,
      },
    );
  });
}
