import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { HttpTestClient, createHttpTestClient } from "./helpers/httpTestClient";

import { createDocumentsRouter } from "../server/routes/documentsRouter";
import { renderDocument, deleteGeneratedDocument } from "../server/services/documentService";
import { generateExcelDocument, generatePptDocument, generateWordDocument } from "../server/services/documentGeneration";
import { listToolDefinitions } from "../server/toolRunner/toolRegistry";
import { ToolRunnerReport } from "../server/toolRunner/types";
import { documentCliToolRunner } from "../server/toolRunner/orchestrator";

vi.mock("../server/toolRunner/orchestrator", () => ({
  documentCliToolRunner: {
    generate: vi.fn(),
  },
}));

const toolRunnerGenerateMock = vi.mocked(documentCliToolRunner.generate);

function createDocumentsApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/documents", createDocumentsRouter());
  return app;
}

function makeBaseReport(documentType: "docx" | "xlsx" | "pptx", requestHash: string, artifactPath: string): ToolRunnerReport {
  return {
    protocolVersion: "tool-runner-cli/1.0",
    locale: "es",
    requestHash,
    documentType,
    toolVersionPin: "1.0.0",
    sandbox: "subprocess",
    usedFallback: false,
    cacheHit: false,
    artifactPath,
    validation: {
      valid: true,
      checks: {
        relationships: true,
        styles: true,
        fonts: true,
        images: true,
        schema: true,
      },
      metadata: {},
      issues: [],
    },
    traces: [],
    incidents: [],
    metrics: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      retries: 0,
    },
  };
}

async function createFixtureArtifact(ext = "bin"): Promise<{ dir: string; path: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tr-router-artifact-"));
  const artifactPath = path.join(dir, `artifact.${ext}`);
  await fs.writeFile(artifactPath, "fixture");
  return { dir, path: artifactPath };
}

async function createValidFixtureArtifact(type: "word" | "excel" | "ppt"): Promise<{ dir: string; path: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tr-router-artifact-"));
  const artifactPath = path.join(dir, `artifact.${type}`);
  let buffer: Buffer;

  if (type === "word") {
    buffer = await generateWordDocument("Reporte", "Contenido válido");
  } else if (type === "excel") {
    buffer = await generateExcelDocument("Reporte", [
      ["Columna A", "Columna B"],
      ["Valor 1", "Valor 2"],
    ]);
  } else {
    buffer = await generatePptDocument("Presentación", [
      {
        title: "Introducción",
        content: ["Punto 1", "Punto 2"],
      },
    ]);
  }

  await fs.writeFile(artifactPath, buffer);
  return { dir, path: artifactPath };
}

describe("documents router tool-runner integration", () => {
  let appClient: HttpTestClient;
  let closeClient: () => Promise<void> = async () => {};
  const tempDirs: string[] = [];
  const createdDocumentIds: string[] = [];

  beforeEach(async () => {
    const app = createDocumentsApp();
    const client = await createHttpTestClient(app);
    appClient = client.client;
    closeClient = client.close;
    process.env.DISABLE_TOOL_RUNNER = "false";
    toolRunnerGenerateMock.mockReset();
  });

  afterEach(async () => {
    await closeClient?.();
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
    for (const docId of createdDocumentIds.splice(0)) {
      deleteGeneratedDocument(docId);
    }
    toolRunnerGenerateMock.mockReset();
  });

  it("returns tool registry capability catalog", async () => {
    const response = await appClient.get("/api/documents/tool-runner/capabilities");

    expect(response.status).toBe(200);
    expect(response.body.protocolVersion).toBe("tool-runner-cli/1.0");
    const toolNames = response.body.tools.map((tool: any) => tool.name).sort();
    expect(toolNames).toEqual(listToolDefinitions().map((tool) => tool.name).sort());
  });

  it("returns a single command definition when command is provided", async () => {
    const response = await appClient.get("/api/documents/tool-runner/capabilities?command=docgen");

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("docgen");
    expect(Array.isArray(response.body.capabilities)).toBe(true);
  });

  it("returns 404 when an unknown tool command is requested", async () => {
    const response = await appClient.get("/api/documents/tool-runner/capabilities?command=does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Tool not found");
  });

  it("returns health snapshots with optional command filter", async () => {
    const healthResponse = await appClient.get("/api/documents/tool-runner/healthcheck");
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe("healthy");
    expect(Array.isArray(healthResponse.body.tools)).toBe(true);

    const commandHealthResponse = await appClient.get("/api/documents/tool-runner/healthcheck?command=xlsxgen");
    expect(commandHealthResponse.status).toBe(200);
    expect(commandHealthResponse.body.tools).toHaveLength(1);
    expect(commandHealthResponse.body.tools[0].name).toBe("xlsxgen");
  });

  it("returns 404 when healthcheck command is unknown", async () => {
    const response = await appClient.get("/api/documents/tool-runner/healthcheck?command=does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Tool not found");
  });

  it("forwards tool-runner output into generate response headers", async () => {
    const { dir, path: artifactPath } = await createFixtureArtifact("docx");
    const validDocx = await generateWordDocument("Informe", "Resumen ejecutivo");
    await fs.writeFile(artifactPath, validDocx);
    tempDirs.push(dir);
    const report = makeBaseReport("docx", "hash-docx-1", artifactPath);
    toolRunnerGenerateMock.mockResolvedValue({
      artifactPath,
      reportPath: path.join(dir, "report.json"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      report,
    });

    const response = await appClient
      .post("/api/documents/generate")
      .send({
        type: "word",
        title: "Informe",
        content: "Resumen ejecutivo",
        locale: "en",
        designTokens: { colors: { primary: "#000" } },
        theme: { id: "theme-a", name: "Theme", tokens: { fonts: { body: "Arial" } } },
        options: { format: "A4" },
        assets: [
          { name: "logo", path: "/tmp/logo.png", mediaType: "image/png", sha256: "hash" },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.headers["x-tool-runner-request-hash"]).toBe(report.requestHash);
    expect(response.headers["x-tool-runner-status"]).toBe("success");
    expect(response.headers["x-tool-runner-command"]).toBe("docx");
    expect(response.headers["x-tool-runner-validation"]).toBe("valid");
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(toolRunnerGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "docx",
        title: "Informe",
        data: { content: "Resumen ejecutivo" },
        locale: "en",
      })
    );
  });

  it("forwards tool-runner output into generate headers for excel", async () => {
    const { dir, path: artifactPath } = await createValidFixtureArtifact("excel");
    tempDirs.push(dir);
    const report = makeBaseReport("xlsx", "hash-xlsx-1", artifactPath);
    toolRunnerGenerateMock.mockResolvedValue({
      artifactPath,
      reportPath: path.join(dir, "report.json"),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      report,
    });

    const response = await appClient
      .post("/api/documents/generate")
      .send({
        type: "excel",
        title: "Libro",
        content: "Col1,Col2\nA,B",
      });

    expect(response.status).toBe(200);
    expect(response.headers["x-tool-runner-request-hash"]).toBe(report.requestHash);
    expect(response.headers["x-tool-runner-status"]).toBe("success");
    expect(response.headers["x-tool-runner-command"]).toBe("xlsx");
    expect(response.headers["x-tool-runner-validation"]).toBe("valid");
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(toolRunnerGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "xlsx",
        title: "Libro",
      })
    );
  });

  it("forwards tool-runner output into generate headers for pptx", async () => {
    const { dir, path: artifactPath } = await createValidFixtureArtifact("ppt");
    tempDirs.push(dir);
    const report = makeBaseReport("pptx", "hash-pptx-1", artifactPath);
    toolRunnerGenerateMock.mockResolvedValue({
      artifactPath,
      reportPath: path.join(dir, "report.json"),
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      report,
    });

    const response = await appClient
      .post("/api/documents/generate")
      .send({
        type: "ppt",
        title: "Presentación",
        content: "Primera diapositiva\\n- Punto 1\\n- Punto 2",
      });

    expect(response.status).toBe(200);
    expect(response.headers["x-tool-runner-request-hash"]).toBe(report.requestHash);
    expect(response.headers["x-tool-runner-status"]).toBe("success");
    expect(response.headers["x-tool-runner-command"]).toBe("pptx");
    expect(response.headers["x-tool-runner-validation"]).toBe("valid");
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    expect(toolRunnerGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "pptx",
        title: "Presentación",
      })
    );
  });

  it("returns fallback header when tool-runner generation fails", async () => {
    toolRunnerGenerateMock.mockRejectedValue(new Error("tool failed"));

    const response = await appClient
      .post("/api/documents/generate")
      .send({
        type: "word",
        title: "Falla controlada",
        content: "Texto",
      });

    expect(response.status).toBe(200);
    expect(response.headers["x-tool-runner-status"]).toBe("fallback-no-report");
    expect(response.headers["x-tool-runner-command"]).toBeUndefined();
    expect(toolRunnerGenerateMock).toHaveBeenCalledTimes(1);
  });

  it("returns fallback header when excel tool-runner generation fails", async () => {
    toolRunnerGenerateMock.mockRejectedValue(new Error("tool failed for xlsx"));

    const response = await appClient
      .post("/api/documents/generate")
      .send({
        type: "excel",
        title: "Libro con error",
        content: "Col1\\nA",
      });

    expect(response.status).toBe(200);
    expect(response.headers["x-tool-runner-status"]).toBe("fallback-no-report");
    expect(response.headers["x-tool-runner-command"]).toBeUndefined();
  });

  it("returns fallback header when pptx tool-runner generation fails", async () => {
    toolRunnerGenerateMock.mockRejectedValue(new Error("tool failed for pptx"));

    const response = await appClient
      .post("/api/documents/generate")
      .send({
        type: "ppt",
        title: "Presentación fallida",
        content: "Diapositiva\\n- Punto 1",
      });

    expect(response.status).toBe(200);
    expect(response.headers["x-tool-runner-status"]).toBe("fallback-no-report");
    expect(response.headers["x-tool-runner-command"]).toBeUndefined();
  });

  it("returns tool runner report from generated doc endpoint", async () => {
    const { dir, path: artifactPath } = await createFixtureArtifact("docx");
    tempDirs.push(dir);
    const report = makeBaseReport("docx", "hash-docx-2", artifactPath);
    toolRunnerGenerateMock.mockResolvedValue({
      artifactPath,
      reportPath: path.join(dir, "report.json"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      report,
    });

    const document = await renderDocument({
      type: "docx",
      templateId: "custom",
      data: {
        title: "Reporte de prueba",
        content: "Contenido del documento",
      },
    });
    createdDocumentIds.push(document.id);

    const response = await appClient.get(`/api/documents/reports/${document.id}`);

    expect(response.status).toBe(200);
    expect(response.body.documentId).toBe(document.id);
    expect(response.body.toolRunnerReport.requestHash).toBe(report.requestHash);
    expect(response.body.toolRunnerReport.documentType).toBe("docx");
  });

  it("returns 404 for missing or expired report data", async () => {
    const prev = process.env.DISABLE_TOOL_RUNNER;
    process.env.DISABLE_TOOL_RUNNER = "true";
    toolRunnerGenerateMock.mockRejectedValue(new Error("tool unavailable"));

    try {
      const document = await renderDocument({
        type: "docx",
        templateId: "custom",
        data: {
          title: "Documento base",
          content: "Sin reporte",
        },
      });
      createdDocumentIds.push(document.id);

      const response = await appClient.get(`/api/documents/reports/${document.id}`);
      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Generation report unavailable for this document");
    } finally {
      process.env.DISABLE_TOOL_RUNNER = prev;
    }
  });
});
