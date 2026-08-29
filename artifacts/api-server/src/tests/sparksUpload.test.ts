import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  transcode: vi.fn(),
  save: vi.fn(async (..._args: unknown[]) => {}),
  setAcl: vi.fn(async () => {}),
  setMetadata: vi.fn(async () => {}),
  getMetadata: vi.fn(async () => [{ contentType: "video/mp4", metadata: {} }]),
}));

vi.mock("../lib/videoTranscode", () => {
  class TranscodeError extends Error {}
  class TranscodeBusyError extends Error {}
  class VideoTooLongError extends TranscodeError {}
  return {
    TranscodeError,
    TranscodeBusyError,
    VideoTooLongError,
    transcodeVideoForFeed: h.transcode,
  };
});

vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class ObjectStorageService {
    getPrivateObjectDir() {
      return "/bucket/private";
    }
    getObjectEntityFile() {
      return { getMetadata: h.getMetadata, setMetadata: h.setMetadata };
    }
  },
  objectStorageClient: {
    bucket: () => ({ file: () => ({ save: h.save }) }),
  },
}));

vi.mock("../lib/objectAcl", () => ({
  getObjectAclPolicy: vi.fn(),
  setObjectAclPolicy: h.setAcl,
}));

import {
  InvalidUploadError,
  getValidatedSparkUpload,
  sniffVideoType,
  uploadVideoBuffer,
} from "../lib/imageUploads";
import { VideoTooLongError } from "../lib/videoTranscode";
import { CreateReelBody } from "@workspace/api-zod";

function movHeader(): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(20, 0);
  bytes.write("ftyp", 4, "latin1");
  bytes.write("qt  ", 8, "latin1");
  return bytes;
}

beforeEach(() => {
  h.transcode.mockReset();
  h.save.mockClear();
  h.setAcl.mockClear();
  h.setMetadata.mockClear();
  h.getMetadata.mockClear();
  h.getMetadata.mockResolvedValue([{ contentType: "video/mp4", metadata: {} }]);
  h.transcode.mockResolvedValue({
    video: Buffer.from("transcoded"),
    poster: Buffer.from("poster"),
  });
});

describe("canonical Spark upload policy", () => {
  it("accepts Spark metadata without the retired hookah confirmation", () => {
    const parsed = CreateReelBody.safeParse({
      videoUrl: "/objects/uploads/video",
      caption: "A night out",
      hashtags: ["nightlife"],
      peopleTags: [7, 8],
      businessId: 3,
      location: "Downtown",
      feeling: "celebrating",
      visibility: "friends",
      commentsEnabled: false,
      sharingEnabled: false,
    });

    expect(parsed.success).toBe(true);
  });

  it("recognizes a QuickTime MOV container by bytes", () => {
    expect(sniffVideoType(movHeader())).toBe("video/quicktime");
  });

  it("reuses the shared transcode/poster path with the 90-second option", async () => {
    const result = await uploadVideoBuffer(movHeader(), 42, {
      maxDurationSeconds: 90,
    });

    expect(h.transcode).toHaveBeenCalledWith(
      expect.any(Buffer),
      { maxDurationSeconds: 90 },
    );
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.setAcl).toHaveBeenCalledTimes(2);
    expect(result.objectPath).toMatch(/^\/objects\/uploads\//);
    expect(result.posterPath).toMatch(/^\/objects\/uploads\//);
  });

  it("stamps canonical uploads and keeps both objects private before Spark creation", async () => {
    await uploadVideoBuffer(movHeader(), 42, {
      maxDurationSeconds: 90,
      sparkDurationValidated: true,
    });

    expect(h.save.mock.calls[0]?.[1]).toMatchObject({
      metadata: { metadata: { sparkDurationValidated: "true" } },
    });
    expect(h.setAcl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ owner: "42", visibility: "private" }),
    );
  });

  it("rejects external and generic storage videos as new Spark inputs", async () => {
    await expect(getValidatedSparkUpload("https://example.com/video.mp4", 42))
      .rejects.toThrow(/sparks\/uploads\/video/i);
    await expect(getValidatedSparkUpload("/objects/uploads/generic-video", 42))
      .rejects.toThrow(/sparks\/uploads\/video/i);
  });

  it("surfaces the duration policy as a client-safe invalid upload", async () => {
    h.transcode.mockRejectedValue(
      new VideoTooLongError("Uploaded video exceeds the 90 second duration limit."),
    );

    await expect(
      uploadVideoBuffer(movHeader(), 42, { maxDurationSeconds: 90 }),
    ).rejects.toBeInstanceOf(InvalidUploadError);
    await expect(
      uploadVideoBuffer(movHeader(), 42, { maxDurationSeconds: 90 }),
    ).rejects.toThrow(/90 second duration limit/i);
    expect(h.save).not.toHaveBeenCalled();
  });
});