import { Router, type IRouter } from "express";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  photoAlbumsTable,
  photosTable,
  photoLikesTable,
  photoCommentsTable,
  postReportsTable,
  type Photo,
} from "@workspace/db";
import {
  CreateAlbumBody,
  UploadPhotoBody,
  CreatePhotoCommentBody,
  ReportPhotoBody,
} from "@workspace/api-zod";
import { requireAuth, getSessionUser } from "../lib/auth";
import { loadAuthors } from "../lib/feedHelpers";
import { getRelationship, canView, type Relationship } from "../lib/socialHelpers";
import { createNotification } from "../lib/notify";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

async function photosToResponse(photos: Photo[], viewerId: number | null) {
  const authorIds = [...new Set(photos.map((p) => p.userId))];
  const albumIds = [...new Set(photos.map((p) => p.albumId))];
  const authors = await loadAuthors(authorIds);
  const albums = albumIds.length
    ? await db.select().from(photoAlbumsTable).where(inArray(photoAlbumsTable.id, albumIds))
    : [];
  const albumMap = new Map(albums.map((a) => [a.id, a]));
  const likedSet = new Set<number>();
  if (viewerId != null && photos.length) {
    const likes = await db
      .select()
      .from(photoLikesTable)
      .where(
        and(
          eq(photoLikesTable.userId, viewerId),
          inArray(photoLikesTable.photoId, photos.map((p) => p.id)),
        ),
      );
    likes.forEach((l) => likedSet.add(l.photoId));
  }
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
      viewerLiked: likedSet.has(p.id),
      createdAt: p.createdAt.toISOString(),
    };
  });
}

function albumToResponse(
  album: typeof photoAlbumsTable.$inferSelect,
  photoCount: number,
  coverImageUrl: string | null,
) {
  return {
    id: album.id,
    userId: album.userId,
    title: album.title,
    description: album.description ?? null,
    visibility: album.visibility,
    albumType: album.albumType,
    photoCount,
    coverImageUrl,
    createdAt: album.createdAt.toISOString(),
  };
}

router.get("/albums", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : NaN;
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const rel = await getRelationship(viewer ?? null, userId);
  const albums = await db
    .select()
    .from(photoAlbumsTable)
    .where(eq(photoAlbumsTable.userId, userId))
    .orderBy(desc(photoAlbumsTable.createdAt));
  const visible = albums.filter((a) => canView(a.visibility, rel));
  const result = [];
  for (const album of visible) {
    const photos = await db
      .select()
      .from(photosTable)
      .where(and(eq(photosTable.albumId, album.id), eq(photosTable.status, "active")))
      .orderBy(desc(photosTable.createdAt));
    const visiblePhotos = photos.filter((p) => canView(p.visibility, rel));
    result.push(albumToResponse(album, visiblePhotos.length, visiblePhotos[0]?.imageUrl ?? null));
  }
  res.json(result);
});

router.post("/albums", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = CreateAlbumBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [album] = await db
    .insert(photoAlbumsTable)
    .values({
      userId: user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      visibility: parsed.data.visibility ?? "public",
      albumType: parsed.data.albumType ?? "custom",
    })
    .returning();
  res.status(201).json(albumToResponse(album, 0, null));
});

router.get("/albums/:id/photos", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const id = parseId(req.params.id);
  const [album] = await db.select().from(photoAlbumsTable).where(eq(photoAlbumsTable.id, id));
  if (!album) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  const rel = await getRelationship(viewer ?? null, album.userId);
  if (!canView(album.visibility, rel)) {
    res.status(404).json({ error: "Album not found" });
    return;
  }
  const photos = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.albumId, id), eq(photosTable.status, "active")))
    .orderBy(desc(photosTable.createdAt));
  const visible = photos.filter((p) => canView(p.visibility, rel));
  res.json(await photosToResponse(visible, viewer?.id ?? null));
});

router.post("/albums/:id/photos", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = UploadPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [album] = await db.select().from(photoAlbumsTable).where(eq(photoAlbumsTable.id, id));
  if (!album || album.userId !== user.id) {
    res.status(403).json({ error: "You can only add photos to your own albums" });
    return;
  }
  const [photo] = await db
    .insert(photosTable)
    .values({
      userId: user.id,
      albumId: id,
      imageUrl: parsed.data.imageUrl,
      caption: parsed.data.caption ?? null,
      visibility: parsed.data.visibility ?? album.visibility,
    })
    .returning();
  const [result] = await photosToResponse([photo], user.id);
  res.status(201).json(result);
});

router.get("/photos", async (req, res): Promise<void> => {
  const viewer = await getSessionUser(req);
  const userId = typeof req.query.userId === "string" ? parseInt(req.query.userId, 10) : NaN;
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const rel = await getRelationship(viewer ?? null, userId);
  const photos = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.userId, userId), eq(photosTable.status, "active")))
    .orderBy(desc(photosTable.createdAt));
  // Photo must be visible AND its album must be visible
  const albumIds = [...new Set(photos.map((p) => p.albumId))];
  const albums = albumIds.length
    ? await db.select().from(photoAlbumsTable).where(inArray(photoAlbumsTable.id, albumIds))
    : [];
  const albumVis = new Map(albums.map((a) => [a.id, a.visibility]));
  const visible = photos.filter(
    (p) => canView(p.visibility, rel) && canView(albumVis.get(p.albumId) ?? "public", rel),
  );
  res.json(await photosToResponse(visible, viewer?.id ?? null));
});

router.delete("/photos/:id", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, id));
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  if (photo.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "You can only delete your own photos" });
    return;
  }
  await db.delete(photoLikesTable).where(eq(photoLikesTable.photoId, id));
  await db.delete(photoCommentsTable).where(eq(photoCommentsTable.photoId, id));
  await db.delete(photosTable).where(eq(photosTable.id, id));
  res.sendStatus(204);
});

async function viewerCanSeePhoto(
  photo: Photo,
  viewer: { id: number; role: string } | null,
): Promise<boolean> {
  const rel = await getRelationship(viewer, photo.userId);
  if (rel.isSelf || rel.isAdmin) return true;
  if (rel.viewerBlockedTarget || rel.targetBlockedViewer) return false;
  if (!canView(photo.visibility, rel)) return false;
  const [album] = await db
    .select()
    .from(photoAlbumsTable)
    .where(eq(photoAlbumsTable.id, photo.albumId));
  return canView(album?.visibility ?? "public", rel);
}

router.post("/photos/:id/like", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, id));
  if (!photo || photo.status !== "active" || !(await viewerCanSeePhoto(photo, user))) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(photoLikesTable)
    .where(and(eq(photoLikesTable.photoId, id), eq(photoLikesTable.userId, user.id)));
  let liked: boolean;
  if (existing) {
    const deleted = await db.delete(photoLikesTable).where(eq(photoLikesTable.id, existing.id)).returning();
    if (deleted.length > 0) {
      await db
        .update(photosTable)
        .set({ likeCount: sql`greatest(${photosTable.likeCount} - 1, 0)` })
        .where(eq(photosTable.id, id));
    }
    liked = false;
  } else {
    const inserted = await db
      .insert(photoLikesTable)
      .values({ photoId: id, userId: user.id })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      await db
        .update(photosTable)
        .set({ likeCount: sql`${photosTable.likeCount} + 1` })
        .where(eq(photosTable.id, id));
      if (photo.userId !== user.id) {
        await createNotification({
          userId: photo.userId,
          type: "photo_like",
          title: "New like",
          message: `${user.name} liked your photo`,
          relatedUserId: user.id,
        });
      }
    }
    liked = true;
  }
  const [updated] = await db.select().from(photosTable).where(eq(photosTable.id, id));
  res.json({ liked, likeCount: updated.likeCount });
});

router.get("/photos/:id/comments", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const viewer = await getSessionUser(req);
  const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, id));
  if (!photo || photo.status !== "active" || !(await viewerCanSeePhoto(photo, viewer ?? null))) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  const comments = await db
    .select()
    .from(photoCommentsTable)
    .where(and(eq(photoCommentsTable.photoId, id), eq(photoCommentsTable.status, "active")))
    .orderBy(photoCommentsTable.createdAt);
  const authors = await loadAuthors([...new Set(comments.map((c) => c.userId))]);
  res.json(
    comments.map((c) => {
      const a = authors.get(c.userId);
      return {
        id: c.id,
        postId: c.photoId,
        userId: c.userId,
        userName: a?.user?.name ?? "Unknown",
        username: a?.user?.username ?? null,
        userPhotoUrl: a?.user?.profilePhotoUrl ?? null,
        userRole: a?.user?.role ?? "member",
        userVerified: a?.dollVerified ?? false,
        commentText: c.commentText,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      };
    }),
  );
});

router.post("/photos/:id/comments", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = CreatePhotoCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, id));
  if (!photo || photo.status !== "active" || !(await viewerCanSeePhoto(photo, user))) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  const [comment] = await db
    .insert(photoCommentsTable)
    .values({ photoId: id, userId: user.id, commentText: parsed.data.commentText })
    .returning();
  await db
    .update(photosTable)
    .set({ commentCount: sql`${photosTable.commentCount} + 1` })
    .where(eq(photosTable.id, id));
  if (photo.userId !== user.id) {
    await createNotification({
      userId: photo.userId,
      type: "photo_comment",
      title: "New comment",
      message: `${user.name} commented on your photo`,
      relatedUserId: user.id,
    });
  }
  const authors = await loadAuthors([user.id]);
  const a = authors.get(user.id);
  res.status(201).json({
    id: comment.id,
    postId: comment.photoId,
    userId: comment.userId,
    userName: user.name,
    username: user.username ?? null,
    userPhotoUrl: user.profilePhotoUrl ?? null,
    userRole: user.role,
    userVerified: a?.dollVerified ?? false,
    commentText: comment.commentText,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
  });
});

router.post("/photos/:id/report", requireAuth(), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const id = parseId(req.params.id);
  const parsed = ReportPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, id));
  if (!photo || !(await viewerCanSeePhoto(photo, user))) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  await db.insert(postReportsTable).values({
    targetType: "photo",
    postId: null,
    commentId: null,
    reporterId: user.id,
    reason: parsed.data.reason,
    notes: `photoId=${id}${parsed.data.notes ? ` — ${parsed.data.notes}` : ""}`,
  });
  res.status(201).json({ message: "Report submitted" });
});

export default router;
