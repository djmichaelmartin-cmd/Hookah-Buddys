import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  AcceptCustomRequestBody,
  DisputeCustomRequestBody,
  UpdateCreatorAlbumBody,
} from "@workspace/api-zod";

describe("Creator content contract", () => {
  it("requires explicit mutual-reuse input and a dispute reason", () => {
    expect(
      AcceptCustomRequestBody.parse({ creatorAgreesReuse: true }),
    ).toEqual({ creatorAgreesReuse: true });
    expect(() => AcceptCustomRequestBody.parse({})).toThrow();
    expect(DisputeCustomRequestBody.parse({ reason: "Wrong content" })).toEqual({
      reason: "Wrong content",
    });
    expect(() => DisputeCustomRequestBody.parse({ reason: "" })).toThrow();
  });

  it("supports Creator-controlled album activation", () => {
    expect(UpdateCreatorAlbumBody.parse({ isActive: false })).toEqual({
      isActive: false,
    });
  });
});

describe("Creator content privacy and transactional invariants", () => {
  it("uploads Creator media privately and serves album bytes only through the entitlement route", async () => {
    const [storageSource, uploadSource, creatorSource] = await Promise.all([
      readFile(new URL("../routes/storage.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/imageUploads.ts", import.meta.url), "utf8"),
      readFile(new URL("../routes/creatorContent.ts", import.meta.url), "utf8"),
    ]);

    expect(storageSource).toMatch(/\/creator-content\/uploads\/image/);
    expect(storageSource).toMatch(/\/creator-content\/uploads\/video/);
    expect(storageSource).toMatch(/visibility: 'private'/);
    expect(uploadSource).toMatch(/options\?\.visibility \?\? "public"/);
    expect(creatorSource).toMatch(
      /`\/api\/creator-albums\/\$\{a\.id\}\/media\/\$\{m\.id\}\/content`/,
    );
    expect(creatorSource).toMatch(
      /eq\(creatorAlbumUnlocksTable\.memberUserId, viewer\.id\)/,
    );
    expect(creatorSource).toMatch(/streamValidatedObject\(file, req, res\)/);
  });

  it("keeps album unlock and custom-request settlement idempotent under row locks", async () => {
    const [creatorSource, creditSource, reconciliationSource] =
      await Promise.all([
        readFile(new URL("../routes/creatorContent.ts", import.meta.url), "utf8"),
        readFile(new URL("../lib/credits.ts", import.meta.url), "utf8"),
        readFile(
          new URL("../lib/customRequestReconciliation.ts", import.meta.url),
          "utf8",
        ),
      ]);

    expect(creatorSource).toMatch(/\.for\("update"\)/);
    expect(creatorSource).toMatch(/pending_creator_response/);
    expect(creatorSource).toMatch(/responseDeadlineAt/);
    expect(creatorSource).toMatch(/deliveryDeadlineAt/);
    expect(creatorSource).toMatch(/custom_photo_video/);
    expect(creatorSource).toMatch(/Boolean\(imageObjectPath\)/);
    expect(creatorSource).toMatch(/Boolean\(videoObjectPath\)/);
    expect(creatorSource).toMatch(/request\.holdStatus === "settled"/);
    expect(creatorSource).toMatch(/Admin reversed custom request settlement/);
    expect(creatorSource).toMatch(
      /Custom request declined after participant block/,
    );
    expect(creatorSource).toMatch(
      /purchasedBalance: sql`\$\{creditBalancesTable\.purchasedBalance\} \+ \$\{request\.priceCredits\}`/,
    );
    expect(creatorSource).toMatch(
      /purchasedBalance: sql`\$\{creditBalancesTable\.purchasedBalance\} - \$\{request\.priceCredits\}`/,
    );
    expect(creatorSource).toMatch(
      /if \(!\(error instanceof AbortSpendError\)\) throw error/,
    );
    expect(creatorSource).toMatch(
      /customContentRequestsTable\.idempotencyKey, p\.data\.idempotencyKey/,
    );
    expect(creatorSource).toMatch(/user\.accountStatus !== "banned"/);
    expect(creatorSource).toMatch(/user\.accountStatus !== "suspended"/);
    expect(creatorSource.match(/getActiveSessionUser\(req\)/g)?.length).toBe(
      3,
    );
    expect(creatorSource.match(/blocksTable\.blockerId/g)?.length).toBeGreaterThan(
      4,
    );
    expect(creditSource).toMatch(/membershipCredits/);
    expect(creditSource).toMatch(/purchasedCredits/);
    expect(reconciliationSource).toMatch(/restoreHeldCredits/);
    expect(reconciliationSource).toMatch(/holdStatus: "refunded"/);
  });

  it("keeps legacy Doll media visible beside the fixed Creator albums", async () => {
    const profileSource = await readFile(
      new URL(
        "../../../web/src/pages/DollProfile.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(profileSource).toMatch(/Existing Gallery/);
    expect(profileSource).toMatch(/useUnlockContent/);
    expect(profileSource).toMatch(/doll\.media/);
    expect(profileSource).toMatch(/<MediaTile/);
  });
});