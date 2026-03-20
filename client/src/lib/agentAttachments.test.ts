import { describe, expect, it } from "vitest";

import {
  buildAgentRunAttachments,
  isSendableAgentAttachment,
  normalizeAgentRunAttachments,
} from "./agentAttachments";

describe("isSendableAgentAttachment", () => {
  it("accepts persisted files that are still processing", () => {
    expect(
      isSendableAgentAttachment({
        id: "file_123",
        name: "scan.png",
        type: "image/png",
        size: 1024,
        status: "processing",
        storagePath: "/objects/uploads/scan.png",
      }),
    ).toBe(true);
  });

  it("rejects processing files that are not yet persisted", () => {
    expect(
      isSendableAgentAttachment({
        id: "temp-123",
        name: "scan.png",
        type: "image/png",
        size: 1024,
        status: "processing",
      }),
    ).toBe(false);
  });

  it("rejects uploading files", () => {
    expect(
      isSendableAgentAttachment({
        id: "file_123",
        name: "scan.png",
        type: "image/png",
        size: 1024,
        status: "uploading",
        storagePath: "/objects/uploads/scan.png",
      }),
    ).toBe(false);
  });

  it("accepts attachments that provide fileId and path aliases", () => {
    expect(
      isSendableAgentAttachment({
        fileId: "file_456",
        name: "prompt.csv",
        type: "text/csv",
        size: 256,
        path: "/objects/uploads/prompt.csv",
      }),
    ).toBe(true);
  });
});

describe("buildAgentRunAttachments", () => {
  it("includes ready and persisted processing files in the payload", () => {
    const attachments = buildAgentRunAttachments([
      {
        id: "file_ready",
        name: "invoice.pdf",
        type: "application/pdf",
        size: 2048,
        status: "ready",
        storagePath: "/objects/uploads/invoice.pdf",
      },
      {
        id: "file_processing",
        name: "scan.png",
        type: "image/png",
        size: 1024,
        status: "processing",
        storagePath: "/objects/uploads/scan.png",
      },
      {
        id: "temp-123",
        name: "draft.png",
        type: "image/png",
        size: 1024,
        status: "processing",
      },
    ]);

    expect(attachments).toHaveLength(2);
    expect(attachments.map((item) => item.id)).toEqual([
      "file_ready",
      "file_processing",
    ]);
    expect(attachments[0]).toMatchObject({
      id: "file_ready",
      fileId: "file_ready",
      storagePath: "/objects/uploads/invoice.pdf",
      path: "/objects/uploads/invoice.pdf",
    });
  });
});

describe("normalizeAgentRunAttachments", () => {
  it("normalizes OpenClaw-style attachments that only provide fileId and path", () => {
    const attachments = normalizeAgentRunAttachments([
      {
        fileId: "file_csv",
        name: "prompt.csv",
        mimeType: "text/csv",
        path: "/objects/uploads/prompt.csv",
        size: 12,
      },
    ]);

    expect(attachments).toEqual([
      expect.objectContaining({
        id: "file_csv",
        fileId: "file_csv",
        name: "prompt.csv",
        mimeType: "text/csv",
        storagePath: "/objects/uploads/prompt.csv",
        path: "/objects/uploads/prompt.csv",
      }),
    ]);
  });
});
