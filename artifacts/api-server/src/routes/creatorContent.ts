import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  blocksTable,
  creatorAlbumsTable,
  creatorAlbumMediaTable,
  creatorAlbumUnlocksTable,
  creatorRequestSettingsTable,
  creditBalancesTable,
  creditTransactionsTable,
  customContentRequestsTable,
  db,
  dollsTable,
  usersTable,
  customContentDeliveriesTable,
  customMessageMetadataTable,
  messageThreadsTable,
  messagesTable,
} from "@workspace/db";
import {
  AddCreatorAlbumMediaBody,
  UpdateCreatorAlbumMediaBody,
  UpdateCreatorAlbumBody,
  UpdateCreatorRequestSettingsBody,
  CreateCustomRequestBody,
  DeliverCustomRequestBody,
  AcceptCustomRequestBody,
  DisputeCustomRequestBody,
} from "@workspace/api-zod";
import { getSessionUser, requireAuth } from "../lib/auth";
import {
  AbortSpendError,
  holdCredits,
  restoreHeldCredits,
  spendCalculatedCredits,
  spendCredits,
} from "../lib/credits";
import { createNotification } from "../lib/notify";
import { reconcileCustomRequestDeadlines } from "../lib/customRequestReconciliation";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";
import {
  toObjectEntityPath,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
} from "../lib/imageUploads";
import { streamValidatedObject } from "./storage";

const router: IRouter = Router();
const id = (value: string | string[]) =>
  Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
const costFor = (
  type: string,
  s: typeof creatorRequestSettingsTable.$inferSelect,
) =>
  type === "custom_photo"
    ? s.photoPriceCredits
    : type === "custom_video"
      ? s.videoPriceCredits
      : s.photoVideoPriceCredits;

const storage = new ObjectStorageService();

async function getActiveSessionUser(req: Request) {
  const user = await getSessionUser(req);
  return user &&
    user.accountStatus !== "banned" &&
    user.accountStatus !== "suspended"
    ? user
    : undefined;
}

async function hasBidirectionalBlock(firstUserId: number, secondUserId: number) {
  if (firstUserId === secondUserId) return false;
  const [block] = await db
    .select({ id: blocksTable.id })
    .from(blocksTable)
    .where(
      or(
        and(
          eq(blocksTable.blockerId, firstUserId),
          eq(blocksTable.blockedUserId, secondUserId),
        ),
        and(
          eq(blocksTable.blockerId, secondUserId),
          eq(blocksTable.blockedUserId, firstUserId),
        ),
      ),
    )
    .limit(1);
  return Boolean(block);
}

const DEFAULT_ALBUMS = [
  {
    albumType: "free_preview",
    title: "Free Album",
    description: "Browse this Creator's free photos.",
  },
  {
    albumType: "cloud_vibes",
    title: "Cool Album",
    description: "May include both photos and videos. Permanent access for 25 credits.",
  },
  {
    albumType: "smokin_hot",
    title: "Smokin Hot Album",
    description: "May include both photos and videos. Includes the Cool Album with permanent access.",
  },
] as const;

async function ensureDefaultAlbums(creatorId: number) {
  const [doll] = await db
    .select()
    .from(dollsTable)
    .where(
      and(
        eq(dollsTable.userId, creatorId),
        eq(dollsTable.applicationStatus, "approved"),
      ),
    );
  if (!doll) return null;
  await db
    .insert(creatorAlbumsTable)
    .values(
      DEFAULT_ALBUMS.map((album) => ({
        creatorUserId: creatorId,
        dollId: doll.id,
        ...album,
      })),
    )
    .onConflictDoNothing();
  return doll;
}

async function validatePrivateCreatorMedia(
  rawPath: string,
  ownerId: number,
  mediaType: "image" | "video",
): Promise<string> {
  const objectPath = storage.normalizeObjectEntityPath(rawPath);
  if (!objectPath.startsWith("/objects/"))
    throw new Error("Media must be an App Storage object");
  const file = await storage.getObjectEntityFile(objectPath);
  const [metadata] = await file.getMetadata();
  const policy = await getObjectAclPolicy(file);
  const validType =
    mediaType === "image"
      ? ALLOWED_IMAGE_TYPES.has(String(metadata.contentType))
      : ALLOWED_VIDEO_TYPES.has(String(metadata.contentType));
  if (
    policy?.owner !== String(ownerId) ||
    policy.visibility !== "private" ||
    !validType
  ) {
    throw new Error("Media must be a private creator-owned matching upload");
  }
  return objectPath;
}

function availability(
  settings: typeof creatorRequestSettingsTable.$inferSelect | undefined,
  creator: typeof usersTable.$inferSelect | undefined,
  doll: typeof dollsTable.$inferSelect | undefined,
) {
  return Boolean(
    settings?.enabled &&
    creator?.accountStatus === "active" &&
    doll?.applicationStatus === "approved" &&
    creator.lastActiveAt &&
    creator.lastActiveAt.getTime() >= Date.now() - 10 * 60 * 1000,
  );
}

router.get("/creator-albums/:creatorUserId", async (req, res) => {
  const viewer = await getActiveSessionUser(req);
  const creatorId = id(req.params.creatorUserId);
  const doll = await ensureDefaultAlbums(creatorId);
  if (!doll) return void res.status(404).json({ error: "Creator not found" });
  if (
    viewer &&
    viewer.role !== "admin" &&
    viewer.id !== creatorId &&
    (await hasBidirectionalBlock(viewer.id, creatorId))
  ) {
    return void res.status(403).json({ error: "Creator content unavailable" });
  }
  const albums = await db
    .select()
    .from(creatorAlbumsTable)
    .where(eq(creatorAlbumsTable.creatorUserId, creatorId))
    .orderBy(
      sql`case ${creatorAlbumsTable.albumType}
        when 'free_preview' then 1
        when 'cloud_vibes' then 2
        when 'smokin_hot' then 3
        else 4 end`,
    );
  const entitled = new Set<number>();
  if (viewer?.role === "admin" || viewer?.id === creatorId)
    albums.forEach((a) => entitled.add(a.id));
  else if (viewer)
    (
      await db
        .select()
        .from(creatorAlbumUnlocksTable)
        .where(eq(creatorAlbumUnlocksTable.memberUserId, viewer.id))
    ).forEach((u) => entitled.add(u.albumId));
  const media = albums.length
    ? await db
        .select()
        .from(creatorAlbumMediaTable)
        .where(
          inArray(
            creatorAlbumMediaTable.albumId,
            albums.map((a) => a.id),
          ),
        )
    : [];
  res.json(
    albums.map((a) => {
      const canManage = viewer?.role === "admin" || viewer?.id === creatorId;
      const visible = media.filter(
        (m) =>
          m.albumId === a.id &&
          (canManage ? m.status !== "removed" : m.status === "active"),
      );
      const unlocked =
        a.isActive &&
        (a.albumType === "free_preview" || entitled.has(a.id));
      return {
        ...a,
        unlocked,
        media: visible
          .slice(0, a.albumType === "free_preview" ? 5 : visible.length)
          .map((m) =>
            unlocked
              ? {
                  ...m,
                  objectPath: `/api/creator-albums/${a.id}/media/${m.id}/content`,
                  thumbnailObjectPath: null,
                  posterObjectPath: null,
                }
              : {
                  id: m.id,
                  albumId: m.albumId,
                  mediaType: m.mediaType,
                  status: m.status,
                  sortOrder: m.sortOrder,
                  caption: m.caption,
                  thumbnailObjectPath: m.thumbnailObjectPath,
                  posterObjectPath: null,
                },
          ),
      };
    }),
  );
});

router.get(
  "/creator-albums/:albumId/media/:mediaId/content",
  async (req, res) => {
    const [row] = await db
      .select({ album: creatorAlbumsTable, media: creatorAlbumMediaTable })
      .from(creatorAlbumMediaTable)
      .innerJoin(
        creatorAlbumsTable,
        eq(creatorAlbumsTable.id, creatorAlbumMediaTable.albumId),
      )
      .where(
        and(
          eq(creatorAlbumsTable.id, id(req.params.albumId)),
          eq(creatorAlbumMediaTable.id, id(req.params.mediaId)),
          eq(creatorAlbumsTable.isActive, true),
          eq(creatorAlbumMediaTable.status, "active"),
        ),
      );
    if (!row) return void res.status(404).json({ error: "Media not found" });

    let canView = row.album.albumType === "free_preview";
    const viewer = await getActiveSessionUser(req);
    if (
      viewer &&
      viewer.role !== "admin" &&
      viewer.id !== row.album.creatorUserId &&
      (await hasBidirectionalBlock(viewer.id, row.album.creatorUserId))
    ) {
      return void res.status(404).json({ error: "Media not found" });
    }
    if (viewer?.role === "admin" || viewer?.id === row.album.creatorUserId) {
      canView = true;
    } else if (viewer && !canView) {
      const [unlock] = await db
        .select({ id: creatorAlbumUnlocksTable.id })
        .from(creatorAlbumUnlocksTable)
        .where(
          and(
            eq(creatorAlbumUnlocksTable.memberUserId, viewer.id),
            eq(creatorAlbumUnlocksTable.albumId, row.album.id),
          ),
        );
      canView = Boolean(unlock);
    }
    if (!canView) return void res.status(404).json({ error: "Media not found" });

    try {
      const file = await storage.getObjectEntityFile(row.media.objectPath);
      await streamValidatedObject(file, req, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return void res.status(404).json({ error: "Media not found" });
      }
      throw error;
    }
  },
);

router.patch(
  "/creator/albums/:albumId",
  requireAuth("doll"),
  async (req, res) => {
    const parsed = UpdateCreatorAlbumBody.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.message });
    }
    const [album] = await db
      .update(creatorAlbumsTable)
      .set(parsed.data)
      .where(
        and(
          eq(creatorAlbumsTable.id, id(req.params.albumId)),
          eq(creatorAlbumsTable.creatorUserId, req.currentUser!.id),
        ),
      )
      .returning();
    if (!album) return void res.status(404).json({ error: "Album not found" });
    const media = await db
      .select()
      .from(creatorAlbumMediaTable)
      .where(eq(creatorAlbumMediaTable.albumId, album.id));
    res.json({ ...album, unlocked: true, media });
  },
);
router.post(
  "/creator/albums/:albumId/media",
  requireAuth("doll"),
  async (req, res) => {
    const parsed = AddCreatorAlbumMediaBody.safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({ error: parsed.error.message });
    const user = req.currentUser!;
    await ensureDefaultAlbums(user.id);
    let objectPath: string;
    try {
      objectPath = await validatePrivateCreatorMedia(
        parsed.data.objectPath,
        user.id,
        parsed.data.mediaType,
      );
    } catch (error) {
      if (error instanceof ObjectNotFoundError)
        return void res
          .status(400)
          .json({ error: "Album media was not found" });
      return void res
        .status(400)
        .json({
          error: error instanceof Error ? error.message : "Invalid album media",
        });
    }
    const result = await db.transaction(async (tx) => {
      const [album] = await tx
        .select()
        .from(creatorAlbumsTable)
        .where(
          and(
            eq(creatorAlbumsTable.id, id(req.params.albumId)),
            eq(creatorAlbumsTable.creatorUserId, user.id),
          ),
        )
        .for("update");
      if (!album) return null;
      if (album.albumType === "free_preview") {
        const [{ count }] = await tx
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(creatorAlbumMediaTable)
          .where(
            and(
              eq(creatorAlbumMediaTable.albumId, album.id),
              sql`${creatorAlbumMediaTable.status} <> 'removed'`,
            ),
          );
        if (count >= 5) return "limit" as const;
      }
      const [media] = await tx
        .insert(creatorAlbumMediaTable)
        .values({
          albumId: album.id,
          creatorUserId: user.id,
          ...parsed.data,
          objectPath,
          status: "active",
        })
        .returning();
      return media;
    });
    if (result === "limit")
      return void res
        .status(409)
        .json({
          error: "Free preview albums may contain at most five media items",
        });
    if (!result) return void res.status(404).json({ error: "Album not found" });
    res.status(201).json(result);
  },
);
router.delete(
  "/creator/albums/:albumId/media/:mediaId",
  requireAuth("doll"),
  async (req, res) => {
    const r = await db
      .update(creatorAlbumMediaTable)
      .set({ status: "removed" })
      .where(
        and(
          eq(creatorAlbumMediaTable.id, id(req.params.mediaId)),
          eq(creatorAlbumMediaTable.albumId, id(req.params.albumId)),
          eq(creatorAlbumMediaTable.creatorUserId, req.currentUser!.id),
        ),
      )
      .returning();
    if (!r[0]) return void res.status(404).json({ error: "Media not found" });
    res.sendStatus(204);
  },
);
router.patch(
  "/creator/albums/:albumId/media/:mediaId",
  requireAuth("doll"),
  async (req, res) => {
    const p = UpdateCreatorAlbumMediaBody.safeParse(req.body);
    if (!p.success)
      return void res.status(400).json({ error: p.error.message });
    const [m] = await db
      .update(creatorAlbumMediaTable)
      .set(p.data)
      .where(
        and(
          eq(creatorAlbumMediaTable.id, id(req.params.mediaId)),
          eq(creatorAlbumMediaTable.albumId, id(req.params.albumId)),
          eq(creatorAlbumMediaTable.creatorUserId, req.currentUser!.id),
        ),
      )
      .returning();
    if (!m) return void res.status(404).json({ error: "Media not found" });
    res.json(m);
  },
);
router.get(
  "/creator/request-settings",
  requireAuth("doll"),
  async (req, res) => {
    const [s] = await db
      .select()
      .from(creatorRequestSettingsTable)
      .where(
        eq(creatorRequestSettingsTable.creatorUserId, req.currentUser!.id),
      );
    res.json(
      s ?? {
        enabled: false,
        photoPriceCredits: 50,
        videoPriceCredits: 150,
        photoVideoPriceCredits: 200,
        allowReuse: false,
        instructions: null,
      },
    );
  },
);
router.put(
  "/creator/request-settings",
  requireAuth("doll"),
  async (req, res) => {
    const p = UpdateCreatorRequestSettingsBody.safeParse(req.body);
    if (!p.success)
      return void res.status(400).json({ error: p.error.message });
    const [s] = await db
      .insert(creatorRequestSettingsTable)
      .values({ creatorUserId: req.currentUser!.id, ...p.data })
      .onConflictDoUpdate({
        target: creatorRequestSettingsTable.creatorUserId,
        set: p.data,
      })
      .returning();
    res.json(s);
  },
);
router.get(
  "/creators/:creatorUserId/request-availability",
  async (req, res) => {
    const creatorId = id(req.params.creatorUserId);
    const [settings] = await db
      .select()
      .from(creatorRequestSettingsTable)
      .where(eq(creatorRequestSettingsTable.creatorUserId, creatorId));
    const [creator] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, creatorId));
    const [doll] = creator
      ? await db
          .select()
          .from(dollsTable)
          .where(eq(dollsTable.userId, creator.id))
      : [];
    let blocked = false;
    const viewer = await getActiveSessionUser(req);
    if (viewer) {
      const rows = await db
        .select({ id: blocksTable.id })
        .from(blocksTable)
        .where(
          or(
            and(
              eq(blocksTable.blockerId, viewer.id),
              eq(blocksTable.blockedUserId, creatorId),
            ),
            and(
              eq(blocksTable.blockerId, creatorId),
              eq(blocksTable.blockedUserId, viewer.id),
            ),
          ),
        );
      blocked = rows.length > 0;
    }
    res.json({
      enabled: Boolean(settings?.enabled) && !blocked,
      onlineEligible: availability(settings, creator, doll) && !blocked,
      photoPriceCredits: settings?.photoPriceCredits ?? 50,
      videoPriceCredits: settings?.videoPriceCredits ?? 150,
      photoVideoPriceCredits: settings?.photoVideoPriceCredits ?? 200,
      instructions: settings?.instructions ?? null,
      allowReuse: settings?.allowReuse ?? false,
    });
  },
);

router.post(
  "/creator-albums/:albumId/unlock",
  requireAuth("member"),
  async (req, res) => {
    const user = req.currentUser!;
    const [a] = await db
      .select()
      .from(creatorAlbumsTable)
      .where(eq(creatorAlbumsTable.id, id(req.params.albumId)));
    if (!a || !a.isActive || a.albumType === "free_preview")
      return void res.status(404).json({ error: "Album not found" });
    if (await hasBidirectionalBlock(user.id, a.creatorUserId))
      return void res.status(403).json({ error: "Creator content unavailable" });
    const existing = async () =>
      (
        await db
          .select()
          .from(creatorAlbumUnlocksTable)
          .where(
            and(
              eq(creatorAlbumUnlocksTable.memberUserId, user.id),
              eq(creatorAlbumUnlocksTable.albumId, a.id),
            ),
          )
      )[0];
    let unlock = await existing();
    if (!unlock) {
      try {
        const spend = await spendCalculatedCredits(user.id, async (tx) => {
          const [cloud] = await tx
            .select()
            .from(creatorAlbumsTable)
            .where(
              and(
                eq(creatorAlbumsTable.creatorUserId, a.creatorUserId),
                eq(creatorAlbumsTable.albumType, "cloud_vibes"),
              ),
            );
          const [cloudUnlock] =
            a.albumType === "smokin_hot" && cloud
              ? await tx
                  .select()
                  .from(creatorAlbumUnlocksTable)
                  .where(
                    and(
                      eq(creatorAlbumUnlocksTable.memberUserId, user.id),
                      eq(creatorAlbumUnlocksTable.albumId, cloud.id),
                    ),
                  )
              : [];
          const cost =
            a.albumType === "cloud_vibes" ? 25 : cloudUnlock ? 75 : 100;
          return {
            cost,
            action: async (actionTx) => {
              const [u] = await actionTx
                .insert(creatorAlbumUnlocksTable)
                .values({
                  memberUserId: user.id,
                  creatorUserId: a.creatorUserId,
                  albumId: a.id,
                  albumType: a.albumType,
                  priceCredits: cost,
                })
                .onConflictDoNothing()
                .returning();
              if (!u) throw new AbortSpendError();
              if (a.albumType === "smokin_hot" && cloud) {
                await actionTx
                  .insert(creatorAlbumUnlocksTable)
                  .values({
                    memberUserId: user.id,
                    creatorUserId: a.creatorUserId,
                    albumId: cloud.id,
                    albumType: "cloud_vibes",
                    priceCredits: 0,
                  })
                  .onConflictDoNothing();
              }
              await actionTx.insert(creditTransactionsTable).values({
                userId: user.id,
                amount: -cost,
                type: "spend",
                description: "Unlocked creator album",
                creatorAlbumUnlockId: u.id,
              });
              return u;
            },
          };
        });
        if (!spend.ok)
          return void res.status(402).json({ error: "Not enough credits" });
        unlock = spend.result;
      } catch (e) {
        if (!(e instanceof AbortSpendError)) throw e;
        unlock = await existing();
      }
    }
    res.status(201).json(unlock);
  },
);
router.post("/custom-requests", requireAuth("member"), async (req, res) => {
  await reconcileCustomRequestDeadlines();
  const p = CreateCustomRequestBody.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: p.error.message });
  const u = req.currentUser!;
  if (u.id === p.data.creatorUserId)
    return void res
      .status(400)
      .json({ error: "You cannot request your own content" });
  const [settings] = await db
    .select()
    .from(creatorRequestSettingsTable)
    .where(eq(creatorRequestSettingsTable.creatorUserId, p.data.creatorUserId));
  const [creator] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, p.data.creatorUserId));
  const [doll] = creator
    ? await db
        .select()
        .from(dollsTable)
        .where(eq(dollsTable.userId, creator.id))
    : [];
  const blocked = await db
    .select()
    .from(blocksTable)
    .where(
      or(
        and(
          eq(blocksTable.blockerId, u.id),
          eq(blocksTable.blockedUserId, p.data.creatorUserId),
        ),
        and(
          eq(blocksTable.blockerId, p.data.creatorUserId),
          eq(blocksTable.blockedUserId, u.id),
        ),
      ),
    );
  if (
    !settings?.enabled ||
    !creator ||
    !doll ||
    creator.accountStatus !== "active" ||
    doll.applicationStatus !== "approved" ||
    !creator.lastActiveAt ||
    creator.lastActiveAt.getTime() < Date.now() - 600000 ||
    blocked[0]
  )
    return void res.status(403).json({ error: "Creator is not eligible" });
  const existing = (
    await db
      .select()
      .from(customContentRequestsTable)
      .where(
        and(
          eq(customContentRequestsTable.customerUserId, u.id),
          eq(customContentRequestsTable.idempotencyKey, p.data.idempotencyKey),
        ),
      )
  )[0];
  if (existing) return void res.status(201).json(existing);
  const price = costFor(p.data.requestType, settings);
  let request: typeof customContentRequestsTable.$inferSelect | null;
  try {
    request = await db.transaction(async (tx) => {
      const hold = await holdCredits(tx, u.id, price);
      if (!hold) return null;
      const [r] = await tx
        .insert(customContentRequestsTable)
        .values({
          customerUserId: u.id,
          creatorUserId: creator.id,
          dollId: doll.id,
          idempotencyKey: p.data.idempotencyKey,
          requestType: p.data.requestType,
          requestText: p.data.requestText,
          customerAllowsReuse: p.data.allowReuse,
          priceCredits: price,
          heldMembershipCredits: hold.membershipCredits,
          heldPurchasedCredits: hold.purchasedCredits,
          responseDeadlineAt: new Date(Date.now() + 7200000),
        })
        .onConflictDoNothing()
        .returning();
      if (!r) throw new AbortSpendError();
      await tx.insert(creditTransactionsTable).values({
        userId: u.id,
        amount: -price,
        type: "hold",
        description: "Custom request hold",
        customContentRequestId: r.id,
        dollId: doll.id,
      });
      return r;
    });
  } catch (error) {
    if (!(error instanceof AbortSpendError)) throw error;
    [request = null] = await db
      .select()
      .from(customContentRequestsTable)
      .where(
        and(
          eq(customContentRequestsTable.customerUserId, u.id),
          eq(customContentRequestsTable.idempotencyKey, p.data.idempotencyKey),
        ),
      );
    if (!request) throw error;
  }
  if (!request)
    return void res.status(402).json({ error: "Not enough credits" });
  await createNotification({
    userId: creator.id,
    type: "custom_request",
    title: "New custom request",
    message: "A member sent a custom request",
    relatedUserId: u.id,
  });
  res.status(201).json(request);
});
router.get(
  "/custom-requests",
  requireAuth("member", "doll"),
  async (req, res) => {
    await reconcileCustomRequestDeadlines();
    const u = req.currentUser!;
    res.json(
      await db
        .select()
        .from(customContentRequestsTable)
        .where(
          u.role === "member"
            ? eq(customContentRequestsTable.customerUserId, u.id)
            : eq(customContentRequestsTable.creatorUserId, u.id),
        ),
    );
  },
);

async function refundRequest(
  requestId: number,
  actorId: number,
  permitted: (r: typeof customContentRequestsTable.$inferSelect) => boolean,
  status: "declined" | "cancelled",
  allowedStatuses = ["pending_creator_response"],
) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(customContentRequestsTable)
      .where(eq(customContentRequestsTable.id, requestId))
      .for("update");
    if (
      !request ||
      !permitted(request) ||
      !allowedStatuses.includes(request.status) ||
      request.holdStatus !== "held"
    )
      return null;
    await restoreHeldCredits(tx, request.customerUserId, {
      membershipCredits: request.heldMembershipCredits,
      purchasedCredits: request.heldPurchasedCredits,
    });
    const [updated] = await tx
      .update(customContentRequestsTable)
      .set({
        status,
        holdStatus: "refunded",
        refundedAt: new Date(),
        ...(status === "declined"
          ? { declinedAt: new Date() }
          : { canceledAt: new Date() }),
      })
      .where(eq(customContentRequestsTable.id, request.id))
      .returning();
    await tx.insert(creditTransactionsTable).values({
      userId: request.customerUserId,
      amount: request.priceCredits,
      type: "refund",
      description: `Custom request ${status}`,
      customContentRequestId: request.id,
      dollId: request.dollId,
    });
    return updated;
  });
}

router.get("/custom-requests/:id", requireAuth(), async (req, res) => {
  await reconcileCustomRequestDeadlines();
  const [request] = await db
    .select()
    .from(customContentRequestsTable)
    .where(eq(customContentRequestsTable.id, id(req.params.id)));
  if (
    !request ||
    (req.currentUser!.role !== "admin" &&
      request.customerUserId !== req.currentUser!.id &&
      request.creatorUserId !== req.currentUser!.id)
  ) {
    return void res.status(404).json({ error: "Request not found" });
  }
  res.json(request);
});

router.post(
  "/custom-requests/:id/accept",
  requireAuth("doll"),
  async (req, res) => {
    await reconcileCustomRequestDeadlines();
    const parsed = AcceptCustomRequestBody.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: parsed.error.message });
    }
    const result = await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(customContentRequestsTable)
        .where(
          and(
            eq(customContentRequestsTable.id, id(req.params.id)),
            eq(customContentRequestsTable.creatorUserId, req.currentUser!.id),
          ),
        )
        .for("update");
      if (
        !request ||
        request.status !== "pending_creator_response" ||
        request.holdStatus !== "held" ||
        request.responseDeadlineAt <= new Date()
      ) {
        return null;
      }
      const [block] = await tx
        .select({ id: blocksTable.id })
        .from(blocksTable)
        .where(
          or(
            and(
              eq(blocksTable.blockerId, request.customerUserId),
              eq(blocksTable.blockedUserId, request.creatorUserId),
            ),
            and(
              eq(blocksTable.blockerId, request.creatorUserId),
              eq(blocksTable.blockedUserId, request.customerUserId),
            ),
          ),
        );
      if (block) {
        await restoreHeldCredits(tx, request.customerUserId, {
          membershipCredits: request.heldMembershipCredits,
          purchasedCredits: request.heldPurchasedCredits,
        });
        const [refunded] = await tx
          .update(customContentRequestsTable)
          .set({
            status: "declined",
            holdStatus: "refunded",
            declinedAt: new Date(),
            refundedAt: new Date(),
          })
          .where(eq(customContentRequestsTable.id, request.id))
          .returning();
        await tx.insert(creditTransactionsTable).values({
          userId: request.customerUserId,
          amount: request.priceCredits,
          type: "refund",
          description: "Custom request declined after participant block",
          customContentRequestId: request.id,
          dollId: request.dollId,
        });
        return { blocked: true as const, request: refunded };
      }
      const [updated] = await tx
        .update(customContentRequestsTable)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          creatorAgreesReuse: parsed.data.creatorAgreesReuse,
          deliveryDeadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        })
        .where(eq(customContentRequestsTable.id, request.id))
        .returning();
      return { blocked: false as const, request: updated };
    });
    if (!result)
      return void res.status(409).json({ error: "Request cannot be accepted" });
    if (result.blocked) {
      return void res.status(409).json({
        error: "Request was refunded because the participants are blocked",
      });
    }
    const request = result.request;
    await createNotification({
      userId: request.customerUserId,
      type: "custom_request_accepted",
      title: "Request accepted",
      message: "Your custom request was accepted",
      relatedUserId: request.creatorUserId,
    });
    res.json(request);
  },
);

async function streamCustomRequestMedia(
  req: Request,
  res: Response,
  kind: "image" | "video",
) {
  const [request] = await db
    .select()
    .from(customContentRequestsTable)
    .where(eq(customContentRequestsTable.id, id(req.params.id)));
  const user = req.currentUser!;
  if (
    !request ||
    (user.role !== "admin" &&
      user.id !== request.customerUserId &&
      user.id !== request.creatorUserId)
  ) {
    return void res.status(404).json({ error: "Request media not found" });
  }
  if (
    user.role !== "admin" &&
    (await hasBidirectionalBlock(
      request.customerUserId,
      request.creatorUserId,
    ))
  ) {
    return void res.status(404).json({ error: "Request media not found" });
  }
  const [delivery] = await db
    .select()
    .from(customContentDeliveriesTable)
    .where(eq(customContentDeliveriesTable.requestId, request.id));
  if (!delivery)
    return void res.status(404).json({ error: "Request media not found" });
  const objectPath =
    kind === "image" ? delivery.imageObjectPath : delivery.videoObjectPath;
  if (!objectPath)
    return void res.status(404).json({ error: "Request media not found" });
  try {
    await streamValidatedObject(
      await storage.getObjectEntityFile(objectPath),
      req,
      res,
    );
  } catch (error) {
    if (error instanceof ObjectNotFoundError)
      return void res.status(404).json({ error: "Request media not found" });
    throw error;
  }
}

router.get("/custom-requests/:id/media/image", requireAuth(), (req, res) =>
  streamCustomRequestMedia(req, res, "image"),
);
router.get("/custom-requests/:id/media/video", requireAuth(), (req, res) =>
  streamCustomRequestMedia(req, res, "video"),
);

router.post(
  "/custom-requests/:id/decline",
  requireAuth("doll"),
  async (req, res) => {
    const request = await refundRequest(
      id(req.params.id),
      req.currentUser!.id,
      (r) => r.creatorUserId === req.currentUser!.id,
      "declined",
    );
    if (!request)
      return void res.status(409).json({ error: "Request cannot be declined" });
    await createNotification({
      userId: request.customerUserId,
      type: "custom_request_declined",
      title: "Request declined",
      message: "Your credits were refunded",
      relatedUserId: request.creatorUserId,
    });
    res.json(request);
  },
);
router.post(
  "/custom-requests/:id/cancel",
  requireAuth("member"),
  async (req, res) => {
    const request = await refundRequest(
      id(req.params.id),
      req.currentUser!.id,
      (r) => r.customerUserId === req.currentUser!.id,
      "cancelled",
    );
    if (!request)
      return void res
        .status(409)
        .json({ error: "Request cannot be cancelled" });
    await createNotification({
      userId: request.creatorUserId,
      type: "custom_request_cancelled",
      title: "Request cancelled",
      message: "The member cancelled their custom request",
      relatedUserId: request.customerUserId,
    });
    res.json(request);
  },
);

router.get("/admin/custom-requests", requireAuth("admin"), async (req, res) => {
  const status =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const creatorUserId =
    typeof req.query.creatorUserId === "string"
      ? id(req.query.creatorUserId)
      : undefined;
  const customerUserId =
    typeof req.query.customerUserId === "string"
      ? id(req.query.customerUserId)
      : undefined;
  const filters = [
    status ? eq(customContentRequestsTable.status, status) : undefined,
    Number.isFinite(creatorUserId)
      ? eq(customContentRequestsTable.creatorUserId, creatorUserId!)
      : undefined,
    Number.isFinite(customerUserId)
      ? eq(customContentRequestsTable.customerUserId, customerUserId!)
      : undefined,
  ].filter(Boolean);
  res.json(
    await db
      .select()
      .from(customContentRequestsTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(customContentRequestsTable.createdAt))
      .limit(200),
  );
});

async function adminRefund(requestId: number) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(customContentRequestsTable)
      .where(eq(customContentRequestsTable.id, requestId))
      .for("update");
    if (!request) return null;
    if (request.holdStatus === "refunded") return request;
    if (!["held", "settled"].includes(request.holdStatus)) return null;
    await restoreHeldCredits(tx, request.customerUserId, {
      membershipCredits: request.heldMembershipCredits,
      purchasedCredits: request.heldPurchasedCredits,
    });
    if (request.holdStatus === "settled") {
      await tx
        .insert(creditBalancesTable)
        .values({
          userId: request.creatorUserId,
          purchasedBalance: -request.priceCredits,
        })
        .onConflictDoUpdate({
          target: creditBalancesTable.userId,
          set: {
            purchasedBalance: sql`${creditBalancesTable.purchasedBalance} - ${request.priceCredits}`,
          },
        });
    }
    const [updated] = await tx
      .update(customContentRequestsTable)
      .set({
        status: "refunded",
        holdStatus: "refunded",
        refundedAt: new Date(),
        adminResolution: "refunded",
      })
      .where(eq(customContentRequestsTable.id, request.id))
      .returning();
    await tx.insert(creditTransactionsTable).values([
      {
        userId: request.customerUserId,
        amount: request.priceCredits,
        type: "refund",
        description: "Admin custom request refund",
        customContentRequestId: request.id,
        dollId: request.dollId,
      },
      ...(request.holdStatus === "settled"
        ? [
            {
              userId: request.creatorUserId,
              amount: -request.priceCredits,
              type: "refund" as const,
              description: "Admin reversed custom request settlement",
              customContentRequestId: request.id,
              dollId: request.dollId,
            },
          ]
        : []),
    ]);
    return updated;
  });
}
router.post(
  "/admin/custom-requests/:id/refund",
  requireAuth("admin"),
  async (req, res) => {
    const request = await adminRefund(id(req.params.id));
    if (!request)
      return void res.status(409).json({ error: "Request cannot be refunded" });
    res.json(request);
  },
);
router.post(
  "/admin/custom-requests/:id/resolve",
  requireAuth("admin"),
  async (req, res) => {
    const resolution = req.body?.resolution;
    if (resolution === "refund") {
      const request = await adminRefund(id(req.params.id));
      if (!request)
        return void res
          .status(409)
          .json({ error: "Request cannot be refunded" });
      return void res.json(request);
    }
    if (resolution !== "complete")
      return void res
        .status(400)
        .json({ error: "resolution must be refund or complete" });
    const [request] = await db
      .update(customContentRequestsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        adminResolution: "completed",
      })
      .where(
        and(
          eq(customContentRequestsTable.id, id(req.params.id)),
          eq(customContentRequestsTable.status, "disputed"),
          eq(customContentRequestsTable.holdStatus, "settled"),
        ),
      )
      .returning();
    if (!request)
      return void res
        .status(409)
        .json({ error: "Request cannot be completed" });
    res.json(request);
  },
);
router.post(
  "/admin/creators/:creatorUserId/request-settings/disable",
  requireAuth("admin"),
  async (req, res) => {
    const [settings] = await db
      .update(creatorRequestSettingsTable)
      .set({ enabled: false })
      .where(
        eq(
          creatorRequestSettingsTable.creatorUserId,
          id(req.params.creatorUserId),
        ),
      )
      .returning();
    if (!settings)
      return void res
        .status(404)
        .json({ error: "Creator request settings not found" });
    res.json(settings);
  },
);

router.post(
  "/custom-requests/:id/deliver",
  requireAuth("doll"),
  async (req, res) => {
    const parsed = DeliverCustomRequestBody.safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({ error: parsed.error.message });
    let imageObjectPath: string | null = null;
    let videoObjectPath: string | null = null;
    let videoPosterObjectPath: string | null = null;
    try {
      if (parsed.data.imageObjectPath) {
        imageObjectPath = await validatePrivateCreatorMedia(
          parsed.data.imageObjectPath,
          req.currentUser!.id,
          "image",
        );
      }
      if (parsed.data.videoObjectPath) {
        videoObjectPath = await validatePrivateCreatorMedia(
          parsed.data.videoObjectPath,
          req.currentUser!.id,
          "video",
        );
      }
      if (parsed.data.videoPosterObjectPath) {
        videoPosterObjectPath = await validatePrivateCreatorMedia(
          parsed.data.videoPosterObjectPath,
          req.currentUser!.id,
          "image",
        );
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return void res
          .status(400)
          .json({ error: "Delivery media was not found" });
      }
      return void res.status(400).json({
        error: "Delivery media must be private, Creator-owned, and the declared type",
      });
    }
    const result = await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(customContentRequestsTable)
        .where(eq(customContentRequestsTable.id, id(req.params.id)))
        .for("update");
      if (!request || request.creatorUserId !== req.currentUser!.id)
        return null;
      const existing = await tx
        .select()
        .from(customContentDeliveriesTable)
        .where(eq(customContentDeliveriesTable.requestId, request.id));
      if (
        existing[0] &&
        request.status === "delivered" &&
        request.holdStatus === "settled"
      )
        return { request };
      if (
        !["accepted", "in_progress"].includes(request.status) ||
        request.holdStatus !== "held" ||
        !request.deliveryDeadlineAt ||
        request.deliveryDeadlineAt <= new Date()
      )
        return null;
      const hasRequiredMedia =
        (request.requestType === "custom_photo" &&
          Boolean(imageObjectPath) &&
          !videoObjectPath) ||
        (request.requestType === "custom_video" &&
          Boolean(videoObjectPath) &&
          !imageObjectPath) ||
        (request.requestType === "custom_photo_video" &&
          Boolean(imageObjectPath) &&
          Boolean(videoObjectPath));
      if (!hasRequiredMedia) return { invalidMedia: true as const, request };
      const [block] = await tx
        .select({ id: blocksTable.id })
        .from(blocksTable)
        .where(
          or(
            and(
              eq(blocksTable.blockerId, request.customerUserId),
              eq(blocksTable.blockedUserId, request.creatorUserId),
            ),
            and(
              eq(blocksTable.blockerId, request.creatorUserId),
              eq(blocksTable.blockedUserId, request.customerUserId),
            ),
          ),
        );
      if (block) return { blocked: true as const, request };
      let [thread] = await tx
        .select()
        .from(messageThreadsTable)
        .where(
          and(
            eq(messageThreadsTable.memberUserId, request.customerUserId),
            eq(messageThreadsTable.dollId, request.dollId),
          ),
        )
        .for("update");
      if (!thread)
        [thread] = await tx
          .insert(messageThreadsTable)
          .values({
            memberUserId: request.customerUserId,
            dollId: request.dollId,
            lastMessage: parsed.data.message ?? "Custom content delivered",
          })
          .returning();
      const reusable =
        request.customerAllowsReuse && request.creatorAgreesReuse === true;
      const [delivery] = await tx
        .insert(customContentDeliveriesTable)
        .values({
          requestId: request.id,
          creatorUserId: request.creatorUserId,
          imageObjectPath,
          videoObjectPath,
          videoPosterObjectPath,
          message: parsed.data.message ?? null,
          reusable,
        })
        .returning();
      const [message] = await tx
        .insert(messagesTable)
        .values({
          threadId: thread.id,
          senderRole: "doll",
          senderUserId: request.creatorUserId,
          body: parsed.data.message ?? "Custom content delivered",
          paid: false,
        })
        .returning();
      await tx
        .insert(customMessageMetadataTable)
        .values({
          messageId: message.id,
          requestId: request.id,
          deliveryId: delivery.id,
          imageObjectPath,
          videoObjectPath,
          reusable,
        });
      await tx
        .update(messageThreadsTable)
        .set({ lastMessage: message.body, lastMessageAt: new Date() })
        .where(eq(messageThreadsTable.id, thread.id));
      const [updated] = await tx
        .update(customContentRequestsTable)
        .set({
          status: "delivered",
          holdStatus: "settled",
          deliveredAt: new Date(),
        })
        .where(eq(customContentRequestsTable.id, request.id))
        .returning();
      await tx
        .insert(creditBalancesTable)
        .values({
          userId: request.creatorUserId,
          purchasedBalance: request.priceCredits,
        })
        .onConflictDoUpdate({
          target: creditBalancesTable.userId,
          set: {
            purchasedBalance: sql`${creditBalancesTable.purchasedBalance} + ${request.priceCredits}`,
          },
        });
      await tx.insert(creditTransactionsTable).values([
        {
          userId: request.customerUserId,
          amount: 0,
          type: "settlement",
          description: "Custom request delivered",
          customContentRequestId: request.id,
          messageId: message.id,
          dollId: request.dollId,
        },
        {
          userId: request.creatorUserId,
          amount: request.priceCredits,
          type: "settlement",
          description: "Custom request creator settlement",
          customContentRequestId: request.id,
          messageId: message.id,
          dollId: request.dollId,
        },
      ]);
      return { request: updated };
    });
    if (!result)
      return void res
        .status(409)
        .json({ error: "Request cannot be delivered" });
    if ("invalidMedia" in result) {
      return void res.status(400).json({
        error:
          result.request.requestType === "custom_photo_video"
            ? "This request requires both a photo and a video"
            : `This request requires one ${result.request.requestType === "custom_photo" ? "photo" : "video"}`,
      });
    }
    if ("blocked" in result) {
      await refundRequest(
        result.request.id,
        req.currentUser!.id,
        (request) => request.creatorUserId === req.currentUser!.id,
        "cancelled",
        ["accepted", "in_progress"],
      );
      return void res.status(409).json({
        error: "Request was refunded because the participants are blocked",
      });
    }
    const deliveredRequest = result.request;
    await createNotification({
      userId: deliveredRequest.customerUserId,
      type: "custom_request_delivered",
      title: "Custom content delivered",
      message: "Your custom content is ready",
      relatedUserId: deliveredRequest.creatorUserId,
    });
    res.status(201).json(deliveredRequest);
  },
);

for (const [action, statuses, field] of [
  ["complete", ["delivered"], "completedAt"],
  ["dispute", ["accepted", "in_progress", "delivered"], "disputeReason"],
] as const) {
  router.post(
    `/custom-requests/:id/${action}`,
    requireAuth("member"),
    async (req, res) => {
        if (action === "dispute") {
          const parsed = DisputeCustomRequestBody.safeParse(req.body);
          if (!parsed.success) {
            return void res.status(400).json({ error: parsed.error.message });
          }
        }
      const [request] = await db
        .update(customContentRequestsTable)
        .set(
          action === "complete"
            ? { status: "completed", completedAt: new Date() }
            : {
                status: "disputed",
                disputeReason: String(req.body.reason),
              },
        )
        .where(
          and(
            eq(customContentRequestsTable.id, id(req.params.id)),
            eq(customContentRequestsTable.customerUserId, req.currentUser!.id),
            inArray(customContentRequestsTable.status, statuses),
          ),
        )
        .returning();
      if (!request)
        return void res
          .status(409)
          .json({ error: `Request cannot be ${action}d` });
      await createNotification({
        userId: request.creatorUserId,
        type: `custom_request_${action}d`,
        title: `Request ${action}d`,
        message: `The member ${action}d the custom request`,
        relatedUserId: request.customerUserId,
      });
      res.json(request);
    },
  );
}
export default router;
