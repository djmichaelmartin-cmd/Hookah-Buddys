/**
 * Group-aware protected asset access.
 *
 * PROBLEM: the universal `GET /storage/objects/*` route serves any object that
 * has a finalized public ACL policy. Group media/posters/attachments/branding
 * are stored as ordinary public-ACL objects, so a non-member who learns a
 * PRIVATE Group's asset URL (e.g. `/api/storage/objects/uploads/<uuid>`) could
 * fetch it directly, bypassing Group privacy.
 *
 * SOLUTION (DB-reference based, no shared-ACL mutation):
 *   - The universal storage route DENIES serving of any object that is
 *     referenced by a PRIVATE Group (see `isObjectReferencedByPrivateGroup`).
 *     Shared/non-Group media and public-Group media keep working universally.
 *   - Private Group serializers emit a PROTECTED asset URL (`/api/group-assets/
 *     :groupId/objects/...`) instead of `/api/storage/...`. That protected route
 *     (in routes/groups.ts) applies the SAME Group access policy as the rest of
 *     the Group API and verifies the requested object is actually referenced by
 *     that Group before streaming it.
 *
 * COMPARISON MODEL (security-correct, fail-closed):
 *   Persisted URL columns may hold ANY supported variant — canonical
 *   `/objects/...`, serving `/api/storage/objects/...`, raw GCS
 *   `https://storage.googleapis.com/...`, or an already-protected
 *   `/api/group-assets/:id/objects/...`. Rather than trying to enumerate those
 *   variants in SQL (which silently missed raw-GCS and protected forms), we
 *   fetch a NARROWLY SCOPED candidate set (only the four relevant string
 *   columns, restricted to the relevant private groups / exact group) and
 *   compare `normalizeStoredObjectPath(value)` against the normalized requested
 *   path in JS. A value that does not normalize (null / external) never
 *   matches, so the check is fail-closed and cannot be tricked by an
 *   unrecognized variant. There is no SQL `LIKE`/wildcard on the object path, so
 *   the same-group protected check cannot be subverted by wildcard injection.
 *
 * BRANDING (icon/cover):
 *   HIDDEN private Groups are NOT discoverable, so their branding must also be
 *   protected — included in universal denial and in the same-group protected
 *   reference check, and the hidden-private serializer emits protected branding
 *   URLs. VISIBLE private Groups are intentionally discoverable, so their
 *   icon/cover may remain universally public (branding only; posts/media stay
 *   protected).
 */

import {
  db,
  groupsTable,
  groupMediaTable,
  groupPostsTable,
  groupEventsTable,
} from "@workspace/db";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage";

const STORAGE_URL_PREFIX = "/api/storage";

/**
 * Base path for the protected, Group-access-controlled asset route. The
 * effective URL is `/api/group-assets/:groupId/objects/<entityId>` (the router
 * is mounted under `/api`).
 */
export const GROUP_ASSET_URL_PREFIX = "/api/group-assets";

const objectStorage = new ObjectStorageService();

/**
 * Normalize any stored URL variant to a canonical `/objects/<entityId>` path,
 * or null if it is not an internal storage object reference. Handles:
 *   - `/objects/<entityId>`
 *   - `/api/storage/objects/<entityId>` (serving URL form)
 *   - `https://storage.googleapis.com/<privateDir>/<entityId>` (raw GCS)
 *   - the protected `/api/group-assets/:groupId/objects/<entityId>` form
 *
 * Returns null for null/empty/external inputs so comparisons are fail-closed.
 */
export function normalizeStoredObjectPath(url: string | null | undefined): string | null {
  if (!url) return null;
  let path = url.trim();
  if (!path) return null;

  // Protected group-asset form: /api/group-assets/:groupId/objects/<entityId>
  if (path.startsWith(GROUP_ASSET_URL_PREFIX)) {
    const rest = path.slice(GROUP_ASSET_URL_PREFIX.length); // /:groupId/objects/...
    const idx = rest.indexOf("/objects/");
    if (idx === -1) return null;
    path = rest.slice(idx); // /objects/<entityId>
    return path.startsWith("/objects/") ? path : null;
  }

  // Serving URL form: /api/storage/objects/<entityId>
  if (path.startsWith(STORAGE_URL_PREFIX)) {
    path = path.slice(STORAGE_URL_PREFIX.length);
  }

  // Raw GCS URL → /objects/<entityId>
  if (path.startsWith("https://storage.googleapis.com/")) {
    path = objectStorage.normalizeObjectEntityPath(path);
  }

  return path.startsWith("/objects/") ? path : null;
}

/**
 * Build the protected Group asset URL for a stored object reference. Returns
 * the original URL unchanged when it is not an internal storage object (e.g.
 * already-external URLs are left as-is).
 */
export function toProtectedGroupAssetUrl(
  groupId: number,
  url: string | null | undefined,
): string | null {
  if (url === null || url === undefined) return url ?? null;
  const objectPath = normalizeStoredObjectPath(url);
  if (!objectPath) return url; // not a storage object — leave unchanged
  // objectPath is `/objects/<entityId>`
  return `${GROUP_ASSET_URL_PREFIX}/${groupId}${objectPath}`;
}

/**
 * True when `target` (a canonical `/objects/...` path) equals the normalized
 * form of any candidate value. Candidate values that do not normalize to a
 * storage object are skipped, so the comparison is fail-closed.
 */
function matchesAnyNormalized(
  target: string,
  candidates: Array<string | null | undefined>,
): boolean {
  for (const c of candidates) {
    if (normalizeStoredObjectPath(c) === target) return true;
  }
  return false;
}

/**
 * Returns true when the given object path is referenced by at least one PRIVATE
 * Group — via a group media item, a Group post's media/poster, a Group event's
 * image, OR (for HIDDEN private groups only) the group's icon/cover branding.
 * Such objects must NOT
 * be served by the universal public storage route; they are only reachable
 * through the protected Group asset route (which enforces Group access).
 *
 * The requested `objectPath` is normalized; every persisted candidate value is
 * normalized in JS before comparison, so ALL supported variants (canonical,
 * serving, raw GCS, already-protected) are covered regardless of how the row
 * was stored. Public-Group and non-Group references never match, and VISIBLE
 * private branding is intentionally left public.
 */
export async function isObjectReferencedByPrivateGroup(
  rawObjectPath: string,
): Promise<boolean> {
  const target = normalizeStoredObjectPath(rawObjectPath);
  if (!target) return false; // not a storage object — nothing to protect

  // 1) Media items owned by a private group. Scope narrowly: private groups
  //    only, and only rows that actually carry a media/poster URL.
  const mediaRows = await db
    .select({
      mediaUrl: groupMediaTable.mediaUrl,
      posterUrl: groupMediaTable.posterUrl,
    })
    .from(groupMediaTable)
    .innerJoin(groupsTable, eq(groupMediaTable.groupId, groupsTable.id))
    .where(
      and(
        eq(groupsTable.privacy, "private"),
        or(isNotNull(groupMediaTable.mediaUrl), isNotNull(groupMediaTable.posterUrl)),
      ),
    );
  for (const r of mediaRows) {
    if (matchesAnyNormalized(target, [r.mediaUrl, r.posterUrl])) return true;
  }

  // 2) Post media/poster in a private group.
  const postRows = await db
    .select({
      mediaUrl: groupPostsTable.mediaUrl,
      posterUrl: groupPostsTable.posterUrl,
    })
    .from(groupPostsTable)
    .innerJoin(groupsTable, eq(groupPostsTable.groupId, groupsTable.id))
    .where(
      and(
        eq(groupsTable.privacy, "private"),
        or(isNotNull(groupPostsTable.mediaUrl), isNotNull(groupPostsTable.posterUrl)),
      ),
    );
  for (const r of postRows) {
    if (matchesAnyNormalized(target, [r.mediaUrl, r.posterUrl])) return true;
  }

  // 3) Event images in a private group.
  const eventRows = await db
    .select({ imageUrl: groupEventsTable.imageUrl })
    .from(groupEventsTable)
    .innerJoin(groupsTable, eq(groupEventsTable.groupId, groupsTable.id))
    .where(and(eq(groupsTable.privacy, "private"), isNotNull(groupEventsTable.imageUrl)));
  for (const r of eventRows) {
    if (matchesAnyNormalized(target, [r.imageUrl])) return true;
  }

  // 4) Branding of HIDDEN private groups (undiscoverable → protect icon/cover).
  //    VISIBLE private groups are intentionally discoverable, so their branding
  //    stays universally public and is NOT included here.
  const brandingRows = await db
    .select({
      iconUrl: groupsTable.iconUrl,
      coverUrl: groupsTable.coverUrl,
    })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.privacy, "private"),
        eq(groupsTable.visibility, "hidden"),
        or(isNotNull(groupsTable.iconUrl), isNotNull(groupsTable.coverUrl)),
      ),
    );
  for (const r of brandingRows) {
    if (matchesAnyNormalized(target, [r.iconUrl, r.coverUrl])) return true;
  }

  return false;
}

/**
 * Verify the given object path is actually referenced by the specified Group
 * (media item, post media/poster, event image, OR — for HIDDEN private groups —
 * the group's icon/cover branding). This is the reference check the protected Group asset
 * route performs AFTER it has confirmed the requester's Group access — so a
 * member of Group A cannot use the protected route to fetch an object that only
 * belongs to a different Group.
 *
 * Same fail-closed, JS-normalized comparison model as
 * `isObjectReferencedByPrivateGroup`. There is no SQL wildcard on the object
 * path, so this cannot be subverted by wildcard injection.
 */
export async function isObjectReferencedByGroup(
  groupId: number,
  rawObjectPath: string,
): Promise<boolean> {
  const target = normalizeStoredObjectPath(rawObjectPath);
  if (!target) return false;

  const mediaRows = await db
    .select({
      mediaUrl: groupMediaTable.mediaUrl,
      posterUrl: groupMediaTable.posterUrl,
    })
    .from(groupMediaTable)
    .where(
      and(
        eq(groupMediaTable.groupId, groupId),
        or(isNotNull(groupMediaTable.mediaUrl), isNotNull(groupMediaTable.posterUrl)),
      ),
    );
  for (const r of mediaRows) {
    if (matchesAnyNormalized(target, [r.mediaUrl, r.posterUrl])) return true;
  }

  const postRows = await db
    .select({
      mediaUrl: groupPostsTable.mediaUrl,
      posterUrl: groupPostsTable.posterUrl,
    })
    .from(groupPostsTable)
    .where(
      and(
        eq(groupPostsTable.groupId, groupId),
        or(isNotNull(groupPostsTable.mediaUrl), isNotNull(groupPostsTable.posterUrl)),
      ),
    );
  for (const r of postRows) {
    if (matchesAnyNormalized(target, [r.mediaUrl, r.posterUrl])) return true;
  }

  const eventRows = await db
    .select({ imageUrl: groupEventsTable.imageUrl })
    .from(groupEventsTable)
    .where(
      and(eq(groupEventsTable.groupId, groupId), isNotNull(groupEventsTable.imageUrl)),
    );
  for (const r of eventRows) {
    if (matchesAnyNormalized(target, [r.imageUrl])) return true;
  }

  // Branding: only HIDDEN private groups protect icon/cover, so only match
  // branding for such a group. (Visible-private branding is public and would
  // never be requested through the protected route anyway.)
  const [brandRow] = await db
    .select({
      iconUrl: groupsTable.iconUrl,
      coverUrl: groupsTable.coverUrl,
      privacy: groupsTable.privacy,
      visibility: groupsTable.visibility,
    })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId))
    .limit(1);
  if (
    brandRow &&
    brandRow.privacy === "private" &&
    brandRow.visibility === "hidden" &&
    matchesAnyNormalized(target, [brandRow.iconUrl, brandRow.coverUrl])
  ) {
    return true;
  }

  return false;
}
