// server/agent/orchestrator/__tests__/planner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decompose } from "../planner";

// Mock the Gemini client
vi.mock("../../../lib/gemini", () => ({
  getGeminiClient: vi.fn(),
  GEMINI_MODELS: { FLASH: "gemini-2.5-flash" },
}));

// Mock config/agentTools
vi.mock("../../../config/agentTools", () => ({
  AGENT_TOOLS: [
    { name: "web_search" },
    { name: "fetch_url" },
    { name: "create_document" },
    { name: "create_presentation" },
    { name: "analyze_data" },
  ],
}));

// Mock toolRegistry
vi.mock("../../registry/toolRegistry", () => ({
  toolRegistry: {
    getAll: () => new Map([["memory_search", {}], ["generate_chart", {}]]),
  },
}));

// Mock fs for fused modules
vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
}));

describe("Planner — decompose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns fallback plan when Gemini is unavailable", async () => {
    const { getGeminiClient } = await import("../../../lib/gemini");
    (getGeminiClient as any).mockReturnValue(null);

    const result = await decompose("Investigate AI frameworks");
    expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(result.subtasks[0].toolHint).toBe("web_search");
    expect(result.subtasks[1].toolHint).toBe("synthesize");
    expect(result.reasoning).toContain("Fallback");
  });

  it("calls Gemini with structured JSON when available", async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        subtasks: [
          {
            id: "step_1",
            description: "Search for AI frameworks",
            toolHint: "web_search",
            args: { query: "AI frameworks 2025" },
            dependencies: [],
            priority: "high",
            estimatedComplexity: "simple",
          },
          {
            id: "step_2",
            description: "Synthesize findings",
            toolHint: "synthesize",
            dependencies: ["step_1"],
            priority: "critical",
            estimatedComplexity: "medium",
          },
        ],
        reasoning: "Simple search then synthesize",
      }),
    });

    const { getGeminiClient } = await import("../../../lib/gemini");
    (getGeminiClient as any).mockReturnValue({
      models: { generateContent: mockGenerateContent },
    });

    const result = await decompose("Investigate AI frameworks");

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[0].id).toBe("step_1");
    expect(result.subtasks[0].toolHint).toBe("web_search");
    expect(result.subtasks[1].dependencies).toEqual(["step_1"]);
    expect(result.reasoning).toBe("Simple search then synthesize");

    // Verify system prompt includes available tools
    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain("web_search");
    expect(callArgs.config.systemInstruction).toContain("synthesize");
    expect(callArgs.config.responseMimeType).toBe("application/json");
  });

  it("returns fallback on Gemini error", async () => {
    const { getGeminiClient } = await import("../../../lib/gemini");
    (getGeminiClient as any).mockReturnValue({
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("API error")),
      },
    });

    const result = await decompose("Complex task");
    expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
    expect(result.reasoning).toContain("Fallback");
  });

  it("includes memory context when replanning", async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        subtasks: [
          {
            id: "step_3",
            description: "Create report from gathered data",
            toolHint: "create_document",
            dependencies: [],
            priority: "critical",
            estimatedComplexity: "medium",
          },
        ],
        reasoning: "Replanning: only document creation remains",
      }),
    });

    const { getGeminiClient } = await import("../../../lib/gemini");
    (getGeminiClient as any).mockReturnValue({
      models: { generateContent: mockGenerateContent },
    });

    const memory = {
      goal: "Research and create report",
      completedResults: {
        step_1: "Search results about AI",
        step_2: "Analysis of frameworks",
      },
      failedAttempts: [
        { subtaskId: "step_3", error: "Timeout", strategy: "create_document", attempt: 1 },
      ],
      context: {},
      timeline: [],
    };

    await decompose("Research and create report", memory);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    const userText = callArgs.contents[0].parts[0].text;
    expect(userText).toContain("CONTEXT FROM PREVIOUS EXECUTION");
    expect(userText).toContain("step_1 (completed)");
    expect(userText).toContain("FAILED ATTEMPTS");
    expect(userText).toContain("Timeout");
    expect(userText).toContain("REPLAN");
  });
});
