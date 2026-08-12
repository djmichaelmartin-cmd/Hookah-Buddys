import { randomUUID } from "crypto";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  objectStorageClient,
} from "./objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "./objectAcl";

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const STORAGE_URL_PREFIX = "/api/storage";

export class InvalidUploadError extends Error {}

/**
 * Sniff the real image type from the file's magic bytes.
 * Returns the authoritative MIME type, or null if the bytes are not a
 * recognized image format.
 */
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (bytes.length >= 6) {
    const sig = bytes.subarray(0, 6).toString("latin1");
    if (sig === "GIF87a" || sig === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

/**
 * Convert a client-provided storage URL ("/api/storage/objects/..." or
 * "/objects/...") to a normalized "/objects/..." path, or null if it is not
 * a storage object URL.
 */
export function toObjectEntityPath(url: string): string | null {
  let path = url;
  if (path.startsWith(STORAGE_URL_PREFIX)) {
    path = path.slice(STORAGE_URL_PREFIX.length);
  }
  return path.startsWith("/objects/") ? path : null;
}

/**
 * Store validated image bytes in the private object dir, stamped with a
 * finalized owner ACL policy. The caller (route) is responsible for bounding
 * the buffer size BEFORE it reaches this function; the size is re-checked
 * here as defense in depth. Returns the object path ("/objects/...").
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  ownerId: number,
): Promise<string> {
  if (buffer.length === 0) {
    throw new InvalidUploadError("Uploaded file is empty.");
  }
  if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
    throw new InvalidUploadError("Uploaded file exceeds the 10 MB size limit.");
  }
  const sniffedType = sniffImageType(buffer);
  if (!sniffedType || !ALLOWED_IMAGE_TYPES.has(sniffedType)) {
    throw new InvalidUploadError(
      "Uploaded file is not an allowed image type (JPEG, PNG, WebP, GIF, AVIF).",
    );
  }

  const service = new ObjectStorageService();
  const privateDir = service.getPrivateObjectDir().replace(/\/$/, "");
  const id = randomUUID();
  const fullPath = `${privateDir}/uploads/${id}`;
  const pathParts = fullPath.startsWith("/") ? fullPath.split("/") : `/${fullPath}`.split("/");
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType: sniffedType });
  await setObjectAclPolicy(file, {
    owner: String(ownerId),
    visibility: "public",
  });

  return `/objects/uploads/${id}`;
}

/**
 * Server-side finalize step for an uploaded image before it may be referenced.
 *
 * Verifies against the ACTUAL stored object (not client-declared metadata):
 * - object exists
 * - stored content type is an allowed image type
 * - stored byte size is within the limit
 * - object is not already owned by another user
 *
 * On success, sets a public-read ACL policy owned by `ownerId` and returns
 * the serving URL ("/api/storage/objects/..."). Objects that never pass this
 * step have no ACL policy and are refused by the serving route.
 */
export async function finalizeUploadedImage(
  storageUrl: string,
  ownerId: number,
): Promise<string> {
  const objectPath = toObjectEntityPath(storageUrl);
  if (!objectPath) {
    throw new InvalidUploadError(
      "Image URL must reference an uploaded storage object (/api/storage/objects/...).",
    );
  }

  const service = new ObjectStorageService();
  let file;
  try {
    file = await service.getObjectEntityFile(objectPath);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      throw new InvalidUploadError("Uploaded image not found in storage.");
    }
    throw err;
  }

  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);

  if (size <= 0) {
    throw new InvalidUploadError("Uploaded file is empty.");
  }
  if (size > MAX_UPLOAD_SIZE_BYTES) {
    throw new InvalidUploadError("Uploaded file exceeds the 10 MB size limit.");
  }

  // Sniff the ACTUAL stored bytes — the object's contentType metadata is
  // client-supplied at PUT time and cannot be trusted.
  const [head] = await file.download({ start: 0, end: 31 });
  const sniffedType = sniffImageType(head);
  if (!sniffedType || !ALLOWED_IMAGE_TYPES.has(sniffedType)) {
    throw new InvalidUploadError(
      "Uploaded file is not an allowed image type (JPEG, PNG, WebP, GIF, AVIF).",
    );
  }

  const existingPolicy = await getObjectAclPolicy(file);
  if (existingPolicy && existingPolicy.owner !== String(ownerId)) {
    throw new InvalidUploadError("This uploaded file belongs to another user.");
  }

  // Overwrite the content type with the sniffed, authoritative value and
  // stamp the finalized ACL policy in one metadata update.
  await file.setMetadata({ contentType: sniffedType });
  await setObjectAclPolicy(file, {
    owner: String(ownerId),
    visibility: "public",
  });

  return `${STORAGE_URL_PREFIX}${objectPath}`;
}
