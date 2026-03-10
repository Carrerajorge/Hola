import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const apiRequestMock = vi.fn();
const resolveUploadUrlForResponseMock = vi.fn();
const uploadBlobWithProgressMock = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
}));

vi.mock("@/lib/uploadTransport", () => ({
  resolveUploadUrlForResponse: resolveUploadUrlForResponseMock,
  uploadBlobWithProgress: uploadBlobWithProgressMock,
}));

import { useCloudLibrary, type LibraryFile } from "@/hooks/use-cloud-library";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useCloudLibrary uploads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiRequestMock.mockReset();
    resolveUploadUrlForResponseMock.mockReset();
    uploadBlobWithProgressMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the shared upload transport for local uploads and completes the file record", async () => {
    const uploadUrlResponse = new Response(
      JSON.stringify({
        uploadUrl: "/api/local-upload/local-object-123",
        storagePath: "/objects/uploads/local-object-123",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
    Object.defineProperty(uploadUrlResponse, "url", {
      value: "https://iliagpt.com/api/library/upload/request-url",
      configurable: true,
    });

    const savedFile = {
      id: 101,
      uuid: "file-uuid-101",
      name: "report",
      originalName: "report.pdf",
      description: null,
      type: "document",
      mimeType: "application/pdf",
      extension: "pdf",
      storagePath: "/objects/uploads/local-object-123",
      storageUrl: null,
      thumbnailPath: null,
      thumbnailUrl: null,
      size: 128,
      width: null,
      height: null,
      duration: null,
      pages: 1,
      metadata: null,
      folderId: null,
      tags: null,
      isFavorite: false,
      isArchived: false,
      isPinned: false,
      userId: "user-1",
      isPublic: false,
      sharedWith: null,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      lastAccessedAt: null,
      deletedAt: null,
      version: 1,
      parentVersionId: null,
    };

    apiRequestMock
      .mockResolvedValueOnce(uploadUrlResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(savedFile), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    resolveUploadUrlForResponseMock.mockReturnValue("https://iliagpt.com/api/local-upload/local-object-123");
    uploadBlobWithProgressMock.mockImplementation(
      async (_url: string, _file: File, onProgress?: (percent: number) => void) => {
        onProgress?.(50);
      }
    );

    const { result } = renderHook(() => useCloudLibrary({ enabled: false }), {
      wrapper: createWrapper(),
    });

    const file = new File(["pdf-body"], "report.pdf", { type: "application/pdf" });
    let uploadedFile: LibraryFile | undefined;

    await act(async () => {
      uploadedFile = await result.current.uploadFile({ file });
    });

    expect(apiRequestMock).toHaveBeenNthCalledWith(
      1,
      "POST",
      "/api/library/upload/request-url",
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        folderId: undefined,
      }
    );
    expect(resolveUploadUrlForResponseMock).toHaveBeenCalledWith(
      "/api/local-upload/local-object-123",
      "https://iliagpt.com/api/library/upload/request-url"
    );
    expect(uploadBlobWithProgressMock).toHaveBeenCalledTimes(1);
    expect(uploadBlobWithProgressMock).toHaveBeenCalledWith(
      "https://iliagpt.com/api/local-upload/local-object-123",
      file,
      expect.any(Function),
      {
        timeoutMs: 120000,
        headers: {
          "Content-Type": "application/pdf",
        },
      }
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      2,
      "POST",
      "/api/library/upload/complete",
      {
        storagePath: "/objects/uploads/local-object-123",
        metadata: {
          name: "report",
          originalName: "report.pdf",
          description: undefined,
          type: "document",
          mimeType: "application/pdf",
          extension: "pdf",
          size: 8,
          width: undefined,
          height: undefined,
          duration: undefined,
          pages: undefined,
          tags: undefined,
          metadata: undefined,
        },
      }
    );

    await waitFor(() => {
      expect(result.current.uploadProgress).toHaveLength(1);
      expect(result.current.uploadProgress[0]).toMatchObject({
        fileName: "report.pdf",
        status: "done",
        progress: 100,
      });
    });

    expect(uploadedFile).toEqual(savedFile);
  });
});
