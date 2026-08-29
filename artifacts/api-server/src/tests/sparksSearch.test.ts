import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { ListReelsQueryParams, ListReelsResponseItem } from "@workspace/api-zod";

it("accepts the bounded optional Spark search query", () => {
  expect(ListReelsQueryParams.parse({ search: "mango mint" }).search).toBe("mango mint");
  expect(ListReelsQueryParams.safeParse({ search: "x".repeat(101) }).success).toBe(false);
});

it("accepts business and audience filters while limiting audience values", () => {
  expect(ListReelsQueryParams.parse({ businessId: 22, dollId: 7, visibility: "public" }))
    .toMatchObject({ businessId: 22, dollId: 7, visibility: "public" });
  expect(ListReelsQueryParams.safeParse({ visibility: "followers" }).success).toBe(false);
  expect(ListReelsQueryParams.safeParse({ dollId: 0 }).success).toBe(false);
  expect(ListReelsResponseItem.shape.businessName.safeParse(null).success).toBe(true);
  expect(ListReelsResponseItem.shape.businessHandle.safeParse(null).success).toBe(true);
  expect(ListReelsResponseItem.shape.businessLogoUrl.safeParse(null).success).toBe(true);
});

it("applies business, Doll, and public filters before the existing status and visibility safeguards", async () => {
  const source = await readFile(
    new URL("../routes/reels.ts", import.meta.url),
    "utf8",
  );

  expect(source).toMatch(/eq\(reelsTable\.status, "active"\)/);
  expect(source).toMatch(/eq\(reelsTable\.businessId, businessId\)/);
  expect(source).toMatch(/inArray\(\s*reelsTable\.userId,/);
  expect(source).toMatch(/select\(\{ userId: dollsTable\.userId \}\)/);
  expect(source).toMatch(/eq\(dollsTable\.id, dollId\)/);
  expect(source).toMatch(/eq\(dollsTable\.applicationStatus, "approved"\)/);
  expect(source).toMatch(/eq\(reelsTable\.visibility, visibility\)/);
  expect(source).toMatch(/ilike\(reelsTable\.caption, pattern\)/);
  expect(source).toMatch(/ilike\(reelsTable\.hashtags, pattern\)/);
  // Search narrows the database candidates; the established relationship,
  // block, and canView filters still run over those candidates before output.
  expect(source).toMatch(/rel\.targetBlockedViewer \|\| rel\.viewerBlockedTarget/);
  expect(source).toMatch(/canView\(r\.visibility, rel\)/);
  // Business attribution is fetched in one active-only batch, not per-card.
  expect(source).toMatch(/inArray\(businessesTable\.id, businessIds\)/);
  expect(source).toMatch(/eq\(businessesTable\.status, "active"\)/);
  expect(source).toMatch(/businessName: business\?\.name \?\? null/);
});