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
  type FeedPost,
  type User,
} from "@workspace/db";

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

export function toFeedPostResponse(
  post: FeedPost,
  author: AuthorInfo | undefined,
  flags: ViewerFlags,
  businessAuthor?: BusinessAuthor,
) {
  const u = author?.user;
  // Only business_post feed items are AUTHORED by the page (owner identity
  // hidden). Check-in / event shares keep the real user as author but still
  // carry a `business` navigation object.
  const isBusiness =
    post.source === "business_post" && post.businessId != null && businessAuthor != null;
  return {
    id: post.id,
    userId: post.userId,
    userRole: post.userRole,
    userName: isBusiness ? businessAuthor!.name : (u?.name ?? "Unknown"),
    username: isBusiness ? businessAuthor!.handle : (u?.username ?? null),
    userPhotoUrl: isBusiness ? businessAuthor!.logoUrl : (u?.profilePhotoUrl ?? null),
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
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export async function hydratePosts(posts: FeedPost[], viewerId: number | null) {
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
  return posts.map((p) =>
    toFeedPostResponse(
      p,
      authors.get(p.userId),
      flags,
      p.businessId != null ? businessAuthors.get(p.businessId) : undefined,
    ),
  );
}
