import { describe, expect, it } from "vitest";
import {
  formatSuperAgentResponse,
  looksLikeSuperAgentRequest,
  mapComplexityToOrchestrationLevel,
  shouldUseSuperAgentOrchestration,
} from "./superAgentRouting";

describe("superAgentRouting", () => {
  it("detects complex autonomous goals as super-agent candidates", () => {
    expect(
      looksLikeSuperAgentRequest(
        "Investiga el mercado, compáralo con la competencia, luego crea un plan y automatiza un workflow semanal.",
        {
          hasAttachments: false,
          hasActiveDocuments: false,
          conversationLength: 2,
        },
      ),
    ).toBe(true);
  });

  it("does not escalate simple chat greetings", () => {
    expect(
      looksLikeSuperAgentRequest("hola", {
        hasAttachments: false,
        hasActiveDocuments: false,
        conversationLength: 1,
      }),
    ).toBe(false);
  });

  it("uses orchestration for complex multi-agent work", () => {
    expect(
      shouldUseSuperAgentOrchestration({
        message:
          "Investiga tres competidores, compara precios, luego arma un plan y genera los siguientes pasos.",
        context: {
          hasAttachments: false,
          hasActiveDocuments: false,
          conversationLength: 3,
        },
        analysis: {
          complexity: "complex",
          intent: "multi_step_task",
          deliverables: [{ type: "research" }, { type: "document" }],
          suggestedAgents: ["research", "browser", "content", "qa"],
        },
      }),
    ).toBe(true);
  });

  it("maps complexity levels into orchestration scores", () => {
    expect(mapComplexityToOrchestrationLevel("trivial")).toBe(1);
    expect(mapComplexityToOrchestrationLevel("moderate")).toBe(4);
    expect(mapComplexityToOrchestrationLevel("expert")).toBe(9);
  });

  it("formats a visible super-agent execution summary", () => {
    const text = formatSuperAgentResponse({
      objective: "Investigar mercado y automatizar reporte",
      analysis: {
        complexity: "complex",
        suggestedAgents: ["research", "browser", "content"],
      },
      plan: {
        objective: "Investigar mercado y automatizar reporte",
        waves: [
          [
            {
              id: "step_1",
              description: "Investigar competidores",
              toolId: "web_search",
              dependencies: [],
              priority: 1,
              status: "completed",
            },
          ],
          [
            {
              id: "step_2",
              description: "Programar reporte semanal",
              toolId: "schedule_task",
              dependencies: ["step_1"],
              priority: 1,
              status: "completed",
            },
          ],
        ],
        totalEstimatedTime: 5000,
        maxParallelism: 1,
      },
      execution: {
        success: true,
        completedTasks: 2,
        failedTasks: 0,
        executionTimeMs: 3200,
        results: new Map([
          ["step_1", { summary: "Se analizaron 3 competidores." }],
          ["step_2", { scheduled: true }],
        ]),
        errors: new Map(),
        runId: "orch_run_123",
        status: "completed",
        subtasks: [
          {
            id: "step_1",
            description: "Investigar competidores",
            toolId: "web_search",
            dependencies: [],
            priority: 1,
            status: "completed",
          },
          {
            id: "step_2",
            description: "Programar reporte semanal",
            toolId: "schedule_task",
            dependencies: ["step_1"],
            priority: 1,
            status: "completed",
          },
        ],
      },
      combined: {
        success: true,
        runId: "orch_run_123",
        status: "completed",
        summary: {
          completed: 2,
          failed: 0,
          executionTime: "3200ms",
          status: "completed",
        },
        results: {
          step_1: { summary: "Se analizaron 3 competidores." },
          step_2: { scheduled: true },
        },
        errors: {},
        artifacts: {
          workspacePath: "/tmp/workspace",
          files: ["report.md"],
        },
      },
    });

    expect(text).toContain("modo superagente");
    expect(text).toContain("Run ID: orch_run_123");
    expect(text).toContain("Fase 1");
    expect(text).toContain("Se analizaron 3 competidores.");
    expect(text).toContain("report.md");
  });
});
