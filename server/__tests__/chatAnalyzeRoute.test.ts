import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const chatMock = vi.fn();
const llmStreamChatMock = vi.fn();
const resolveSkillContextMock = vi.fn();
const buildSkillSectionMock = vi.fn();
const normalizeDocumentMock = vi.fn();
const routeIntentMock = vi.fn();

vi.mock("../services/ChatServiceV2", () => ({
  chatService: { chat: chatMock },
  AVAILABLE_MODELS: {},
  DEFAULT_PROVIDER: "xai",
  DEFAULT_MODEL: "grok-3-fast",
}));

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: vi.fn(),
    streamChat: llmStreamChatMock,
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getUserSettings: vi.fn(async () => null),
    createAuditLog: vi.fn(async () => null),
    getChat: vi.fn(async () => null),
    createChat: vi.fn(async () => null),
    createChatMessage: vi.fn(async () => ({ id: "m1" })),
    getFile: vi.fn(async () => null),
  },
}));

vi.mock("../services/conversationMemory", () => ({
  conversationMemoryManager: {
    augmentWithHistory: vi.fn(async (_cid: string, msgs: any[]) => msgs),
  },
}));

vi.mock("../services/usageQuotaService", () => ({
  usageQuotaService: {
    hasTokenQuota: vi.fn(async () => true),
    checkAndIncrementUsage: vi.fn(async () => ({ allowed: true })),
    recordTokenUsage: vi.fn(async () => null),
  },
}));

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: vi.fn(() => "user_test"),
}));

vi.mock("../types/express", async () => {
  const actual = await vi.importActual("../types/express");
  return {
    ...actual,
    getUserId: vi.fn(() => "user_test"),
  };
});

vi.mock("../lib/ensureUserRowExists", () => ({
  ensureUserRowExists: vi.fn(async () => null),
}));

vi.mock("../services/questionClassifier", () => ({
  questionClassifier: {
    classifyQuestion: vi.fn(() => ({ type: "factual_simple", maxTokens: 128 })),
  },
}));

vi.mock("../services/skillContextResolver", () => ({
  drizzleSkillStore: {},
  resolveSkillContextFromRequest: resolveSkillContextMock,
  buildSkillSystemPromptSection: buildSkillSectionMock,
}));

vi.mock("../services/skillPlatform", () => ({
  getSkillPlatformService: vi.fn(() => ({
    executeFromMessage: vi.fn(async () => ({
      status: "skipped",
      continueWithModel: true,
      outputText: "",
      autoCreated: false,
      requiresConfirmation: false,
      traces: [],
      fallbackText: "",
      error: undefined,
      output: undefined,
      policyBreached: undefined,
      selectedSkill: undefined,
    })),
  })),
}));

vi.mock("../services/structuredDocumentNormalizer", () => ({
  normalizeDocument: normalizeDocumentMock,
}));

vi.mock("../services/intentRouter", () => ({
  routeIntent: routeIntentMock,
  ROUTER_VERSION: "test",
}));

async function makeApp() {
  const { createChatAiRouter } = await import("../routes/chatAiRouter");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createChatAiRouter(() => {}));
  return app;
}

describe("chat analyze route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    resolveSkillContextMock.mockResolvedValue(null);
    buildSkillSectionMock.mockReturnValue("");
    routeIntentMock.mockResolvedValue({
      intent: "SUMMARIZE",
      confidence: 0.95,
      output_format: "text",
      slots: {},
      language_detected: "es",
      fallback_used: false,
      clarification_question: null,
    });

    normalizeDocumentMock.mockResolvedValue({
      version: "1.0",
      documentMeta: {
        id: "doc_1",
        fileName: "test.txt",
        fileSize: 12,
        mimeType: "text/plain",
        documentType: "text",
        title: "test.txt",
        wordCount: 2,
      },
      sections: [
        {
          id: "sec_1",
          type: "paragraph",
          content: "Hola mundo",
          sourceRef: "page:1",
        },
      ],
      tables: [],
      metrics: [],
      anomalies: [],
      insights: [],
      sources: [
        {
          id: "src_1",
          type: "page",
          location: "test.txt",
          pageNumber: 1,
          previewText: "Hola mundo",
        },
      ],
      suggestedQuestions: [],
      extractionDiagnostics: {
        extractedAt: "2026-03-21T00:00:00.000Z",
        durationMs: 5,
        parserUsed: "mock",
        mimeTypeDetected: "text/plain",
        bytesProcessed: 12,
        chunksGenerated: 1,
      },
    });

    llmStreamChatMock.mockImplementation(
      () =>
        (async function* () {
          yield { content: "Resumen breve del documento." };
        })(),
    );
  });

  it("returns a JSON analysis response for inline document uploads", async () => {
    const app = await makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const response = await client.post("/api/chat/analyze").send({
        messages: [{ role: "user", content: "dame un resumen" }],
        conversationId: "chat_analyze_test",
        attachments: [
          {
            name: "test.txt",
            mimeType: "text/plain",
            type: "document",
            content: Buffer.from("Hola mundo").toString("base64"),
          },
        ],
      });

      expect(response.status).toBe(200);
      expect(response.type).toMatch(/application\/json/);
      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe("DATA_MODE");
      expect(response.body.answer_text).toContain("Resumen breve");
      expect(llmStreamChatMock).toHaveBeenCalledOnce();
      expect(normalizeDocumentMock).toHaveBeenCalledOnce();
    } finally {
      await close();
    }
  }, 60000);
});
