import { db, mediaTable, favoritesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { toDollResponse, type DollCounts } from "./mappers";
import type { Doll } from "@workspace/db";

export async function getDollCounts(dollId: number): Promise<DollCounts> {
  const rows = await db
    .select({ type: mediaTable.type, count: sql<number>`count(*)::int` })
    .from(mediaTable)
    .where(and(eq(mediaTable.dollId, dollId), eq(mediaTable.status, "approved")))
    .groupBy(mediaTable.type);

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = r.count;

  const [fav] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(favoritesTable)
    .where(eq(favoritesTable.dollId, dollId));

  return {
    premiumPhotoCount: byType["premium_photo"] ?? 0,
    premiumVideoCount: byType["premium_video"] ?? 0,
    freePhotoCount: byType["free_photo"] ?? 0,
    shortVideoCount: byType["short_video"] ?? 0,
    favoriteCount: fav?.count ?? 0,
  };
}

export async function dollWithCounts(doll: Doll) {
  const counts = await getDollCounts(doll.id);
  return toDollResponse(doll, counts);
}
