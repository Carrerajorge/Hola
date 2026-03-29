import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAttachmentPipeline } from "../useAttachmentPipeline";

// Mock dependencies
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("@/lib/logger", () => ({
  chatLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/fileUploader", () => ({
  getFileUploader: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      uploadUrl: "https://upload.example.com/test",
      fileId: "server-file-123",
    }),
  }),
}));

describe("useAttachmentPipeline", () => {
  const defaultProps = {
    chatId: "test-chat-123",
    user: { id: "user-123" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with empty state", () => {
    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    expect(result.current.files).toEqual([]);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.totalProgress).toBe(0);
  });

  it("should add files", () => {
    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    const mockFile = new File(["content"], "test.txt", { type: "text/plain" });
    const fileList = {
      0: mockFile,
      length: 1,
      item: (i: number) => (i === 0 ? mockFile : null),
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].name).toBe("test.txt");
    expect(result.current.files[0].status).toBe("pending");
  });

  it("should remove files", () => {
    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    const mockFile = new File(["content"], "test.txt", { type: "text/plain" });
    const fileList = {
      0: mockFile,
      length: 1,
      item: (i: number) => (i === 0 ? mockFile : null),
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    const fileId = result.current.files[0].id;

    act(() => {
      result.current.removeFile(fileId);
    });

    expect(result.current.files).toHaveLength(0);
  });

  it("should clear all files", () => {
    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    const mockFile1 = new File(["content"], "test1.txt", { type: "text/plain" });
    const mockFile2 = new File(["content"], "test2.txt", { type: "text/plain" });
    const fileList = {
      0: mockFile1,
      1: mockFile2,
      length: 2,
      item: (i: number) => (i === 0 ? mockFile1 : mockFile2),
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    expect(result.current.files).toHaveLength(2);

    act(() => {
      result.current.clearFiles();
    });

    expect(result.current.files).toHaveLength(0);
  });

  it("should enforce max files limit", () => {
    const { result } = renderHook(() =>
      useAttachmentPipeline({ ...defaultProps, maxFiles: 2 })
    );

    const mockFile1 = new File(["content"], "test1.txt", { type: "text/plain" });
    const mockFile2 = new File(["content"], "test2.txt", { type: "text/plain" });
    const mockFile3 = new File(["content"], "test3.txt", { type: "text/plain" });

    const fileList = {
      0: mockFile1,
      1: mockFile2,
      2: mockFile3,
      length: 3,
      item: (i: number) => [mockFile1, mockFile2, mockFile3][i] || null,
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    expect(result.current.files).toHaveLength(2);
  });

  it("should enforce max file size", () => {
    const { result } = renderHook(() =>
      useAttachmentPipeline({ ...defaultProps, maxSize: 100 }) // 100 bytes
    );

    const smallFile = new File(["small"], "small.txt", { type: "text/plain" });
    const largeFile = new File(["x".repeat(1000)], "large.txt", { type: "text/plain" });

    const fileList = {
      0: smallFile,
      1: largeFile,
      length: 2,
      item: (i: number) => (i === 0 ? smallFile : largeFile),
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].name).toBe("small.txt");
  });

  it("should handle null file list", () => {
    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    act(() => {
      result.current.addFiles(null);
    });

    expect(result.current.files).toHaveLength(0);
  });

  it("should upload files successfully", async () => {
    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    const mockFile = new File(["content"], "test.txt", { type: "text/plain" });
    const fileList = {
      0: mockFile,
      length: 1,
      item: (i: number) => (i === 0 ? mockFile : null),
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    let uploadedFiles: any[] = [];
    await act(async () => {
      uploadedFiles = await result.current.uploadFiles();
    });

    expect(uploadedFiles).toHaveLength(1);
    expect(uploadedFiles[0].status).toBe("completed");
    expect(uploadedFiles[0].url).toBeDefined();
  });

  it("should handle upload errors gracefully", async () => {
    const { apiFetch } = await import("@/lib/apiClient");
    (apiFetch as any).mockRejectedValueOnce(new Error("Upload failed"));

    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    const mockFile = new File(["content"], "test.txt", { type: "text/plain" });
    const fileList = {
      0: mockFile,
      length: 1,
      item: (i: number) => (i === 0 ? mockFile : null),
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    let uploadedFiles: any[] = [];
    await act(async () => {
      uploadedFiles = await result.current.uploadFiles();
    });

    expect(uploadedFiles).toHaveLength(0); // Failed uploads not returned
  });

  it("should calculate total progress", () => {
    const { result } = renderHook(() => useAttachmentPipeline(defaultProps));

    const mockFile1 = new File(["content"], "test1.txt", { type: "text/plain" });
    const mockFile2 = new File(["content"], "test2.txt", { type: "text/plain" });
    const fileList = {
      0: mockFile1,
      1: mockFile2,
      length: 2,
      item: (i: number) => (i === 0 ? mockFile1 : mockFile2),
    } as unknown as FileList;

    act(() => {
      result.current.addFiles(fileList);
    });

    expect(result.current.totalProgress).toBe(0);
  });
});
