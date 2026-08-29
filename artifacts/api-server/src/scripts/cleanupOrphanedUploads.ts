/**
 * Cleanup: delete orphaned uploads from object storage.
 *
 * Images are uploaded to `<PRIVATE_OBJECT_DIR>/uploads/<uuid>` the moment a
 * user picks a file. If the form is abandoned, the object stays in the bucket
 * with no database reference. This script lists every object under uploads/,
 * collects every storage-object URL referenced by the database, and deletes
 * objects that are (a) older than the grace period and (b) unreferenced.
 *
 * DRY-RUN by default — reports what would be deleted without deleting.
 *
 * Run from artifacts/api-server:
 *   pnpm run build && node dist/scripts/cleanupOrphanedUploads.mjs             # dry run
 *   pnpm run build && node dist/scripts/cleanupOrphanedUploads.mjs --delete    # actually delete
 *   ... --grace-hours=24                                                       # custom grace period
 */
import {
  db,
  usersTable,
  profileDetailsTable,
  feedPostsTable,
  photosTable,
  mediaTable,
  dollsTable,
  verificationsTable,
  reelsTable,
  loungesTable,
  groupsTable,
  groupEventsTable,
  groupPostsTable,
  groupMediaTable,
} from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";

const DEFAULT_GRACE_HOURS = 48;

function parseArgs() {
  const args = process.argv.slice(2);
  const doDelete = args.includes("--delete");
  let graceHours = DEFAULT_GRACE_HOURS;
  for (const a of args) {
    const m = a.match(/^--grace-hours=(\d+(?:\.\d+)?)$/);
    if (m) graceHours = Number(m[1]);
  }
  return { doDelete, graceHours };
}

/**
 * Extract the upload object id from any stored URL form:
 *   /objects/uploads/<id>
 *   /api/storage/objects/uploads/<id>
 *   https://storage.googleapis.com/<bucket>/.../uploads/<id>
 * Returns null when the value does not reference an uploads/ storage object.
 */
function extractUploadId(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/\/uploads\/([A-Za-z0-9-]+)(?:[?#]|$)/);
  return m ? m[1] : null;
}

async function collectReferencedIds(): Promise<Set<string>> {
  const referenced = new Set<string>();
  const add = (v: string | null | undefined) => {
    const id = extractUploadId(v);
    if (id) referenced.add(id);
  };
  const addNestedStrings = (value: unknown): void => {
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(addNestedStrings);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(addNestedStrings);
    }
  };

  // Every table/column that can hold a storage object URL.
  const users = await db
    .select({ a: usersTable.profilePhotoUrl })
    .from(usersTable);
  users.forEach((r) => add(r.a));

  const details = await db
    .select({ a: profileDetailsTable.coverPhotoUrl })
    .from(profileDetailsTable);
  details.forEach((r) => add(r.a));

  const posts = await db
    .select({ a: feedPostsTable.mediaUrl, b: feedPostsTable.posterUrl })
    .from(feedPostsTable);
  posts.forEach((r) => {
    add(r.a);
    add(r.b);
  });

  const photos = await db.select({ a: photosTable.imageUrl }).from(photosTable);
  photos.forEach((r) => add(r.a));

  const media = await db
    .select({ a: mediaTable.url, b: mediaTable.thumbnailUrl })
    .from(mediaTable);
  media.forEach((r) => {
    add(r.a);
    add(r.b);
  });

  const dolls = await db
    .select({
      a: dollsTable.profilePhotoUrl,
      b: dollsTable.verificationPhotoUrl,
      c: dollsTable.verificationVideoUrl,
      d: dollsTable.governmentIdUrl,
    })
    .from(dollsTable);
  dolls.forEach((r) => {
    add(r.a);
    add(r.b);
    add(r.c);
    add(r.d);
  });

  const verifications = await db
    .select({
      a: verificationsTable.governmentIdUrl,
      b: verificationsTable.selfieUrl,
      c: verificationsTable.hookahPhotoUrl,
      d: verificationsTable.hookahVideoUrl,
    })
    .from(verificationsTable);
  verifications.forEach((r) => {
    add(r.a);
    add(r.b);
    add(r.c);
    add(r.d);
  });

  const reels = await db
    .select({ a: reelsTable.videoUrl, b: reelsTable.thumbnailUrl })
    .from(reelsTable);
  reels.forEach((r) => {
    add(r.a);
    add(r.b);
  });

  const lounges = await db
    .select({ a: loungesTable.imageUrl })
    .from(loungesTable);
  lounges.forEach((r) => add(r.a));

  const groups = await db
    .select({
      a: groupsTable.coverUrl,
      b: groupsTable.iconUrl,
      draftData: groupsTable.meetupDraftData,
    })
    .from(groupsTable);
  groups.forEach((r) => {
    add(r.a);
    add(r.b);
    addNestedStrings(r.draftData);
  });

  const groupEvents = await db
    .select({ a: groupEventsTable.imageUrl })
    .from(groupEventsTable);
  groupEvents.forEach((r) => add(r.a));

  const groupPosts = await db
    .select({ a: groupPostsTable.mediaUrl, b: groupPostsTable.posterUrl })
    .from(groupPostsTable);
  groupPosts.forEach((r) => {
    add(r.a);
    add(r.b);
  });

  const groupMedia = await db
    .select({ a: groupMediaTable.mediaUrl, b: groupMediaTable.posterUrl })
    .from(groupMediaTable);
  groupMedia.forEach((r) => {
    add(r.a);
    add(r.b);
  });

  return referenced;
}

async function main() {
  const { doDelete, graceHours } = parseArgs();
  const cutoff = Date.now() - graceHours * 60 * 60 * 1000;

  console.log(
    `Orphaned-upload cleanup — mode: ${doDelete ? "DELETE" : "DRY RUN"}, grace period: ${graceHours}h`,
  );

  const service = new ObjectStorageService();
  const privateDir = service.getPrivateObjectDir().replace(/\/$/, "");
  const parts = (privateDir.startsWith("/") ? privateDir : `/${privateDir}`).split("/");
  const bucketName = parts[1];
  const basePrefix = parts.slice(2).join("/");
  const uploadsPrefix = basePrefix ? `${basePrefix}/uploads/` : "uploads/";

  const referenced = await collectReferencedIds();
  console.log(`Referenced upload ids in database: ${referenced.size}`);

  const [files] = await objectStorageClient
    .bucket(bucketName)
    .getFiles({ prefix: uploadsPrefix });
  console.log(`Objects in storage under uploads/: ${files.length}`);

  let orphaned = 0;
  let deleted = 0;
  let keptRecent = 0;
  let bytesReclaimable = 0;
  let errors = 0;

  for (const file of files) {
    const id = file.name.slice(uploadsPrefix.length);
    if (!id || id.includes("/")) continue; // skip nested/unexpected paths
    if (referenced.has(id)) continue;

    const createdStr = file.metadata.timeCreated as string | undefined;
    const createdMs = createdStr ? Date.parse(createdStr) : NaN;
    if (!Number.isFinite(createdMs)) {
      console.warn(`  Skipping ${file.name}: no creation timestamp`);
      continue;
    }
    if (createdMs > cutoff) {
      keptRecent++;
      continue; // inside grace period — may still be finalized by an open form
    }

    orphaned++;
    const size = Number(file.metadata.size ?? 0);
    bytesReclaimable += size;
    const ageHours = Math.round((Date.now() - createdMs) / 3_600_000);
    console.log(
      `  ORPHAN ${file.name} (${(size / 1024).toFixed(1)} KB, ${ageHours}h old)${doDelete ? "" : " — would delete"}`,
    );

    if (doDelete) {
      try {
        await file.delete();
        deleted++;
      } catch (err) {
        errors++;
        console.error(`  Failed to delete ${file.name}:`, err);
      }
    }
  }

  console.log("");
  console.log(`Summary:`);
  console.log(`  Total upload objects:        ${files.length}`);
  console.log(`  Referenced (kept):           ${files.length - orphaned - keptRecent}`);
  console.log(`  Unreferenced but recent:     ${keptRecent} (inside ${graceHours}h grace period)`);
  console.log(`  Orphaned past grace period:  ${orphaned} (${(bytesReclaimable / 1024 / 1024).toFixed(2)} MB)`);
  if (doDelete) {
    console.log(`  Deleted:                     ${deleted}${errors ? ` (${errors} failed)` : ""}`);
  } else {
    console.log(`  Dry run — nothing deleted. Re-run with --delete to remove them.`);
  }

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
