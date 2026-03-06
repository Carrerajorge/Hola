import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "crypto";
import {
  buildWaves as buildPlannerWaves,
  decompose as decomposeGoal,
  orchestrate as executeGoal,
  type OrchestratorResult,
  type PlannerOutput,
  type SubTask as PlannerSubTask,
} from "../agent/orchestrator/index.js";
import type { PlannerSkillContext } from "@shared/skills/skillOperationalCatalog";
import {
  resolvePrimaryLlmModelForRole,
  type AgentLlmRoleId,
} from "./agentControlPlane";
import { agentManager, type Agent } from "./agentManager";
import { toolRegistry, type ToolDefinition } from "./toolRegistry";

export type OrchestrationStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type OrchestrationLane = "brain" | "research" | "speed";
export type SubTaskKind = "task" | "aggregate" | "research" | "code" | "automation";
export type SubTaskExecutionMode = "tool" | "agent";

export interface SubTaskToolCandidate {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  score: number;
}

export interface OrchestrationSubtask {
  id: string;
  description: string;
  toolId: string | null;
  dependencies: string[];
  priority: number;
  status: OrchestrationStatus;
  kind?: SubTaskKind;
  lane?: OrchestrationLane;
  agentId?: string | null;
  agentName?: string | null;
  model?: string;
  executionMode?: SubTaskExecutionMode;
  toolHint?: string;
  toolCandidates?: SubTaskToolCandidate[];
  capabilities?: string[];
  reasoning?: string;
  estimatedDurationMs?: number;
  alternateStrategy?: string;
  args?: Record<string, unknown>;
  sourceObjective?: string;
  sourceComplexity?: number;
  sourceComplexityLabel?: "simple" | "medium" | "complex";
  plannerReasoning?: string;
  retryCount?: number;
  maxRetries?: number;
  result?: unknown;
  error?: string;
}

export interface OrchestrationStrategy {
  lane?: OrchestrationLane;
  model?: string;
  agentId?: string | null;
  agentName?: string | null;
  executionMode?: SubTaskExecutionMode;
  toolId?: string | null;
}

export interface OrchestrationPlan {
  planId?: string;
  objective: string;
  waves: OrchestrationSubtask[][];
  totalEstimatedTime: number;
  maxParallelism: number;
  createdAtMs?: number;
  plannerReasoning?: string;
  strategy?: OrchestrationStrategy;
  subtasks?: OrchestrationSubtask[];
  skillContext?: PlannerSkillContext | null;
}

export interface OrchestrationExecutionResult {
  success: boolean;
  completedTasks: number;
  failedTasks: number;
  results: Map<string, unknown>;
  errors: Map<string, string>;
  executionTimeMs: number;
  runId?: string;
  planId?: string;
  status?: "completed" | "partial" | "failed";
  objective?: string;
  strategy?: OrchestrationStrategy;
  timeline?: Array<{ ts: number; event: string; detail: string }>;
  artifacts?: {
    workspacePath: string;
    files: string[];
  };
  subtasks?: OrchestrationSubtask[];
}

export interface CombinedOrchestrationResult {
  success: boolean;
  runId?: string;
  planId?: string;
  status?: "completed" | "partial" | "failed";
  strategy?: OrchestrationStrategy;
  summary: {
    completed: number;
    failed: number;
    executionTime: string;
    status?: "completed" | "partial" | "failed";
  };
  results: Record<string, unknown>;
  errors: Record<string, string>;
  timeline?: Array<{ ts: number; event: string; detail: string }>;
  artifacts?: {
    workspacePath: string;
    files: string[];
  };
}

export interface OrchestrationRunRecord {
  runId: string;
  planId?: string;
  objective: string;
  createdAtMs: number;
  completedAtMs?: number;
  status: "completed" | "partial" | "failed";
  success: boolean;
  completedTasks: number;
  failedTasks: number;
  executionTimeMs: number;
  strategy?: OrchestrationStrategy;
  result: CombinedOrchestrationResult;
  plan?: OrchestrationPlan;
  timeline?: Array<{ ts: number; event: string; detail: string }>;
  artifacts?: {
    workspacePath: string;
    files: string[];
  };
  subtasks?: OrchestrationSubtask[];
}

type OrchestrationEngineStoreFile = {
  version: 1;
  updatedAt: string;
  runs: OrchestrationRunRecord[];
};

export type OrchestrationEngineStatus = {
  storePath: string;
  persistRuns: boolean;
  runCount: number;
  maxRunHistory: number;
  lastRunAtMs: number | null;
};

type AgentManagerDeps = Pick<
  typeof agentManager,
  "getActiveAgent" | "getAgent" | "getAgents" | "recommendAgent"
>;

type ToolRegistryDeps = Pick<
  typeof toolRegistry,
  "getToolById" | "searchTools" | "searchByCapability"
>;

export interface OrchestrationEngineDependencies {
  decomposeGoal: (
    objective: string,
    options?: {
      skillContext?: PlannerSkillContext | null;
    },
  ) => Promise<PlannerOutput>;
  buildPlannerWaves: (subtasks: PlannerSubTask[]) => string[][];
  executeGoal: (
    objective: string,
    options: {
      runId: string;
      plannerOutput?: PlannerOutput;
      skillContext?: PlannerSkillContext | null;
    },
  ) => Promise<OrchestratorResult>;
  resolvePrimaryModelForRole: (role: AgentLlmRoleId) => string;
  agentManager: AgentManagerDeps;
  toolRegistry: ToolRegistryDeps;
}

const DEFAULT_DEPENDENCIES: OrchestrationEngineDependencies = {
  decomposeGoal,
  buildPlannerWaves,
  executeGoal,
  resolvePrimaryModelForRole: resolvePrimaryLlmModelForRole,
  agentManager,
  toolRegistry,
};

const RESEARCH_TOOL_HINTS = new Set([
  "web_search",
  "fetch_url",
  "academic_search",
  "academic_export",
  "scopus_search",
  "format_citations",
]);

const SPEED_TOOL_HINTS = new Set([
  "schedule_task",
  "workflow_manage",
  "workflow_execute",
  "scaffold_project",
  "generate_code",
  "write_file",
  "write_multiple_files",
  "read_file",
  "list_files",
  "shell_exec",
  "create_document",
  "create_presentation",
  "create_spreadsheet",
  "analyze_data",
]);

const TOOL_TOKEN_SPLIT_REGEX = /[^a-z0-9]+/i;
const MAX_RUN_HISTORY = 100;

type CreateOrchestrationEngineOptions = {
  deps?: Partial<OrchestrationEngineDependencies>;
  storePath?: string;
  persistRuns?: boolean;
  maxRunHistory?: number;
};

function normalizeObjective(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveOrchestrationStorePath(storePath?: string): string {
  if (typeof storePath === "string" && storePath.trim().length > 0) {
    return path.resolve(storePath.trim());
  }
  if (process.env.OPENCLAW_ORCHESTRATION_STORE_PATH?.trim()) {
    return path.resolve(process.env.OPENCLAW_ORCHESTRATION_STORE_PATH.trim());
  }
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "hola-openclaw", "orchestration-runs.json");
  }
  return path.resolve(process.cwd(), "output", "openclaw", "orchestration-runs.json");
}

function isCreateOptions(
  value: Partial<OrchestrationEngineDependencies> | CreateOrchestrationEngineOptions | undefined,
): value is CreateOrchestrationEngineOptions {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "deps" in value || "storePath" in value || "persistRuns" in value || "maxRunHistory" in value;
}

function mapPlannerPriority(priority: PlannerSubTask["priority"]): number {
  switch (priority) {
    case "critical":
      return 1;
    case "high":
      return 2;
    default:
      return 3;
  }
}

function toPlannerPriority(priority: number): PlannerSubTask["priority"] {
  if (priority <= 1) return "critical";
  if (priority === 2) return "high";
  return "normal";
}

function estimateDurationMs(complexity: PlannerSubTask["estimatedComplexity"]): number {
  switch (complexity) {
    case "simple":
      return 15_000;
    case "complex":
      return 120_000;
    default:
      return 45_000;
  }
}

function toPlannerComplexity(
  task: Pick<OrchestrationSubtask, "sourceComplexityLabel" | "estimatedDurationMs">,
): PlannerSubTask["estimatedComplexity"] {
  if (task.sourceComplexityLabel) return task.sourceComplexityLabel;
  if ((task.estimatedDurationMs ?? 0) >= 100_000) return "complex";
  if ((task.estimatedDurationMs ?? 0) >= 30_000) return "medium";
  return "simple";
}

function inferLane(task: Pick<PlannerSubTask, "description" | "toolHint">): OrchestrationLane {
  const normalizedDescription = task.description.toLowerCase();
  const normalizedToolHint = task.toolHint.toLowerCase();

  if (normalizedToolHint === "synthesize") return "brain";
  if (RESEARCH_TOOL_HINTS.has(normalizedToolHint)) return "research";
  if (SPEED_TOOL_HINTS.has(normalizedToolHint)) return "speed";

  if (/\b(search|research|investiga|buscar|fuente|citations?|paper|articulo|artículo|scopus)\b/i.test(normalizedDescription)) {
    return "research";
  }
  if (/\b(summary|summarize|synthesize|consolidar|resumen|analiza hallazgos)\b/i.test(normalizedDescription)) {
    return "brain";
  }

  return "speed";
}

function inferKind(
  lane: OrchestrationLane,
  task: Pick<PlannerSubTask, "toolHint">,
): SubTaskKind {
  if (task.toolHint === "synthesize") return "aggregate";
  if (lane === "research") return "research";
  if (/\b(schedule|workflow)\b/i.test(task.toolHint)) return "automation";
  if (/\b(code|file|shell|scaffold)\b/i.test(task.toolHint)) return "code";
  return "task";
}

function buildModelForLane(
  lane: OrchestrationLane,
  deps: OrchestrationEngineDependencies,
): string {
  const role: AgentLlmRoleId = lane === "brain" ? "brain" : lane === "research" ? "research" : "speed";
  return deps.resolvePrimaryModelForRole(role);
}

function mapAutonomyAgentToManagerAgent(
  task: Pick<PlannerSubTask, "description" | "toolHint">,
  lane: OrchestrationLane,
  deps: OrchestrationEngineDependencies,
): Agent | null {
  const { agentManager: manager } = deps;

  const directMatch =
    (lane === "research" ? manager.getAgent("researcher") : null) ??
    manager.recommendAgent(task.description) ??
    manager.getActiveAgent() ??
    manager.getAgent("assistant") ??
    manager.getAgents()[0] ??
    null;

  return directMatch;
}

function buildToolCandidate(tool: ToolDefinition, score: number): SubTaskToolCandidate {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    capabilities: [...tool.capabilities],
    score,
  };
}

function resolveToolCandidates(
  task: Pick<PlannerSubTask, "description" | "toolHint">,
  deps: OrchestrationEngineDependencies,
): SubTaskToolCandidate[] {
  if (!task.toolHint || task.toolHint === "synthesize") {
    return [];
  }

  const deduped = new Map<string, SubTaskToolCandidate>();
  const push = (tool: ToolDefinition | undefined, score: number) => {
    if (!tool) return;
    const candidate = buildToolCandidate(tool, score);
    const existing = deduped.get(tool.id);
    if (!existing || existing.score < score) {
      deduped.set(tool.id, candidate);
    }
  };

  push(deps.toolRegistry.getToolById(task.toolHint), 1);

  for (const tool of deps.toolRegistry.searchTools(task.toolHint)) {
    push(tool, tool.id === task.toolHint ? 1 : 0.9);
  }

  const tokens = new Set<string>(
    `${task.toolHint} ${task.description}`
      .toLowerCase()
      .split(TOOL_TOKEN_SPLIT_REGEX)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );

  for (const token of tokens) {
    for (const tool of deps.toolRegistry.searchByCapability(token)) {
      push(tool, tool.id === task.toolHint ? 1 : 0.8);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.id.localeCompare(right.id);
  });
}

function mapPlannerTaskToServiceTask(
  task: PlannerSubTask,
  objective: string,
  complexity: number,
  plannerReasoning: string,
  deps: OrchestrationEngineDependencies,
): OrchestrationSubtask {
  const lane = inferLane(task);
  const executionMode: SubTaskExecutionMode = task.toolHint === "synthesize" ? "agent" : "tool";
  const toolCandidates = resolveToolCandidates(task, deps);
  const agent = mapAutonomyAgentToManagerAgent(task, lane, deps);

  return {
    id: task.id,
    description: task.description,
    toolId:
      task.toolHint === "synthesize"
        ? null
        : deps.toolRegistry.getToolById(task.toolHint)?.id ?? toolCandidates[0]?.id ?? task.toolHint,
    dependencies: [...task.dependencies],
    priority: mapPlannerPriority(task.priority),
    status: "pending",
    kind: inferKind(lane, task),
    lane,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    model: buildModelForLane(lane, deps),
    executionMode,
    toolHint: task.toolHint,
    toolCandidates,
    capabilities: toolCandidates[0]?.capabilities ?? agent?.capabilities ?? [],
    reasoning: task.description,
    estimatedDurationMs: estimateDurationMs(task.estimatedComplexity),
    alternateStrategy: task.alternateStrategy,
    args: task.args ?? {},
    sourceObjective: objective,
    sourceComplexity: complexity,
    sourceComplexityLabel: task.estimatedComplexity,
    plannerReasoning,
  };
}

function mapPlannerOutputToSubtasks(
  plannerOutput: PlannerOutput,
  objective: string,
  complexity: number,
  deps: OrchestrationEngineDependencies,
): OrchestrationSubtask[] {
  return plannerOutput.subtasks.map((task) =>
    mapPlannerTaskToServiceTask(task, objective, complexity, plannerOutput.reasoning, deps),
  );
}

function toPlannerSubTask(task: OrchestrationSubtask): PlannerSubTask {
  return {
    id: task.id,
    description: task.description,
    toolHint: task.toolHint ?? task.toolId ?? "synthesize",
    args: task.args,
    dependencies: [...task.dependencies],
    priority: toPlannerPriority(task.priority),
    estimatedComplexity: toPlannerComplexity(task),
    alternateStrategy: task.alternateStrategy,
    status: task.status,
    retryCount: task.retryCount ?? 0,
    maxRetries: task.maxRetries ?? 2,
    result: task.result,
    error: task.error,
  };
}

function buildStrategy(subtasks: OrchestrationSubtask[]): OrchestrationStrategy | undefined {
  const primary =
    subtasks.find((task) => task.executionMode === "tool") ??
    subtasks.find((task) => task.executionMode === "agent") ??
    subtasks[0];

  if (!primary) return undefined;
  return {
    lane: primary.lane,
    model: primary.model,
    agentId: primary.agentId,
    agentName: primary.agentName,
    executionMode: primary.executionMode,
    toolId: primary.toolId,
  };
}

function estimateWaveDurationMs(wave: OrchestrationSubtask[]): number {
  if (wave.length === 0) return 0;
  return Math.max(...wave.map((task) => task.estimatedDurationMs ?? 30_000));
}

function buildPlannerOutputFromPlan(plan: OrchestrationPlan): PlannerOutput {
  const subtasks = (plan.subtasks ?? []).map((task) => ({
    id: task.id,
    description: task.description,
    toolHint: task.toolHint ?? task.toolId ?? "synthesize",
    args: task.args,
    dependencies: [...task.dependencies],
    priority: toPlannerPriority(task.priority),
    estimatedComplexity: toPlannerComplexity(task),
    alternateStrategy: task.alternateStrategy,
  }));

  return {
    subtasks,
    reasoning: plan.plannerReasoning ?? plan.subtasks?.[0]?.plannerReasoning ?? "",
  };
}

function mapExecutionSubtasks(
  baseSubtasks: OrchestrationSubtask[],
  executedSubtasks: OrchestratorResult["subtasks"],
): OrchestrationSubtask[] {
  const baseById = new Map(baseSubtasks.map((task) => [task.id, task]));

  if (!executedSubtasks || executedSubtasks.length === 0) {
    return baseSubtasks;
  }

  return executedSubtasks.map((task) => {
    const base = baseById.get(task.id);
    return {
      ...(base ?? {
        id: task.id,
        description: task.description,
        toolId: task.toolHint === "synthesize" ? null : task.toolHint,
        dependencies: [...task.dependencies],
        priority: mapPlannerPriority(task.priority),
        status: task.status,
      }),
      status: task.status,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      result: task.result,
      error: task.error,
    };
  });
}

export class OrchestrationEngineService {
  private readonly deps: OrchestrationEngineDependencies;
  private readonly storePath: string;
  private readonly persistRuns: boolean;
  private readonly maxRunHistory: number;
  private readonly runs: OrchestrationRunRecord[] = [];

  constructor(
    input: Partial<OrchestrationEngineDependencies> | CreateOrchestrationEngineOptions = {},
  ) {
    const options = isCreateOptions(input) ? input : { deps: input };
    const deps = options.deps ?? {};
    this.deps = {
      ...DEFAULT_DEPENDENCIES,
      ...deps,
      agentManager: {
        ...DEFAULT_DEPENDENCIES.agentManager,
        ...(deps.agentManager ?? {}),
      },
      toolRegistry: {
        ...DEFAULT_DEPENDENCIES.toolRegistry,
        ...(deps.toolRegistry ?? {}),
      },
    };
    this.storePath = resolveOrchestrationStorePath(options.storePath);
    this.persistRuns = options.persistRuns ?? true;
    this.maxRunHistory = Math.max(1, Math.min(500, Math.floor(options.maxRunHistory ?? MAX_RUN_HISTORY)));
    this.loadRunsFromDisk();
  }

  private loadRunsFromDisk(): void {
    if (!this.persistRuns) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<OrchestrationEngineStoreFile>;
      if (!parsed || !Array.isArray(parsed.runs)) {
        return;
      }
      this.runs.splice(0, this.runs.length, ...parsed.runs.slice(0, this.maxRunHistory));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        console.warn(
          `[OrchestrationEngine] Failed to load persisted runs from ${this.storePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private persistRunsToDisk(): void {
    if (!this.persistRuns) {
      return;
    }
    try {
      const payload: OrchestrationEngineStoreFile = {
        version: 1,
        updatedAt: new Date().toISOString(),
        runs: this.runs.slice(0, this.maxRunHistory),
      };
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const tmpPath = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(tmpPath, this.storePath);
    } catch (error) {
      console.warn(
        `[OrchestrationEngine] Failed to persist runs to ${this.storePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async decomposeTask(
    objective: string,
    complexity = 3,
    options?: {
      skillContext?: PlannerSkillContext | null;
    },
  ): Promise<OrchestrationSubtask[]> {
    const normalizedObjective = normalizeObjective(objective);
    if (!normalizedObjective) return [];

    const boundedComplexity = Math.max(1, Math.min(10, Math.round(complexity || 3)));
    const plannerOutput = await this.deps.decomposeGoal(normalizedObjective, {
      skillContext: options?.skillContext,
    });
    return mapPlannerOutputToSubtasks(
      plannerOutput,
      normalizedObjective,
      boundedComplexity,
      this.deps,
    );
  }

  buildExecutionPlan(
    subtasks: OrchestrationSubtask[],
    options?: {
      skillContext?: PlannerSkillContext | null;
    },
  ): OrchestrationPlan {
    const plannerTasks = subtasks.map((task) => toPlannerSubTask(task));
    const wavesById = this.deps.buildPlannerWaves(plannerTasks);
    const taskById = new Map(subtasks.map((task) => [task.id, task]));
    const waves = wavesById.map((wave) =>
      wave.map((taskId) => taskById.get(taskId)).filter((task): task is OrchestrationSubtask => Boolean(task)),
    );

    return {
      planId: `orch_plan_${randomUUID()}`,
      objective: subtasks[0]?.sourceObjective ?? "",
      waves,
      totalEstimatedTime: waves.reduce((sum, wave) => sum + estimateWaveDurationMs(wave), 0),
      maxParallelism: waves.reduce((max, wave) => Math.max(max, wave.length), 0),
      createdAtMs: Date.now(),
      plannerReasoning: subtasks[0]?.plannerReasoning,
      strategy: buildStrategy(subtasks),
      subtasks: [...subtasks],
      skillContext: options?.skillContext ?? null,
    };
  }

  async executeParallel(plan: OrchestrationPlan): Promise<OrchestrationExecutionResult> {
    const startedAtMs = Date.now();
    const runId = `orch_run_${randomUUID()}`;
    const objective = plan.objective || plan.subtasks?.[0]?.sourceObjective || "";
    const plannerOutput = buildPlannerOutputFromPlan(plan);

    const execution = await this.deps.executeGoal(objective, {
      runId,
      plannerOutput,
      skillContext: plan.skillContext,
    });

    const results = new Map<string, unknown>(Object.entries(execution.results || {}));
    const errors = new Map<string, string>(Object.entries(execution.errors || {}));
    const subtasks = mapExecutionSubtasks(plan.subtasks ?? [], execution.subtasks);
    const completedTasks =
      execution.stats?.completed ??
      subtasks.filter((task) => task.status === "completed").length;
    const failedTasks =
      execution.stats?.failed ??
      subtasks.filter((task) => task.status === "failed").length;
    const executionTimeMs =
      execution.stats?.totalDurationMs ?? Math.max(0, Date.now() - startedAtMs);
    const success = execution.status === "completed" && failedTasks === 0 && errors.size === 0;

    const adapted: OrchestrationExecutionResult = {
      runId,
      planId: execution.planId ?? plan.planId,
      status: execution.status,
      objective,
      strategy: plan.strategy,
      success,
      completedTasks,
      failedTasks,
      results,
      errors,
      executionTimeMs,
      timeline: execution.timeline,
      artifacts: execution.artifacts,
      subtasks,
    };

    const record: OrchestrationRunRecord = {
      runId,
      planId: adapted.planId,
      objective,
      createdAtMs: startedAtMs,
      completedAtMs: startedAtMs + executionTimeMs,
      status: adapted.status ?? (success ? "completed" : "failed"),
      success: adapted.success,
      completedTasks: adapted.completedTasks,
      failedTasks: adapted.failedTasks,
      executionTimeMs: adapted.executionTimeMs,
      strategy: adapted.strategy,
      result: this.combineResults(adapted),
      plan,
      timeline: adapted.timeline,
      artifacts: adapted.artifacts,
      subtasks: adapted.subtasks,
    };

    this.runs.unshift(record);
    if (this.runs.length > this.maxRunHistory) {
      this.runs.length = this.maxRunHistory;
    }
    this.persistRunsToDisk();

    return adapted;
  }

  combineResults(execution: OrchestrationExecutionResult): CombinedOrchestrationResult {
    return {
      success: execution.success,
      runId: execution.runId,
      planId: execution.planId,
      status: execution.status,
      strategy: execution.strategy,
      summary: {
        completed: execution.completedTasks,
        failed: execution.failedTasks,
        executionTime: `${execution.executionTimeMs}ms`,
        status: execution.status,
      },
      results: Object.fromEntries(execution.results.entries()),
      errors: Object.fromEntries(execution.errors.entries()),
      timeline: execution.timeline,
      artifacts: execution.artifacts,
    };
  }

  listRuns(limit = 20): OrchestrationRunRecord[] {
    const boundedLimit = Math.max(1, Math.min(this.maxRunHistory, Math.floor(limit || 20)));
    return this.runs.slice(0, boundedLimit);
  }

  getRun(runId: string): OrchestrationRunRecord | null {
    return this.runs.find((run) => run.runId === runId) ?? null;
  }

  getStatus(): OrchestrationEngineStatus {
    return {
      storePath: this.storePath,
      persistRuns: this.persistRuns,
      runCount: this.runs.length,
      maxRunHistory: this.maxRunHistory,
      lastRunAtMs: this.runs[0]?.completedAtMs ?? this.runs[0]?.createdAtMs ?? null,
    };
  }
}

export function createOrchestrationEngine(
  input: Partial<OrchestrationEngineDependencies> | CreateOrchestrationEngineOptions = {},
): OrchestrationEngineService {
  return new OrchestrationEngineService(input);
}

export const orchestrationEngine = createOrchestrationEngine();
