import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generated Group file upload client", () => {
  it("sends the Blob itself rather than a JSON-serialized object", async () => {
    const clientModuleUrl = new URL(
      "../../../../lib/api-client-react/src/generated/api.ts",
      import.meta.url,
    ).href;
    const client = (await import(
      /* @vite-ignore */ clientModuleUrl
    )) as unknown as {
      uploadGroupFile: (file: unknown) => Promise<{
        objectPath: string;
      }>;
    };
    const file = new Blob(["%PDF-1.7\nclient-body"], {
      type: "application/pdf",
    });
    let capturedBody: unknown;
    let capturedContentType: string | null | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: {
        body?: unknown;
        headers?: { get?: (name: string) => string | null };
      }) => {
        capturedBody = init?.body;
        capturedContentType = init?.headers?.get?.("content-type");
        return new Response(
          JSON.stringify({
            objectPath: "/objects/uploads/client-test",
            contentType: "application/pdf",
            sizeBytes: file.size,
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    const result = await client.uploadGroupFile(file);

    expect(capturedBody).toBe(file);
    expect(capturedContentType).toBe("application/octet-stream");
    expect(result.objectPath).toBe("/objects/uploads/client-test");
  });
});