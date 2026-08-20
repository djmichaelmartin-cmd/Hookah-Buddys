import { Readable } from 'stream';
import express, {
  Router,
  type IRouter,
  type Request,
  type Response,
} from 'express';

import { requireAuth } from '../lib/auth';
import {
  ALLOWED_GROUP_FILE_TYPES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  InvalidUploadError,
  MAX_GROUP_FILE_SIZE_BYTES,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_VIDEO_UPLOAD_SIZE_BYTES,
  TranscodeBusyError,
  uploadGroupFileBuffer,
  uploadImageBuffer,
  uploadVideoBuffer,
} from '../lib/imageUploads';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { isObjectReferencedByPrivateGroup } from '../lib/groupAssets';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/image
 *
 * Bounded server-side image upload. The raw request body is capped at
 * MAX_UPLOAD_SIZE_BYTES by the body parser (oversized requests are rejected
 * with 413 before any bytes reach durable storage). The actual bytes are
 * sniffed for a real image signature before the object is written, and the
 * stored object is stamped with an owner ACL policy (finalized) on write.
 */
router.post(
  '/storage/uploads/image',
  requireAuth(),
  express.raw({
    type: () => true,
    limit: MAX_UPLOAD_SIZE_BYTES,
  }),
  async (req: Request, res: Response) => {
    try {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Request body must be the raw image bytes.' });
        return;
      }

      const objectPath = await uploadImageBuffer(body, req.currentUser!.id);
      res.status(201).json({ objectPath });
    } catch (error) {
      if (error instanceof InvalidUploadError) {
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, 'Error uploading image');
      res.status(500).json({ error: 'Failed to upload image' });
    }
  },
);

/**
 * POST /storage/uploads/video
 *
 * Bounded server-side video upload. The raw body is capped at
 * MAX_VIDEO_UPLOAD_SIZE_BYTES by the body parser and the bytes are sniffed
 * for a real MP4/WebM signature. The video is then transcoded to a
 * web-friendly H.264 MP4 with a JPEG poster frame; both stored objects are
 * stamped with an owner ACL policy. Responds with both object paths.
 */
router.post(
  '/storage/uploads/video',
  requireAuth(),
  express.raw({
    type: () => true,
    limit: MAX_VIDEO_UPLOAD_SIZE_BYTES,
  }),
  async (req: Request, res: Response) => {
    try {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Request body must be the raw video bytes.' });
        return;
      }

      const { objectPath, posterPath } = await uploadVideoBuffer(
        body,
        req.currentUser!.id,
      );
      res.status(201).json({ objectPath, posterPath });
    } catch (error) {
      if (error instanceof TranscodeBusyError) {
        res.setHeader('Retry-After', '15');
        res.status(503).json({ error: error.message });
        return;
      }
      if (error instanceof InvalidUploadError) {
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, 'Error uploading video');
      res.status(500).json({ error: 'Failed to upload video' });
    }
  },
);

/**
 * POST /storage/uploads/group-file
 *
 * Bounded server-side generic Group file upload. Send the raw file bytes as
 * the request body. The raw body is capped at MAX_GROUP_FILE_SIZE_BYTES by the
 * body parser (oversized requests are rejected with 413 before any bytes reach
 * durable storage). The bytes are sniffed for an allowed Group file signature
 * (PDF/JPEG/PNG/WebP); the stored object is stamped with an owner ACL policy
 * (finalized) ON WRITE. Responds with the object path and sniffed content type.
 */
router.post(
  '/storage/uploads/group-file',
  requireAuth(),
  express.raw({
    type: () => true,
    limit: MAX_GROUP_FILE_SIZE_BYTES,
  }),
  async (req: Request, res: Response) => {
    try {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Request body must be the raw file bytes.' });
        return;
      }

      const { objectPath, contentType } = await uploadGroupFileBuffer(
        body,
        req.currentUser!.id,
      );
      res.status(201).json({ objectPath, contentType });
    } catch (error) {
      if (error instanceof InvalidUploadError) {
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, 'Error uploading group file');
      res.status(500).json({ error: 'Failed to upload file' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * Range requests are forwarded so media can seek without full downloads.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(
        file,
        3600,
        req.headers.range,
      );

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve uploaded object entities from PRIVATE_OBJECT_DIR. Only objects with
 * a finalized ACL policy and a validated image/video content type are served.
 * Range requests are forwarded so videos can seek without full downloads.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Group privacy bypass guard: any object referenced by a PRIVATE Group must
    // NOT be served by this universal (unauthenticated, ACL-only) route. Such
    // objects are only reachable via the protected Group asset route, which
    // enforces the Group access policy. Non-Group and public-Group objects are
    // unaffected and continue to serve here.
    if (await isObjectReferencedByPrivateGroup(objectPath)) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }

    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    // Only serve objects that were written through the validated upload path
    // (which sets a public-read ACL policy). Anything else is refused.
    const canAccess = await objectStorageService.canAccessObjectEntity({
      objectFile,
    });
    if (!canAccess) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }

    await streamValidatedObject(objectFile, req, res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

/**
 * Shared streamer for finalized object entities. Enforces the allowed
 * content-type policy (image / video / Group file), sets `X-Content-Type-
 * Options: nosniff`, forces `Content-Disposition: attachment` for PDFs, and
 * forwards range requests for video seeking. Used by both the universal storage
 * route and the protected Group asset route so behavior is identical.
 *
 * Returns after writing a 404 when the object's content type is not allowed.
 */
export async function streamValidatedObject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objectFile: any,
  req: Request,
  res: Response,
): Promise<void> {
  // Never serve attacker-controlled content types from the app origin —
  // only validated image, video, and Group file types are allowed. The
  // Group file set adds application/pdf (still-image PDF/JPEG/PNG/WebP), all
  // of which are safe to serve because they were sniffed at upload time.
  const [metadata] = await objectFile.getMetadata();
  const contentType = (metadata.contentType as string) || '';
  if (
    !ALLOWED_IMAGE_TYPES.has(contentType) &&
    !ALLOWED_VIDEO_TYPES.has(contentType) &&
    !ALLOWED_GROUP_FILE_TYPES.has(contentType)
  ) {
    res.status(404).json({ error: 'Object not found' });
    return;
  }

  const response = await objectStorageService.downloadObject(
    objectFile,
    3600,
    req.headers.range,
  );

  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // PDFs must never render inline in the app origin — force a download so a
  // crafted PDF cannot execute script in the origin's context.
  if (contentType === 'application/pdf') {
    res.setHeader('Content-Disposition', 'attachment');
  }

  if (response.body) {
    const nodeStream = Readable.fromWeb(
      response.body as ReadableStream<Uint8Array>,
    );
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}

export default router;
