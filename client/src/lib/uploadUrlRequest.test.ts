import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiFetchMock,
  ensureCsrfTokenMock,
  resolveUploadUrlForResponseMock,
} = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  ensureCsrfTokenMock: vi.fn(async () => {}),
  resolveUploadUrlForResponseMock: vi.fn((uploadUrl: string) => uploadUrl),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: apiFetchMock,
}));

vi.mock("@/lib/uploadTransport", () => ({
  ensureCsrfToken: ensureCsrfTokenMock,
  resolveUploadUrlForResponse: resolveUploadUrlForResponseMock,
}));

import { requestUploadUrl } from "./uploadUrlRequest";

function createJsonResponse(body: unknown, status: number, url = "https://hola.test/api/objects/upload"): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("requestUploadUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries transient 502 responses and returns the resolved upload url", async () => {
    apiFetchMock
      .mockResolvedValueOnce(createJsonResponse({ error: "Bad gateway" }, 502))
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            uploadURL: "/api/local-upload/test-123",
            storagePath: "/objects/uploads/test-123",
          },
          200,
        ),
      );
    resolveUploadUrlForResponseMock.mockReturnValueOnce("https://hola.test/api/local-upload/test-123");

    const result = await requestUploadUrl({
      uploadId: "upload-test-123",
      fileName: "captura.png",
      mimeType: "image/png",
      fileSize: 1024,
      maxRetries: 2,
      baseDelayMs: 1,
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(ensureCsrfTokenMock).toHaveBeenCalledTimes(1);
    expect(result.uploadURL).toBe("https://hola.test/api/local-upload/test-123");
    expect(result.storagePath).toBe("/objects/uploads/test-123");
  });

  it("does not retry non-retryable 400 responses", async () => {
    apiFetchMock.mockResolvedValueOnce(
      createJsonResponse({ error: "Invalid uploadId format" }, 400),
    );

    await expect(
      requestUploadUrl({
        uploadId: "bad",
        fileName: "captura.png",
        mimeType: "image/png",
        fileSize: 1024,
        maxRetries: 2,
        baseDelayMs: 1,
      }),
    ).rejects.toThrow("Invalid uploadId format");

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});
