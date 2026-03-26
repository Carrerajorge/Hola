import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const { startProductionPipelineMock } = vi.hoisted(() => ({
  startProductionPipelineMock: vi.fn(),
}));

vi.mock("../../agent/production", async () => {
  const actual = await vi.importActual<any>("../../agent/production");
  return {
    ...actual,
    startProductionPipeline: startProductionPipelineMock,
  };
});

vi.mock("../academicArticlesExport", () => ({
  exportAcademicArticlesFromPrompt: vi.fn(),
}));

import { handleProductionRequest, isProductionIntent } from "../productionHandler";

function createMockSseResponse(): Response & { __chunks: string[] } {
  const chunks: string[] = [];
  const res: any = {
    headersSent: false,
    locals: {},
    socket: { write: vi.fn() },
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    flush: vi.fn(),
    write: vi.fn((chunk: string) => {
      chunks.push(String(chunk));
      return true;
    }),
    end: vi.fn(),
  };
  res.__chunks = chunks;
  return res as Response & { __chunks: string[] };
}

describe("productionHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns production_error when pipeline finishes without artifacts", async () => {
    startProductionPipelineMock.mockResolvedValue({
      workOrderId: "wo_1",
      status: "failed",
      artifacts: [],
      summary: "## Producción Completada\n\n**Entregables:** Ninguno",
      evidencePack: { sources: [], notes: [], dataPoints: [], gaps: [], limitations: [] },
      traceMap: { links: [], inconsistencies: [], coverageScore: 0 },
      qaReport: { overallScore: 0, passed: false, checks: [], suggestions: [], blockers: [] },
      timing: {
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 100,
        stageTimings: {} as any,
      },
      costs: { llmCalls: 0, searchQueries: 0, tokensUsed: 0 },
    });

    const res = createMockSseResponse();

    const result = await handleProductionRequest(
      {
        message: "crea una ppt de gestion administrativa",
        userId: "user_test",
        chatId: "chat_test",
        intentResult: {
          intent: "CREATE_PRESENTATION",
          output_format: "pptx",
          slots: { topic: "gestion administrativa" },
          confidence: 0.99,
          normalized_text: "crea una ppt de gestion administrativa",
        } as any,
      },
      res,
    );

    const output = res.__chunks.join("");
    expect(result.handled).toBe(true);
    expect(result.error).toBeTruthy();
    expect(output).toContain("event: production_error");
    expect(output).not.toContain("event: production_complete");
    expect(output).toContain("No se pudieron generar archivos en esta corrida");
  });

  it("does not force production mode for simple inline table prompt", () => {
    const result = isProductionIntent(
      {
        intent: "CREATE_SPREADSHEET",
        confidence: 0.9,
      } as any,
      "haz una tabla de 4 columnas y 4 filas con frutas y precios",
    );

    expect(result).toBe(false);
  });

  it("keeps production mode for explicit spreadsheet artifact requests", () => {
    const result = isProductionIntent(
      {
        intent: "CREATE_SPREADSHEET",
        confidence: 0.9,
      } as any,
      "crea un archivo excel con 4 columnas y 4 filas con frutas y precios",
    );

    expect(result).toBe(true);
  });

  it("does not force production mode for generic document wording", () => {
    const result = isProductionIntent(
      {
        intent: "CREATE_DOCUMENT",
        confidence: 0.9,
      } as any,
      "crea un documento sobre energía solar",
    );

    expect(result).toBe(false);
  });

  it("does not force production mode for format-only academic style requests", () => {
    const result = isProductionIntent(
      {
        intent: "CREATE_DOCUMENT",
        confidence: 0.9,
      } as any,
      "hazme un resumen en formato APA",
    );

    expect(result).toBe(false);
  });

  it("does not force production mode for transcription-style prompts", () => {
    const result = isProductionIntent(
      {
        intent: "CREATE_PRESENTATION",
        confidence: 0.9,
      } as any,
      "puedes transcribir",
    );

    expect(result).toBe(false);
  });

  it("keeps production mode for explicit presentation artifact requests", () => {
    const result = isProductionIntent(
      {
        intent: "CREATE_PRESENTATION",
        confidence: 0.9,
      } as any,
      "crea un powerpoint con el resumen ejecutivo",
    );

    expect(result).toBe(true);
  });
});
