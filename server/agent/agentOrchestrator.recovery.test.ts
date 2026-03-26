import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectQueue: any[] = [];
const insertQueue: any[] = [];
const updateQueue: any[] = [];
const llmChatMock = vi.fn(async () => ({ content: "Recovered summary" }));
const updateRunWithLockMock = vi.fn(async () => ({ success: true }));

function makeQueryBuilder(value: any) {
  const promise = Promise.resolve(value);
  const builder: any = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    returning: vi.fn(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return builder;
}

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => makeQueryBuilder(selectQueue.shift() ?? [])),
    insert: vi.fn(() => {
      const promise = Promise.resolve(insertQueue.shift() ?? [{}]);
      const valuesBuilder: any = {
        returning: vi.fn(() => promise),
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
      };
      return {
        values: vi.fn(() => valuesBuilder),
      };
    }),
    update: vi.fn(() => {
      const promise = Promise.resolve(updateQueue.shift() ?? []);
      const whereBuilder: any = {
        returning: vi.fn(() => promise),
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
      };
      const builder: any = {
        set: vi.fn(() => builder),
        where: vi.fn(() => whereBuilder),
        returning: vi.fn(() => promise),
      };
      return builder;
    }),
  },
}));

vi.mock("./dbTransactions", () => ({
  updateRunWithLock: updateRunWithLockMock,
}));

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: llmChatMock,
  },
}));

vi.mock("./toolRegistry", () => ({
  toolRegistry: {
    get: vi.fn(() => ({
      inputSchema: {
        safeParse: (input: any) => ({ success: true, data: input }),
      },
    })),
    execute: vi.fn(async () => ({ success: true, output: "ok", artifacts: [] })),
  },
}));

vi.mock("./toolLoopDetection", () => ({
  detectToolCallLoop: vi.fn(() => ({ stuck: false, message: "", level: "warn" })),
  hashToolCall: vi.fn(() => "call-hash"),
  hashToolOutcome: vi.fn(() => "outcome-hash"),
}));

vi.mock("./sandbox/tools", () => ({
  defaultToolRegistry: {
    listToolsWithInfo: vi.fn(() => []),
  },
}));

vi.mock("./htnPlanner", () => ({
  getHTNPlanner: vi.fn(() => ({
    plan: vi.fn(async () => ({ success: false })),
    execute: vi.fn(async () => ({ success: true, executionTime: 0, failedTasks: [] })),
  })),
}));

vi.mock("../services/userSettingsCache", () => ({
  getUserSettingsCached: vi.fn(async () => null),
}));

vi.mock("./policyEngine", () => ({
  policyEngine: {
    getPolicy: vi.fn(() => ({
      deniedByDefault: false,
      allowedPlans: ["free", "pro", "admin"],
    })),
    hasCapability: vi.fn(() => false),
  },
}));

vi.mock("../openclaw/plugins/hookSystem", () => ({
  hookSystem: {
    dispatch: vi.fn(async () => undefined),
  },
}));

vi.mock("../replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityBuffer() {
      throw new Error("not needed in test");
    }
  },
}));

vi.mock("./documentDirectResponse", () => ({
  buildDocumentAttachmentContext: vi.fn(async () => ""),
  generateDirectAttachmentTranscriptionResponse: vi.fn(async () => null),
  generateDirectDocumentResponse: vi.fn(async () => null),
}));

vi.mock("./eventBus", () => ({
  agentEventBus: {
    emit: vi.fn(async () => undefined),
  },
}));

vi.mock("./orchestrator/orchestratorBridge", () => ({
  createGraphForRun: vi.fn(),
  getActiveGraph: vi.fn(() => null),
  convertPlanToSpec: vi.fn(() => ({})),
  recordToolResult: vi.fn(),
  transitionToPlanning: vi.fn(),
  transitionToExecuting: vi.fn(),
  transitionToVerifying: vi.fn(),
  transitionToDone: vi.fn(),
  transitionToFailed: vi.fn(),
  transitionToCancelled: vi.fn(),
  transitionToRetry: vi.fn(),
  transitionToEscalate: vi.fn(),
  shouldEscalateAction: vi.fn(() => false),
  isBudgetExceeded: vi.fn(() => false),
  cleanupGraph: vi.fn(async () => undefined),
  getGraphStatus: vi.fn(() => "ok"),
}));

async function flushAsyncWork(iterations = 4) {
  for (let index = 0; index < iterations; index++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("AgentManager recovery", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    insertQueue.length = 0;
    updateQueue.length = 0;
    vi.clearAllMocks();
    updateRunWithLockMock.mockResolvedValue({ success: true });
    llmChatMock.mockResolvedValue({ content: "Recovered summary" });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("rehydrates awaiting confirmation runs without auto-resuming them", async () => {
    const runId = "run-awaiting-confirmation";
    const startedAt = new Date("2026-03-26T10:00:00.000Z");

    selectQueue.push(
      [
        {
          id: runId,
          chatId: "chat-1",
          messageId: "msg-1",
          userId: "user-1",
          status: "awaiting_confirmation",
          executionProfile: "marathon_12h",
          plan: {
            objective: "Desplegar el proyecto",
            steps: [
              {
                index: 0,
                toolName: "shell_command",
                description: "Ejecutar deploy",
                input: { command: "deploy" },
                expectedOutput: "Deploy terminado",
              },
            ],
            estimatedTime: "10 minutes",
          },
          artifacts: [],
          summary: null,
          error: null,
          totalSteps: 1,
          completedSteps: 0,
          currentStepIndex: 0,
          startedAt,
          completedAt: null,
          createdAt: startedAt,
          idempotencyKey: null,
        },
      ],
      [
        {
          id: "step-1",
          runId,
          stepIndex: 0,
          toolName: "shell_command",
          toolInput: { command: "deploy" },
          toolOutput: null,
          status: "failed",
          error: "Confirmation required to continue",
          retryCount: 0,
          startedAt,
          completedAt: new Date("2026-03-26T10:05:00.000Z"),
          createdAt: startedAt,
        },
      ],
      [],
      [{ plan: "pro" }],
      [{ content: "Haz el deploy a producción", attachments: [] }],
    );

    const { AgentManager } = await import("./agentOrchestrator");
    const manager = new AgentManager();

    try {
      const summary = await manager.recoverPersistedRuns();
      const orchestrator = manager.getOrchestrator(runId);

      expect(summary).toMatchObject({
        scanned: 1,
        recovered: 1,
        resumed: 0,
        failed: 0,
      });
      expect(orchestrator).toBeDefined();
      expect(orchestrator?.status).toBe("awaiting_confirmation");
      expect(orchestrator?.getExecutionProfile()).toBe("marathon_12h");
      expect(orchestrator?.getPendingConfirmation()).toMatchObject({
        stepIndex: 0,
        toolName: "shell_command",
      });
    } finally {
      manager.shutdown();
    }
  });

  it("auto-resumes running marathon runs recovered from persistence", async () => {
    const runId = "run-auto-resume";
    const startedAt = new Date("2026-03-26T11:00:00.000Z");

    selectQueue.push(
      [
        {
          id: runId,
          chatId: "chat-2",
          messageId: "msg-2",
          userId: "user-2",
          status: "running",
          executionProfile: "marathon_24h",
          plan: {
            objective: "Completar auditoria",
            steps: [
              {
                index: 0,
                toolName: "shell_command",
                description: "Correr auditoria",
                input: { command: "audit" },
                expectedOutput: "Auditoria finalizada",
              },
            ],
            estimatedTime: "30 minutes",
          },
          artifacts: [],
          summary: null,
          error: null,
          totalSteps: 1,
          completedSteps: 1,
          currentStepIndex: 1,
          startedAt,
          completedAt: null,
          createdAt: startedAt,
          idempotencyKey: null,
        },
      ],
      [
        {
          id: "step-2",
          runId,
          stepIndex: 0,
          toolName: "shell_command",
          toolInput: { command: "audit" },
          toolOutput: { ok: true },
          status: "succeeded",
          error: null,
          retryCount: 0,
          startedAt,
          completedAt: new Date("2026-03-26T11:10:00.000Z"),
          createdAt: startedAt,
        },
      ],
      [],
      [{ plan: "free" }],
      [{ content: "Termina la auditoria completa", attachments: [] }],
      [{ id: "step-2", stepIndex: 0 }],
    );

    const { AgentManager } = await import("./agentOrchestrator");
    const manager = new AgentManager();

    try {
      const summary = await manager.recoverPersistedRuns();
      await flushAsyncWork();

      const orchestrator = manager.getOrchestrator(runId);
      expect(summary).toMatchObject({
        scanned: 1,
        recovered: 1,
        resumed: 1,
        failed: 0,
      });
      expect(orchestrator).toBeDefined();
      expect(orchestrator?.getExecutionProfile()).toBe("marathon_24h");
      expect(orchestrator?.status).toBe("completed");
      expect(llmChatMock).toHaveBeenCalled();
      expect(updateRunWithLockMock).toHaveBeenCalled();
    } finally {
      manager.shutdown();
    }
  });
});
