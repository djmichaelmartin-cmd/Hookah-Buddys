import { randomUUID } from "crypto";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  objectStorageClient,
} from "./objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "./objectAcl";
import {
  transcodeVideoForFeed,
  TranscodeBusyError,
  TranscodeError,
} from "./videoTranscode";

export { TranscodeBusyError };

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

// Verification documents: images we already sniff, plus PDF. These are stored
// PRIVATELY (never public ACL) and only accessible to the owner + platform
// admin via the dedicated admin download route.
export const ALLOWED_DOCUMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

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
 * Sniff the real document type from magic bytes. Recognizes the private
 * verification document families: PDF and the still-image types (JPEG, PNG,
 * WebP). Returns the authoritative MIME type, or null if unrecognized.
 */
export function sniffDocumentType(bytes: Buffer): string | null {
  if (
    bytes.length >= 5 &&
    bytes.subarray(0, 5).toString("latin1") === "%PDF-"
  ) {
    return "application/pdf";
  }
  const imageType = sniffImageType(bytes);
  if (imageType && ALLOWED_DOCUMENT_TYPES.has(imageType)) return imageType;
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
    if (err instanceof TranscodeBusyError) {
      throw err; // surfaced as 503 by the route — retryable, not a bad upload
    }
    if (err instanceof TranscodeError) {
      throw new InvalidUploadError(
        "Uploaded video could not be processed. Please upload a valid MP4 or WebM video.",
      );
    }
    throw err;
  }

  const [objectPath, posterPath] = await Promise.all([
    storeValidatedBuffer(transcoded.video, "video/mp4", ownerId, {
      [TRANSCODED_METADATA_KEY]: "true",
    }),
    storeValidatedBuffer(transcoded.poster, "image/jpeg", ownerId),
  ]);
  return { objectPath, posterPath };
}

/**
 * Custom metadata flag stamped on videos produced by our own transcode
 * pipeline, so finalize steps can tell an already-compressed video from a
 * raw client upload and skip a pointless second transcode.
 */
const TRANSCODED_METADATA_KEY = "videoTranscoded";
async function storeValidatedBuffer(
  buffer: Buffer,
  contentType: string,
  ownerId: number,
  extraMetadata?: Record<string, string>,
): Promise<string> {
  const service = new ObjectStorageService();
  const privateDir = service.getPrivateObjectDir().replace(/\/$/, "");
  const id = randomUUID();
  const fullPath = `${privateDir}/uploads/${id}`;
  const pathParts = fullPath.startsWith("/") ? fullPath.split("/") : `/${fullPath}`.split("/");
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    contentType,
    ...(extraMetadata ? { metadata: { metadata: extraMetadata } } : {}),
  });
  await setObjectAclPolicy(file, {
    owner: String(ownerId),
    visibility: "public",
  });

  return `/objects/uploads/${id}`;
}

/**
 * Metadata key stamped on private verification documents recording the
 * business the document was scoped to at upload time. Read by the admin
 * download route as defense-in-depth (the object key also encodes it).
 */
const VERIFICATION_BUSINESS_METADATA_KEY = "verificationBusinessId";

/**
 * Store a validated buffer in the PRIVATE object dir under an owner/business-
 * scoped verification key, stamped with a PRIVATE ACL policy (owner-only read;
 * NEVER public). Returns the opaque object path ("/objects/verification/...").
 *
 * Unlike storeValidatedBuffer, this never grants public visibility — the
 * document is served only through the admin-authorized download route.
 */
async function storeValidatedPrivateVerificationBuffer(
  buffer: Buffer,
  contentType: string,
  ownerId: number,
  businessId: number,
): Promise<string> {
  const service = new ObjectStorageService();
  const privateDir = service.getPrivateObjectDir().replace(/\/$/, "");
  const id = randomUUID();
  // Owner/business-scoped key so keys are opaque yet auditable.
  const entityId = `verification/${businessId}/${ownerId}/${id}`;
  const fullPath = `${privateDir}/${entityId}`;
  const pathParts = fullPath.startsWith("/") ? fullPath.split("/") : `/${fullPath}`.split("/");
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    contentType,
    metadata: {
      metadata: { [VERIFICATION_BUSINESS_METADATA_KEY]: String(businessId) },
    },
  });
  await setObjectAclPolicy(file, {
    owner: String(ownerId),
    visibility: "private",
  });

  return `/objects/${entityId}`;
}

/**
 * Validate + store an uploaded verification document buffer PRIVATELY.
 * Sniffs the actual bytes (PDF/JPEG/PNG/WebP), enforces the size cap, and
 * writes to an owner/business-scoped private key with a private ACL. Returns
 * the opaque object path; the caller stores this ref (never a public URL).
 */
export async function uploadVerificationDocumentBuffer(
  buffer: Buffer,
  ownerId: number,
  businessId: number,
): Promise<{ objectPath: string; contentType: string }> {
  if (buffer.length === 0) {
    throw new InvalidUploadError("Uploaded document is empty.");
  }
  if (buffer.length > MAX_DOCUMENT_SIZE_BYTES) {
    throw new InvalidUploadError("Uploaded document exceeds the 15 MB size limit.");
  }
  const sniffedType = sniffDocumentType(buffer);
  if (!sniffedType || !ALLOWED_DOCUMENT_TYPES.has(sniffedType)) {
    throw new InvalidUploadError(
      "Uploaded document is not an allowed type (PDF, JPEG, PNG, WebP).",
    );
  }
  const objectPath = await storeValidatedPrivateVerificationBuffer(
    buffer,
    sniffedType,
    ownerId,
    businessId,
  );
  return { objectPath, contentType: sniffedType };
}

/**
 * Confirm a client-supplied verification document ref is:
 * - a storage object path (/objects/... — never an external/public URL),
 * - an existing object,
 * - owned by `ownerId` (per its ACL policy),
 * - PRIVATE (visibility !== "public") — rejects any public-ACL object,
 * - a valid document content type (PDF/JPEG/PNG/WebP).
 *
 * Returns the normalized opaque object path. Throws InvalidUploadError on any
 * violation. This NEVER mutates the ACL to public.
 */
export async function assertPrivateVerificationDocument(
  ref: string,
  ownerId: number,
  businessId: number,
): Promise<string> {
  const objectPath = toObjectEntityPath(ref);
  if (!objectPath) {
    throw new InvalidUploadError(
      "Verification documents must reference an uploaded storage object.",
    );
  }
  if (!objectPath.startsWith(`/objects/verification/${businessId}/`)) {
    throw new InvalidUploadError(
      "Verification document is not scoped to this Business Page.",
    );
  }
  const service = new ObjectStorageService();
  let file;
  try {
    file = await service.getObjectEntityFile(objectPath);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      throw new InvalidUploadError("Verification document not found in storage.");
    }
    throw err;
  }
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (size <= 0) throw new InvalidUploadError("Verification document is empty.");
  if (size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new InvalidUploadError("Verification document exceeds the 15 MB size limit.");
  }

  const policy = await getObjectAclPolicy(file);
  if (!policy) {
    throw new InvalidUploadError("Verification document has no access policy.");
  }
  if (policy.owner !== String(ownerId)) {
    throw new InvalidUploadError("Verification document belongs to another user.");
  }
  if (policy.visibility === "public") {
    throw new InvalidUploadError(
      "Verification document must be a private upload (public objects are not allowed).",
    );
  }
  if (
    String(metadata.metadata?.[VERIFICATION_BUSINESS_METADATA_KEY] ?? "") !==
    String(businessId)
  ) {
    throw new InvalidUploadError(
      "Verification document ownership metadata does not match this Business Page.",
    );
  }

  // Sniff the real bytes — content type metadata is client-controlled at PUT.
  const [head] = await file.download({ start: 0, end: 63 });
  const sniffed = sniffDocumentType(head);
  if (!sniffed || !ALLOWED_DOCUMENT_TYPES.has(sniffed)) {
    throw new InvalidUploadError(
      "Verification document is not an allowed type (PDF, JPEG, PNG, WebP).",
    );
  }
  return objectPath;
}

/**
 * Allowed content types for a generic Group "file" attachment (kind=file).
 *
 * IMPORTANT — storage-model limitation: this backend can only *safely* finalize
 * an uploaded object whose real bytes it can content-sniff and authoritatively
 * type. We currently sniff PDF + the still-image families (JPEG/PNG/WebP). Truly
 * arbitrary file types (docx, xlsx, zip, csv, ...) cannot be byte-verified here,
 * so they are refused with an explicit error rather than persisted on trust.
 * A future generic-file model (magic-byte table + declared-extension binding)
 * would widen this set; until then kind=file is restricted to these types.
 */
export const ALLOWED_GROUP_FILE_TYPES = ALLOWED_DOCUMENT_TYPES;
export const MAX_GROUP_FILE_SIZE_BYTES = MAX_DOCUMENT_SIZE_BYTES; // 15 MB

/**
 * Store validated Group file bytes in the private object dir, stamped with a
 * finalized owner ACL policy AT WRITE TIME. This is the ONLY safe way to
 * introduce a Group file object: ownership is assigned by the server as it
 * writes bytes it has itself sniffed and bounded — never claimed after the fact
 * on a caller-supplied path.
 *
 * The caller (route) is responsible for bounding the buffer size BEFORE it
 * reaches this function; the size is re-checked here as defense in depth.
 * Only content-sniffable, allowed Group file types (PDF/JPEG/PNG/WebP) are
 * accepted; anything else is refused. Returns the object path ("/objects/...")
 * and the authoritative sniffed content type.
 */
export async function uploadGroupFileBuffer(
  buffer: Buffer,
  ownerId: number,
): Promise<{ objectPath: string; contentType: string }> {
  if (buffer.length === 0) {
    throw new InvalidUploadError("Uploaded file is empty.");
  }
  if (buffer.length > MAX_GROUP_FILE_SIZE_BYTES) {
    throw new InvalidUploadError("Uploaded file exceeds the 15 MB size limit.");
  }
  const sniffedType = sniffDocumentType(buffer);
  if (!sniffedType || !ALLOWED_GROUP_FILE_TYPES.has(sniffedType)) {
    throw new InvalidUploadError(
      "Uploaded file is not an allowed Group file type (PDF, JPEG, PNG, WebP).",
    );
  }
  // storeValidatedBuffer stamps { owner, visibility: "public" } at write time.
  const objectPath = await storeValidatedBuffer(buffer, sniffedType, ownerId);
  return { objectPath, contentType: sniffedType };
}

/**
 * Ownership-aware finalizer for a generic Group file attachment (kind=file).
 *
 * This does NOT claim ownership of an ACL-less object. A safe Group file object
 * can only be created via `uploadGroupFileBuffer` (server-side raw upload),
 * which stamps the owner ACL at write time. This function merely CONFIRMS a
 * caller-supplied reference points at such an already-finalized object owned by
 * the current uploader; it never mutates ownership.
 *
 *  1. Namespace: the ref must resolve to an internal storage object path
 *     (/objects/...); external/`data:` URLs are rejected.
 *  2. Existence: the object must exist in storage.
 *  3. Finalized ownership: the object MUST already carry an ACL policy whose
 *     owner equals `ownerId`. A missing (null) policy is REJECTED — we never
 *     assign ownership to an ACL-less object here. A policy owned by another
 *     user is REJECTED.
 *  4. MIME policy: the ACTUAL stored bytes are sniffed and must be an allowed
 *     Group file type (never trusts client-declared contentType).
 *  5. Size policy: enforced against the real stored size (15 MB cap).
 *
 * Throws InvalidUploadError on any violation (mapped to HTTP 400 by callers).
 */
export async function finalizeUploadedGroupFile(
  storageUrl: string,
  ownerId: number,
): Promise<{ url: string; contentType: string }> {
  if (/^data:/i.test(storageUrl.trim())) {
    throw new InvalidUploadError(
      "Embedded data: URLs are not allowed. Upload the file first and reference the returned URL.",
    );
  }
  const objectPath = toObjectEntityPath(storageUrl);
  if (!objectPath) {
    throw new InvalidUploadError(
      "File must reference an uploaded storage object (/api/storage/objects/...).",
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
  if (size > MAX_GROUP_FILE_SIZE_BYTES) {
    throw new InvalidUploadError("Uploaded file exceeds the 15 MB size limit.");
  }

  // Ownership: the object MUST already be finalized (have an ACL policy) and be
  // owned by this uploader. We NEVER claim an ACL-less object here — such an
  // object was not created through the validated server-side upload path.
  const existingPolicy = await getObjectAclPolicy(file);
  if (!existingPolicy) {
    throw new InvalidUploadError(
      "Uploaded file is not finalized. Upload it via /api/storage/uploads/group-file first.",
    );
  }
  if (existingPolicy.owner !== String(ownerId)) {
    throw new InvalidUploadError("This uploaded file belongs to another user.");
  }

  // Sniff the ACTUAL stored bytes — client-declared contentType is untrusted.
  const [head] = await file.download({ start: 0, end: 63 });
  const sniffed = sniffDocumentType(head);
  if (!sniffed || !ALLOWED_GROUP_FILE_TYPES.has(sniffed)) {
    throw new InvalidUploadError(
      "Uploaded file is not an allowed Group file type (PDF, JPEG, PNG, WebP).",
    );
  }

  return { url: `${STORAGE_URL_PREFIX}${objectPath}`, contentType: sniffed };
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
  const { url } = await finalizeUploadedMediaInternal(storageUrl, ownerId, kind);
  return url;
}

async function finalizeUploadedMediaInternal(
  storageUrl: string,
  ownerId: number,
  kind: "image" | "video" | "any",
): Promise<{
  url: string;
  objectPath: string;
  sniffedType: string;
  file: Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>;
  size: number;
  alreadyTranscoded: boolean;
}> {
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

  const alreadyTranscoded =
    (metadata.metadata?.[TRANSCODED_METADATA_KEY] as string | undefined) === "true";

  return {
    url: `${STORAGE_URL_PREFIX}${objectPath}`,
    objectPath,
    sniffedType,
    file,
    size,
    alreadyTranscoded,
  };
}

/**
 * Finalize a user-supplied media URL that may reference a video, running any
 * raw video upload through the same transcode + poster pipeline as feed
 * videos (bounded-bitrate H.264 MP4, max 720p, JPEG poster).
 *
 * - `data:` URLs are rejected.
 * - Non-storage URLs (external links) pass through unchanged, no poster.
 * - Storage images are finalized as usual, no poster.
 * - Storage videos already produced by our transcode pipeline are finalized
 *   as-is (no double compression), no poster.
 * - Raw storage videos are downloaded, transcoded, and re-stored; the
 *   returned URL points at the compressed copy and `posterUrl` at the
 *   generated poster frame. The raw original is left in place — it may
 *   already be referenced by other records, so its removal (when truly
 *   unreferenced) is deferred to the orphan-cleanup script.
 *
 * `kind` restricts the acceptable media families, as in
 * `finalizeUploadedMedia`.
 */
export async function finalizeMediaUrlWithVideoTranscode(
  url: string,
  ownerId: number,
  kind: "video" | "any" = "any",
): Promise<{ url: string; posterUrl: string | null }> {
  if (/^data:/i.test(url.trim())) {
    throw new InvalidUploadError(
      "Embedded data: URLs are not allowed. Upload the file to /api/storage/uploads/video and reference the returned URL.",
    );
  }
  if (!toObjectEntityPath(url)) {
    return { url, posterUrl: null };
  }

  const finalized = await finalizeUploadedMediaInternal(url, ownerId, kind);
  const isVideo = ALLOWED_VIDEO_TYPES.has(finalized.sniffedType);
  if (!isVideo || finalized.alreadyTranscoded) {
    return { url: finalized.url, posterUrl: null };
  }

  // Raw video: download the stored bytes and run the shared transcode
  // pipeline, storing the compressed copy + poster as new objects.
  const [bytes] = await finalized.file.download();
  let transcoded;
  try {
    transcoded = await transcodeVideoForFeed(bytes);
  } catch (err) {
    if (err instanceof TranscodeError) {
      throw new InvalidUploadError(
        "Uploaded video could not be processed. Please upload a valid MP4 or WebM video.",
      );
    }
    throw err;
  }

  const [objectPath, posterPath] = await Promise.all([
    storeValidatedBuffer(transcoded.video, "video/mp4", ownerId, {
      [TRANSCODED_METADATA_KEY]: "true",
    }),
    storeValidatedBuffer(transcoded.poster, "image/jpeg", ownerId),
  ]);

  // NOTE: the raw original is intentionally NOT deleted here. Finalization
  // has no view of database references — the same object may already back an
  // existing gallery item, reel, or feed post. The reference-aware
  // orphan-cleanup script removes it once nothing points at it.
  return {
    url: `${STORAGE_URL_PREFIX}${objectPath}`,
    posterUrl: `${STORAGE_URL_PREFIX}${posterPath}`,
  };
}
