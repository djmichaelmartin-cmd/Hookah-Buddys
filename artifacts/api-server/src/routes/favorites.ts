import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, favoritesTable, dollsTable } from "@workspace/db";
import { AddFavoriteBody, RemoveFavoriteParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { dollWithCounts } from "../lib/dollHelpers";

const router: IRouter = Router();

router.get("/favorites", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db
    .select({ fav: favoritesTable, doll: dollsTable })
    .from(favoritesTable)
    .leftJoin(dollsTable, eq(favoritesTable.dollId, dollsTable.id))
    .where(eq(favoritesTable.memberUserId, user.id))
    .orderBy(sql`${favoritesTable.createdAt} desc`);
  const result = await Promise.all(
    rows.map(async (r) => ({
      id: r.fav.id,
      dollId: r.fav.dollId,
      doll: r.doll ? await dollWithCounts(r.doll) : undefined,
      createdAt: r.fav.createdAt ? r.fav.createdAt.toISOString() : undefined,
    })),
  );
  res.json(result);
});

router.post("/favorites", requireAuth("member"), async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const parsed = AddFavoriteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db
    .select()
    .from(favoritesTable)
    .where(and(eq(favoritesTable.memberUserId, user.id), eq(favoritesTable.dollId, parsed.data.dollId)));
  let fav = existing[0];
  if (!fav) {
    [fav] = await db
      .insert(favoritesTable)
      .values({ memberUserId: user.id, dollId: parsed.data.dollId })
      .returning();
  }
  res.status(201).json({
    id: fav.id,
    dollId: fav.dollId,
    createdAt: fav.createdAt ? fav.createdAt.toISOString() : undefined,
  });
});

router.delete("/favorites/:dollId", requireAuth("member"), async (req, res): Promise<void> => {
  const params = RemoveFavoriteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = req.currentUser!;
  await db
    .delete(favoritesTable)
    .where(and(eq(favoritesTable.memberUserId, user.id), eq(favoritesTable.dollId, params.data.dollId)));
  res.json({ message: "Removed from favorites" });
});

export default router;
