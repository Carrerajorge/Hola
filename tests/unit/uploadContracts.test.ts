import { describe, it, expect } from "vitest";
import {
  UPLOAD_ID_PATTERN,
  CONVERSATION_ID_PATTERN,
} from "@shared/uploadContracts";
import type {
  UploadState,
  UploadStatusEvent,
  UploadResponse,
  UploadSecurityContract,
  UploadAuthMode,
  FileStatusResponse,
} from "@shared/uploadContracts";

describe("UPLOAD_ID_PATTERN", () => {
  it("accepts valid upload IDs", () => {
    expect(UPLOAD_ID_PATTERN.test("abc123")).toBe(true);
    expect(UPLOAD_ID_PATTERN.test("Upload.file-1_2")).toBe(true);
    expect(UPLOAD_ID_PATTERN.test("a".repeat(127))).toBe(true);
  });

  it("rejects too short IDs", () => {
    expect(UPLOAD_ID_PATTERN.test("abc")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("ab")).toBe(false);
  });

  it("rejects IDs starting with special characters", () => {
    expect(UPLOAD_ID_PATTERN.test(".abc123")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("-abc123")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("_abc123")).toBe(false);
  });

  it("rejects IDs exceeding max length", () => {
    expect(UPLOAD_ID_PATTERN.test("a".repeat(128))).toBe(false);
  });

  it("rejects empty string", () => {
    expect(UPLOAD_ID_PATTERN.test("")).toBe(false);
  });
});

describe("CONVERSATION_ID_PATTERN", () => {
  it("accepts valid conversation IDs", () => {
    expect(CONVERSATION_ID_PATTERN.test("abcd")).toBe(true);
    expect(CONVERSATION_ID_PATTERN.test("conv.123-abc_def")).toBe(true);
  });

  it("rejects too short IDs", () => {
    expect(CONVERSATION_ID_PATTERN.test("ab")).toBe(false);
    expect(CONVERSATION_ID_PATTERN.test("a")).toBe(false);
  });

  it("rejects IDs exceeding max length", () => {
    expect(CONVERSATION_ID_PATTERN.test("a".repeat(257))).toBe(false);
  });
});

describe("Type contracts (compile-time)", () => {
  it("UploadState has expected values", () => {
    const states: UploadState[] = ["queued", "processing", "ready", "failed", "error"];
    expect(states).toHaveLength(5);
  });

  it("UploadAuthMode has expected values", () => {
    const modes: UploadAuthMode[] = ["cookie-session", "bearer-token"];
    expect(modes).toHaveLength(2);
  });

  it("UploadStatusEvent has required fields", () => {
    const event: UploadStatusEvent = {
      fileId: "file-1",
      state: "ready",
      uploadProgress: 100,
      processingProgress: 100,
    };
    expect(event.fileId).toBe("file-1");
    expect(event.state).toBe("ready");
  });

  it("UploadResponse has required fields", () => {
    const resp: UploadResponse = {
      uploadURL: "https://example.com/upload",
      storagePath: "/uploads/file.pdf",
    };
    expect(resp.uploadURL).toBeDefined();
  });

  it("FileStatusResponse has required fields", () => {
    const status: FileStatusResponse = {
      fileId: "f1",
      name: "test.pdf",
      status: "ready",
      processingProgress: 100,
      processingError: null,
      completedAt: "2024-01-01T00:00:00Z",
    };
    expect(status.fileId).toBe("f1");
  });

  it("UploadSecurityContract has nested structure", () => {
    const contract: UploadSecurityContract = {
      authMode: "cookie-session",
      csrf: {
        required: true,
        headerNames: ["X-CSRF-Token"],
        credentials: "include",
        rotateOnDemand: true,
      },
      cors: {
        requiresCredentials: true,
        originValidation: "strict",
        refererValidation: "strict",
      },
      upload: {
        endpoint: "/api/upload",
        directUploadContentTypePolicy: "strict",
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowedMimeTypes: ["application/pdf"],
      },
      idempotency: {
        uploadIdHeader: "X-Upload-Id",
        conversationIdHeader: "X-Conversation-Id",
      },
    };
    expect(contract.csrf.required).toBe(true);
    expect(contract.upload.allowedMimeTypes).toContain("application/pdf");
  });
});
