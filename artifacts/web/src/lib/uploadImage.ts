export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload an image file to object storage via the bounded server endpoint and
 * return the serving URL ("/api/storage/objects/..."). Throws Error with a
 * user-facing message on failure.
 */
export async function uploadImage(file: File): Promise<string> {
  const res = await fetch("/api/storage/uploads/image", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Upload failed");
  }
  const { objectPath } = await res.json();
  return `/api/storage${objectPath}`;
}
