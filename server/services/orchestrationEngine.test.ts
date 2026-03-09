import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOrchestrationEngine } from "./orchestrationEngine";
import type { PlannerSkillContext } from "@shared/skills/skillOperationalCatalog";

const assistantAgent = {
  id: "assistant",
  name: "Personal Assistant",
  description: "",
  systemPrompt: "",
  model: "gemini-2.5-flash",
  tools: [],
  capabilities: [],
  settings: {
    temperature: 0.5,
    maxTokens: 2048,
    topP: 0.9,
    streaming: true,
    memory: true,
    webSearch: true,
    codeExecution: false,
  },
  status: "active" as const,
  stats: {
    messagesProcessed: 0,
    tokensUsed: 0,
    averageResponseTime: 0,
    successRate: 100,
    lastActive: null,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const scheduleTool = {
  id: "schedule_task",
  name: "Schedule Task",
  description: "Create scheduled jobs",
  category: "automation" as const,
  capabilities: ["schedule task", "cron", "scheduler"],
  endpoint: "/api/tools/schedule-task",
  method: "POST" as const,
  isEnabled: true,
  usageCount: 0,
  successRate: 100,
  healthStatus: "healthy" as const,
  failureCount: 0,
};

const plannerOutput = {
  subtasks: [
    {
      id: "step_1",
      description: "Schedule a recurring report for the customer team",
      toolHint: "schedule_task",
      args: { frequency: "daily" },
      dependencies: [],
      priority: "high" as const,
      estimatedComplexity: "simple" as const,
      alternateStrategy: "Use workflow_manage if scheduling fails",
    },
    {
      id: "step_2",
      description: "Synthesize the final operator summary",
      toolHint: "synthesize",
      dependencies: ["step_1"],
      priority: "critical" as const,
      estimatedComplexity: "medium" as const,
    },
  ],
  reasoning: "Use a scheduling tool first and then provide an aggregated summary.",
};

const skillContext: PlannerSkillContext = {
  activeSkill: {
    id: "automation",
    name: "Automatizaciones",
    description: "Planifica y ejecuta flujos programados",
    badgeLabel: "AgentOps",
    domainLabel: "Orquestacion y automatizacion",
    lane: "brain",
    executionMode: "hybrid",
    readiness: "guarded",
    primaryTools: ["openclaw_spawn_subagent", "openclaw_clawi_exec"],
    fallbackTools: ["synthesize"],
    requiredScopes: ["external_network", "system"],
    abilities: ["workflow", "scheduling"],
    searchTerms: ["automatizacion", "workflow", "scheduler"],
    routingStrategy: "Descompone, delega y sintetiza.",
    routingNotes: ["Prioriza subagentes para objetivos multi-etapa."],
  },
  relevantSkills: [],
  routingNotes: ["La skill activa debe viajar hasta el planner y la ejecucion."],
};

describe("orchestrationEngine adapter", () => {
  let mocks: {
    decomposeGoal: ReturnType<typeof vi.fn>;
    buildPlannerWaves: ReturnType<typeof vi.fn>;
    executeGoal: ReturnType<typeof vi.fn>;
    resolvePrimaryModelForRole: ReturnType<typeof vi.fn>;
    getActiveAgent: ReturnType<typeof vi.fn>;
    getAgent: ReturnType<typeof vi.fn>;
    getAgents: ReturnType<typeof vi.fn>;
    recommendAgent: ReturnType<typeof vi.fn>;
    getToolById: ReturnType<typeof vi.fn>;
    searchTools: ReturnType<typeof vi.fn>;
    searchByCapability: ReturnType<typeof vi.fn>;
  };

  let orchestrationEngine: ReturnType<typeof createOrchestrationEngine>;
  let storePath: string;

  beforeEach(() => {
    storePath = path.join(
      os.tmpdir(),
      "hola-openclaw-tests",
      `orchestration-engine-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true });

    mocks = {
      decomposeGoal: vi.fn().mockResolvedValue(plannerOutput),
      buildPlannerWaves: vi.fn().mockReturnValue([["step_1"], ["step_2"]]),
      executeGoal: vi.fn().mockResolvedValue({
        planId: "plan_123",
        status: "completed",
        results: {
          step_1: { scheduled: true },
          step_2: { summary: "ready" },
        },
        errors: {},
        finalOutput: { summary: "ready" },
        timeline: [{ ts: Date.now(), event: "done", detail: "completed" }],
        subtasks: [
          {
            ...plannerOutput.subtasks[0],
            status: "completed",
            retryCount: 0,
            maxRetries: 2,
            result: { scheduled: true },
          },
          {
            ...plannerOutput.subtasks[1],
            status: "completed",
            retryCount: 0,
            maxRetries: 2,
            result: { summary: "ready" },
          },
        ],
        stats: {
          totalSubtasks: 2,
          completed: 2,
          failed: 0,
          skipped: 0,
          selfExpanded: 0,
          replanned: 0,
          totalDurationMs: 1500,
        },
        artifacts: {
          workspacePath: "/tmp/workspace",
          files: ["report.md"],
        },
      }),
      resolvePrimaryModelForRole: vi.fn((lane: string) => `${lane}-model`),
      getActiveAgent: vi.fn().mockReturnValue(assistantAgent),
      getAgent: vi.fn((id: string) => (id === "assistant" ? assistantAgent : null)),
      getAgents: vi.fn().mockReturnValue([assistantAgent]),
      recommendAgent: vi.fn().mockReturnValue(assistantAgent),
      getToolById: vi.fn((id: string) => (id === "schedule_task" ? scheduleTool : undefined)),
      searchTools: vi.fn((query: string) => (query === "schedule_task" ? [scheduleTool] : [])),
      searchByCapability: vi.fn((token: string) =>
        token === "schedule" || token === "scheduler" ? [scheduleTool] : [],
      ),
    };

    orchestrationEngine = createOrchestrationEngine({
      storePath,
      deps: {
        decomposeGoal: mocks.decomposeGoal,
        buildPlannerWaves: mocks.buildPlannerWaves,
        executeGoal: mocks.executeGoal,
        resolvePrimaryModelForRole: mocks.resolvePrimaryModelForRole,
        agentManager: {
          getActiveAgent: mocks.getActiveAgent,
          getAgent: mocks.getAgent,
          getAgents: mocks.getAgents,
          recommendAgent: mocks.recommendAgent,
        },
        toolRegistry: {
          getToolById: mocks.getToolById,
          searchTools: mocks.searchTools,
          searchByCapability: mocks.searchByCapability,
        },
      },
    });
  });

  it("maps planner subtasks into role-aware service tasks", async () => {
    const subtasks = await orchestrationEngine.decomposeTask(
      "Programa un reporte diario y dame un resumen final",
      4,
      { skillContext },
    );

    expect(subtasks).toHaveLength(2);
    expect(subtasks[0]).toMatchObject({
      id: "step_1",
      toolId: "schedule_task",
      lane: "speed",
      executionMode: "tool",
      model: "speed-model",
      agentId: "assistant",
      sourceObjective: "Programa un reporte diario y dame un resumen final",
    });
    expect(subtasks[0]?.toolCandidates?.[0]?.id).toBe("schedule_task");

    expect(subtasks[1]).toMatchObject({
      id: "step_2",
      toolId: null,
      kind: "aggregate",
      executionMode: "agent",
      model: "brain-model",
    });
    expect(mocks.decomposeGoal).toHaveBeenCalledWith(
      "Programa un reporte diario y dame un resumen final",
      { skillContext },
    );
  });

  it("builds a plan with objective, waves, and strategy metadata", async () => {
    const subtasks = await orchestrationEngine.decomposeTask(
      "Programa un reporte diario y dame un resumen final",
      4,
      { skillContext },
    );
    const plan = orchestrationEngine.buildExecutionPlan(subtasks, { skillContext });

    expect(mocks.buildPlannerWaves).toHaveBeenCalledTimes(1);
    expect(plan.objective).toBe("Programa un reporte diario y dame un resumen final");
    expect(plan.waves).toHaveLength(2);
    expect(plan.waves[0]?.[0]?.id).toBe("step_1");
    expect(plan.strategy).toMatchObject({
      lane: "speed",
      model: "speed-model",
      agentId: "assistant",
    });
    expect(plan.skillContext?.activeSkill?.id).toBe("automation");
  });

  it("executes through the super planner and stores run history", async () => {
    const subtasks = await orchestrationEngine.decomposeTask(
      "Programa un reporte diario y dame un resumen final",
      4,
      { skillContext },
    );
    const plan = orchestrationEngine.buildExecutionPlan(subtasks, { skillContext });
    const result = await orchestrationEngine.executeParallel(plan);

    expect(mocks.executeGoal).toHaveBeenCalledTimes(1);
    const call = mocks.executeGoal.mock.calls[0];
    expect(call?.[0]).toBe("Programa un reporte diario y dame un resumen final");
    expect(call?.[1]?.plannerOutput?.subtasks).toHaveLength(2);
    expect(call?.[1]?.skillContext?.activeSkill?.id).toBe("automation");

    expect(result.completedTasks).toBe(2);
    expect(result.failedTasks).toBe(0);
    expect(result.planId).toBe("plan_123");
    expect(result.runId).toBeTruthy();
    expect(result.results.get("step_2")).toEqual({ summary: "ready" });

    const combined = orchestrationEngine.combineResults(result);
    expect(combined.strategy).toMatchObject({
      lane: "speed",
      agentId: "assistant",
    });

    const runs = orchestrationEngine.listRuns();
    expect(runs[0]?.runId).toBe(result.runId);
    expect(orchestrationEngine.getRun(result.runId!)).not.toBeNull();

    const reloaded = createOrchestrationEngine({
      storePath,
      deps: {
        decomposeGoal: mocks.decomposeGoal,
        buildPlannerWaves: mocks.buildPlannerWaves,
        executeGoal: mocks.executeGoal,
        resolvePrimaryModelForRole: mocks.resolvePrimaryModelForRole,
        agentManager: {
          getActiveAgent: mocks.getActiveAgent,
          getAgent: mocks.getAgent,
          getAgents: mocks.getAgents,
          recommendAgent: mocks.recommendAgent,
        },
        toolRegistry: {
          getToolById: mocks.getToolById,
          searchTools: mocks.searchTools,
          searchByCapability: mocks.searchByCapability,
        },
      },
    });

    expect(reloaded.getRun(result.runId!)).not.toBeNull();
    expect(reloaded.getStatus()).toMatchObject({
      storePath,
      persistRuns: true,
      runCount: 1,
    });
  });
});
