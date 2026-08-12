export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm"];
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

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

/**
 * Upload a video file (MP4/WebM, max 50 MB) via the bounded server endpoint.
 * The server transcodes it to a compressed H.264 MP4 and extracts a JPEG
 * poster frame. Returns the serving URLs for both. Throws Error with a
 * user-facing message on failure.
 */
export async function uploadVideo(
  file: File,
): Promise<{ url: string; posterUrl: string }> {
  const res = await fetch("/api/storage/uploads/video", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error("Video exceeds the 50 MB size limit.");
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Upload failed");
  }
  const { objectPath, posterPath } = await res.json();
  return {
    url: `/api/storage${objectPath}`,
    posterUrl: `/api/storage${posterPath}`,
  };
}
