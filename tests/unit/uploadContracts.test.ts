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
  BaseUploadHeaders,
  UploadIntentRequest,
  MultipartCreateRequest,
  MultipartSignPartRequest,
  MultipartCompleteRequest,
  FileRegisterRequest,
} from "@shared/uploadContracts";

// ---------------------------------------------------------------------------
// UPLOAD_ID_PATTERN
// ---------------------------------------------------------------------------
describe("UPLOAD_ID_PATTERN", () => {
  it("accepts valid alphanumeric upload IDs of minimum length", () => {
    expect(UPLOAD_ID_PATTERN.test("abc123")).toBe(true); // 6 chars
    expect(UPLOAD_ID_PATTERN.test("A1b2C3")).toBe(true);
  });

  it("accepts IDs with allowed special characters (., -, _)", () => {
    expect(UPLOAD_ID_PATTERN.test("Upload.file-1_2")).toBe(true);
    expect(UPLOAD_ID_PATTERN.test("a_b.c-d.e_f")).toBe(true);
  });

  it("accepts ID at maximum allowed length (127 chars)", () => {
    expect(UPLOAD_ID_PATTERN.test("a".repeat(127))).toBe(true);
  });

  it("rejects IDs shorter than 6 total characters", () => {
    expect(UPLOAD_ID_PATTERN.test("abc")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("ab")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("a")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("abcde")).toBe(false); // 5 chars
  });

  it("rejects IDs starting with special characters", () => {
    expect(UPLOAD_ID_PATTERN.test(".abc123")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("-abc123")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("_abc123")).toBe(false);
  });

  it("rejects IDs exceeding 127 characters", () => {
    expect(UPLOAD_ID_PATTERN.test("a".repeat(128))).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("X".repeat(200))).toBe(false);
  });

  it("rejects empty string", () => {
    expect(UPLOAD_ID_PATTERN.test("")).toBe(false);
  });

  it("rejects IDs with disallowed characters (spaces, @, #, etc.)", () => {
    expect(UPLOAD_ID_PATTERN.test("abc 123")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("abc@123")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("abc#123")).toBe(false);
    expect(UPLOAD_ID_PATTERN.test("abc/123")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CONVERSATION_ID_PATTERN
// ---------------------------------------------------------------------------
describe("CONVERSATION_ID_PATTERN", () => {
  it("accepts valid conversation IDs (min 4 chars total)", () => {
    expect(CONVERSATION_ID_PATTERN.test("abcd")).toBe(true);
    expect(CONVERSATION_ID_PATTERN.test("conv.123-abc_def")).toBe(true);
  });

  it("accepts ID at maximum length (256 chars)", () => {
    expect(CONVERSATION_ID_PATTERN.test("a".repeat(256))).toBe(true);
  });

  it("rejects IDs shorter than 4 total characters", () => {
    expect(CONVERSATION_ID_PATTERN.test("ab")).toBe(false);
    expect(CONVERSATION_ID_PATTERN.test("a")).toBe(false);
    expect(CONVERSATION_ID_PATTERN.test("abc")).toBe(false); // 3 chars
  });

  it("rejects IDs exceeding 256 characters", () => {
    expect(CONVERSATION_ID_PATTERN.test("a".repeat(257))).toBe(false);
  });

  it("rejects IDs starting with non-alphanumeric characters", () => {
    expect(CONVERSATION_ID_PATTERN.test(".abcdef")).toBe(false);
    expect(CONVERSATION_ID_PATTERN.test("-abcdef")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(CONVERSATION_ID_PATTERN.test("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type contracts - UploadState
// ---------------------------------------------------------------------------
describe("UploadState type contract", () => {
  it("covers all five valid states", () => {
    const states: UploadState[] = ["queued", "processing", "ready", "failed", "error"];
    expect(states).toHaveLength(5);
    expect(states).toContain("queued");
    expect(states).toContain("error");
  });
});

// ---------------------------------------------------------------------------
// Type contracts - UploadAuthMode
// ---------------------------------------------------------------------------
describe("UploadAuthMode type contract", () => {
  it("covers both auth modes", () => {
    const modes: UploadAuthMode[] = ["cookie-session", "bearer-token"];
    expect(modes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Type contracts - UploadStatusEvent
// ---------------------------------------------------------------------------
describe("UploadStatusEvent type contract", () => {
  it("creates a valid event with required fields", () => {
    const event: UploadStatusEvent = {
      fileId: "file-abc",
      state: "processing",
      uploadProgress: 50,
      processingProgress: 0,
    };
    expect(event.fileId).toBe("file-abc");
    expect(event.state).toBe("processing");
    expect(event.uploadProgress).toBe(50);
  });

  it("allows optional error field", () => {
    const event: UploadStatusEvent = {
      fileId: "file-xyz",
      state: "failed",
      uploadProgress: 100,
      processingProgress: 30,
      error: "Timeout exceeded",
    };
    expect(event.error).toBe("Timeout exceeded");
  });
});

// ---------------------------------------------------------------------------
// Type contracts - UploadResponse
// ---------------------------------------------------------------------------
describe("UploadResponse type contract", () => {
  it("creates a minimal upload response", () => {
    const resp: UploadResponse = {
      uploadURL: "https://storage.example.com/upload/123",
      storagePath: "/bucket/files/doc.pdf",
    };
    expect(resp.uploadURL).toContain("https://");
    expect(resp.storagePath).toContain("/");
  });

  it("allows optional uploadId and localFallback", () => {
    const resp: UploadResponse = {
      uploadURL: "https://example.com/upload",
      storagePath: "/tmp/local",
      uploadId: "up-001",
      localFallback: true,
    };
    expect(resp.uploadId).toBe("up-001");
    expect(resp.localFallback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type contracts - FileStatusResponse
// ---------------------------------------------------------------------------
describe("FileStatusResponse type contract", () => {
  it("creates a completed file status", () => {
    const status: FileStatusResponse = {
      fileId: "f1",
      name: "report.pdf",
      status: "ready",
      processingProgress: 100,
      processingError: null,
      completedAt: "2024-06-15T10:30:00Z",
    };
    expect(status.processingProgress).toBe(100);
    expect(status.processingError).toBeNull();
    expect(status.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("creates a failed file status with error", () => {
    const status: FileStatusResponse = {
      fileId: "f2",
      name: "corrupt.xlsx",
      status: "failed",
      processingProgress: 10,
      processingError: "Unsupported format",
      completedAt: null,
    };
    expect(status.processingError).toBe("Unsupported format");
    expect(status.completedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Type contracts - UploadSecurityContract
// ---------------------------------------------------------------------------
describe("UploadSecurityContract type contract", () => {
  it("creates a full security contract with cookie-session auth", () => {
    const contract: UploadSecurityContract = {
      requestId: "req-001",
      issuedAt: "2024-01-01T00:00:00Z",
      authMode: "cookie-session",
      csrf: {
        required: true,
        tokenEndpoint: "/api/csrf-token",
        cookieName: "csrftoken",
        headerNames: ["X-CSRF-Token", "X-CSRFToken"],
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
        maxFileSizeBytes: 50 * 1024 * 1024,
        allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
      },
      idempotency: {
        uploadIdHeader: "X-Upload-Id",
        conversationIdHeader: "X-Conversation-Id",
      },
    };
    expect(contract.csrf.required).toBe(true);
    expect(contract.csrf.headerNames).toHaveLength(2);
    expect(contract.upload.allowedMimeTypes).toContain("application/pdf");
    expect(contract.upload.maxFileSizeBytes).toBe(50 * 1024 * 1024);
    expect(contract.cors.originValidation).toBe("strict");
  });

  it("creates a minimal security contract with bearer-token auth", () => {
    const contract: UploadSecurityContract = {
      authMode: "bearer-token",
      csrf: {
        required: false,
        headerNames: [],
        credentials: "omit",
        rotateOnDemand: false,
      },
      cors: {
        requiresCredentials: false,
        originValidation: "none",
        refererValidation: "none",
      },
      upload: {
        endpoint: "/upload",
        directUploadContentTypePolicy: "permissive",
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowedMimeTypes: ["*/*"],
      },
      idempotency: {
        uploadIdHeader: "X-Upload-Id",
        conversationIdHeader: "X-Conversation-Id",
      },
    };
    expect(contract.authMode).toBe("bearer-token");
    expect(contract.csrf.required).toBe(false);
    expect(contract.csrf.credentials).toBe("omit");
  });
});

// ---------------------------------------------------------------------------
// Type contracts - Multipart interfaces
// ---------------------------------------------------------------------------
describe("MultipartCreateRequest type contract", () => {
  it("creates a valid multipart create request", () => {
    const req: MultipartCreateRequest = {
      fileName: "large-video.mp4",
      mimeType: "video/mp4",
      fileSize: 500 * 1024 * 1024,
      totalChunks: 50,
      uploadId: "up-multi-1",
      conversationId: "conv-001",
    };
    expect(req.fileName).toBe("large-video.mp4");
    expect(req.totalChunks).toBe(50);
    expect(req.fileSize).toBeGreaterThan(0);
  });
});

describe("MultipartSignPartRequest type contract", () => {
  it("creates a valid sign part request", () => {
    const req: MultipartSignPartRequest = {
      uploadId: "up-multi-1",
      partNumber: 3,
    };
    expect(req.partNumber).toBe(3);
    expect(req.uploadId).toBe("up-multi-1");
  });
});

describe("MultipartCompleteRequest type contract", () => {
  it("creates a valid complete request with parts list", () => {
    const req: MultipartCompleteRequest = {
      uploadId: "up-multi-1",
      parts: [{ partNumber: 1 }, { partNumber: 2 }, { partNumber: 3 }],
    };
    expect(req.parts).toHaveLength(3);
    expect(req.parts[0].partNumber).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Type contracts - FileRegisterRequest + BaseUploadHeaders
// ---------------------------------------------------------------------------
describe("FileRegisterRequest type contract", () => {
  it("creates a valid file register request", () => {
    const req: FileRegisterRequest = {
      name: "data.csv",
      type: "text/csv",
      size: 2048,
      storagePath: "/uploads/data.csv",
    };
    expect(req.name).toBe("data.csv");
    expect(req.size).toBe(2048);
  });
});

describe("BaseUploadHeaders type contract", () => {
  it("allows all header fields to be optional", () => {
    const headers: BaseUploadHeaders = {};
    expect(headers["X-Upload-Id"]).toBeUndefined();
  });

  it("accepts all defined header fields", () => {
    const headers: BaseUploadHeaders = {
      "X-Upload-Id": "up-123",
      "X-Conversation-Id": "conv-456",
      "X-CSRF-Token": "token-abc",
      "X-CSRFToken": "token-xyz",
    };
    expect(headers["X-Upload-Id"]).toBe("up-123");
    expect(headers["X-CSRF-Token"]).toBe("token-abc");
  });
});
