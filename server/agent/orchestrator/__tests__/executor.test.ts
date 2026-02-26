// server/agent/orchestrator/__tests__/executor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { orchestrate } from "../executor";

// Mock Gemini for planner (returns a structured plan)
vi.mock("../../../lib/gemini", () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          subtasks: [
            {
              id: "step_1",
              description: "Search for TypeScript frameworks",
              toolHint: "web_search",
              args: { query: "TypeScript frameworks 2025" },
              dependencies: [],
              priority: "high",
              estimatedComplexity: "simple",
            },
            {
              id: "step_2",
              description: "Search for Python frameworks",
              toolHint: "web_search",
              args: { query: "Python frameworks 2025" },
              dependencies: [],
              priority: "high",
              estimatedComplexity: "simple",
            },
            {
              id: "step_3",
              description: "Compare and synthesize the findings into a report",
              toolHint: "synthesize",
              args: {},
              dependencies: ["step_1", "step_2"],
              priority: "critical",
              estimatedComplexity: "medium",
            },
          ],
          reasoning:
            "Parallel web searches for both ecosystems, then synthesize comparison",
        }),
      }),
    },
  })),
  GEMINI_MODELS: { FLASH: "gemini-2.5-flash" },
}));

// Mock agentTools
vi.mock("../../../config/agentTools", () => ({
  AGENT_TOOLS: [{ name: "web_search" }, { name: "fetch_url" }, { name: "synthesize" }],
}));

// Mock toolRegistry
vi.mock("../../registry/toolRegistry", () => ({
  toolRegistry: {
    getAll: () => new Map(),
    execute: vi.fn().mockResolvedValue({ success: false, error: { code: "NOT_FOUND_ERROR" } }),
  },
}));

// Mock webSearch for built-in tool execution
vi.mock("../../../services/webSearch", () => ({
  searchWeb: vi.fn().mockImplementation(async (query: string) => ({
    results: [
      { title: `Result for ${query}`, url: "https://example.com", snippet: `Info about ${query}` },
      { title: `Guide: ${query}`, url: "https://example.com/2", snippet: `Deep dive into ${query}` },
    ],
  })),
  fetchUrl: vi.fn().mockResolvedValue({ text: "Page content" }),
}));

// Mock selfExpand
vi.mock("../../selfExpand/capabilityExpander", () => ({
  expandAndExecute: vi.fn().mockResolvedValue(null),
}));

// Mock fs for fused module discovery
vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
}));

describe("Orchestrator — orchestrate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decomposes, schedules, and executes a multi-step task", async () => {
    const result = await orchestrate(
      "Compare TypeScript and Python frameworks for AI",
      { runId: "test-run-1" },
    );

    expect(result.planId).toBeTruthy();
    expect(result.status).toBe("completed");
    expect(result.stats.totalSubtasks).toBe(3);
    expect(result.stats.completed).toBe(3);
    expect(result.stats.failed).toBe(0);

    // Verify all steps produced results
    expect(result.results["step_1"]).toBeTruthy();
    expect(result.results["step_2"]).toBeTruthy();
    expect(result.results["step_3"]).toBeTruthy();

    // Synthesize result should be a string (LLM reasoning output)
    expect(typeof result.results["step_3"]).toBe("string");
  });

  it("streams SSE events during execution", async () => {
    const sseEvents: Array<{ event: string; data: any }> = [];
    const mockRes = {
      write: vi.fn((chunk: string) => {
        const lines = chunk.split("\n");
        const event = lines[0]?.replace("event: ", "");
        const data = lines[1]?.replace("data: ", "");
        if (event && data) {
          sseEvents.push({ event, data: JSON.parse(data) });
        }
      }),
    };

    await orchestrate(
      "Compare TypeScript and Python frameworks",
      { runId: "test-run-2", sseRes: mockRes },
    );

    const eventTypes = sseEvents.map((e) => e.event);

    // Must have core orchestration events
    expect(eventTypes).toContain("orchestration_start");
    expect(eventTypes).toContain("planning");
    expect(eventTypes).toContain("plan_created");
    expect(eventTypes).toContain("wave_start");
    expect(eventTypes).toContain("subtask_start");
    expect(eventTypes).toContain("subtask_result");
    expect(eventTypes).toContain("orchestration_done");

    // Verify plan_created event has the right structure
    const planEvent = sseEvents.find((e) => e.event === "plan_created");
    expect(planEvent?.data.subtaskCount).toBe(3);
    expect(planEvent?.data.waveCount).toBe(2); // [step_1, step_2] then [step_3]
    expect(planEvent?.data.waves).toEqual([["step_1", "step_2"], ["step_3"]]);
  });

  it("executes independent subtasks in parallel (wave 1)", async () => {
    const result = await orchestrate(
      "Compare TypeScript and Python frameworks",
      { runId: "test-run-3" },
    );

    // Both step_1 and step_2 should be completed (they run in parallel in wave 1)
    expect(result.results["step_1"]).toBeTruthy();
    expect(result.results["step_2"]).toBeTruthy();
    expect(result.stats.completed).toBe(3);

    // Verify the wave structure: step_1 and step_2 in the same wave
    const planEvents = result.timeline.filter((t) => t.event === "wave_start");
    expect(planEvents.length).toBe(2); // wave 0 (parallel) + wave 1 (synthesize)
  });

  it("includes timeline events in the result", async () => {
    const result = await orchestrate(
      "Compare frameworks",
      { runId: "test-run-4" },
    );

    expect(result.timeline.length).toBeGreaterThan(0);
    const events = result.timeline.map((t) => t.event);
    expect(events).toContain("orchestration_start");
    expect(events).toContain("planning");
    expect(events).toContain("plan_created");
    expect(events).toContain("wave_start");
    expect(events).toContain("subtask_completed");
    expect(events).toContain("orchestration_done");
  });

  it("measures total duration", async () => {
    const result = await orchestrate(
      "Simple task",
      { runId: "test-run-5" },
    );

    expect(result.stats.totalDurationMs).toBeGreaterThan(0);
    expect(result.stats.totalDurationMs).toBeLessThan(30000); // Should be fast in tests
  });
});

describe("Orchestrator — error recovery", () => {
  it("handles subtask failure with retry", async () => {
    const { searchWeb } = await import("../../../services/webSearch");
    let callCount = 0;
    (searchWeb as any).mockImplementation(async (query: string) => {
      callCount++;
      if (callCount === 1 && query.includes("TypeScript")) {
        throw new Error("Transient network error");
      }
      return {
        results: [{ title: query, url: "https://ex.com", snippet: query }],
      };
    });

    const result = await orchestrate(
      "Compare TypeScript and Python frameworks",
      { runId: "test-run-err-1", maxRetries: 2 },
    );

    // Should eventually complete (retry succeeds)
    expect(result.stats.completed).toBeGreaterThanOrEqual(2);
  });

  it("returns partial status when some subtasks fail", async () => {
    // Make Gemini return a plan with a tool that doesn't exist
    const { getGeminiClient } = await import("../../../lib/gemini");
    (getGeminiClient as any).mockReturnValue({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            subtasks: [
              {
                id: "step_1",
                description: "Do something simple",
                toolHint: "web_search",
                args: { query: "test" },
                dependencies: [],
                priority: "normal",
                estimatedComplexity: "simple",
              },
              {
                id: "step_2",
                description: "Use nonexistent tool",
                toolHint: "totally_fake_tool_xyz",
                args: {},
                dependencies: [],
                priority: "normal",
                estimatedComplexity: "simple",
              },
              {
                id: "step_3",
                description: "Synthesize",
                toolHint: "synthesize",
                dependencies: ["step_1"],
                priority: "critical",
                estimatedComplexity: "medium",
              },
            ],
            reasoning: "Test with one failing subtask",
          }),
        }),
      },
    });

    const result = await orchestrate(
      "Test partial failure",
      { runId: "test-run-err-2", maxRetries: 0 },
    );

    // step_2 should fail (or fallback to synthesize), but step_1 and step_3 should complete
    expect(result.stats.completed).toBeGreaterThanOrEqual(2);
  });
});
