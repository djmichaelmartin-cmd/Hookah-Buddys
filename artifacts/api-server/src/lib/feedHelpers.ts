import { inArray, and, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  dollsTable,
  postLikesTable,
  postSavesTable,
  followsTable,
  type FeedPost,
  type User,
} from "@workspace/db";

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

export function toFeedPostResponse(post: FeedPost, author: AuthorInfo | undefined, flags: ViewerFlags) {
  const u = author?.user;
  return {
    id: post.id,
    userId: post.userId,
    userRole: post.userRole,
    userName: u?.name ?? "Unknown",
    username: u?.username ?? null,
    userPhotoUrl: u?.profilePhotoUrl ?? null,
    userVerified: author?.dollVerified ?? false,
    dollId: u?.dollId ?? null,
    city: u?.city ?? null,
    state: u?.state ?? null,
    text: post.text,
    mediaUrl: post.mediaUrl ?? null,
    mediaType: post.mediaType,
    category: post.category,
    status: post.status,
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
  const flags = await loadViewerFlags(
    viewerId,
    posts.map((p) => p.id),
    authorIds,
  );
  return posts.map((p) => toFeedPostResponse(p, authors.get(p.userId), flags));
}
