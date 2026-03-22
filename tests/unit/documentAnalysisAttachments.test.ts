import { describe, expect, it } from "vitest";

import {
  isDocumentFile,
  resolveAnalyzeAttachmentMimeType,
  toAnalyzePayloadAttachment,
} from "../../client/src/lib/documentAnalysisAttachments";

describe("documentAnalysisAttachments", () => {
  it("preserves a valid MIME type when building the analyze payload", () => {
    const payload = toAnalyzePayloadAttachment({
      id: "file_1",
      name: "report.pdf",
      type: "document",
      mimeType: "application/pdf",
      storagePath: "/objects/uploads/report.pdf",
    });

    expect(payload).toMatchObject({
      id: "file_1",
      fileId: "file_1",
      name: "report.pdf",
      type: "document",
      mimeType: "application/pdf",
      storagePath: "/objects/uploads/report.pdf",
    });
  });

  it("infers a safe MIME type from filename when the attachment MIME is blank", () => {
    const payload = toAnalyzePayloadAttachment({
      id: "file_2",
      name: "meeting-notes.docx",
      type: "document",
      mimeType: "",
      storagePath: "/objects/uploads/meeting-notes.docx",
    });

    expect(payload.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("never falls back to the literal attachment type as a MIME type", () => {
    expect(
      resolveAnalyzeAttachmentMimeType({
        name: "financials.xlsx",
        type: "document",
        mimeType: "",
      }),
    ).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("detects documents without misclassifying images", () => {
    expect(
      isDocumentFile(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "proposal.docx",
        "document",
      ),
    ).toBe(true);

    expect(isDocumentFile("image/png", "diagram.png", "image")).toBe(false);
  });
});
