import { Router } from "express";
import { z } from "zod";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { getOpenClawConfig } from "../openclaw/config";
import { skillRegistry } from "../openclaw/skills/skillRegistry";
import { initSkills } from "../openclaw/skills/skillLoader";
import { AgentExecutionProfileSchema } from "@shared/agentExecutionProfile";
import { normalizeOpenClawWorkspaceContext } from "@shared/openclawWorkspaceContext";
import { openclawSessionContextService } from "../openclaw/sessionContextService";

const objectiveSchema = z.object({
  objective: z.string().trim().min(1, "objective is required"),
  complexity: z.coerce.number().int().min(1).max(10).optional(),
});

const ragSearchSchema = z.object({
  query: z.string().trim().min(1, "query is required"),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  chatId: z.string().trim().optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
});

const ragContextSchema = z.object({
  message: z.string().trim().min(1, "message is required"),
  currentChatId: z.string().trim().optional(),
});

const skillsResolveSchema = z.object({
  skillIds: z.array(z.string().trim().min(1)).optional(),
});

const spawnSubagentSchema = z.object({
  objective: z.string().trim().min(1, "objective is required"),
  planHint: z.array(z.string().trim().min(1)).optional(),
  parentRunId: z.string().trim().optional(),
  executionProfile: AgentExecutionProfileSchema.optional(),
  workspaceContext: z.unknown().optional(),
});

const orchestratorFlowSchema = objectiveSchema.extend({
  spawnSubagents: z.boolean().optional().default(true),
  maxSubagents: z.coerce.number().int().min(1).max(10).optional().default(3),
  workspaceContext: z.unknown().optional(),
});

function normalizeComplexity(objective: string, complexity?: number): number {
  if (typeof complexity === "number" && Number.isFinite(complexity)) {
    return Math.max(1, Math.min(10, complexity));
  }
  return Math.min(10, Math.max(1, Math.ceil(objective.length / 120)));
}

function parseLimit(raw: unknown, fallback = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

function parseSubagentStatus(raw: unknown) {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  if (
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "cancelled"
  ) {
    return normalized;
  }
  return undefined;
}

function respondError(res: any, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      error: "Invalid request",
      details: error.flatten(),
    });
  }
  return res.status(500).json({
    error: (error as Error)?.message || "Runtime error",
  });
}

type RAGServiceInstance = InstanceType<typeof import("../services/ragService").RAGService>;
type OpenClawSubagentService = typeof import("../openclaw/agents/subagentService").openclawSubagentService;
type OrchestrationEngine = typeof import("../services/orchestrationEngine").orchestrationEngine;

let ragServicePromise: Promise<RAGServiceInstance> | null = null;
let subagentServicePromise: Promise<OpenClawSubagentService> | null = null;
let orchestrationEnginePromise: Promise<OrchestrationEngine> | null = null;
let runtimeSkillsInitPromise: Promise<number> | null = null;

async function getRagService(): Promise<RAGServiceInstance> {
  if (!ragServicePromise) {
    ragServicePromise = import("../services/ragService").then(({ RAGService }) => new RAGService());
  }
  return ragServicePromise;
}

async function getSubagentService(): Promise<OpenClawSubagentService> {
  if (!subagentServicePromise) {
    subagentServicePromise = import("../openclaw/agents/subagentService").then(
      ({ openclawSubagentService }) => openclawSubagentService,
    );
  }
  return subagentServicePromise;
}

async function getOrchestrationEngine(): Promise<OrchestrationEngine> {
  if (!orchestrationEnginePromise) {
    orchestrationEnginePromise = import("../services/orchestrationEngine").then(
      ({ orchestrationEngine }) => orchestrationEngine,
    );
  }
  return orchestrationEnginePromise;
}

async function ensureRuntimeSkillsLoaded(forceReload = false): Promise<number> {
  const config = getOpenClawConfig();
  if (!config.skills.enabled) {
    skillRegistry.clear();
    return 0;
  }

  if (!forceReload && skillRegistry.list().length > 0) {
    return skillRegistry.list().length;
  }

  if (!runtimeSkillsInitPromise) {
    runtimeSkillsInitPromise = initSkills(config)
      .then(() => skillRegistry.list().length)
      .finally(() => {
        runtimeSkillsInitPromise = null;
      });
  }

  return await runtimeSkillsInitPromise;
}

export function createOpenClawRuntimeRouter(): Router {
  const router = Router();

  router.post("/session-context/:runId", (req, res) => {
    try {
      const rawWorkspaceContext =
        req.body && typeof req.body === "object" && "workspaceContext" in req.body
          ? (req.body as Record<string, unknown>).workspaceContext
          : req.body;
      const workspaceContext = normalizeOpenClawWorkspaceContext(rawWorkspaceContext);
      if (!workspaceContext) {
        return res.status(400).json({ error: "Invalid workspace context" });
      }

      const record = openclawSessionContextService.remember(req.params.runId, workspaceContext);
      return res.status(201).json({
        runId: record.runId,
        workspaceContext: record.workspaceContext,
        repositorySnapshot: record.repositorySnapshot,
        updatedAt: record.updatedAt,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/health", async (_req, res) => {
    const config = getOpenClawConfig();
    let skillsLoaded = skillRegistry.list().length;

    if (config.skills.enabled && skillsLoaded === 0) {
      try {
        skillsLoaded = await ensureRuntimeSkillsLoaded();
      } catch {
        skillsLoaded = skillRegistry.list().length;
      }
    }

    return res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      modules: {
        skills: config.skills.enabled && skillsLoaded > 0,
        tools: config.tools.enabled,
        gateway: config.gateway.enabled,
      },
      details: {
        skillsConfigured: config.skills.enabled,
        skillsLoaded,
        skillsDirectory: config.skills.directory,
        toolsConfigured: config.tools.enabled,
        gatewayConfigured: config.gateway.enabled,
        gatewayPath: config.gateway.path,
      },
    });
  });

  router.get("/skills", async (_req, res) => {
    try {
      await ensureRuntimeSkillsLoaded();
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || "Failed to load skills",
      });
    }

    const skills = skillRegistry.list().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tools: skill.tools || [],
      source: skill.source || "builtin",
      filePath: skill.filePath,
      updatedAt: skill.updatedAt,
    }));
    return res.json({
      count: skills.length,
      skills,
    });
  });

  router.post("/skills/reload", async (_req, res) => {
    try {
      const count = await ensureRuntimeSkillsLoaded(true);
      return res.json({
        reloaded: true,
        count,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || "Failed to reload skills",
      });
    }
  });

  router.post("/skills/resolve", async (req, res) => {
    try {
      const parsed = skillsResolveSchema.parse(req.body || {});
      await ensureRuntimeSkillsLoaded();
      const resolved = skillRegistry.resolve(parsed.skillIds);
      return res.json({
        prompt: resolved.prompt,
        tools: resolved.tools,
        count: resolved.skills.length,
        skills: resolved.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          tools: skill.tools || [],
          source: skill.source || "builtin",
          filePath: skill.filePath,
        })),
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/rag/search", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const ragService = await getRagService();
      const parsed = ragSearchSchema.parse(req.body || {});
      const results = await ragService.search(userId, parsed.query, {
        limit: parsed.limit,
        chatId: parsed.chatId,
        minScore: parsed.minScore,
      });
      return res.json({
        count: results.length,
        results,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/rag/context", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const ragService = await getRagService();
      const parsed = ragContextSchema.parse(req.body || {});
      const context = await ragService.getContextForMessage(
        userId,
        parsed.message,
        parsed.currentChatId,
      );
      return res.json({ context });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/orchestrator/plan", async (req, res) => {
    try {
      const orchestrationEngine = await getOrchestrationEngine();
      const parsed = objectiveSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);
      return res.json({ objective: parsed.objective, complexity, subtasks, plan });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/orchestrator/run", async (req, res) => {
    try {
      const orchestrationEngine = await getOrchestrationEngine();
      const parsed = objectiveSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);
      const execution = await orchestrationEngine.executeParallel(plan);
      const combined = orchestrationEngine.combineResults(execution);
      return res.json({
        objective: parsed.objective,
        complexity,
        subtasks,
        plan,
        execution,
        combined,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  // Full agentic flow for smoke/e2e checks:
  // objective -> plan -> delegate subagents -> consolidated response.
  router.post("/orchestrator/flow", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const orchestrationEngine = await getOrchestrationEngine();
      const openclawSubagentService = await getSubagentService();
      const parsed = orchestratorFlowSchema.parse(req.body || {});
      const workspaceContext = normalizeOpenClawWorkspaceContext(parsed.workspaceContext);
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity);
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);

      const delegatedRuns = parsed.spawnSubagents
        ? subtasks.slice(0, parsed.maxSubagents).map((subtask) =>
            openclawSubagentService.spawn({
              requesterUserId: userId,
              objective: subtask.description,
              planHint: subtask.toolId ? [`use:${subtask.toolId}`] : [],
              workspaceContext,
            }),
          )
        : [];

      const execution = await orchestrationEngine.executeParallel(plan);
      const combined = orchestrationEngine.combineResults(execution);

      return res.json({
        objective: parsed.objective,
        complexity,
        subtasks,
        plan,
        delegatedRuns: delegatedRuns.map((run) => ({
          id: run.id,
          objective: run.objective,
          status: run.status,
          createdAt: run.createdAt,
        })),
        execution,
        combined,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/subagents", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const openclawSubagentService = await getSubagentService();
      const parsed = spawnSubagentSchema.parse(req.body || {});
      const workspaceContext =
        normalizeOpenClawWorkspaceContext(parsed.workspaceContext) ||
        openclawSessionContextService.resolveWorkspaceContext(parsed.parentRunId);
      const run = openclawSubagentService.spawn({
        requesterUserId: userId,
        objective: parsed.objective,
        planHint: parsed.planHint || [],
        parentRunId: parsed.parentRunId,
        executionProfile: parsed.executionProfile,
        workspaceContext,
      });
      return res.status(202).json(run);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/subagents", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const openclawSubagentService = await getSubagentService();
    const status = parseSubagentStatus(req.query.status);
    const limit = parseLimit(req.query.limit, 50);
    const parentRunId = typeof req.query.parentRunId === "string" ? req.query.parentRunId : undefined;
    const runs = openclawSubagentService.list({
      requesterUserId: userId,
      status,
      limit,
      parentRunId,
    });
    return res.json({
      count: runs.length,
      runs,
    });
  });

  router.get("/subagents/:runId", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const openclawSubagentService = await getSubagentService();
    const run = openclawSubagentService.get(req.params.runId);
    if (!run || run.requesterUserId !== userId) {
      return res.status(404).json({ error: "Subagent run not found" });
    }
    return res.json(run);
  });

  router.post("/subagents/:runId/cancel", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const openclawSubagentService = await getSubagentService();
    const run = openclawSubagentService.get(req.params.runId);
    if (!run || run.requesterUserId !== userId) {
      return res.status(404).json({ error: "Subagent run not found" });
    }

    const cancelled = openclawSubagentService.cancel(run.id);
    return res.json({
      runId: run.id,
      cancelled,
    });
  });

  return router;
}
