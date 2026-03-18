import { beforeEach, describe, expect, it, vi } from "vitest";

const { llmChatMock, extractAllAttachmentsContentMock } = vi.hoisted(() => ({
  llmChatMock: vi.fn(),
  extractAllAttachmentsContentMock: vi.fn(),
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

import { generateDirectDocumentResponse } from "./documentDirectResponse";

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
