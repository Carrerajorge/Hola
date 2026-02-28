import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const executeLocalControlRequestMock = vi.fn();
const toolGetMock = vi.fn();
const toolExecuteMock = vi.fn();

vi.mock("../routes/chatAiRouter", () => ({
  executeLocalControlRequest: executeLocalControlRequestMock,
}));

vi.mock("../agent/toolRegistry", () => ({
  toolRegistry: {
    get: toolGetMock,
    execute: toolExecuteMock,
  },
}));

async function createTestApp() {
  const { createLocalControlRouter } = await import("../routes/localControlRouter");
  const app = express();
  app.use(express.json());
  app.use("/api", createLocalControlRouter());
  return app;
}

describe("localControlRouter OpenClaw fallback", () => {
  beforeEach(() => {
    executeLocalControlRequestMock.mockReset();
    toolGetMock.mockReset();
    toolExecuteMock.mockReset();

    executeLocalControlRequestMock.mockResolvedValue({ handled: false });
    toolGetMock.mockReturnValue({ name: "openclaw_clawi_status" });
    toolExecuteMock.mockResolvedValue({
      success: true,
      output: { ok: true, source: "test" },
      artifacts: [],
      previews: [],
    });
  });

  it("executes openclaw_clawi_status from natural prompt input", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/local/exec")
        .send({ prompt: "No expliques. Ejecuta SOLO la herramienta openclaw_clawi_status y responde JSON." });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.tool).toBe("openclaw_clawi_status");
      expect(toolExecuteMock).toHaveBeenCalledTimes(1);
      expect(toolExecuteMock.mock.calls[0][0]).toBe("openclaw_clawi_status");
    } finally {
      await close();
    }
  });

  it("executes openclaw tool from structured command input", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/local/exec")
        .send({ command: "openclaw_clawi_status", args: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.tool).toBe("openclaw_clawi_status");
    } finally {
      await close();
    }
  });

  it("executes openclaw tool from long strict audit prompt", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const prompt =
        "Modo auditoria estricto. Si no puedes usar herramientas openclaw_* de verdad, responde exactamente FAIL_NO_OPENCLAW_TOOLS y termina. Tarea obligatoria: ejecuta openclaw_clawi_status y responde JSON.";

      const res = await client
        .post("/api/local/exec")
        .send({ prompt });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.tool).toBe("openclaw_clawi_status");
      expect(toolExecuteMock).toHaveBeenCalledTimes(1);
      expect(toolExecuteMock.mock.calls[0][0]).toBe("openclaw_clawi_status");
    } finally {
      await close();
    }
  });

  it("normalizes common tool typo openclaw_clavi_status -> openclaw_clawi_status", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/local/exec")
        .send({ prompt: "No expliques. Ejecuta SOLO openclaw_clavi_status y responde JSON." });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.tool).toBe("openclaw_clawi_status");
      expect(toolExecuteMock).toHaveBeenCalledTimes(1);
      expect(toolExecuteMock.mock.calls[0][0]).toBe("openclaw_clawi_status");
    } finally {
      await close();
    }
  });

  it("executes openclaw tool from strict audit prompt without explicit run verb", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const prompt =
        "Modo auditoria estricto. Tarea obligatoria: herramienta openclaw_clawi_status. Responde exactamente FAIL_NO_OPENCLAW_TOOLS si falla.";

      const res = await client
        .post("/api/local/exec")
        .send({ prompt });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.tool).toBe("openclaw_clawi_status");
      expect(toolExecuteMock).toHaveBeenCalledTimes(1);
      expect(toolExecuteMock.mock.calls[0][0]).toBe("openclaw_clawi_status");
    } finally {
      await close();
    }
  });

  it("does not create folder from long multi-step audit prompt", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const prompt =
        "Quiero una PRUEBA E2E. 1) Ejecuta openclaw_clawi_status 2) Crea la carpeta artifacts/fusion_test_e2e 3) Genera REPORT.md con score y justificacion breve.";

      const res = await client
        .post("/api/local/create-folder")
        .send({ prompt });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(String(res.body.error || "")).toContain("Folder name is required");
    } finally {
      await close();
    }
  });

  it("returns not found when openclaw tool is referenced but not registered", async () => {
    toolGetMock.mockReturnValue(undefined);

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/local/exec")
        .send({ prompt: "ejecuta openclaw_clawi_status" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe("TOOL_NOT_FOUND");
    } finally {
      await close();
    }
  });

  it("keeps previous error behavior for non-local non-openclaw prompts", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/local/exec").send({ prompt: "hola mundo" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(String(res.body.error || "")).toContain("No se detecto un comando local valido");
    } finally {
      await close();
    }
  });
});
