// server/agent/orchestrator/__tests__/demo.test.ts
// ---------------------------------------------------------------------------
// DEMO: SuperPlanner solving a complex real-world task autonomously
//
// This test demonstrates the full orchestrator pipeline:
// 1. Receives a complex NL task
// 2. Decomposes into subtasks with dependencies
// 3. Schedules parallel waves
// 4. Executes with tool routing + synthesize
// 5. Handles errors with retry
// 6. Delivers a complete final result
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { orchestrate } from "../executor";
import { buildWaves } from "../scheduler";
import { decompose } from "../planner";
import type { SubTask } from "../types";

// ── Mock Gemini with realistic multi-step decomposition ──

const COMPLEX_PLAN = {
  subtasks: [
    {
      id: "research_ts",
      description: "Search for the most popular TypeScript AI/ML frameworks in 2025",
      toolHint: "web_search",
      args: { query: "best TypeScript AI ML frameworks 2025 comparison" },
      dependencies: [],
      priority: "high",
      estimatedComplexity: "simple",
      alternateStrategy: "Try searching for 'TypeScript machine learning libraries 2025'",
    },
    {
      id: "research_py",
      description: "Search for the most popular Python AI/ML frameworks in 2025",
      toolHint: "web_search",
      args: { query: "best Python AI ML frameworks 2025 comparison" },
      dependencies: [],
      priority: "high",
      estimatedComplexity: "simple",
      alternateStrategy: "Try searching for 'Python deep learning frameworks ranking 2025'",
    },
    {
      id: "research_rust",
      description: "Search for emerging Rust AI/ML frameworks in 2025",
      toolHint: "web_search",
      args: { query: "Rust AI ML frameworks 2025 emerging" },
      dependencies: [],
      priority: "normal",
      estimatedComplexity: "simple",
    },
    {
      id: "analyze_data",
      description: "Analyze and compare the research data: popularity, maturity, performance, community size",
      toolHint: "synthesize",
      args: {
        instructions:
          "Create a structured comparison analyzing: (1) framework popularity by stars/downloads, " +
          "(2) maturity level, (3) performance benchmarks if available, (4) community size, " +
          "(5) enterprise adoption. Organize as a data table.",
      },
      dependencies: ["research_ts", "research_py", "research_rust"],
      priority: "critical",
      estimatedComplexity: "complex",
    },
    {
      id: "generate_insights",
      description: "Generate strategic insights and recommendations based on the analysis",
      toolHint: "synthesize",
      args: {
        instructions:
          "Based on the analysis, provide: (1) Key trends shaping AI framework landscape, " +
          "(2) Best framework per use case (web ML, training, inference, edge), " +
          "(3) Prediction for which frameworks will dominate in 2026, " +
          "(4) Actionable recommendations for a team choosing a framework today.",
      },
      dependencies: ["analyze_data"],
      priority: "critical",
      estimatedComplexity: "complex",
    },
    {
      id: "final_report",
      description: "Assemble the complete report combining all research, analysis, and insights",
      toolHint: "synthesize",
      args: {
        instructions:
          "Create a comprehensive, well-structured report titled 'AI Framework Landscape 2025'. " +
          "Include: Executive Summary, Methodology, Framework Comparison (table), " +
          "Trend Analysis, Use-Case Recommendations, and Conclusion. " +
          "Use all available data from previous steps.",
      },
      dependencies: ["analyze_data", "generate_insights"],
      priority: "critical",
      estimatedComplexity: "complex",
    },
  ],
  reasoning:
    "Three parallel research tracks (TS, Python, Rust) → data analysis → " +
    "strategic insights → final assembled report. Maximizes parallelism in wave 1.",
};

vi.mock("../../../lib/gemini", () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: vi.fn().mockImplementation(async ({ contents, config }: any) => {
        const text = contents[0]?.parts?.[0]?.text || "";

        // If this is a decomposition call (has responseMimeType)
        if (config?.responseMimeType === "application/json") {
          return { text: JSON.stringify(COMPLEX_PLAN) };
        }

        // Otherwise it's a synthesize call — return realistic content
        if (text.includes("structured comparison")) {
          return {
            text: `## AI Framework Comparison 2025

| Framework | Language | GitHub Stars | Maturity | Performance |
|-----------|----------|-------------|----------|-------------|
| PyTorch | Python | 82k | Mature | Excellent |
| TensorFlow | Python | 186k | Mature | Excellent |
| JAX | Python | 30k | Growing | Superior |
| Transformers.js | TypeScript | 11k | Growing | Good |
| ONNX Runtime | Multi | 14k | Mature | Excellent |
| Burn | Rust | 8k | Early | Promising |

Key finding: Python dominates but TypeScript is the fastest-growing ecosystem for inference.`,
          };
        }

        if (text.includes("strategic insights")) {
          return {
            text: `## Strategic Insights

### Key Trends
1. **Edge inference explosion**: Models running directly in browsers/devices
2. **Rust adoption for performance-critical training**: 3x growth in Rust ML projects
3. **TypeScript becoming the inference language**: Transformers.js adoption up 400%

### Recommendations
- **Web ML/Inference**: Use Transformers.js (TypeScript) for browser-based inference
- **Training**: PyTorch 2.x remains the gold standard for research
- **Production deployment**: ONNX Runtime for cross-platform inference
- **Cutting-edge research**: JAX for its functional approach and XLA compilation

### 2026 Predictions
- PyTorch retains research dominance but JAX captures 25% of new projects
- TypeScript AI tooling doubles in adoption for web-first companies
- Rust ML enters production use at major cloud providers`,
          };
        }

        if (text.includes("comprehensive") || text.includes("Executive Summary")) {
          return {
            text: `# AI Framework Landscape 2025 — Comprehensive Report

## Executive Summary
The AI framework ecosystem in 2025 is characterized by three major shifts: Python's continued dominance in training, TypeScript's explosive growth for inference, and Rust's emergence for performance-critical workloads. This report analyzes 6 major frameworks across 5 dimensions.

## Methodology
We conducted web research across TypeScript, Python, and Rust ecosystems, analyzing GitHub metrics, community surveys, and enterprise adoption data.

## Framework Comparison
[Includes the full comparison table from analysis phase]

## Trend Analysis
[Includes strategic insights and emerging patterns]

## Use-Case Recommendations
- Web ML → Transformers.js
- Research Training → PyTorch 2.x
- Production Inference → ONNX Runtime
- Performance-Critical → Burn (Rust)

## Conclusion
Teams should adopt a polyglot approach: Python for training, TypeScript for web inference, and watch Rust for future performance needs. The framework landscape is fragmenting by use case, not consolidating.

---
*Report generated autonomously by SuperPlanner*`,
          };
        }

        // Default synthesize response
        return { text: `[Synthesized] ${text.slice(0, 200)}` };
      }),
    },
  })),
  GEMINI_MODELS: { FLASH: "gemini-2.5-flash" },
}));

// Mock agentTools
vi.mock("../../../config/agentTools", () => ({
  AGENT_TOOLS: [{ name: "web_search" }, { name: "fetch_url" }, { name: "analyze_data" }],
}));

// Mock toolRegistry
vi.mock("../../registry/toolRegistry", () => ({
  toolRegistry: {
    getAll: () => new Map(),
    execute: vi.fn().mockResolvedValue({
      success: false,
      error: { code: "NOT_FOUND_ERROR" },
    }),
  },
}));

// Mock webSearch with realistic results
vi.mock("../../../services/webSearch", () => ({
  searchWeb: vi.fn().mockImplementation(async (query: string) => {
    if (query.includes("TypeScript")) {
      return {
        results: [
          { title: "Top TypeScript AI Frameworks 2025", url: "https://dev.to/ts-ai-2025", snippet: "Transformers.js leads TypeScript AI with 11k GitHub stars, followed by TensorFlow.js..." },
          { title: "TypeScript ML Ecosystem Guide", url: "https://blog.ml/ts", snippet: "The TypeScript ML ecosystem has grown 400% since 2023..." },
        ],
      };
    }
    if (query.includes("Python")) {
      return {
        results: [
          { title: "Python AI Frameworks Comparison 2025", url: "https://ai.dev/python", snippet: "PyTorch (82k stars) and TensorFlow (186k stars) continue to dominate..." },
          { title: "JAX: The Rising Star", url: "https://jax.dev", snippet: "JAX's functional approach and XLA compilation make it the fastest-growing..." },
        ],
      };
    }
    if (query.includes("Rust")) {
      return {
        results: [
          { title: "Rust ML Frameworks 2025", url: "https://rust-ml.dev", snippet: "Burn framework leads with 8k stars, offering PyTorch-like API with Rust performance..." },
          { title: "Candle: Hugging Face's Rust ML", url: "https://hf.co/candle", snippet: "Candle enables running LLMs at native speed..." },
        ],
      };
    }
    return { results: [{ title: "General result", url: "https://ex.com", snippet: "Generic info" }] };
  }),
  fetchUrl: vi.fn().mockResolvedValue({ text: "Page content" }),
}));

// Mock selfExpand
vi.mock("../../selfExpand/capabilityExpander", () => ({
  expandAndExecute: vi.fn().mockResolvedValue(null),
}));

// Mock fs
vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
}));

describe("DEMO: SuperPlanner solving a complex task autonomously", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decomposes 'Compare AI frameworks across 3 languages' into a parallel DAG", async () => {
    const plan = await decompose(
      "Investiga los frameworks de IA más populares de TypeScript, Python y Rust en 2025, " +
      "analiza sus fortalezas y debilidades, y genera un reporte comparativo completo",
    );

    expect(plan.subtasks.length).toBe(6);

    // Wave 1: 3 parallel research tasks (no dependencies)
    const wave1 = plan.subtasks.filter((st) => st.dependencies.length === 0);
    expect(wave1.length).toBe(3);
    expect(wave1.every((st) => st.toolHint === "web_search")).toBe(true);

    // Analysis depends on all 3 research tasks
    const analysis = plan.subtasks.find((st) => st.id === "analyze_data");
    expect(analysis?.dependencies).toEqual(["research_ts", "research_py", "research_rust"]);

    // Insights depend on analysis
    const insights = plan.subtasks.find((st) => st.id === "generate_insights");
    expect(insights?.dependencies).toEqual(["analyze_data"]);

    // Final report depends on analysis + insights
    const report = plan.subtasks.find((st) => st.id === "final_report");
    expect(report?.dependencies).toEqual(["analyze_data", "generate_insights"]);
  });

  it("schedules the DAG into optimal parallel waves", () => {
    const subtasks: SubTask[] = COMPLEX_PLAN.subtasks.map((st) => ({
      ...st,
      status: "pending" as const,
      retryCount: 0,
      maxRetries: 2,
    }));

    const waves = buildWaves(subtasks);

    // Expected: 4 waves
    // Wave 0: [research_ts, research_py, research_rust]  (3 parallel)
    // Wave 1: [analyze_data]                              (needs all 3 research)
    // Wave 2: [generate_insights]                         (needs analysis)
    // Wave 3: [final_report]                              (needs analysis + insights)
    expect(waves.length).toBe(4);
    expect(waves[0]).toEqual(["research_ts", "research_py", "research_rust"]);
    expect(waves[1]).toEqual(["analyze_data"]);
    expect(waves[2]).toEqual(["generate_insights"]);
    expect(waves[3]).toEqual(["final_report"]);
  });

  it("executes the full pipeline and produces a comprehensive report", async () => {
    const sseEvents: Array<{ event: string; data: any }> = [];
    const mockRes = {
      write: vi.fn((chunk: string) => {
        const lines = chunk.split("\n");
        const event = lines[0]?.replace("event: ", "");
        const data = lines[1]?.replace("data: ", "");
        if (event && data) {
          try {
            sseEvents.push({ event, data: JSON.parse(data) });
          } catch {}
        }
      }),
    };

    const result = await orchestrate(
      "Investiga los frameworks de IA más populares de TypeScript, Python y Rust en 2025, " +
      "analiza sus fortalezas y debilidades, y genera un reporte comparativo completo " +
      "con tabla de comparación, análisis de tendencias y recomendaciones por caso de uso",
      { runId: "demo-run-1", sseRes: mockRes },
    );

    // ── Verify execution stats ──
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  SUPERPLANNER DEMO RESULTS");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`  Status:        ${result.status}`);
    console.log(`  Total subtasks: ${result.stats.totalSubtasks}`);
    console.log(`  Completed:     ${result.stats.completed}`);
    console.log(`  Failed:        ${result.stats.failed}`);
    console.log(`  Skipped:       ${result.stats.skipped}`);
    console.log(`  Duration:      ${result.stats.totalDurationMs}ms`);
    console.log(`  Replans:       ${result.stats.replanned}`);
    console.log("═══════════════════════════════════════════════════════");

    // Print timeline
    console.log("\n  EXECUTION TIMELINE:");
    for (const event of result.timeline) {
      const relTime = event.ts - result.timeline[0].ts;
      console.log(`  +${String(relTime).padStart(5)}ms  ${event.event}: ${event.detail.slice(0, 80)}`);
    }
    console.log("═══════════════════════════════════════════════════════\n");

    expect(result.status).toBe("completed");
    expect(result.stats.totalSubtasks).toBe(6);
    expect(result.stats.completed).toBe(6);
    expect(result.stats.failed).toBe(0);

    // ── Verify the final output is a complete report ──
    const finalReport = result.finalOutput as string;
    expect(finalReport).toContain("AI Framework Landscape 2025");
    expect(finalReport).toContain("Executive Summary");
    expect(finalReport).toContain("Methodology");
    expect(finalReport).toContain("Conclusion");
    expect(finalReport).toContain("SuperPlanner");

    // ── Verify intermediate results are in memory ──
    // Research results
    expect(result.results["research_ts"]).toBeTruthy();
    expect(result.results["research_py"]).toBeTruthy();
    expect(result.results["research_rust"]).toBeTruthy();

    // Analysis contains comparison table
    const analysis = result.results["analyze_data"] as string;
    expect(analysis).toContain("PyTorch");
    expect(analysis).toContain("Transformers.js");
    expect(analysis).toContain("Burn");

    // Insights contain strategic recommendations
    const insights = result.results["generate_insights"] as string;
    expect(insights).toContain("Recommendations");
    expect(insights).toContain("2026 Predictions");

    // ── Verify SSE events were streamed ──
    const eventTypes = sseEvents.map((e) => e.event);
    expect(eventTypes).toContain("orchestration_start");
    expect(eventTypes).toContain("plan_created");
    expect(eventTypes).toContain("wave_start");
    expect(eventTypes).toContain("subtask_start");
    expect(eventTypes).toContain("subtask_result");
    expect(eventTypes).toContain("orchestration_done");

    // Verify wave structure in SSE
    const planEvent = sseEvents.find((e) => e.event === "plan_created");
    expect(planEvent?.data.subtaskCount).toBe(6);
    expect(planEvent?.data.waveCount).toBe(4);

    // First wave should be parallel (3 research tasks)
    const waveStarts = sseEvents.filter((e) => e.event === "wave_start");
    expect(waveStarts[0]?.data.parallel).toBe(true);
    expect(waveStarts[0]?.data.subtaskIds.length).toBe(3);

    // Print final report preview
    console.log("  FINAL REPORT (first 500 chars):");
    console.log("  " + finalReport.slice(0, 500).replace(/\n/g, "\n  "));
    console.log("\n═══════════════════════════════════════════════════════\n");
  });

  it("handles error recovery when one research track fails", async () => {
    // Override searchWeb to fail for Rust queries — the orchestrator's
    // graceful degradation chain (builtin → registry → selfExpand → synthesize)
    // should still produce a completed result via LLM fallback.
    const { searchWeb } = await import("../../../services/webSearch");
    (searchWeb as any).mockImplementation(async (query: string) => {
      if (query.includes("Rust")) {
        throw new Error("Rate limit exceeded — service unavailable");
      }
      return {
        results: [{ title: query, url: "https://ex.com", snippet: `Info about ${query}` }],
      };
    });

    const result = await orchestrate(
      "Compare AI frameworks across TypeScript, Python, and Rust",
      { runId: "demo-retry-1", maxRetries: 2 },
    );

    // Should still complete — the Rust research subtask falls through
    // to synthesize (LLM) when web_search fails, demonstrating graceful degradation
    expect(result.status).toBe("completed");
    expect(result.stats.completed).toBe(6);
    expect(result.stats.failed).toBe(0);

    // The research_rust task completed via synthesize fallback
    const rustResult = result.results["research_rust"];
    expect(rustResult).toBeTruthy();

    // All 6 tasks complete despite web_search failure
    const completedEvents = result.timeline.filter(
      (t) => t.event === "subtask_completed",
    );
    expect(completedEvents.length).toBe(6);
  });
});
