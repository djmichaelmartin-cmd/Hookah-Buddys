import { Readable } from 'stream';
import express, {
  Router,
  type IRouter,
  type Request,
  type Response,
} from 'express';

import { requireAuth } from '../lib/auth';
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  InvalidUploadError,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_VIDEO_UPLOAD_SIZE_BYTES,
  uploadImageBuffer,
  uploadVideoBuffer,
} from '../lib/imageUploads';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

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
 * Bounded server-side video upload, mirroring the image endpoint. The raw
 * body is capped at MAX_VIDEO_UPLOAD_SIZE_BYTES by the body parser, the
 * bytes are sniffed for a real MP4/WebM signature before the object is
 * written, and the stored object is stamped with an owner ACL policy.
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

      const objectPath = await uploadVideoBuffer(body, req.currentUser!.id);
      res.status(201).json({ objectPath });
    } catch (error) {
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
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
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
 * a finalized ACL policy and a validated image content type are served.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
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

    // Never serve attacker-controlled content types from the app origin —
    // only validated image and video types are allowed.
    const [metadata] = await objectFile.getMetadata();
    const contentType = (metadata.contentType as string) || '';
    if (!ALLOWED_IMAGE_TYPES.has(contentType) && !ALLOWED_VIDEO_TYPES.has(contentType)) {
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

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
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

export default router;
