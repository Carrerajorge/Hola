import { Router, Request, Response, NextFunction } from "express"; import { AuthenticatedRequest } from "../types/express"; import { db } from "../db"; import {
  agentModeRuns, agentModeSteps,
  agentModeEvents
} from "@shared/schema"; import { agentManager, AgentPlan } from "../agent/agentOrchestrator"; import { agentEventBus } from "../agent/eventBus"; import {
  activityStreamPublisher,
  agentLoopFacade
} from "../agent/orchestration"; import { eq, desc, asc, and, gte, lt, count } from "drizzle-orm"; import { randomUUID } from "crypto"; import {
  CreateRunRequestSchema,
  RunResponseSchema, StepsArrayResponseSchema
} from "../agent/contracts"; import { validateOrThrow, ValidationError } from "../agent/validation"; import { checkIdempotency } from
  "../agent/idempotency"; import { updateRunWithLock } from "../agent/dbTransactions"; import { toolRegistry, TOOL_CATEGORIES } from "../agent/registry/toolRegistry"; import { ToolArtifact } from
  "../agent/toolRegistry"; import { agentRegistry } from "../agent/registry/agentRegistry"; import {
  DEFAULT_AGENT_EXECUTION_PROFILE,
  normalizeAgentExecutionProfile
} from "@shared/agentExecutionProfile"; import { getAgentExecutionProfileConfig } from "../agent/executionProfiles";



function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;

  // For local agent testing without full auth, bypass in development
  if (process.env.NODE_ENV !== "production") {
    // Inject mock user for DB relations that require userId
    if (!user) {
      (req as AuthenticatedRequest).user = { id: 1, claims: { sub: "1" } } as any;
    }
    return next();
  }

  if (!user) {
    return res.status(401).json({
      error: "Authentication required"
    });
  }
  next();
}

const AGENT_ROBUSTNESS_POLICY = {
  failureWarningPercent: 15,
  failureCriticalPercent: 30,
  alertFailureWarningPercent: 20,
  alertFailureCriticalPercent: 40,
  staleWarningCount: 1,
  staleCriticalCount: 3,
  minimumRunsForThroughputAlert: 10,
  minimumRunsForRunningCheck: 3,
  stepFailureSensitivityPercent: 15,
  maxHoursWindow: 168,
  minHoursWindow: 1,
  defaultHoursWindow: 24,
};

const VALID_RUN_STATUSES = new Set([
  "queued",
  "planning",
  "running",
  "verifying",
  "replanning",
  "awaiting_confirmation",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "paused",
  "compensated",
]);

const VALID_STEP_STATUSES = new Set([
  "pending",
  "running",
  "verifying",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
  "compensated",
]);

const VALID_PHASE_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
]);

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function getIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRobustnessPolicy() {
  return {
    failureWarningPercent: clampNumber(getIntEnv("AGENT_FAILURE_WARNING_PERCENT", AGENT_ROBUSTNESS_POLICY.failureWarningPercent), 0, 100, AGENT_ROBUSTNESS_POLICY.failureWarningPercent),
    failureCriticalPercent: clampNumber(getIntEnv("AGENT_FAILURE_CRITICAL_PERCENT", AGENT_ROBUSTNESS_POLICY.failureCriticalPercent), 0, 100, AGENT_ROBUSTNESS_POLICY.failureCriticalPercent),
    alertFailureWarningPercent: clampNumber(getIntEnv("AGENT_ALERT_FAILURE_WARNING_PERCENT", AGENT_ROBUSTNESS_POLICY.alertFailureWarningPercent), 0, 100, AGENT_ROBUSTNESS_POLICY.alertFailureWarningPercent),
    alertFailureCriticalPercent: clampNumber(getIntEnv("AGENT_ALERT_FAILURE_CRITICAL_PERCENT", AGENT_ROBUSTNESS_POLICY.alertFailureCriticalPercent), 0, 100, AGENT_ROBUSTNESS_POLICY.alertFailureCriticalPercent),
    staleWarningCount: Math.max(1, Math.floor(getIntEnv("AGENT_STALE_WARNING_COUNT", AGENT_ROBUSTNESS_POLICY.staleWarningCount))),
    staleCriticalCount: Math.max(1, Math.floor(getIntEnv("AGENT_STALE_CRITICAL_COUNT", AGENT_ROBUSTNESS_POLICY.staleCriticalCount))),
    minimumRunsForThroughputAlert: Math.max(1, Math.floor(getIntEnv("AGENT_THROUGHPUT_MIN_RUNS", AGENT_ROBUSTNESS_POLICY.minimumRunsForThroughputAlert))),
    minimumRunsForRunningCheck: Math.max(1, Math.floor(getIntEnv("AGENT_RUNNING_MIN_RUNS", AGENT_ROBUSTNESS_POLICY.minimumRunsForRunningCheck))),
    stepFailureSensitivityPercent: clampNumber(getIntEnv("AGENT_STEP_FAILURE_PERCENT", AGENT_ROBUSTNESS_POLICY.stepFailureSensitivityPercent), 0, 100, AGENT_ROBUSTNESS_POLICY.stepFailureSensitivityPercent),
    maxHoursWindow: Math.max(1, Math.floor(getIntEnv("AGENT_ROBUSTNESS_MAX_HOURS", AGENT_ROBUSTNESS_POLICY.maxHoursWindow))),
    minHoursWindow: Math.max(1, Math.floor(getIntEnv("AGENT_ROBUSTNESS_MIN_HOURS", AGENT_ROBUSTNESS_POLICY.minHoursWindow))),
    defaultHoursWindow: Math.max(1, Math.floor(getIntEnv("AGENT_ROBUSTNESS_DEFAULT_HOURS", AGENT_ROBUSTNESS_POLICY.defaultHoursWindow))),
  };
}



function toPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 10000) / 100;
}

function toIsoDateString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (value == null) {
    return fallback;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "null" ? serialized : fallback;
  } catch {
    return String(value);
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = normalizeText(value, "");
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  return undefined;
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  return undefined;
}

function normalizeRunStatus(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "queued";
  if (VALID_RUN_STATUSES.has(normalized)) return normalized;
  if (normalized === "executing" || normalized === "in_progress" || normalized === "retrying") return "running";
  if (normalized === "succeeded" || normalized === "success" || normalized === "done") return "completed";
  if (normalized === "error") return "failed";
  return "queued";
}

function normalizeStepStatus(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "pending";
  if (VALID_STEP_STATUSES.has(normalized)) return normalized;
  if (normalized === "queued" || normalized === "created") return "pending";
  if (normalized === "retrying" || normalized === "in_progress" || normalized === "processing") return "running";
  if (normalized === "completed" || normalized === "success" || normalized === "done") return "succeeded";
  if (normalized === "error") return "failed";
  return "pending";
}

function normalizeArtifactsForResponse(rawArtifacts: unknown): Array<{
  id: string;
  type: string;
  name: string;
  url?: string;
}> {
  if (!Array.isArray(rawArtifacts)) {
    return [];
  }

  return rawArtifacts.map((artifact, index) => {
    const record = artifact && typeof artifact === "object"
      ? artifact as Record<string, unknown>
      : {};

    const fallbackName =
      typeof artifact === "string" && artifact.trim().length > 0
        ? artifact.trim()
        : `artifact-${index + 1}`;

    const type = normalizeText(record.type ?? record.artifactType, "file");
    const name = normalizeText(record.name ?? record.filename ?? record.path ?? record.title, fallbackName);
    const url = normalizeOptionalText(record.url ?? record.href) ?? undefined;

    return {
      id: normalizeText(record.id, randomUUID()),
      type,
      name,
      ...(url ? { url } : {}),
    };
  });
}

function normalizeWorkspaceFilesForResponse(rawWorkspaceFiles: unknown): Record<string, string> | undefined {
  if (!rawWorkspaceFiles || typeof rawWorkspaceFiles !== "object" || Array.isArray(rawWorkspaceFiles)) {
    return undefined;
  }

  const entries = Object.entries(rawWorkspaceFiles as Record<string, unknown>);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [key, normalizeText(value, "")]),
  );
}

function normalizeStepsForResponse(rawSteps: unknown) {
  if (!Array.isArray(rawSteps)) {
    return [];
  }

  return rawSteps.map((step, index) => {
    const record = step && typeof step === "object"
      ? step as Record<string, unknown>
      : {};

    return {
      stepIndex:
        typeof record.stepIndex === "number" && Number.isFinite(record.stepIndex) && record.stepIndex >= 0
          ? record.stepIndex
          : index,
      toolName: normalizeText(record.toolName, "unknown"),
      description:
        typeof record.description === "string" && record.description.trim().length > 0
          ? record.description
          : null,
      status: normalizeStepStatus(record.status),
      output: record.output ?? null,
      error: normalizeOptionalText(record.error),
      startedAt: toIsoDateString(record.startedAt) ?? null,
      completedAt: toIsoDateString(record.completedAt) ?? null,
    };
  });
}

function finalizeRunResponse(rawResponse: Record<string, any>, contextLabel: string) {
  const normalized = {
    id: normalizeText(rawResponse.id, randomUUID()),
    chatId: normalizeText(rawResponse.chatId, ""),
    status: normalizeRunStatus(rawResponse.status),
    executionProfile: normalizeAgentExecutionProfile(rawResponse.executionProfile),
    plan: rawResponse.plan ?? null,
    steps: normalizeStepsForResponse(rawResponse.steps),
    artifacts: normalizeArtifactsForResponse(rawResponse.artifacts),
    summary: normalizeOptionalText(rawResponse.summary),
    error: normalizeOptionalText(rawResponse.error),
    eventStream: Array.isArray(rawResponse.eventStream) ? rawResponse.eventStream : undefined,
    todoList: Array.isArray(rawResponse.todoList) ? rawResponse.todoList : undefined,
    workspaceFiles: normalizeWorkspaceFilesForResponse(rawResponse.workspaceFiles),
    currentStepIndex:
      typeof rawResponse.currentStepIndex === "number" && Number.isFinite(rawResponse.currentStepIndex)
        ? rawResponse.currentStepIndex
        : 0,
    totalSteps:
      typeof rawResponse.totalSteps === "number" && Number.isFinite(rawResponse.totalSteps)
        ? rawResponse.totalSteps
        : Array.isArray(rawResponse.steps) ? rawResponse.steps.length : 0,
    completedSteps:
      typeof rawResponse.completedSteps === "number" && Number.isFinite(rawResponse.completedSteps)
        ? rawResponse.completedSteps
        : 0,
    runtimeBudgetMs: normalizeOptionalPositiveNumber(rawResponse.runtimeBudgetMs),
    runtimeRemainingMs: normalizeOptionalNonNegativeNumber(rawResponse.runtimeRemainingMs),
    startedAt: toIsoDateString(rawResponse.startedAt),
    completedAt: toIsoDateString(rawResponse.completedAt),
    createdAt: toIsoDateString(rawResponse.createdAt) || new Date().toISOString(),
  };

  const parsed = RunResponseSchema.safeParse(normalized);
  if (parsed.success) {
    return parsed.data;
  }

  console.warn(`[AgentRoutes] Run response validation failed for ${contextLabel}:`, parsed.error.flatten());

  const degraded = {
    ...normalized,
    plan: null,
    eventStream: undefined,
    todoList: undefined,
    workspaceFiles: undefined,
  };

  const reparsed = RunResponseSchema.safeParse(degraded);
  if (reparsed.success) {
    return reparsed.data;
  }

  console.error(`[AgentRoutes] Fallback run response validation failed for ${contextLabel}:`, reparsed.error.flatten());

  return {
    id: degraded.id,
    chatId: degraded.chatId,
    status: degraded.status,
    executionProfile: degraded.executionProfile,
    plan: null,
    steps: degraded.steps,
    artifacts: degraded.artifacts,
    summary: degraded.summary,
    error: degraded.error,
    currentStepIndex: degraded.currentStepIndex,
    totalSteps: degraded.totalSteps,
    completedSteps: degraded.completedSteps,
    ...(degraded.runtimeBudgetMs !== undefined ? { runtimeBudgetMs: degraded.runtimeBudgetMs } : {}),
    ...(degraded.runtimeRemainingMs !== undefined ? { runtimeRemainingMs: degraded.runtimeRemainingMs } : {}),
    ...(degraded.startedAt ? { startedAt: degraded.startedAt } : {}),
    ...(degraded.completedAt ? { completedAt: degraded.completedAt } : {}),
    createdAt: degraded.createdAt,
  };
}

function normalizeRunPlanForResponse(
  rawPlan: unknown,
  runCreatedAt: Date,
  totalStepsFallback: number,
): AgentPlan | null {
  if (!rawPlan || typeof rawPlan !== "object") {
    return null;
  }

  const plan = rawPlan as Partial<AgentPlan> & {
    objective?: string;
    reasoning?: string | null;
    steps?: Array<Record<string, unknown>>;
    phases?: Array<Record<string, unknown>>;
    currentPhaseIndex?: number | null;
    estimatedTimeMs?: number | null;
    createdAt?: Date | string | null;
  };

  const normalizedSteps = (Array.isArray(plan.steps) ? plan.steps : [])
    .slice(0, 64)
    .map((step, index) => {
      const record = step && typeof step === "object"
        ? step as Record<string, unknown>
        : {};

      const dependencies = Array.isArray(record.dependencies)
        ? record.dependencies
          .map((dependency) => Number(dependency))
          .filter((dependency) => Number.isInteger(dependency) && dependency >= 0)
        : [];

      const timeoutMs = Number(record.timeoutMs);

      return {
        index:
          typeof record.index === "number" && Number.isFinite(record.index) && record.index >= 0
            ? record.index
            : index,
        toolName: normalizeText(record.toolName, "unknown"),
        description: normalizeText(record.description, `Paso ${index + 1}`),
        input: record.input && typeof record.input === "object" && !Array.isArray(record.input)
          ? record.input as Record<string, unknown>
          : {},
        expectedOutput: normalizeText(record.expectedOutput, "Task completion"),
        dependencies,
        optional: Boolean(record.optional),
        ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs: Math.round(timeoutMs) } : {}),
        ...(typeof record.phaseId === "string" && record.phaseId.trim().length > 0 ? { phaseId: record.phaseId.trim() } : {}),
      };
    });

  if (normalizedSteps.length === 0) {
    return null;
  }

  const normalizedPhases = Array.isArray(plan.phases)
    ? plan.phases.map((phase, index) => {
      const record = phase && typeof phase === "object"
        ? phase as Record<string, unknown>
        : {};
      const stepIndices = Array.isArray(record.stepIndices)
        ? record.stepIndices
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0)
        : [];
      const status = String(record.status ?? "").trim().toLowerCase();

      return {
        id: normalizeText(record.id, `phase-${index + 1}`),
        name: normalizeText(record.name, `Fase ${index + 1}`),
        ...(typeof record.description === "string" && record.description.trim().length > 0
          ? { description: record.description.trim() }
          : {}),
        status: VALID_PHASE_STATUSES.has(status) ? status : "pending",
        stepIndices,
      };
    })
    : undefined;

  const estimatedTimeMs =
    typeof plan.estimatedTimeMs === "number" && Number.isFinite(plan.estimatedTimeMs) && plan.estimatedTimeMs > 0
      ? Math.round(plan.estimatedTimeMs)
      : Math.max(normalizedSteps.length, totalStepsFallback, 1) * 15_000;

  const createdAt =
    plan.createdAt instanceof Date
      ? plan.createdAt
      : typeof plan.createdAt === "string" && plan.createdAt.trim().length > 0
        ? new Date(plan.createdAt)
        : runCreatedAt;

  return {
    objective: typeof plan.objective === "string" && plan.objective.trim().length > 0
      ? plan.objective
      : "Completar la tarea solicitada",
    steps: normalizedSteps as AgentPlan["steps"],
    phases: normalizedPhases as AgentPlan["phases"] | undefined,
    currentPhaseIndex:
      typeof plan.currentPhaseIndex === "number" && Number.isFinite(plan.currentPhaseIndex)
        ? plan.currentPhaseIndex
        : undefined,
    estimatedTimeMs,
    reasoning: typeof plan.reasoning === "string" ? plan.reasoning : undefined,
    createdAt: Number.isNaN(createdAt.getTime()) ? runCreatedAt : createdAt,
  };
}

export function createAgentModeRouter() {
  const router = Router();

  router.post("/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const validatedBody = validateOrThrow(CreateRunRequestSchema, req.body, "POST /runs request body");
      const { chatId, messageId, message, model, attachments, executionProfile, idempotencyKey } = validatedBody;
      const user = (req as AuthenticatedRequest).user;
      const userId = user?.claims?.sub || user?.id;
      const userPlan = ((user as any)?.plan === "pro" || (user as any)?.plan === "admin") ? (user as any).plan : "free" as "free" | "pro" | "admin";
      const normalizedExecutionProfile = normalizeAgentExecutionProfile(executionProfile);
      const executionProfileConfig = getAgentExecutionProfileConfig(normalizedExecutionProfile);

      if (idempotencyKey) {
        const idempotencyResult = await checkIdempotency(idempotencyKey, chatId);
        if (idempotencyResult.isDuplicate) {
          return res.status(200).json({
            id: idempotencyResult.existingRunId,
            runId: idempotencyResult.existingRunId,
            status: idempotencyResult.existingStatus,
            duplicate: true,
          });
        }
      }

      const runId = randomUUID();

      const [newRun] = await db.insert(agentModeRuns).values({
        id: runId,
        chatId,
        messageId: messageId || null,
        userId: userId || null,
        status: "queued",
        executionProfile: normalizedExecutionProfile,
        plan: null,
        artifacts: null,
        summary: null,
        error: null,
        totalSteps: 0,
        completedSteps: 0,
        currentStepIndex: 0,
        startedAt: null,
        completedAt: null,
        idempotencyKey: idempotencyKey || null,
      }).returning();

      (async () => {
        let currentStatus = "queued";
        try {
          const lockResult = await updateRunWithLock(runId, "queued", {
            status: "planning",
            startedAt: new Date()
          });
          if (!lockResult.success) {
            console.warn(`[AgentRoutes] Failed to transition run ${runId} to planning: ${lockResult.error}`);
            return;
          }
          currentStatus = "planning";

          const orchestrator = await agentManager.startRun(
            runId,
            chatId,
            userId || "anonymous",
            message,
            attachments,
            userPlan,
            model,
            normalizedExecutionProfile,
          );

          orchestrator.on("progress", async (progress) => {
            try {
              const newStatus = progress.status === "executing" ? "running" : progress.status;
              const updateData: Record<string, any> = {
                status: newStatus,
                currentStepIndex: progress.currentStepIndex,
                totalSteps: progress.totalSteps,
                // Count finished steps, not just successes (failed steps are also "completed" from a progress POV).
                completedSteps: progress.stepResults.length,
              };

              if (progress.plan) {
                updateData.plan = progress.plan;
              }

              if (progress.artifacts && progress.artifacts.length > 0) {
                updateData.artifacts = progress.artifacts;
              }

              if (progress.status === "completed") {
                updateData.status = "completed";
                updateData.completedAt = new Date();

                const summary = await orchestrator.generateSummary();
                updateData.summary = summary;
              }

              if (progress.status === "failed") {
                updateData.completedAt = new Date();
                updateData.error = progress.error || "Unknown error";
              }

              if (progress.status === "cancelled") {
                updateData.completedAt = new Date();
              }

              const lockResult = await updateRunWithLock(runId, currentStatus, updateData);
              if (lockResult.success) {
                currentStatus = newStatus;
              } else {
                console.warn(`[AgentRoutes] Optimistic lock failed for run ${runId}: ${lockResult.error}`);
              }

              for (const stepResult of progress.stepResults) {
                const existingStep = await db.select()
                  .from(agentModeSteps)
                  .where(eq(agentModeSteps.runId, runId))
                  .then(steps => steps.find(s => s.stepIndex === stepResult.stepIndex));

                if (!existingStep) {
                  await db.insert(agentModeSteps).values({
                    runId,
                    stepIndex: stepResult.stepIndex,
                    toolName: stepResult.toolName,
                    toolInput: progress.plan?.steps[stepResult.stepIndex]?.input || null,
                    toolOutput: stepResult.output,
                    status: stepResult.success ? "succeeded" : "failed",
                    error: stepResult.error || null,
                    startedAt: new Date(stepResult.startedAt),
                    completedAt: new Date(stepResult.completedAt),
                  });
                } else {
                  await db.update(agentModeSteps)
                    .set({
                      toolOutput: stepResult.output,
                      status: stepResult.success ? "succeeded" : "failed",
                      error: stepResult.error || null,
                      completedAt: new Date(stepResult.completedAt),
                    })
                    .where(eq(agentModeSteps.id, existingStep.id));
                }
              }
            } catch (err) {
              console.error(`[AgentRoutes] Error updating run ${runId} progress:`, err);
            }
          });

        } catch (err: any) {
          console.error(`[AgentRoutes] Error starting run ${runId}:`, err);
          await updateRunWithLock(runId, currentStatus, {
            status: "failed",
            error: err.message || "Failed to start agent run",
            completedAt: new Date(),
          });
        }
      })();

      const createResponse = {
        id: newRun.id,
        chatId: newRun.chatId,
        status: "queued",
        executionProfile: normalizedExecutionProfile,
        currentStepIndex: 0,
        totalSteps: 0,
        completedSteps: 0,
        runtimeBudgetMs: executionProfileConfig.maxRunDurationMs,
        runtimeRemainingMs: executionProfileConfig.maxRunDurationMs,
        steps: [],
        artifacts: [],
        plan: null,
        summary: undefined,
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        createdAt: newRun.createdAt.toISOString(),
      };

      const validatedResponse = validateOrThrow(RunResponseSchema, createResponse, "POST /runs response");
      res.status(201).json(validatedResponse);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: "Validation failed",
          details: error.zodError.errors
        });
      }
      console.error("[AgentRoutes] Error creating run:", error);
      res.status(500).json({ error: "Failed to create agent run" });
    }
  });

  router.get("/runs/chat/:chatId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { chatId } = req.params;

      const runs = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.chatId, chatId))
        .orderBy(desc(agentModeRuns.createdAt))
        .limit(1);

      const run = runs[0];
      if (!run) {
        return res.status(404).json({ error: "Run not found for chat", code: "RUN_NOT_FOUND" });
      }

      let effectiveRun = run;

      const ageMs = Date.now() - run.createdAt.getTime();
      if (run.status === "planning" && !run.startedAt && ageMs > 5_000) {
        await db.update(agentModeRuns)
          .set({
            status: "failed",
            error: "Run stalled in planning (no startedAt)",
            completedAt: new Date(),
          })
          .where(eq(agentModeRuns.id, run.id));

        // Re-fetch the updated run (simple + consistent)
        const [updatedRun] = await db.select().from(agentModeRuns).where(eq(agentModeRuns.id, run.id));
        if (updatedRun) effectiveRun = updatedRun;
      }

      const steps = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, run.id))
        .orderBy(agentModeSteps.stepIndex);
      const executionProfile = normalizeAgentExecutionProfile((effectiveRun as any).executionProfile);
      const executionProfileConfig = getAgentExecutionProfileConfig(executionProfile);
      const runtimeRemainingMs = effectiveRun.startedAt
        ? Math.max(0, executionProfileConfig.maxRunDurationMs - (Date.now() - effectiveRun.startedAt.getTime()))
        : executionProfileConfig.maxRunDurationMs;

      const planSteps = (effectiveRun.plan as AgentPlan)?.steps || [];

      const mergedSteps = planSteps.map((planStep: any, index: number) => {
        const dbStep = steps.find(s => s.stepIndex === index);
        if (dbStep) {
          return {
            stepIndex: dbStep.stepIndex,
            toolName: dbStep.toolName,
            description: planStep.description,
            status: dbStep.status,
            output: dbStep.toolOutput,
            error: dbStep.error,
            startedAt: dbStep.startedAt,
            completedAt: dbStep.completedAt,
          };
        }
        const cur = effectiveRun.currentStepIndex || 0;
        return {
          stepIndex: index,
          toolName: planStep.toolName,
          description: planStep.description,
          status: index < cur ? "pending" : (index === cur && effectiveRun.status === "running" ? "running" : "pending"),
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
        };
      });

      const response: any = {
        id: effectiveRun.id,
        chatId: effectiveRun.chatId,
        status: effectiveRun.status,
        executionProfile,
        plan: normalizeRunPlanForResponse(
          effectiveRun.plan,
          effectiveRun.createdAt,
          effectiveRun.totalSteps ?? planSteps.length,
        ),
        currentStepIndex: effectiveRun.currentStepIndex ?? 0,
        totalSteps: effectiveRun.totalSteps ?? planSteps.length,
        completedSteps: effectiveRun.completedSteps ?? 0,
        runtimeBudgetMs: executionProfileConfig.maxRunDurationMs,
        runtimeRemainingMs,
        steps: mergedSteps.length > 0 ? mergedSteps : steps.map(s => ({
          stepIndex: s.stepIndex,
          toolName: s.toolName,
          description: null,
          status: s.status,
          output: s.toolOutput,
          error: s.error,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        })),
        artifacts: (effectiveRun.artifacts as ToolArtifact[]) || [],
        summary: effectiveRun.summary ?? "",
        error: effectiveRun.error ?? "",
        startedAt: effectiveRun.startedAt?.toISOString(),
        completedAt: effectiveRun.completedAt?.toISOString(),
        createdAt: effectiveRun.createdAt.toISOString(),
      };

      // If this run is still active in-memory, include richer debug fields for the AgentPanel tabs.
      const activeOrchestrator = agentManager.getOrchestrator(effectiveRun.id);
      if (activeOrchestrator) {
        response.eventStream = activeOrchestrator.getEventStream?.() || [];
        response.todoList = activeOrchestrator.getTodoList?.() || [];
        response.workspaceFiles = activeOrchestrator.getWorkspaceFiles
          ? Object.fromEntries(activeOrchestrator.getWorkspaceFiles())
          : {};
        response.executionProfile = activeOrchestrator.getExecutionProfile?.() || executionProfile;
        response.runtimeBudgetMs = activeOrchestrator.getRuntimeBudgetMs?.() || executionProfileConfig.maxRunDurationMs;
        response.runtimeRemainingMs = activeOrchestrator.getRuntimeRemainingMs?.() || runtimeRemainingMs;
      }

      // Ensure response matches schema: dates must be ISO strings.
      if (Array.isArray((response as any).steps)) {
        (response as any).steps = (response as any).steps.map((s: any) => ({
          ...s,
          startedAt: s?.startedAt instanceof Date ? s.startedAt.toISOString() : (s?.startedAt ?? null),
          completedAt: s?.completedAt instanceof Date ? s.completedAt.toISOString() : (s?.completedAt ?? null),
        }));
      }

      res.json(finalizeRunResponse(response, `GET /runs/chat/${chatId}`));
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting chat run:", error);
      res.status(500).json({ error: "Failed to get agent run for chat" });
    }
  });

  router.get("/runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {

      const { id } = req.params;

      const runs = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id))
        .limit(1);

      const run = runs[0];
      if (!run) {
        return res.status(404).json({ error: "Run not found", code: "RUN_NOT_FOUND" });
      }

      let effectiveRun = run;

      const ageMs = Date.now() - run.createdAt.getTime();
      if (run.status === "planning" && !run.startedAt && ageMs > 5_000) {
        await db.update(agentModeRuns)
          .set({
            status: "failed",
            error: "Run stalled in planning (no startedAt)",
            completedAt: new Date(),
          })
          .where(eq(agentModeRuns.id, run.id));

        // Re-fetch the updated run (simple + consistent)
        const [updatedRun] = await db.select().from(agentModeRuns).where(eq(agentModeRuns.id, run.id));
        if (updatedRun) {
          if (updatedRun) effectiveRun = updatedRun;
        }
      }

      const steps = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, id))
        .orderBy(agentModeSteps.stepIndex);
      const executionProfile = normalizeAgentExecutionProfile((effectiveRun as any).executionProfile);
      const executionProfileConfig = getAgentExecutionProfileConfig(executionProfile);
      const runtimeRemainingMs = effectiveRun.startedAt
        ? Math.max(0, executionProfileConfig.maxRunDurationMs - (Date.now() - effectiveRun.startedAt.getTime()))
        : executionProfileConfig.maxRunDurationMs;

      const planSteps = (effectiveRun.plan as AgentPlan)?.steps || [];

      const mergedSteps = planSteps.map((planStep: any, index: number) => {
        const dbStep = steps.find(s => s.stepIndex === index);
        if (dbStep) {
          return {
            stepIndex: dbStep.stepIndex,
            toolName: dbStep.toolName,
            description: planStep.description,
            status: dbStep.status,
            output: dbStep.toolOutput,
            error: dbStep.error,
            startedAt: dbStep.startedAt,
            completedAt: dbStep.completedAt,
          };
        }
        const cur = effectiveRun.currentStepIndex || 0;
        return {
          stepIndex: index,
          toolName: planStep.toolName,
          description: planStep.description,
          status: index < cur ? "pending" : (index === cur && effectiveRun.status === "running" ? "running" : "pending"),
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
        };
      });

      const response: any = {
        id: effectiveRun.id,
        chatId: effectiveRun.chatId,
        status: effectiveRun.status,
        executionProfile,
        plan: normalizeRunPlanForResponse(
          effectiveRun.plan,
          effectiveRun.createdAt,
          effectiveRun.totalSteps ?? planSteps.length,
        ),
        currentStepIndex: effectiveRun.currentStepIndex ?? 0,
        totalSteps: effectiveRun.totalSteps ?? planSteps.length,
        completedSteps: effectiveRun.completedSteps ?? 0,
        runtimeBudgetMs: executionProfileConfig.maxRunDurationMs,
        runtimeRemainingMs,
        steps: mergedSteps.length > 0 ? mergedSteps : steps.map(s => ({
          stepIndex: s.stepIndex,
          toolName: s.toolName,
          description: null,
          status: s.status,
          output: s.toolOutput,
          error: s.error,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        })),
        artifacts: (effectiveRun.artifacts as ToolArtifact[]) || [],
        summary: effectiveRun.summary ?? "",
        error: effectiveRun.error ?? "",
        startedAt: effectiveRun.startedAt?.toISOString(),
        completedAt: effectiveRun.completedAt?.toISOString(),
        createdAt: effectiveRun.createdAt.toISOString(),
      };

      // If this run is still active in-memory, include richer debug fields for the AgentPanel tabs.
      const activeOrchestrator = agentManager.getOrchestrator(effectiveRun.id);
      if (activeOrchestrator) {
        response.eventStream = activeOrchestrator.getEventStream?.() || [];
        response.todoList = activeOrchestrator.getTodoList?.() || [];
        response.workspaceFiles = activeOrchestrator.getWorkspaceFiles
          ? Object.fromEntries(activeOrchestrator.getWorkspaceFiles())
          : {};
        response.executionProfile = activeOrchestrator.getExecutionProfile?.() || executionProfile;
        response.runtimeBudgetMs = activeOrchestrator.getRuntimeBudgetMs?.() || executionProfileConfig.maxRunDurationMs;
        response.runtimeRemainingMs = activeOrchestrator.getRuntimeRemainingMs?.() || runtimeRemainingMs;
      }
      // Ensure response matches schema: dates must be ISO strings.
      if (Array.isArray((response as any).steps)) {
        (response as any).steps = (response as any).steps.map((s: any) => ({
          ...s,
          startedAt: s?.startedAt instanceof Date ? s.startedAt.toISOString() : (s?.startedAt ?? null),
          completedAt: s?.completedAt instanceof Date ? s.completedAt.toISOString() : (s?.completedAt ?? null),
        }));
      }

      res.json(finalizeRunResponse(response, `GET /runs/${id}`));
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting run:", error);
      res.status(500).json({ error: "Failed to get agent run" });
    }
  });

  router.get("/runs/:id/steps", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const steps = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, id))
        .orderBy(agentModeSteps.stepIndex);

      const response = steps.map(s => ({
        stepIndex: s.stepIndex,
        toolName: s.toolName,
        status: s.status,
        output: s.toolOutput,
        error: s.error,
        startedAt: s.startedAt ? s.startedAt.toISOString() : null,
        completedAt: s.completedAt ? s.completedAt.toISOString() : null,
      }));

      const validatedResponse = validateOrThrow(StepsArrayResponseSchema, response, `GET /runs/${id}/steps response`);
      res.json(response);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        console.error(`[AgentRoutes] Response validation failed:`, error.zodError.errors);
        return res.status(500).json({ error: "Internal response validation failed" });
      }
      console.error("[AgentRoutes] Error getting steps:", error);
      res.status(500).json({ error: "Failed to get run steps" });
    }


  });

  router.get("/runs/:id/events", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const limitRaw = parseInt((req.query.limit as string) || "100", 10);
      const pageRaw = parseInt((req.query.page as string) || "1", 10);
      const sortOrder = (req.query.order as string)?.toLowerCase() === "desc" ? "desc" : "asc";
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 100;
      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const offset = (page - 1) * limit;

      const totalResult = await db.select({ total: count() })
        .from(agentModeEvents)
        .where(eq(agentModeEvents.runId, id));
      const totalEvents = Number(totalResult[0]?.total ?? 0);

      const events = await db.select()
        .from(agentModeEvents)
        .where(eq(agentModeEvents.runId, id))
        .orderBy(sortOrder === "asc" ? asc(agentModeEvents.timestamp) : desc(agentModeEvents.timestamp))
        .limit(limit)
        .offset(offset);

      const responseData = events.map(e => ({
        id: e.id,
        runId: e.runId,
        stepIndex: e.stepIndex,
        correlationId: e.correlationId,
        eventType: e.eventType,
        payload: e.payload,
        metadata: e.metadata,
        timestamp: e.timestamp,
      }));

      res.json({
        runId: id,
        page,
        limit,
        order: sortOrder,
        total: totalEvents,
        events: responseData,
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting events:", error);
      res.status(500).json({ error: "Failed to get agent run events" });
    }
  });

  router.get("/runs/:id/metrics", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const steps = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, id))
        .orderBy(agentModeSteps.stepIndex);

      const events = await db.select()
        .from(agentModeEvents)
        .where(eq(agentModeEvents.runId, id))
        .orderBy(asc(agentModeEvents.timestamp));

      const completedSteps = steps.filter(step => step.status === "succeeded" || step.status === "failed");
      const succeededSteps = steps.filter(step => step.status === "succeeded");
      const failedSteps = steps.filter(step => step.status === "failed");

      const toolUsage = steps.reduce<Record<string, {
        toolName: string;
        totalRuns: number;
        successCount: number;
        failureCount: number;
        avgDurationMs: number | null;
      }>>((acc, step) => {
        const toolName = step.toolName || "unknown";
        if (!acc[toolName]) {
          acc[toolName] = {
            toolName,
            totalRuns: 0,
            successCount: 0,
            failureCount: 0,
            avgDurationMs: null,
          };
        }
        acc[toolName].totalRuns += 1;
        if (step.status === "succeeded") acc[toolName].successCount += 1;
        if (step.status === "failed") acc[toolName].failureCount += 1;

        if (step.startedAt && step.completedAt) {
          const durationMs = step.completedAt.getTime() - step.startedAt.getTime();
          const currentAverage = acc[toolName].avgDurationMs ?? 0;
          const previousCount = acc[toolName].totalRuns - 1;
          acc[toolName].avgDurationMs = ((currentAverage * previousCount) + durationMs) / acc[toolName].totalRuns;
        }
        return acc;
      }, {});

      const eventCounts = events.reduce<Record<string, number>>((acc, event) => {
        acc[event.eventType] = (acc[event.eventType] || 0) + 1;
        return acc;
      }, {});

      const lastFailedStep = failedSteps[failedSteps.length - 1];
      const lastError = lastFailedStep?.error || run.error || null;

      const runStart = run.startedAt?.getTime();
      const runEnd = run.completedAt?.getTime();
      const totalDurationMs = runStart ? ((runEnd || Date.now()) - runStart) : null;

      res.json({
        runId: run.id,
        status: run.status,
        totalDurationMs,
        stepCount: steps.length,
        completedSteps: completedSteps.length,
        successRate: steps.length ? succeededSteps.length / steps.length : 0,
        failures: failedSteps.map(step => ({
          stepIndex: step.stepIndex,
          toolName: step.toolName,
          error: step.error,
          completedAt: step.completedAt,
        })),
        toolUsage: Object.values(toolUsage),
        eventCounts,
        lastError,
        startedAt: run.startedAt?.toISOString() || null,
        completedAt: run.completedAt?.toISOString() || null,
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting run metrics:", error);
      res.status(500).json({ error: "Failed to get agent run metrics" });
    }
  });

  router.get("/runs/:id/events/stream", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const clientId = agentEventBus.subscribe(id, res);
      console.log(`[AgentRoutes] SSE client ${clientId} connected to run ${id}`);

      req.on("close", () => {
        agentEventBus.removeClient(clientId);
        console.log(`[AgentRoutes] SSE client ${clientId} disconnected from run ${id}`);
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error setting up event stream:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to setup event stream" });
      }
    }
  });

  router.get("/runs/:id/stream", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const clientId = activityStreamPublisher.subscribe(id, res);
      console.log(`[AgentRoutes] Activity stream client ${clientId} connected to run ${id}`);

      req.on("close", () => {
        activityStreamPublisher.unsubscribe(id, res);
        console.log(`[AgentRoutes] Activity stream client ${clientId} disconnected from run ${id}`);
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error setting up activity stream:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to setup activity stream" });
      }
    }
  });

  router.get("/runs/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const pipelineStatus = await agentLoopFacade.getRunStatus(id);

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run && pipelineStatus.status === "completed") {
        return res.status(404).json({ error: "Run not found" });
      }

      const response = {
        runId: id,
        status: run?.status || pipelineStatus.status,
        currentStep: pipelineStatus.currentStep,
        totalSteps: run?.totalSteps || pipelineStatus.totalSteps,
        completedSteps: run?.completedSteps || 0,
        startedAt: run?.startedAt?.toISOString() || (pipelineStatus.startedAt ? new Date(pipelineStatus.startedAt).toISOString() : undefined),
        completedAt: run?.completedAt?.toISOString() || (pipelineStatus.completedAt ? new Date(pipelineStatus.completedAt).toISOString() : undefined),
        error: run?.error || pipelineStatus.error,
        summary: run?.summary,
        pipeline: {
          status: pipelineStatus.status,
          currentStep: pipelineStatus.currentStep,
          totalSteps: pipelineStatus.totalSteps,
        },
      };

      res.json(response);
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting run status:", error);
      res.status(500).json({ error: "Failed to get run status" });
    }
  });

  router.get("/runs/:id/events/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const memoryEvents = activityStreamPublisher.getHistory(id);

      res.json({
        runId: id,
        events: memoryEvents,
        count: memoryEvents.length,
        source: "memory",
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting event history:", error);
      res.status(500).json({ error: "Failed to get event history" });
    }
  });

  router.post("/runs/:id/cancel", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (["completed", "failed", "cancelled"].includes(run.status)) {
        return res.status(400).json({
          error: "Cannot cancel a run that has already finished",
          currentStatus: run.status,
        });
      }

      const agentManagerCancelled = await agentManager.cancelRun(id);
      const pipelineCancelled = await agentLoopFacade.cancelRun(id);

      const lockResult = await updateRunWithLock(id, run.status, {
        status: "cancelled",
        completedAt: new Date(),
      });

      if (!lockResult.success) {
        return res.status(409).json({
          error: "Failed to cancel run due to concurrent modification",
          details: lockResult.error,
        });
      }

      res.json({
        success: true,
        cancelled: agentManagerCancelled || pipelineCancelled,
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error cancelling run:", error);
      res.status(500).json({ error: "Failed to cancel agent run" });
    }
  });

  router.post("/runs/:id/pause", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "running") {
        return res.status(400).json({
          error: "Can only pause running runs",
          currentStatus: run.status,
        });
      }

      if (typeof (agentManager as unknown as Record<string, any>).pauseRun === 'function') {
        await (agentManager as unknown as Record<string, any>).pauseRun(id);
      }

      const lockResult = await updateRunWithLock(id, "running", { status: "paused" });

      if (!lockResult.success) {
        return res.status(409).json({
          error: "Failed to pause run due to concurrent modification",
          details: lockResult.error,
        });
      }

      res.json({ success: true, status: "paused" });
    } catch (error: any) {
      console.error("[AgentRoutes] Error pausing run:", error);
      res.status(500).json({ error: "Failed to pause agent run" });
    }
  });

  router.post("/runs/:id/resume", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "paused") {
        return res.status(400).json({
          error: "Can only resume paused runs",
          currentStatus: run.status,
        });
      }

      if (typeof (agentManager as unknown as Record<string, any>).resumeRun === 'function') {
        await (agentManager as unknown as Record<string, any>).resumeRun(id);
      }

      const lockResult = await updateRunWithLock(id, "paused", { status: "running" });

      if (!lockResult.success) {
        return res.status(409).json({
          error: "Failed to resume run due to concurrent modification",
          details: lockResult.error,
        });
      }

      res.json({ success: true, status: "running" });
    } catch (error: any) {
      console.error("[AgentRoutes] Error resuming run:", error);
      res.status(500).json({ error: "Failed to resume agent run" });
    }
  });

  router.post("/runs/:id/confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const decisionRaw = (req.body?.decision || req.body?.action || "confirm") as string;
      const decision = String(decisionRaw).trim().toLowerCase();

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "awaiting_confirmation") {
        return res.status(400).json({
          error: "Run is not awaiting confirmation",
          currentStatus: run.status,
        });
      }

      if (decision === "cancel") {
        const cancelled = await (agentManager as any).cancelPendingConfirmation?.(id);
        await updateRunWithLock(id, "awaiting_confirmation", { status: "cancelled", completedAt: new Date() });
        return res.json({ success: true, status: "cancelled", cancelled: !!cancelled });
      }

      const confirmed = await (agentManager as any).confirmRun?.(id);

      const lockResult = await updateRunWithLock(id, "awaiting_confirmation", {
        status: "running",
        pendingConfirmation: null as any,
        awaitingConfirmationSince: null as any,
      } as any);

      if (!lockResult.success) {
        return res.status(409).json({
          error: "Failed to confirm run due to concurrent modification",
          details: lockResult.error,
        });
      }

      res.json({ success: true, status: "running", confirmed: !!confirmed });
    } catch (error: any) {
      console.error("[AgentRoutes] Error confirming run:", error);
      res.status(500).json({ error: "Failed to confirm agent run" });
    }
  });

  router.post("/runs/:id/retry", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as AuthenticatedRequest).user;
      const userId = user?.claims?.sub || user?.id;
      const userPlan = ((user as any)?.plan === "pro" || (user as any)?.plan === "admin") ? (user as any).plan : "free" as "free" | "pro" | "admin";

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "failed") {
        return res.status(400).json({
          error: "Can only retry failed runs",
          currentStatus: run.status,
        });
      }

      const failedStep = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, id))
        .orderBy(desc(agentModeSteps.stepIndex))
        .limit(1)
        .then(steps => steps.find(s => s.status === "failed"));

      const retryFromStep = failedStep?.stepIndex || 0;

      const retryLockResult = await updateRunWithLock(id, "failed", {
        status: "running",
        error: null,
        completedAt: null,
        currentStepIndex: retryFromStep,
      });

      if (!retryLockResult.success) {
        return res.status(409).json({
          error: "Failed to acquire lock for retry",
          details: retryLockResult.error,
        });
      }

      const plan = run.plan as AgentPlan;
      if (plan && plan.objective) {
        (async () => {
          let currentStatus = "running";
          try {
            const executionProfile = normalizeAgentExecutionProfile((run as any).executionProfile);
            const orchestrator = await agentManager.startRun(
              id,
              run.chatId,
              userId || "anonymous",
              plan.objective,
              [],
              userPlan,
              undefined,
              executionProfile,
            );

            orchestrator.on("progress", async (progress) => {
              try {
                const newStatus = progress.status === "executing" ? "running" : progress.status;
                const updateData: any = {
                  status: newStatus,
                  currentStepIndex: progress.currentStepIndex,
                  completedSteps: progress.stepResults.filter((r: any) => r.success).length,
                };

                if (progress.artifacts && progress.artifacts.length > 0) {
                  updateData.artifacts = progress.artifacts;
                }

                if (progress.status === "completed") {
                  updateData.status = "completed";
                  updateData.completedAt = new Date();
                  const summary = await orchestrator.generateSummary();
                  updateData.summary = summary;
                }

                if (progress.status === "failed") {
                  updateData.completedAt = new Date();
                  updateData.error = progress.error || "Unknown error";
                }

                const lockResult = await updateRunWithLock(id, currentStatus, updateData);
                if (lockResult.success) {
                  currentStatus = newStatus;
                } else {
                  console.warn(`[AgentRoutes] Optimistic lock failed for retry run ${id}: ${lockResult.error}`);
                }
              } catch (err) {
                console.error(`[AgentRoutes] Error updating retry run ${id}:`, err);
              }
            });
          } catch (err: any) {
            console.error(`[AgentRoutes] Error retrying run ${id}:`, err);
            await updateRunWithLock(id, currentStatus, {
              status: "failed",
              error: err.message || "Failed to retry agent run",
              completedAt: new Date(),
            });
          }
        })();
      }

      res.json({
        success: true,
        status: "running",
        retryFromStep,
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error retrying run:", error);
      res.status(500).json({ error: "Failed to retry agent run" });
    }
  });

  router.get("/skills", async (req: Request, res: Response) => {
    try {
      const allTools = toolRegistry.getAll();

      const categoryMap: Record<string, string> = {
        "Web": "research",
        "Generation": "media",
        "Processing": "data",
        "Data": "data",
        "Document": "documents",
        "Development": "code",
        "Diagram": "media",
        "API": "automation",
        "Productivity": "automation",
        "Security": "code",
        "Automation": "automation",
        "Database": "data",
        "Monitoring": "automation",
        "Utility": "automation",
        "Memory": "data",
        "Reasoning": "research",
        "Orchestration": "automation",
        "Communication": "communication",
        "AdvancedSystem": "automation",
      };

      const popularTools = new Set([
        "web_search", "generate_image", "doc_create", "spreadsheet_create",
        "code_generate", "data_analyze", "pdf_manipulate", "slides_create",
        "browser_navigate", "fetch_url"
      ]);

      const skills = allTools
        .filter(tool => tool.metadata.implementationStatus === "implemented")
        .map((tool) => {
          const category = categoryMap[tool.metadata.category] || "automation";
          return {
            id: tool.metadata.name.toLowerCase().replace(/_/g, "-"),
            name: tool.metadata.name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            description: tool.metadata.description,
            category,
            primaryAgent: `${tool.metadata.category}Agent`,
            tools: [tool.metadata.name],
            requiredInputs: [],
            outputType: "Resultado",
            tags: tool.metadata.tags,
            version: tool.metadata.version,
            popular: popularTools.has(tool.metadata.name),
            new: tool.metadata.experimental,
            deprecated: tool.metadata.deprecated,
            implementationStatus: tool.metadata.implementationStatus,
          };
        });

      res.json({ skills });
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting skills:", error);
      res.status(500).json({ error: "Failed to get skills", skills: [] });
    }
  });

  router.get("/capabilities", async (req: Request, res: Response) => {
    try {
      const toolStats = toolRegistry.getStats();
      const agentStats = agentRegistry.getStats();
      const allTools = toolRegistry.getAll();

      const categoryNameMap: Record<string, string> = {
        "Web": "Investigación",
        "Generation": "Multimedia",
        "Processing": "Procesamiento",
        "Data": "Datos y Análisis",
        "Document": "Documentos",
        "Development": "Desarrollo",
        "Diagram": "Diagramas",
        "API": "APIs",
        "Productivity": "Productividad",
        "Security": "Seguridad",
        "Automation": "Automatización",
        "Database": "Base de Datos",
        "Monitoring": "Monitoreo",
        "Utility": "Utilidades",
        "Memory": "Memoria",
        "Reasoning": "Razonamiento",
        "Orchestration": "Orquestación",
        "Communication": "Comunicación",
        "AdvancedSystem": "Sistema Avanzado",
      };

      const categories = Object.entries(toolStats.byCategory).map(([id, count]) => ({
        id: id.toLowerCase(),
        name: categoryNameMap[id] || id,
        count,
      }));

      const implementedCount = allTools.filter(
        t => t.metadata.implementationStatus === "implemented"
      ).length;

      const stats = {
        totalTools: toolStats.totalTools,
        totalAgents: agentStats.totalAgents,
        totalSkills: implementedCount,
        categories,
        traces: toolStats.traces,
        byRole: agentStats.byRole,
      };

      res.json(stats);
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting capabilities:", error);
      res.status(500).json({
        error: "Failed to get capabilities",
        totalTools: 0,
        totalAgents: 0,
        totalSkills: 0,
        categories: [],
      });
    }
  });

  router.get("/robustness/report", requireAuth, async (req: Request, res: Response) => {
    try {
      const requestedHours = parseInt((req.query.hours as string) || "24", 10);
      const policy = getRobustnessPolicy();
      const windowHours = Number.isFinite(requestedHours) ? clampNumber(requestedHours, policy.minHoursWindow, policy.maxHoursWindow, policy.defaultHoursWindow) : policy.defaultHoursWindow;
      const since = new Date(Date.now() - (windowHours * 60 * 60 * 1000));

      const runRows = await db
        .select({
          status: agentModeRuns.status,
          total: count(),
        })
        .from(agentModeRuns)
        .where(gte(agentModeRuns.createdAt, since))
        .groupBy(agentModeRuns.status);

      const stepRows = await db
        .select({
          status: agentModeSteps.status,
          total: count(),
        })
        .from(agentModeSteps)
        .innerJoin(agentModeRuns, eq(agentModeSteps.runId, agentModeRuns.id))
        .where(gte(agentModeRuns.createdAt, since))
        .groupBy(agentModeSteps.status);

      const runningRows = await db
        .select({ total: count() })
        .from(agentModeRuns)
        .where(and(gte(agentModeRuns.createdAt, since), eq(agentModeRuns.status, "running")));

      const failedRows = await db
        .select({ total: count() })
        .from(agentModeRuns)
        .where(and(gte(agentModeRuns.createdAt, since), eq(agentModeRuns.status, "failed")));

      const totalRuns = runRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
      const totalSteps = stepRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
      const failedRuns = Number(failedRows?.[0]?.total || 0);
      const completedRuns = runRows
        .filter(r => r.status === "completed" || r.status === "succeeded")
        .reduce((sum, row) => sum + Number(row.total || 0), 0);
      const runningRuns = Number(runningRows?.[0]?.total || 0);

      const byRunStatus = runRows.map(row => ({
        status: row.status,
        total: Number(row.total || 0),
      }));

      const failedStatuses = byRunStatus.reduce((acc, item) => acc + (item.status === "failed" ? item.total : 0), 0);

      const byStepStatus = stepRows.map(row => ({
        status: row.status,
        total: Number(row.total || 0),
      }));

      const recentSuccess = toPercent(completedRuns, totalRuns);
      const recentFailures = toPercent(failedRuns, totalRuns);

      const resilience = toolRegistry.getResilienceMetrics();
      const recommendations: string[] = [];

      if (recentFailures > policy.failureWarningPercent) {
        recommendations.push("Aumentar límites de reintento y revisar herramientas con mayor tasa de falla.");
      }

      const fragileTools = (Object.entries(resilience.byCategory) as Array<[string, { state: string; failureCount: number; successCount: number }]>)
        .filter(([, metrics]) => metrics.failureCount > metrics.successCount)
        .map(([name]) => name);

      if (fragileTools.length > 0) {
        recommendations.push(`Herramientas con mayor degradación: ${fragileTools.join(", ")}.`);
      }

      if (runningRuns > 0 && totalRuns >= policy.minimumRunsForRunningCheck) {
        recommendations.push("Hay runs activos recientes; revisar timeout y estados pendientes de confirmación.");
      }

      if (failedStatuses > 0 && totalRuns > 0) {
        recommendations.push(`Hay ${failedStatuses} runs en estado failed en esta ventana; revisar errores recurrentes.`);
      }

      const healthLevel = recentFailures >= policy.failureCriticalPercent
        ? "degraded"
        : recentFailures >= policy.failureWarningPercent
          ? "warning"
          : "healthy";

      res.json({
        healthLevel,
        windowHours,
        successRatePercent: recentSuccess,
        failureRatePercent: recentFailures,
        runs: {
          total: totalRuns,
          byStatus: byRunStatus,
          running: runningRuns,
          failed: failedRuns,
          completed: completedRuns,
        },
        steps: {
          total: totalSteps,
          byStatus: byStepStatus,
        },
        resilience,
        recommendations,
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error generating robustness report:", error);
      res.status(500).json({
        error: "Failed to generate robustness report",
      });
    }
  });


  router.get("/robustness/alerts", requireAuth, async (req: Request, res: Response) => {
    try {
      const requestedHours = parseInt((req.query.hours as string) || "24", 10);
      const policy = getRobustnessPolicy();
      const windowHours = Number.isFinite(requestedHours) ? clampNumber(requestedHours, policy.minHoursWindow, policy.maxHoursWindow, policy.defaultHoursWindow) : policy.defaultHoursWindow;
      const staleMinutes = parseInt((req.query.staleMinutes as string) || "15", 10);
      const since = new Date(Date.now() - (windowHours * 60 * 60 * 1000));
      const staleCutoff = new Date(Date.now() - (Math.max(staleMinutes, 1) * 60 * 1000));

      const runRows = await db
        .select({
          status: agentModeRuns.status,
          total: count(),
        })
        .from(agentModeRuns)
        .where(gte(agentModeRuns.createdAt, since))
        .groupBy(agentModeRuns.status);

      const stepRows = await db
        .select({
          status: agentModeSteps.status,
          total: count(),
        })
        .from(agentModeSteps)
        .innerJoin(agentModeRuns, eq(agentModeSteps.runId, agentModeRuns.id))
        .where(gte(agentModeRuns.createdAt, since))
        .groupBy(agentModeSteps.status);

      const staleRows = await db
        .select({ total: count(), runId: agentModeRuns.id })
        .from(agentModeRuns)
        .where(
          and(
            gte(agentModeRuns.createdAt, since),
            eq(agentModeRuns.status, "running"),
            lt(agentModeRuns.startedAt, staleCutoff)
          )
        );

      const totalRuns = runRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
      const totalSteps = stepRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
      const failedRuns = runRows
        .filter(row => row.status === "failed")
        .reduce((sum, row) => sum + Number(row.total || 0), 0);
      const runningRows = runRows
        .filter(row => row.status === "running")
        .reduce((sum, row) => sum + Number(row.total || 0), 0);

      const recentSuccess = toPercent(
        runRows
          .filter(row => row.status === "completed" || row.status === "succeeded")
          .reduce((sum, row) => sum + Number(row.total || 0), 0),
        totalRuns
      );

      const recentFailures = toPercent(failedRuns, totalRuns);
      const staleRuns = Number(staleRows?.[0]?.total || 0);
      const stepFailed = stepRows
        .filter(row => row.status === "failed")
        .reduce((sum, row) => sum + Number(row.total || 0), 0);

      const alerts = [] as Array<{
        severity: "critical" | "warning" | "info";
        code: string;
        title: string;
        detail: string;
      }>;

      if (recentFailures >= policy.alertFailureCriticalPercent) {
        alerts.push({
          severity: "critical",
          code: "agent.failure.rate",
          title: "Falla crítica de runs",
          detail: `Falla reciente ${recentFailures.toFixed(2)}% en ${totalRuns} runs`,
        });
      } else if (recentFailures >= policy.alertFailureWarningPercent) {
        alerts.push({
          severity: "warning",
          code: "agent.failure.rate",
          title: "Aumento de fallas",
          detail: `Falla reciente ${recentFailures.toFixed(2)}% en ${totalRuns} runs`,
        });
      }

      if (staleRuns >= policy.staleWarningCount) {
        alerts.push({
          severity: staleRuns >= policy.staleCriticalCount ? "critical" : "warning",
          code: "agent.run.stale",
          title: "Runs bloqueados",
          detail: `Hay ${staleRuns} run(s) en ejecución por más de ${Math.max(staleMinutes, 1)} min`,
        });
      }

      if (recentFailures >= policy.stepFailureSensitivityPercent && stepFailed > 0 && stepRows.length > 0) {
        alerts.push({
          severity: "warning",
          code: "agent.steps.failed",
          title: "Alta tasa de pasos fallidos",
          detail: `Hay ${stepFailed} pasos fallidos en ${totalSteps} totales`,
        });
      }

      if (runningRows > 0 && totalRuns >= policy.minimumRunsForThroughputAlert) {
        alerts.push({
          severity: "info",
          code: "agent.throughput",
          title: "Actividad agente elevada",
          detail: `${runningRows} runs activos con ${totalRuns} runs analizados en ${windowHours}h`,
        });
      }

      const recommendations = alerts.length
        ? alerts.map(a => `${a.title}: ${a.detail}`)
        : ["Sin alertas críticas: operación estable en ventana analizada."];

      const alertLevel = alerts.some(a => a.severity === "critical")
        ? "critical"
        : alerts.some(a => a.severity === "warning")
          ? "warning"
          : alerts.length > 0
            ? "info"
            : "ok";

      res.json({
        healthLevel: recentFailures >= policy.alertFailureCriticalPercent
          ? "degraded"
          : recentFailures >= policy.alertFailureWarningPercent
            ? "warning"
            : "healthy",
        windowHours,
        staleMinutes: Math.max(staleMinutes, 1),
        alertLevel,
        alerts,
        recommendations,
        indicators: {
          totalRuns,
          runningRuns,
          failedRuns,
          totalSteps,
          stepFailed,
          staleRuns,
          successRatePercent: recentSuccess,
          failureRatePercent: recentFailures,
        },
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error generating robustness alerts:", error);
      res.status(500).json({
        error: "Failed to generate robustness alerts",
      });
    }
  });

  router.get("/robustness/policy", requireAuth, async (_req: Request, res: Response) => {
    try {
      const policy = getRobustnessPolicy();
      res.json({
        policy,
        env: {
          AGENT_FAILURE_WARNING_PERCENT: process.env.AGENT_FAILURE_WARNING_PERCENT || null,
          AGENT_FAILURE_CRITICAL_PERCENT: process.env.AGENT_FAILURE_CRITICAL_PERCENT || null,
          AGENT_ALERT_FAILURE_WARNING_PERCENT: process.env.AGENT_ALERT_FAILURE_WARNING_PERCENT || null,
          AGENT_ALERT_FAILURE_CRITICAL_PERCENT: process.env.AGENT_ALERT_FAILURE_CRITICAL_PERCENT || null,
          AGENT_STALE_WARNING_COUNT: process.env.AGENT_STALE_WARNING_COUNT || null,
          AGENT_STALE_CRITICAL_COUNT: process.env.AGENT_STALE_CRITICAL_COUNT || null,
          AGENT_THROUGHPUT_MIN_RUNS: process.env.AGENT_THROUGHPUT_MIN_RUNS || null,
          AGENT_RUNNING_MIN_RUNS: process.env.AGENT_RUNNING_MIN_RUNS || null,
          AGENT_STEP_FAILURE_PERCENT: process.env.AGENT_STEP_FAILURE_PERCENT || null,
          AGENT_ROBUSTNESS_MAX_HOURS: process.env.AGENT_ROBUSTNESS_MAX_HOURS || null,
          AGENT_ROBUSTNESS_MIN_HOURS: process.env.AGENT_ROBUSTNESS_MIN_HOURS || null,
          AGENT_ROBUSTNESS_DEFAULT_HOURS: process.env.AGENT_ROBUSTNESS_DEFAULT_HOURS || null,
        },
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error returning robustness policy:", error);
      res.status(500).json({ error: "Failed to get robustness policy" });
    }
  });



  return router;
}
