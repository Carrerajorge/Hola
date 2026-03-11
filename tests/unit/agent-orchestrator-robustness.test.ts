import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => {
  const chain = {
    set: () => ({ where: async () => ({}) }),
  };
  return {
    db: {
      update: () => chain,
    },
  };
});

const toolExecuteMock = vi.fn();
const toolListMock = vi.fn(() => []);
const llmChatMock = vi.fn();
vi.mock("../../server/agent/toolRegistry", () => ({
  toolRegistry: {
    execute: (...args: any[]) => toolExecuteMock(...args),
    list: () => toolListMock(),
  },
}));

vi.mock("../../server/lib/llmGateway", () => ({
  llmGateway: {
    chat: (...args: any[]) => llmChatMock(...args),
  },
}));

vi.mock("../../server/agent/eventBus", () => ({
  agentEventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../server/openclaw/plugins/hookSystem", () => ({
  hookSystem: {
    dispatch: vi.fn().mockResolvedValue(undefined),
  },
}));

import { AgentOrchestrator } from "../../server/agent/agentOrchestrator";
import { getHTNPlanner, type Task } from "../../server/agent/htnPlanner";

function makePrimitiveTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || "task-id",
    name: overrides.name || "Task",
    type: "primitive",
    description: overrides.description || "Task description",
    preconditions: overrides.preconditions || [],
    effects: overrides.effects || [],
    cost: overrides.cost || 1,
    estimatedDuration: overrides.estimatedDuration || 1_000,
    priority: overrides.priority || 1,
    toolName: overrides.toolName,
    toolParams: overrides.toolParams,
    status: overrides.status || "pending",
    result: overrides.result,
    error: overrides.error,
    startTime: overrides.startTime,
    endTime: overrides.endTime,
    retryCount: overrides.retryCount || 0,
    maxRetries: overrides.maxRetries || 1,
    dependencies: overrides.dependencies || [],
    dependents: overrides.dependents || [],
  };
}

describe("AgentOrchestrator robustness", () => {
  beforeEach(() => {
    toolExecuteMock.mockReset();
    toolListMock.mockReset();
    toolListMock.mockReturnValue([]);
    llmChatMock.mockReset();
  });

  it("treats short capability questions as conversational", async () => {
    const orchestrator = new AgentOrchestrator("run-convo", "chat-1", "user-1", "pro");

    await expect((orchestrator as any).checkIfConversational("¿Qué haces?")).resolves.toBe(true);
    await expect((orchestrator as any).checkIfConversational("como estas")).resolves.toBe(true);
  });

  it("hydrates fetch_url with the first URL from dependency search results", async () => {
    toolExecuteMock.mockResolvedValue({
      success: true,
      output: { content: "Fetched page" },
      artifacts: [],
    });

    const orchestrator = new AgentOrchestrator("run-fetch", "chat-1", "user-1", "pro");
    (orchestrator as any).emitTraceEvent = vi.fn().mockResolvedValue(undefined);

    orchestrator.plan = {
      objective: "Investigar ejemplo",
      estimatedTime: "1 minute",
      steps: [
        { index: 0, toolName: "web_search", description: "Search", input: {}, expectedOutput: "Results" },
        { index: 1, toolName: "fetch_url", description: "Fetch", input: {}, expectedOutput: "Content" },
      ],
    };

    const searchTask = makePrimitiveTask({
      id: "search-task",
      name: "Search",
      description: "Search",
      toolName: "search_web",
      status: "completed",
      result: [
        { title: "Example", url: "https://example.com", snippet: "Example snippet" },
      ],
    });

    const fetchTask = makePrimitiveTask({
      id: "fetch-task",
      name: "Fetch",
      description: "Fetch",
      toolName: "fetch_url",
      toolParams: {},
      dependencies: [searchTask.id],
    });

    const planId = "htn-fetch-plan";
    const planner = getHTNPlanner();
    (planner as any).activePlans.set(planId, {
      id: planId,
      goal: "Investigar ejemplo",
      rootTask: searchTask,
      allTasks: new Map([
        [searchTask.id, searchTask],
        [fetchTask.id, fetchTask],
      ]),
      executionOrder: [searchTask.id, fetchTask.id],
      status: "ready",
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        totalCost: 2,
        estimatedDuration: 2_000,
        completedTasks: 0,
        failedTasks: 0,
      },
    });

    (orchestrator as any).htnPlanId = planId;

    const output = await orchestrator.executeHTNTask(fetchTask);

    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    expect(toolExecuteMock.mock.calls[0][0]).toBe("fetch_url");
    expect(toolExecuteMock.mock.calls[0][1]).toMatchObject({
      url: "https://example.com",
    });
    expect(output).toEqual({ content: "Fetched page" });
  });

  it("hydrates summarize with dependency content before executing the tool", async () => {
    toolExecuteMock.mockResolvedValue({
      success: true,
      output: { summary: "Resumen listo" },
      artifacts: [],
    });

    const orchestrator = new AgentOrchestrator("run-summarize", "chat-1", "user-1", "pro");
    (orchestrator as any).emitTraceEvent = vi.fn().mockResolvedValue(undefined);

    orchestrator.plan = {
      objective: "Resume la pagina",
      estimatedTime: "1 minute",
      steps: [
        { index: 0, toolName: "fetch_url", description: "Fetch", input: {}, expectedOutput: "Content" },
        { index: 1, toolName: "summarize", description: "Summarize", input: {}, expectedOutput: "Summary" },
      ],
    };

    const fetchTask = makePrimitiveTask({
      id: "fetch-task",
      name: "Fetch",
      description: "Fetch",
      toolName: "fetch_url",
      status: "completed",
      result: {
        url: "https://example.com",
        title: "Example",
        content: "Contenido de prueba para resumir correctamente.",
      },
    });

    const summarizeTask = makePrimitiveTask({
      id: "summarize-task",
      name: "Summarize",
      description: "Summarize",
      toolName: "summarize",
      toolParams: {},
      dependencies: [fetchTask.id],
    });

    const planId = "htn-summarize-plan";
    const planner = getHTNPlanner();
    (planner as any).activePlans.set(planId, {
      id: planId,
      goal: "Resume la pagina",
      rootTask: fetchTask,
      allTasks: new Map([
        [fetchTask.id, fetchTask],
        [summarizeTask.id, summarizeTask],
      ]),
      executionOrder: [fetchTask.id, summarizeTask.id],
      status: "ready",
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        totalCost: 2,
        estimatedDuration: 2_000,
        completedTasks: 0,
        failedTasks: 0,
      },
    });

    (orchestrator as any).htnPlanId = planId;

    await orchestrator.executeHTNTask(summarizeTask);

    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    expect(toolExecuteMock.mock.calls[0][0]).toBe("summarize");
    expect(toolExecuteMock.mock.calls[0][1]).toMatchObject({
      input: expect.stringContaining("Contenido de prueba"),
      content: expect.stringContaining("Contenido de prueba"),
      targetLength: "medium",
      format: "paragraph",
      audience: "general",
    });
  });

  it("hydrates summarize with previous step output during normal step execution", async () => {
    toolExecuteMock.mockResolvedValue({
      success: true,
      output: { summary: "Resumen listo" },
      artifacts: [],
    });

    const orchestrator = new AgentOrchestrator("run-normal-summarize", "chat-1", "user-1", "pro");
    (orchestrator as any).emitTraceEvent = vi.fn().mockResolvedValue(undefined);

    orchestrator.plan = {
      objective: "Resume la pagina",
      estimatedTime: "1 minute",
      steps: [
        { index: 0, toolName: "fetch_url", description: "Fetch", input: {}, expectedOutput: "Content" },
        { index: 1, toolName: "summarize", description: "Summarize", input: {}, expectedOutput: "Summary" },
      ],
    };

    orchestrator.stepResults = [
      {
        stepIndex: 0,
        toolName: "fetch_url",
        success: true,
        output: {
          url: "https://example.com",
          title: "Example",
          content: "Contenido de prueba para resumir correctamente.",
        },
        artifacts: [],
        startedAt: 1,
        completedAt: 2,
      },
    ];

    await orchestrator.executeStep(1);

    expect(toolExecuteMock).toHaveBeenCalledTimes(1);
    expect(toolExecuteMock.mock.calls[0][0]).toBe("summarize");
    expect(toolExecuteMock.mock.calls[0][1]).toMatchObject({
      input: expect.stringContaining("Contenido de prueba"),
      content: expect.stringContaining("Contenido de prueba"),
      targetLength: "medium",
      format: "paragraph",
      audience: "general",
    });
  });

  it("pauses HTN execution when a tool requires confirmation", async () => {
    toolExecuteMock
      .mockResolvedValueOnce({
        success: true,
        output: { sessionId: "session-123" },
        artifacts: [],
      })
      .mockResolvedValueOnce({
        success: false,
        output: null,
        artifacts: [],
        error: { code: "REQUIRES_CONFIRMATION", message: "User confirmation required", retryable: false },
      });

    const orchestrator = new AgentOrchestrator("run-confirm", "chat-1", "user-1", "pro");
    (orchestrator as any).emitTraceEvent = vi.fn().mockResolvedValue(undefined);

    await orchestrator.generatePlan("GitHub par jao, mera repo check karo");
    await orchestrator.executeHTNPlan();

    expect(orchestrator.status).toBe("awaiting_confirmation");
    expect(orchestrator.getPendingConfirmation()).toMatchObject({
      toolName: "computer_use_agentic",
      stepIndex: 1,
    });
  });

  it("creates an HTN browser-autonomy plan for GitHub prompts", async () => {
    const orchestrator = new AgentOrchestrator("run-plan", "chat-1", "user-1", "pro");
    const plan = await orchestrator.generatePlan("GitHub par jao, mera repo check karo");

    const toolNames = plan.steps.map((step) => step.toolName);
    expect(toolNames).toContain("computer_use_session");
    expect(toolNames).toContain("computer_use_agentic");
    expect(toolNames).toContain("computer_use_screenshot");
  });
});
