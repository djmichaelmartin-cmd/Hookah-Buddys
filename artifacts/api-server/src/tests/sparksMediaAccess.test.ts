import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  GetReelPosterMediaParams,
  GetReelVideoMediaParams,
} from "@workspace/api-zod";

it("keeps protected Spark media routes in the generated contract", () => {
  expect(GetReelVideoMediaParams.parse({ id: 9 })).toEqual({ id: 9 });
  expect(GetReelPosterMediaParams.parse({ id: 9 })).toEqual({ id: 9 });
});

it("uses visibility-aware response URLs and the same access gate for media streams", async () => {
  const [source, storageSource] = await Promise.all([
    readFile(new URL("../routes/reels.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/storage.ts", import.meta.url), "utf8"),
  ]);
  expect(source).toMatch(/r\.visibility === "public" \|\| !toObjectEntityPath\(r\.videoUrl\)/);
  expect(source).toMatch(/`\/api\/reels\/\$\{r\.id\}\/media\/video`/);
  expect(source).toMatch(/`\/api\/reels\/\$\{r\.id\}\/media\/poster`/);
  expect(source).toMatch(/router\.get\("\/reels\/:id\/media\/video"/);
  expect(source).toMatch(/router\.get\("\/reels\/:id\/media\/poster"/);
  expect(source).toMatch(/reel\.status !== "active" \|\| !\(await viewerCanSeeReel\(reel, viewer \?\? null\)\)/);
  expect(source).toMatch(/streamValidatedObject\(objectFile, req, res\)/);
  // The universal object route calls the ACL checker without a user identity;
  // canonical friends/only_me uploads are private and therefore cannot pass it.
  expect(storageSource).toMatch(/canAccessObjectEntity\(\{\s*objectFile,\s*\}\)/);
});