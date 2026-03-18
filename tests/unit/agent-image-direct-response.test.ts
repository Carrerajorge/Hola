import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildDocumentAttachmentContextMock,
  generateDirectAttachmentTranscriptionResponseMock,
  generateDirectDocumentResponseMock,
} = vi.hoisted(() => ({
  buildDocumentAttachmentContextMock: vi.fn(),
  generateDirectAttachmentTranscriptionResponseMock: vi.fn(),
  generateDirectDocumentResponseMock: vi.fn(),
}));

vi.mock("../../server/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: async () => ({}),
      }),
    }),
  },
}));

const chatMock = vi.fn();
vi.mock("../../server/lib/llmGateway", () => ({
  llmGateway: {
    chat: (...args: any[]) => chatMock(...args),
  },
}));

const getObjectEntityBufferMock = vi.fn();
vi.mock("../../server/replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityBuffer(...args: any[]) {
      return getObjectEntityBufferMock(...args);
    }
  },
}));

vi.mock("../../server/agent/documentDirectResponse", async () => {
  const actual = await vi.importActual<typeof import("../../server/agent/documentDirectResponse")>(
    "../../server/agent/documentDirectResponse"
  );

  return {
    ...actual,
    buildDocumentAttachmentContext: buildDocumentAttachmentContextMock,
    generateDirectAttachmentTranscriptionResponse: generateDirectAttachmentTranscriptionResponseMock,
    generateDirectDocumentResponse: generateDirectDocumentResponseMock,
  };
});

import { AgentOrchestrator } from "../../server/agent/agentOrchestrator";

describe("AgentOrchestrator image direct response", () => {
  beforeEach(() => {
    chatMock.mockReset();
    getObjectEntityBufferMock.mockReset();
    buildDocumentAttachmentContextMock.mockReset();
    generateDirectAttachmentTranscriptionResponseMock.mockReset();
    generateDirectDocumentResponseMock.mockReset();
    buildDocumentAttachmentContextMock.mockResolvedValue("");
    generateDirectAttachmentTranscriptionResponseMock.mockResolvedValue(null);
    generateDirectDocumentResponseMock.mockResolvedValue(null);
    delete process.env.AGENT_IMAGE_OCR_SUPPORT_TIMEOUT_MS;
  });

  it("responds directly with vision when the user attaches an image exercise", async () => {
    chatMock.mockResolvedValue({ content: "La distancia correcta es 1 m." });
    getObjectEntityBufferMock.mockResolvedValue(Buffer.from("fake-image-binary"));

    const orchestrator = new AgentOrchestrator("run-image", "chat-image", "user-image", "pro");

    const plan = await orchestrator.generatePlan("Resuelve este ejercicio", [
      {
        name: "ejercicio.png",
        type: "image",
        mimeType: "image/png",
        storagePath: "exercise-image",
      },
    ]);

    expect(plan.steps).toHaveLength(0);
    expect(plan.conversationalResponse).toBe("La distancia correcta es 1 m.");
    expect(chatMock).toHaveBeenCalledTimes(1);

    const messages = chatMock.mock.calls[0][0];
    const userMessage = messages[1];
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content.some((part: any) => part.type === "image_url")).toBe(true);
  });

  it("does not block direct image responses when OCR support stalls", async () => {
    process.env.AGENT_IMAGE_OCR_SUPPORT_TIMEOUT_MS = "10";
    chatMock.mockResolvedValue({ content: "Respuesta con vision sin esperar OCR." });
    getObjectEntityBufferMock.mockResolvedValue(Buffer.from("fake-image-binary"));
    buildDocumentAttachmentContextMock.mockImplementation(
      () => new Promise<string>(() => undefined),
    );

    const orchestrator = new AgentOrchestrator("run-image-timeout", "chat-image", "user-image", "pro");

    const plan = await orchestrator.generatePlan("Resuelve este ejercicio", [
      {
        name: "ejercicio.png",
        type: "image",
        mimeType: "image/png",
        storagePath: "exercise-image",
      },
    ]);

    expect(plan.steps).toHaveLength(0);
    expect(plan.conversationalResponse).toBe("Respuesta con vision sin esperar OCR.");
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});
