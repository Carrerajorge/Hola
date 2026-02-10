import { describe, expect, it } from "vitest";

import {
  buildOpenClaw1000CapabilityProfile,
  suggestOpenClaw1000ToolForStep,
} from "../../server/services/openClaw1000CapabilityProfiler";

describe("OpenClaw1000 Capability Profiler", () => {
  it("builds a ranked capability profile for research prompts", () => {
    const profile = buildOpenClaw1000CapabilityProfile(
      "Busca 30 artículos científicos recientes sobre IA generativa y crea un reporte con citas",
      { limit: 20, minScore: 0.1 }
    );

    expect(profile.total).toBeGreaterThanOrEqual(1000);
    expect(profile.eligible).toBeGreaterThan(0);
    expect(profile.matches.length).toBeGreaterThan(0);
    expect(profile.recommendedTools.length).toBeGreaterThan(0);
    expect(profile.categories.length).toBeGreaterThan(0);
    expect(
      profile.categories.some((c) =>
        c.category === "academic_research" ||
        c.category === "web_realtime_search" ||
        c.category === "knowledge_rag_memory"
      )
    ).toBe(true);
  });

  it("keeps only requested statuses when filtering", () => {
    const profile = buildOpenClaw1000CapabilityProfile(
      "Automatiza despliegues de contenedores en kubernetes y monitoreo",
      {
        limit: 50,
        minScore: 0.08,
        includeStatuses: ["implemented"],
      }
    );

    expect(profile.matches.every((m) => m.capability.status === "implemented")).toBe(true);
  });

  it("suggests a concrete tool for an execution step", () => {
    const profile = buildOpenClaw1000CapabilityProfile(
      "Analiza repositorios, corrige bugs y ejecuta pruebas automáticamente",
      { limit: 30, minScore: 0.08 }
    );

    const usedTools = new Set<string>();
    const tool = suggestOpenClaw1000ToolForStep(
      "SEARCH_CODEBASE analizar módulos y ejecutar unit tests",
      profile,
      usedTools
    );

    expect(tool).toBeTruthy();
    expect(typeof tool).toBe("string");
  });
});
