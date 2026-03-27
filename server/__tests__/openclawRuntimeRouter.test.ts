import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const runtimeRuns: any[] = [];
const runtimeSkills: any[] = [];
const defaultRuntimeSkill = {
  id: "coding-agent",
  name: "Coding Agent",
  description: "Code skill",
  tools: ["openclaw_exec"],
  source: "builtin",
};
const initSkillsMock = vi.fn(async () => {
  if (runtimeSkills.length === 0) {
    runtimeSkills.push({ ...defaultRuntimeSkill });
  }
});

const orchestrationEngineMock = {
  decomposeTask: vi.fn(async (objective: string) => [
    {
      id: "subtask_1",
      description: `Analizar objetivo: ${objective}`,
      toolId: "analyze",
      dependencies: [],
      priority: 1,
      status: "pending",
    },
    {
      id: "subtask_2",
      description: "Generar salida consolidada",
      toolId: null,
      dependencies: ["subtask_1"],
      priority: 2,
      status: "pending",
    },
  ]),
  buildExecutionPlan: vi.fn((subtasks: any[]) => ({
    waves: [[subtasks[0]], [subtasks[1]]],
    totalEstimatedTime: 10_000,
    maxParallelism: 1,
  })),
  executeParallel: vi.fn(async () => ({
    success: true,
    completedTasks: 2,
    failedTasks: 0,
    results: new Map([
      ["subtask_1", { ok: true }],
      ["subtask_2", { summary: "done" }],
    ]),
    errors: new Map(),
    executionTimeMs: 123,
  })),
  combineResults: vi.fn(() => ({
    success: true,
    summary: {
      completed: 2,
      failed: 0,
      executionTime: "123ms",
    },
    results: {
      subtask_1: { ok: true },
      subtask_2: { summary: "done" },
    },
    errors: {},
  })),
};

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: () => "user_test",
}));

vi.mock("../services/ragService", () => ({
  RAGService: class {
    async search() {
      return [{ content: "mocked memory", score: 0.91, chatId: "chat_1" }];
    }

    async getContextForMessage() {
      return "[Contexto]\nmocked memory";
    }
  },
}));

vi.mock("../services/orchestrationEngine", () => ({
  orchestrationEngine: orchestrationEngineMock,
}));

vi.mock("../openclaw/skills/skillRegistry", () => ({
  skillRegistry: {
    list: vi.fn(() => runtimeSkills),
    resolve: vi.fn((skillIds?: string[]) => ({
      skills: runtimeSkills.filter((skill) =>
        !skillIds || skillIds.length === 0 ? true : skillIds.includes(skill.id),
      ),
      prompt: "## Skill: Coding Agent\nUse tools.",
      tools: ["openclaw_exec"],
    })),
    clear: vi.fn(() => {
      runtimeSkills.length = 0;
    }),
  },
}));

vi.mock("../openclaw/config", () => ({
  getOpenClawConfig: () => ({
    gateway: { enabled: false, path: "/ws/openclaw" },
    tools: {
      enabled: false,
      safeBins: [],
      workspaceRoot: "/tmp",
      execTimeout: 120000,
      execSecurity: "warn",
    },
    plugins: { enabled: false, directory: "" },
    skills: {
      enabled: true,
      directory: "/tmp/skills",
      extraDirectories: [],
      workspaceDirectory: "/tmp",
      includeBuiltins: true,
      autoImportClawi: false,
      maxSkillFileBytes: 1000,
    },
    streaming: { enabled: false, blockMinChars: 50, blockMaxChars: 500, previewMode: "partial" },
  }),
}));

vi.mock("../openclaw/skills/skillLoader", () => ({
  initSkills: initSkillsMock,
}));

vi.mock("../openclaw/agents/subagentService", () => ({
  openclawSubagentService: {
    spawn: vi.fn((params: any) => {
      const run = {
        id: `sub_${runtimeRuns.length + 1}`,
        requesterUserId: params.requesterUserId,
        objective: params.objective,
        planHint: params.planHint || [],
        parentRunId: params.parentRunId,
        executionProfile: params.executionProfile || "standard",
        workspaceContext: params.workspaceContext,
        status: "queued",
        createdAt: Date.now(),
      };
      runtimeRuns.push(run);
      return run;
    }),
    list: vi.fn((params: any = {}) => {
      return runtimeRuns
        .filter((run) => !params.requesterUserId || run.requesterUserId === params.requesterUserId)
        .filter((run) => !params.parentRunId || run.parentRunId === params.parentRunId)
        .filter((run) => !params.status || run.status === params.status)
        .slice(0, Math.max(1, params.limit || 100));
    }),
    get: vi.fn((runId: string) => runtimeRuns.find((run) => run.id === runId)),
    cancel: vi.fn((runId: string) => {
      const found = runtimeRuns.find((run) => run.id === runId);
      if (!found) return false;
      found.status = "cancelled";
      return true;
    }),
  },
}));

async function createTestApp() {
  const { createOpenClawRuntimeRouter } = await import("../routes/openclawRuntimeRouter");
  const app = express();
  app.use(express.json());
  app.use("/api/openclaw/runtime", createOpenClawRuntimeRouter());
  return app;
}

describe("openclawRuntimeRouter smoke flow", () => {
  beforeEach(() => {
    runtimeRuns.length = 0;
    runtimeSkills.length = 0;
    runtimeSkills.push({ ...defaultRuntimeSkill });
    vi.clearAllMocks();
  });

  it("lazy-loads runtime skills and reports effective health", async () => {
    runtimeSkills.length = 0;

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const healthRes = await client.get("/api/openclaw/runtime/health");
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.modules.skills).toBe(true);
      expect(healthRes.body.modules.tools).toBe(false);
      expect(healthRes.body.details.skillsConfigured).toBe(true);
      expect(healthRes.body.details.skillsLoaded).toBe(1);
      expect(initSkillsMock).toHaveBeenCalledTimes(1);

      const skillsRes = await client.get("/api/openclaw/runtime/skills");
      expect(skillsRes.status).toBe(200);
      expect(skillsRes.body.count).toBe(1);
      expect(skillsRes.body.skills[0]?.id).toBe("coding-agent");
    } finally {
      await close();
    }
  });

  it("executes objective -> plan -> subagents -> consolidated response", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const objective = "analiza ventas y genera resumen";

      const planRes = await client
        .post("/api/openclaw/runtime/orchestrator/plan")
        .send({ objective });
      expect(planRes.status).toBe(200);
      expect(Array.isArray(planRes.body.subtasks)).toBe(true);
      expect(planRes.body.subtasks.length).toBeGreaterThanOrEqual(1);

      const spawnRes = await client
        .post("/api/openclaw/runtime/subagents")
        .send({ objective: planRes.body.subtasks[0].description, executionProfile: "marathon_24h" });
      expect(spawnRes.status).toBe(202);
      expect(spawnRes.body.id).toBeTruthy();
      expect(spawnRes.body.executionProfile).toBe("marathon_24h");

      const listRes = await client.get("/api/openclaw/runtime/subagents");
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.runs)).toBe(true);
      expect(listRes.body.runs.length).toBeGreaterThanOrEqual(1);

      const runRes = await client
        .post("/api/openclaw/runtime/orchestrator/run")
        .send({ objective });
      expect(runRes.status).toBe(200);
      expect(runRes.body.combined).toBeTruthy();
      expect(runRes.body.combined.summary.completed).toBe(2);

      const flowRes = await client
        .post("/api/openclaw/runtime/orchestrator/flow")
        .send({ objective, spawnSubagents: true, maxSubagents: 2 });
      expect(flowRes.status).toBe(200);
      expect(Array.isArray(flowRes.body.delegatedRuns)).toBe(true);
      expect(flowRes.body.delegatedRuns.length).toBeGreaterThanOrEqual(1);
      expect(flowRes.body.combined.summary.completed).toBe(2);
    } finally {
      await close();
    }
  });

  it("persists structured workspace context when spawning subagents", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const workspaceContext = {
        projectId: "project-1",
        projectName: "Hola",
        repositoryPath: "/tmp/repos/hola",
        selectedFolder: "server/openclaw",
        branch: "codex/openclaw-native-review-20260327",
        runtimeTarget: "openclaw_native",
        executionAccess: "workspace",
      };

      const spawnRes = await client.post("/api/openclaw/runtime/subagents").send({
        objective: "Revisa el módulo de runtime",
        executionProfile: "standard",
        workspaceContext,
      });

      expect(spawnRes.status).toBe(202);
      expect(spawnRes.body.workspaceContext).toEqual(workspaceContext);
      expect(runtimeRuns[0]?.workspaceContext).toEqual(workspaceContext);

      const listRes = await client.get("/api/openclaw/runtime/subagents");
      expect(listRes.status).toBe(200);
      expect(listRes.body.runs[0]?.workspaceContext).toEqual(workspaceContext);
    } finally {
      await close();
    }
  });
});
