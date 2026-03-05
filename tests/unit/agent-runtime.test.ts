import { describe, expect, it } from "vitest";
import { TaskGraphPlanner } from "../../server/agent/runtime/planner";
import { ConcurrentTaskExecutor } from "../../server/agent/runtime/executor";
import type { RuntimeTaskGraph } from "../../server/agent/runtime/types";
import type { ToolResult } from "../../server/agent/toolRegistry";

function createMockGraph(): RuntimeTaskGraph {
  const planner = new TaskGraphPlanner();
  return planner.build({
    objective: "Analizar una pregunta con dos pasos",
    userMessage: "Analiza esto",
    steps: [
      {
        index: 0,
        toolName: "web_search",
        description: "Buscar contexto",
        input: { query: "foo" },
        expectedOutput: "Resultados",
      },
      {
        index: 1,
        toolName: "web_search",
        description: "Buscar fuentes adicionales",
        input: { query: "bar" },
        expectedOutput: "Fuentes",
      },
    ],
    attachments: [],
  });
}

describe("Agent runtime planner/executor", () => {
  it("planner builds typed DAG with DoD and validations", () => {
    const graph = createMockGraph();
    expect(graph.tasks.length).toBe(2);
    expect(graph.tasks[0].id).toBe("task-1");
    expect(Array.isArray(graph.tasks[0].definitionOfDone)).toBe(true);
    expect(graph.tasks[0].validations.length).toBeGreaterThan(0);
  });

  it("executor emits structured events and final_ready on success", async () => {
    const graph = createMockGraph();
    const emitted: string[] = [];
    const snapshots: any[] = [];

    const executor = new ConcurrentTaskExecutor({
      runId: "run-test-1",
      chatId: "chat-1",
      userId: "user-1",
      userPlan: "pro",
      signal: new AbortController().signal,
      emitTraceEvent: async (eventType) => {
        emitted.push(eventType);
      },
      executeTool: async () => {
        const result: ToolResult = {
          success: true,
          output: { ok: true },
          artifacts: [],
        };
        return result;
      },
      persistSnapshot: async (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const result = await executor.execute(graph);
    expect(result.success).toBe(true);
    expect(emitted).toContain("skill_load_started");
    expect(emitted).toContain("task_created");
    expect(emitted).toContain("task_started");
    expect(emitted).toContain("tool_call_started");
    expect(emitted).toContain("tool_call_done");
    expect(emitted).toContain("validation_passed");
    expect(emitted).toContain("final_ready");
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("executor schedules retries and fails when required validation does not pass", async () => {
    const graph = createMockGraph();
    const emitted: string[] = [];

    const executor = new ConcurrentTaskExecutor({
      runId: "run-test-2",
      chatId: "chat-2",
      userId: "user-2",
      userPlan: "pro",
      signal: new AbortController().signal,
      emitTraceEvent: async (eventType) => {
        emitted.push(eventType);
      },
      executeTool: async () => {
        const result: ToolResult = {
          success: false,
          output: null,
          artifacts: [],
          error: {
            code: "MOCK_FAIL",
            message: "Mock failure",
            retryable: true,
          },
        };
        return result;
      },
      persistSnapshot: async () => {},
    });

    const result = await executor.execute(graph);
    expect(result.success).toBe(false);
    expect(emitted).toContain("retry_scheduled");
    expect(result.status === "failed" || result.status === "cancelled").toBe(true);
  });
});

