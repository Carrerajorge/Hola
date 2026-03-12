import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry, type ToolDefinition } from "../toolRegistry";

describe("ToolRegistry summarize inference", () => {
  it("infers summarize input from dependency results when HTN omitted content", async () => {
    const registry = new ToolRegistry();
    const summarizeTool: ToolDefinition = {
      name: "summarize",
      description: "Summarize fetched content",
      inputSchema: z.object({
        input: z.string().min(1),
      }),
      execute: async (input) => ({
        success: true,
        output: { summary: input.input.slice(0, 40) },
      }),
    };

    registry.register(summarizeTool);

    const result = await registry.execute(
      "summarize",
      {
        _dependencyResults: {
          step_2: {
            output: {
              textContent:
                "OpenAI announced a new release with stronger tool use and planning support.",
            },
          },
        },
      },
      { userId: "test-user", runId: "run-1" } as any,
    );

    expect(result.success).toBe(true);
    expect((result.output as any)?.summary).toContain("OpenAI announced");
  });

  it("does not overwrite an explicit summarize input", async () => {
    const registry = new ToolRegistry();
    const summarizeTool: ToolDefinition = {
      name: "summarize",
      description: "Summarize fetched content",
      inputSchema: z.object({
        input: z.string().min(1),
      }),
      execute: async (input) => ({
        success: true,
        output: { summary: input.input },
      }),
    };

    registry.register(summarizeTool);

    const result = await registry.execute(
      "summarize",
      {
        input: "Use this explicit text",
        _dependencyResults: {
          step_2: {
            output: {
              textContent: "This should not replace the explicit input.",
            },
          },
        },
      },
      { userId: "test-user", runId: "run-1" } as any,
    );

    expect(result.success).toBe(true);
    expect((result.output as any)?.summary).toBe("Use this explicit text");
  });
});
