import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  photosTable,
  photoAlbumsTable,
  reelsTable,
  feedPostsTable,
  type Photo,
  type Reel,
} from "@workspace/db";
import { loadAuthors } from "../lib/feedHelpers";
import { detailsToResponse, getProfileDetails, getFieldPrivacy, parseJsonArray } from "../lib/socialHelpers";

export async function photosToAdminResponse(photos: Photo[]) {
  const authors = await loadAuthors([...new Set(photos.map((p) => p.userId))]);
  const albumIds = [...new Set(photos.map((p) => p.albumId))];
  const albums = albumIds.length
    ? await db.select().from(photoAlbumsTable).where(inArray(photoAlbumsTable.id, albumIds))
    : [];
  const albumMap = new Map(albums.map((a) => [a.id, a]));
  return photos.map((p) => {
    const a = authors.get(p.userId);
    return {
      id: p.id,
      userId: p.userId,
      userName: a?.user?.name ?? "Unknown",
      userPhotoUrl: a?.user?.profilePhotoUrl ?? null,
      albumId: p.albumId,
      albumTitle: albumMap.get(p.albumId)?.title ?? "",
      imageUrl: p.imageUrl,
      caption: p.caption ?? null,
      visibility: p.visibility,
      status: p.status,
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      viewerLiked: false,
      createdAt: p.createdAt.toISOString(),
    };
  });
}

export async function reelsToAdminResponse(reels: Reel[]) {
  const authors = await loadAuthors([...new Set(reels.map((r) => r.userId))]);
  return reels.map((r) => {
    const a = authors.get(r.userId);
    return {
      id: r.id,
      userId: r.userId,
      userRole: r.userRole,
      userName: a?.user?.name ?? "Unknown",
      username: a?.user?.username ?? null,
      userPhotoUrl: a?.user?.profilePhotoUrl ?? null,
      userVerified: a?.dollVerified ?? false,
      dollId: a?.user?.dollId ?? null,
      videoUrl: r.videoUrl,
      thumbnailUrl: r.thumbnailUrl ?? null,
      caption: r.caption ?? null,
      category: r.category,
      hashtags: parseJsonArray(r.hashtags),
      visibility: r.visibility,
      status: r.status,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
      saveCount: r.saveCount,
      reportCount: r.reportCount,
      viewerLiked: false,
      viewerSaved: false,
      viewerFollowsAuthor: false,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function buildMyProfileDataForAdmin(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;
  const details = detailsToResponse(await getProfileDetails(userId));
  const privacyRows = await getFieldPrivacy(userId);
  const [postRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.userId, userId), eq(feedPostsTable.status, "active")));
  const [reelRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reelsTable)
    .where(and(eq(reelsTable.userId, userId), eq(reelsTable.status, "active")));
  const checklist: [string, boolean][] = [
    ["profilePhoto", !!user.profilePhotoUrl],
    ["coverPhoto", !!details.coverPhotoUrl],
    ["cityState", !!(user.city || details.livesInCity)],
    ["bio", !!details.description],
    ["favoriteHookahFlavor", !!details.favoriteHookahFlavor],
    ["interests", details.interests.length > 0],
    ["firstPost", postRow.c > 0],
    ["firstReel", reelRow.c > 0],
  ];
  const done = checklist.filter(([, ok]) => ok).length;
  return {
    userId,
    name: user.name,
    username: user.username ?? null,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    details,
    fieldPrivacy: privacyRows.map((r) => ({ fieldName: r.fieldName, visibility: r.visibility })),
    profileCompletion: {
      percent: Math.round((done / checklist.length) * 100),
      missing: checklist.filter(([, ok]) => !ok).map(([name]) => name),
    },
  };
}
