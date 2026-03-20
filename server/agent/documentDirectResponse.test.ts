import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  llmChatMock,
  extractAllAttachmentsContentMock,
  getFileMock,
  getFileByStoragePathMock,
  getFileChunksMock,
} = vi.hoisted(() => ({
  llmChatMock: vi.fn(),
  extractAllAttachmentsContentMock: vi.fn(),
  getFileMock: vi.fn(),
  getFileByStoragePathMock: vi.fn(),
  getFileChunksMock: vi.fn(),
}));

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: llmChatMock,
  },
}));

vi.mock("../services/attachmentService", async () => {
  const actual = await vi.importActual<typeof import("../services/attachmentService")>(
    "../services/attachmentService"
  );

  return {
    ...actual,
    extractAllAttachmentsContent: extractAllAttachmentsContentMock,
  };
});

vi.mock("../storage", () => ({
  storage: {
    getFile: getFileMock,
    getFileByStoragePath: getFileByStoragePathMock,
    getFileChunks: getFileChunksMock,
  },
}));

import {
  buildDocumentAttachmentContext,
  generateDirectAttachmentTranscriptionResponse,
  isAttachmentTranscriptionRequest,
  generateDirectDocumentResponse,
} from "./documentDirectResponse";

describe("generateDirectDocumentResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a direct response for document attachments", async () => {
    extractAllAttachmentsContentMock.mockResolvedValue([
      {
        fileName: "plan_operativo.pptx",
        content: "Objetivo general: aumentar ventas un 20 por ciento. Hitos: marketing, alianzas y seguimiento semanal.",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        documentType: "PowerPoint",
      },
    ]);
    llmChatMock.mockResolvedValue({
      content: "Resumen ejecutivo: el plan prioriza crecimiento comercial, alianzas estratégicas y seguimiento semanal.",
    });

    const response = await generateDirectDocumentResponse({
      userMessage: "Dame un resumen ejecutivo conciso",
      attachments: [
        {
          name: "plan_operativo.pptx",
          storagePath: "/objects/uploads/plan_operativo",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      ],
      userId: "user-1",
    });

    expect(response).toContain("Resumen ejecutivo");
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    expect(llmChatMock.mock.calls[0]?.[0]?.[0]?.content).toContain("=== CONTENIDO DEL DOCUMENTO ===");
    expect(llmChatMock.mock.calls[0]?.[0]?.[0]?.content).toContain("plan_operativo.pptx");
  });

  it("keeps image attachments in the extraction context for OCR", async () => {
    extractAllAttachmentsContentMock.mockResolvedValue([
      {
        fileName: "captura.png",
        content: "Texto extraido por OCR desde la imagen",
        mimeType: "image/png",
        documentType: "Image OCR",
      },
    ]);

    const context = await buildDocumentAttachmentContext([
      {
        name: "captura.png",
        storagePath: "/objects/uploads/captura.png",
        mimeType: "image/png",
      },
    ]);

    expect(extractAllAttachmentsContentMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "captura.png",
        storagePath: "/objects/uploads/captura.png",
        mimeType: "image/png",
      }),
    ]);
    expect(context).toContain("captura.png");
    expect(context).toContain("Texto extraido por OCR");
  });

  it("accepts OpenClaw-style attachments that only provide path", async () => {
    getFileByStoragePathMock.mockResolvedValue(undefined);
    extractAllAttachmentsContentMock.mockResolvedValue([
      {
        fileName: "prompt.csv",
        content: "columna,valor\nobjetivo,analizar documentos",
        mimeType: "text/csv",
        documentType: "CSV",
      },
    ]);

    const context = await buildDocumentAttachmentContext([
      {
        name: "prompt.csv",
        path: "/objects/uploads/prompt.csv",
        mimeType: "text/csv",
      },
    ]);

    expect(getFileByStoragePathMock).toHaveBeenCalledWith("/objects/uploads/prompt.csv");
    expect(extractAllAttachmentsContentMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "prompt.csv",
        storagePath: "/objects/uploads/prompt.csv",
        mimeType: "text/csv",
      }),
    ]);
    expect(context).toContain("prompt.csv");
    expect(context).toContain("objetivo,analizar documentos");
  });

  it("backfills storagePath and normalizes csv mime types from file metadata", async () => {
    getFileMock.mockResolvedValue({
      id: "file-csv",
      name: "prompt.csv",
      type: "application/vnd.ms-excel",
      storagePath: "/objects/uploads/prompt.csv",
      status: "ready",
    });
    extractAllAttachmentsContentMock.mockResolvedValue([
      {
        fileName: "prompt.csv",
        content: "task,priority\nfix,high",
        mimeType: "text/csv",
        documentType: "CSV",
      },
    ]);

    const context = await buildDocumentAttachmentContext([
      {
        fileId: "file-csv",
        name: "prompt.csv",
        mimeType: "application/vnd.ms-excel",
      },
    ]);

    expect(getFileMock).toHaveBeenCalledWith("file-csv");
    expect(extractAllAttachmentsContentMock).toHaveBeenCalledWith([
      expect.objectContaining({
        fileId: "file-csv",
        name: "prompt.csv",
        storagePath: "/objects/uploads/prompt.csv",
        mimeType: "text/csv",
      }),
    ]);
    expect(context).toContain("task,priority");
  });

  it("detects explicit OCR or transcription requests", () => {
    expect(isAttachmentTranscriptionRequest("transcribir")).toBe(true);
    expect(isAttachmentTranscriptionRequest("extrae todo el texto de la imagen")).toBe(true);
    expect(isAttachmentTranscriptionRequest("hazme un resumen")).toBe(false);
  });

  it("returns the extracted text directly for transcription requests without calling the LLM", async () => {
    extractAllAttachmentsContentMock.mockResolvedValue([
      {
        fileName: "captura.png",
        content: "OCR POTENTE\nFactura 12345\nTotal 98.50 Bs",
        mimeType: "image/png",
        documentType: "Image OCR",
      },
    ]);

    const response = await generateDirectAttachmentTranscriptionResponse({
      userMessage: "transcribir",
      attachments: [
        {
          name: "captura.png",
          storagePath: "/objects/uploads/captura.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(response).toContain("OCR POTENTE");
    expect(response).toContain("Factura 12345");
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it("waits for processed OCR text when the attachment is still processing", async () => {
    extractAllAttachmentsContentMock.mockResolvedValue([]);
    getFileMock
      .mockResolvedValueOnce({
        id: "file-1",
        name: "captura.png",
        type: "image/png",
        status: "processing",
      })
      .mockResolvedValue({
        id: "file-1",
        name: "captura.png",
        type: "image/png",
        status: "ready",
      });
    getFileChunksMock.mockResolvedValue([
      {
        fileId: "file-1",
        chunkIndex: 0,
        content: "OCR POTENTE\nFactura 12345\nTotal 98.50 Bs",
      },
    ]);

    const response = await generateDirectAttachmentTranscriptionResponse({
      userMessage: "transcribir",
      attachments: [
        {
          id: "file-1",
          name: "captura.png",
          storagePath: "/objects/uploads/captura.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(getFileMock).toHaveBeenCalledWith("file-1");
    expect(response).toContain("OCR POTENTE");
    expect(response).toContain("Factura 12345");
  });

  it("skips direct document mode when the user explicitly asks for web search", async () => {
    extractAllAttachmentsContentMock.mockResolvedValue([
      {
        fileName: "plan_operativo.pptx",
        content: "Contenido interno del plan operativo.",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        documentType: "PowerPoint",
      },
    ]);

    const response = await generateDirectDocumentResponse({
      userMessage: "Busca en internet noticias sobre este plan operativo",
      attachments: [
        {
          name: "plan_operativo.pptx",
          storagePath: "/objects/uploads/plan_operativo",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
      ],
      userId: "user-1",
    });

    expect(response).toBeNull();
    expect(llmChatMock).not.toHaveBeenCalled();
  });
});
