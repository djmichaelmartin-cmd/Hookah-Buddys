import { randomUUID } from "crypto";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  objectStorageClient,
} from "./objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "./objectAcl";
import { transcodeVideoForFeed, TranscodeError } from "./videoTranscode";

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
export const MAX_VIDEO_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

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

// ISO base media file format brands that identify an MP4 video container.
// (avif/avis are excluded — those are images, handled by sniffImageType.)
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "mp4v",
  "avc1",
  "dash",
  "M4V ",
]);

/**
 * Sniff the real video type from the file's magic bytes.
 * Returns the authoritative MIME type, or null if the bytes are not a
 * recognized video format (MP4 or WebM).
 */
export function sniffVideoType(bytes: Buffer): string | null {
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("latin1");
    if (MP4_BRANDS.has(brand)) return "video/mp4";
    return null;
  }
  if (
    bytes.length >= 4 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    // EBML container — require the "webm" DocType within the header to
    // distinguish WebM from generic Matroska.
    if (bytes.subarray(0, Math.min(bytes.length, 64)).includes("webm")) {
      return "video/webm";
    }
    return null;
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
  return storeValidatedBuffer(buffer, sniffedType, ownerId);
}

/**
 * Validate, transcode, and store uploaded video bytes.
 *
 * The raw upload (MP4/WebM, bounded by the route) is transcoded to a
 * web-friendly bounded-bitrate H.264 MP4 (max 720p, faststart) and a JPEG
 * poster frame is extracted. Both objects are stored in the private object
 * dir with a finalized owner ACL policy. Returns the object paths for the
 * compressed video and its poster.
 */
export async function uploadVideoBuffer(
  buffer: Buffer,
  ownerId: number,
): Promise<{ objectPath: string; posterPath: string }> {
  if (buffer.length === 0) {
    throw new InvalidUploadError("Uploaded file is empty.");
  }
  if (buffer.length > MAX_VIDEO_UPLOAD_SIZE_BYTES) {
    throw new InvalidUploadError("Uploaded file exceeds the 50 MB size limit.");
  }
  const sniffedType = sniffVideoType(buffer);
  if (!sniffedType || !ALLOWED_VIDEO_TYPES.has(sniffedType)) {
    throw new InvalidUploadError(
      "Uploaded file is not an allowed video type (MP4, WebM).",
    );
  }

  let transcoded;
  try {
    transcoded = await transcodeVideoForFeed(buffer);
  } catch (err) {
    if (err instanceof TranscodeError) {
      throw new InvalidUploadError(
        "Uploaded video could not be processed. Please upload a valid MP4 or WebM video.",
      );
    }
    throw err;
  }

  const [objectPath, posterPath] = await Promise.all([
    storeValidatedBuffer(transcoded.video, "video/mp4", ownerId),
    storeValidatedBuffer(transcoded.poster, "image/jpeg", ownerId),
  ]);
  return { objectPath, posterPath };
}

async function storeValidatedBuffer(
  buffer: Buffer,
  contentType: string,
  ownerId: number,
): Promise<string> {
  const service = new ObjectStorageService();
  const privateDir = service.getPrivateObjectDir().replace(/\/$/, "");
  const id = randomUUID();
  const fullPath = `${privateDir}/uploads/${id}`;
  const pathParts = fullPath.startsWith("/") ? fullPath.split("/") : `/${fullPath}`.split("/");
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType });
  await setObjectAclPolicy(file, {
    owner: String(ownerId),
    visibility: "public",
  });

  return `/objects/uploads/${id}`;
}

/**
 * Guard + finalizer for user-supplied media URLs (feed posts, album photos,
 * Doll media). Rejects embedded `data:` URLs outright (they bloat the
 * database), finalizes storage object URLs (ACL + image validation), and
 * passes other URLs (e.g. external links) through unchanged.
 */
export async function finalizeMediaUrl(
  url: string,
  ownerId: number,
): Promise<string> {
  if (/^data:/i.test(url.trim())) {
    throw new InvalidUploadError(
      "Embedded data: URLs are not allowed. Upload the file to /api/storage/uploads/image and reference the returned URL.",
    );
  }
  if (toObjectEntityPath(url)) {
    return finalizeUploadedMedia(url, ownerId, "any");
  }
  return url;
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
  return finalizeUploadedMedia(storageUrl, ownerId, "image");
}

/**
 * Generic finalize step for an uploaded media object (image and/or video).
 * `kind` restricts which media families are acceptable:
 * - "image": images only (10 MB cap)
 * - "video": videos only (50 MB cap)
 * - "any":   either family, with the matching cap applied
 */
export async function finalizeUploadedMedia(
  storageUrl: string,
  ownerId: number,
  kind: "image" | "video" | "any",
): Promise<string> {
  const objectPath = toObjectEntityPath(storageUrl);
  if (!objectPath) {
    throw new InvalidUploadError(
      "Media URL must reference an uploaded storage object (/api/storage/objects/...).",
    );
  }

  const service = new ObjectStorageService();
  let file;
  try {
    file = await service.getObjectEntityFile(objectPath);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      throw new InvalidUploadError("Uploaded file not found in storage.");
    }
    throw err;
  }

  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);

  if (size <= 0) {
    throw new InvalidUploadError("Uploaded file is empty.");
  }

  // Sniff the ACTUAL stored bytes — the object's contentType metadata is
  // client-supplied at PUT time and cannot be trusted. 64 bytes covers all
  // image signatures and the WebM DocType scan.
  const [head] = await file.download({ start: 0, end: 63 });

  let sniffedType: string | null = null;
  if (kind === "image" || kind === "any") {
    const imageType = sniffImageType(head);
    if (imageType && ALLOWED_IMAGE_TYPES.has(imageType)) sniffedType = imageType;
  }
  if (!sniffedType && (kind === "video" || kind === "any")) {
    const videoType = sniffVideoType(head);
    if (videoType && ALLOWED_VIDEO_TYPES.has(videoType)) sniffedType = videoType;
  }
  if (!sniffedType) {
    throw new InvalidUploadError(
      kind === "image"
        ? "Uploaded file is not an allowed image type (JPEG, PNG, WebP, GIF, AVIF)."
        : kind === "video"
          ? "Uploaded file is not an allowed video type (MP4, WebM)."
          : "Uploaded file is not an allowed media type (JPEG, PNG, WebP, GIF, AVIF, MP4, WebM).",
    );
  }

  const maxSize = ALLOWED_VIDEO_TYPES.has(sniffedType)
    ? MAX_VIDEO_UPLOAD_SIZE_BYTES
    : MAX_UPLOAD_SIZE_BYTES;
  if (size > maxSize) {
    throw new InvalidUploadError(
      `Uploaded file exceeds the ${maxSize === MAX_VIDEO_UPLOAD_SIZE_BYTES ? "50" : "10"} MB size limit.`,
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
