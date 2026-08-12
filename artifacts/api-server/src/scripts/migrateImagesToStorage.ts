/**
 * One-off migration: move base64 data-URL profile/cover images out of the
 * database into object storage, replacing them with served object URLs.
 *
 * Run from artifacts/api-server:
 *   pnpm run build && node dist/scripts/migrateImagesToStorage.mjs
 */
import { like } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, usersTable, profileDetailsTable } from "@workspace/db";
import { uploadImageBuffer, InvalidUploadError } from "../lib/imageUploads";

async function uploadDataUrl(dataUrl: string, ownerId: number): Promise<string | null> {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  try {
    const objectPath = await uploadImageBuffer(buffer, ownerId);
    return `/api/storage${objectPath}`;
  } catch (err) {
    if (err instanceof InvalidUploadError) return null; // not a valid image
    throw err;
  }
}

async function main() {
  const users = await db
    .select({ id: usersTable.id, url: usersTable.profilePhotoUrl })
    .from(usersTable)
    .where(like(usersTable.profilePhotoUrl, "data:%"));
  console.log(`Users with base64 profile photos: ${users.length}`);
  for (const u of users) {
    const newUrl = await uploadDataUrl(u.url!, u.id);
    if (!newUrl) {
      console.warn(`Skipping user ${u.id}: unparseable data URL`);
      continue;
    }
    await db.update(usersTable).set({ profilePhotoUrl: newUrl }).where(eq(usersTable.id, u.id));
    console.log(`Migrated profile photo for user ${u.id} -> ${newUrl}`);
  }

  const details = await db
    .select({ userId: profileDetailsTable.userId, url: profileDetailsTable.coverPhotoUrl })
    .from(profileDetailsTable)
    .where(like(profileDetailsTable.coverPhotoUrl, "data:%"));
  console.log(`Profiles with base64 cover photos: ${details.length}`);
  for (const d of details) {
    const newUrl = await uploadDataUrl(d.url!, d.userId);
    if (!newUrl) {
      console.warn(`Skipping cover for user ${d.userId}: unparseable data URL`);
      continue;
    }
    await db
      .update(profileDetailsTable)
      .set({ coverPhotoUrl: newUrl })
      .where(eq(profileDetailsTable.userId, d.userId));
    console.log(`Migrated cover photo for user ${d.userId} -> ${newUrl}`);
  }

  console.log("Migration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
