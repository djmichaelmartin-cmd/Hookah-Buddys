/**
 * Production-backed tests for the safe Group file upload path in
 * ../lib/imageUploads:
 *   - uploadGroupFileBuffer(buffer, ownerId): server-side raw upload that
 *     sniffs + bounds the bytes and stamps the owner ACL AT WRITE TIME.
 *   - finalizeUploadedGroupFile(url, ownerId): confirmation-only finalizer that
 *     REQUIRES an existing ACL policy owned by the uploader (never claims an
 *     ACL-less object) before a caller-supplied ref may back a kind=file item.
 *
 * These execute the REAL functions with the storage client + ACL layer mocked
 * (a live object store is unavailable in CI). No production logic is
 * duplicated here — only the storage/ACL boundary is faked so the real
 * decision path runs end to end.
 *
 * Security property (reviewer finding): ACL-less "claiming" is unsafe. A
 * caller-supplied path with no ACL policy, or one owned by another user, must
 * be rejected; ownership may only be assigned by the server while it writes
 * bytes it has itself validated (uploadGroupFileBuffer).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the storage + ACL boundary BEFORE importing the module under test ──

// A minimal PDF header so sniffDocumentType() authoritatively types the object.
const PDF_HEAD = Buffer.concat([
  Buffer.from("%PDF-1.7\n", "latin1"),
  Buffer.alloc(56, 0),
]);

// vi.mock factories are hoisted above module-scope variables, so shared mock
// state must live in a vi.hoisted() block to be accessible inside the factory.
const h = vi.hoisted(() => {
  // Existing-object finalizer path state.
  const setMetadataMock = vi.fn(async (_meta: { contentType: string }) => {});
  const setAclMock = vi.fn(
    async (_file: unknown, _policy: { owner: string; visibility: string }) => {},
  );
  const fakeObject: {
    exists: boolean;
    size: number;
    head: Buffer;
    aclPolicy: { owner: string; visibility: string } | null;
  } = { exists: true, size: 1024, head: Buffer.alloc(64), aclPolicy: null };

  // Write-path state (uploadGroupFileBuffer -> storeValidatedBuffer).
  const saveMock = vi.fn(async (_buf: Buffer, _opts?: unknown) => {});
  return { setMetadataMock, setAclMock, fakeObject, saveMock };
});
const { setMetadataMock, setAclMock, saveMock } = h;
const fakeObject = h.fakeObject;

vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityFile(_objectPath: string) {
      if (!h.fakeObject.exists) throw new ObjectNotFoundError("not found");
      return {
        getMetadata: async () => [{ size: h.fakeObject.size }],
        download: async (_opts?: { start: number; end: number }) => [h.fakeObject.head],
        setMetadata: h.setMetadataMock,
      };
    }
    getPrivateObjectDir() {
      return "/bucket/private";
    }
  }
  return {
    ObjectStorageService,
    ObjectNotFoundError,
    // storeValidatedBuffer uses: objectStorageClient.bucket(name).file(name).save(...)
    objectStorageClient: {
      bucket: (_name: string) => ({
        file: (_objectName: string) => ({ save: h.saveMock }),
      }),
    },
  };
});

vi.mock("../lib/objectAcl", () => ({
  getObjectAclPolicy: async () => h.fakeObject.aclPolicy,
  setObjectAclPolicy: h.setAclMock,
}));

// videoTranscode is imported transitively by imageUploads; stub it so the import
// graph resolves without pulling in ffmpeg/native deps during unit tests.
vi.mock("../lib/videoTranscode", () => ({
  transcodeVideoForFeed: async () => ({ video: Buffer.alloc(0), poster: Buffer.alloc(0) }),
  TranscodeBusyError: class TranscodeBusyError extends Error {},
  TranscodeError: class TranscodeError extends Error {},
}));

// Import the REAL production functions after mocks are registered.
import {
  finalizeUploadedGroupFile,
  uploadGroupFileBuffer,
  InvalidUploadError,
  ALLOWED_GROUP_FILE_TYPES,
  MAX_GROUP_FILE_SIZE_BYTES,
} from "../lib/imageUploads";

const UPLOADER = 1001;
const OTHER_USER = 2002;

beforeEach(() => {
  setMetadataMock.mockClear();
  setAclMock.mockClear();
  saveMock.mockClear();
  // Reset the hoisted object IN PLACE (the mock factories captured this ref).
  fakeObject.exists = true;
  fakeObject.size = 1024;
  fakeObject.head = PDF_HEAD;
  fakeObject.aclPolicy = null; // pending / ACL-less by default
});

describe("finalizeUploadedGroupFile — confirmation-only (never claims ACL-less)", () => {
  it("REJECTS an ACL-less existing object (no ownership may be assigned here)", async () => {
    fakeObject.aclPolicy = null;
    await expect(
      finalizeUploadedGroupFile("/objects/uploads/acl-less", UPLOADER),
    ).rejects.toBeInstanceOf(InvalidUploadError);
    await expect(
      finalizeUploadedGroupFile("/objects/uploads/acl-less", UPLOADER),
    ).rejects.toThrow(/not finalized/i);
    // Must NOT stamp/claim an ACL-less object.
    expect(setAclMock).not.toHaveBeenCalled();
    expect(setMetadataMock).not.toHaveBeenCalled();
  });

  it("REJECTS a valid /objects path owned by another user", async () => {
    fakeObject.aclPolicy = { owner: String(OTHER_USER), visibility: "public" };
    await expect(
      finalizeUploadedGroupFile("/objects/uploads/someone-elses-file", UPLOADER),
    ).rejects.toThrow(/belongs to another user/i);
    expect(setAclMock).not.toHaveBeenCalled();
  });

  it("ACCEPTS an object already finalized to the SAME uploader (no ACL mutation)", async () => {
    fakeObject.aclPolicy = { owner: String(UPLOADER), visibility: "public" };
    const result = await finalizeUploadedGroupFile("/objects/uploads/my-file", UPLOADER);
    expect(result.url).toBe("/api/storage/objects/uploads/my-file");
    expect(result.contentType).toBe("application/pdf");
    // Confirmation-only: never re-stamps metadata or ACL.
    expect(setMetadataMock).not.toHaveBeenCalled();
    expect(setAclMock).not.toHaveBeenCalled();
  });

  it("accepts the /api/storage/objects/... serving-URL form for an owned object", async () => {
    fakeObject.aclPolicy = { owner: String(UPLOADER), visibility: "public" };
    const result = await finalizeUploadedGroupFile(
      "/api/storage/objects/uploads/my-file",
      UPLOADER,
    );
    expect(result.url).toBe("/api/storage/objects/uploads/my-file");
  });

  it("REJECTS a non-object namespace (arbitrary internal path)", async () => {
    await expect(
      finalizeUploadedGroupFile("/private/secrets/whatever", UPLOADER),
    ).rejects.toThrow(/uploaded storage object/i);
  });

  it("REJECTS external URLs and data: URLs", async () => {
    await expect(
      finalizeUploadedGroupFile("https://evil.example/x.pdf", UPLOADER),
    ).rejects.toThrow(/uploaded storage object/i);
    await expect(
      finalizeUploadedGroupFile("data:application/pdf;base64,AAAA", UPLOADER),
    ).rejects.toThrow(/data: URLs are not allowed/i);
  });

  it("REJECTS a missing object", async () => {
    fakeObject.exists = false;
    await expect(
      finalizeUploadedGroupFile("/objects/uploads/ghost", UPLOADER),
    ).rejects.toThrow(/not found/i);
  });

  it("REJECTS an empty object", async () => {
    fakeObject.size = 0;
    await expect(
      finalizeUploadedGroupFile("/objects/uploads/empty", UPLOADER),
    ).rejects.toThrow(/empty/i);
  });

  it("REJECTS an oversize object (> 15 MB policy)", async () => {
    fakeObject.size = MAX_GROUP_FILE_SIZE_BYTES + 1;
    await expect(
      finalizeUploadedGroupFile("/objects/uploads/huge", UPLOADER),
    ).rejects.toThrow(/size limit/i);
  });

  it("REJECTS bytes that are not an allowed Group file type even when owned", async () => {
    fakeObject.aclPolicy = { owner: String(UPLOADER), visibility: "public" };
    fakeObject.head = Buffer.from("PK\x03\x04arbitrary-zip-or-docx-bytes", "latin1");
    await expect(
      finalizeUploadedGroupFile("/objects/uploads/arbitrary", UPLOADER),
    ).rejects.toThrow(/not an allowed Group file type/i);
  });
});

describe("uploadGroupFileBuffer — server-side write stamps owner ACL at write time", () => {
  it("ACCEPTS allowed bytes and stamps { owner, public } ACL on the written object", async () => {
    const buf = Buffer.concat([PDF_HEAD, Buffer.alloc(100, 1)]);
    const result = await uploadGroupFileBuffer(buf, UPLOADER);
    expect(result.objectPath).toMatch(/^\/objects\/uploads\//);
    expect(result.contentType).toBe("application/pdf");
    // Bytes were written and the owner ACL stamped AT WRITE TIME.
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(setAclMock).toHaveBeenCalledTimes(1);
    const [, policy] = setAclMock.mock.calls[0];
    expect(policy).toEqual({ owner: String(UPLOADER), visibility: "public" });
  });

  it("REJECTS an empty buffer (no write, no ACL)", async () => {
    await expect(uploadGroupFileBuffer(Buffer.alloc(0), UPLOADER)).rejects.toThrow(/empty/i);
    expect(saveMock).not.toHaveBeenCalled();
    expect(setAclMock).not.toHaveBeenCalled();
  });

  it("REJECTS an oversize buffer (> 15 MB policy)", async () => {
    const big = Buffer.alloc(MAX_GROUP_FILE_SIZE_BYTES + 1);
    await expect(uploadGroupFileBuffer(big, UPLOADER)).rejects.toThrow(/size limit/i);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("REJECTS bytes of a disallowed/unsniffable type (no write, no ACL)", async () => {
    const zip = Buffer.from("PK\x03\x04not-a-pdf-or-image", "latin1");
    await expect(uploadGroupFileBuffer(zip, UPLOADER)).rejects.toThrow(
      /not an allowed Group file type/i,
    );
    expect(saveMock).not.toHaveBeenCalled();
    expect(setAclMock).not.toHaveBeenCalled();
  });
});

describe("ALLOWED_GROUP_FILE_TYPES — documented storage-model limitation", () => {
  it("permits only byte-verifiable types; arbitrary files are refused", () => {
    expect(ALLOWED_GROUP_FILE_TYPES.has("application/pdf")).toBe(true);
    expect(ALLOWED_GROUP_FILE_TYPES.has("image/png")).toBe(true);
    expect(ALLOWED_GROUP_FILE_TYPES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_GROUP_FILE_TYPES.has("image/webp")).toBe(true);
    expect(ALLOWED_GROUP_FILE_TYPES.has("application/zip")).toBe(false);
    expect(
      ALLOWED_GROUP_FILE_TYPES.has(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });
});
