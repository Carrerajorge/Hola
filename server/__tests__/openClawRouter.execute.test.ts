import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const runEmbeddedPiAgentMock = vi.fn();

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: () => "user_test",
  isAuthenticated: () => true,
}));

vi.mock("../services/userScopedAgentDir.js", () => ({
  resolveUserScopedAgentDir: () => "/tmp/iliagpt-openclaw-router-test-agent",
}));

vi.mock("../services/superIntelligence/agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: (...args: unknown[]) => runEmbeddedPiAgentMock(...args),
}));

vi.mock("../middleware/rateLimiter", () => ({
  globalLimiter: (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
}));

async function createTestApp() {
  const { default: openClawRouter } = await import("../routes/openClawRouter");
  const app = express();
  app.use(express.json());
  app.use("/api/openclaw", openClawRouter);
  return app;
}

describe("openClawRouter native execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "resultado nativo" }, { text: "segunda parte" }],
      meta: {
        durationMs: 42,
        stopReason: "completed",
        agentMeta: {
          provider: "google",
          model: "gemini-3.1-pro-preview",
        },
      },
    });
  });

  it("POST /api/openclaw/execute uses the native embedded runtime", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.post("/api/openclaw/execute").send({
        prompt: "Analiza este repo de forma nativa",
        context: { repo: "Hola" },
        enableTools: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.engine).toContain("native embedded runtime");
      expect(res.body.data.response).toContain("resultado nativo");
      expect(res.body.data.response).not.toContain("Simulated RAG output");
      expect(res.body.data.nativeToolsEnabled).toBe(true);
      expect(runEmbeddedPiAgentMock).toHaveBeenCalledTimes(1);
      expect(runEmbeddedPiAgentMock.mock.calls[0][0]).toMatchObject({
        disableTools: false,
        messageChannel: "api",
        messageProvider: "iliagpt-openclaw-native",
      });
    } finally {
      await close();
    }
  }, 30_000);

  it("returns 400 for invalid execute payloads", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.post("/api/openclaw/execute").send({
        prompt: "   ",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Invalid request");
      expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  }, 30_000);
});
