import { Router } from "express";
import { z } from "zod";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { getOpenClawConfig } from "../openclaw/config";
import { openclawSubagentService } from "../openclaw/agents/subagentService";
import { skillRegistry } from "../openclaw/skills/skillRegistry";
import { initSkills } from "../openclaw/skills/skillLoader";
import { getAgentControlPlaneSnapshot } from "../services/agentControlPlane";
import { openClawBrowserRuntime } from "../services/openclawBrowserRuntime";
import {
  mapConnectorExecutionStatus,
  openClawConnectorRuntime,
} from "../services/openclawConnectorRuntime";
import { openClawExtensionRuntime } from "../services/openclawExtensionRuntime";
import { openClawProcessRuntime } from "../services/openclawProcessRuntime";
import { openClawSessionRuntime } from "../services/openclawSessionRuntime";
import { openClawSuperAgentRuntime } from "../services/openclawSuperAgentRuntime";
import { openClawTaskRuntime } from "../services/openclawTaskRuntime";
import { RAGService } from "../services/ragService";
import { orchestrationEngine } from "../services/orchestrationEngine.ts";
import { resolveOrchestratorSkillContextForUser } from "../services/orchestratorSkillContext";

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
});

const orchestratorFlowSchema = objectiveSchema.extend({
  spawnSubagents: z.boolean().optional().default(true),
  maxSubagents: z.coerce.number().int().min(1).max(10).optional().default(3),
});

const backgroundProcessPollSchema = z.object({
  timeoutMs: z.coerce.number().int().min(0).max(120_000).optional(),
});

const backgroundProcessWriteSchema = z.object({
  data: z.string().optional().default(""),
  eof: z.boolean().optional().default(false),
});

const backgroundProcessSendKeysSchema = z.object({
  keys: z.array(z.string()).optional(),
  hex: z.array(z.string()).optional(),
  literal: z.string().optional(),
});

const backgroundProcessPasteSchema = z.object({
  text: z.string().optional().default(""),
  bracketed: z.boolean().optional().default(true),
});

const backgroundCronListSchema = z.object({
  includeDisabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  query: z.string().trim().optional(),
  enabled: z.enum(["all", "enabled", "disabled"]).optional(),
  sortBy: z.enum(["nextRunAtMs", "updatedAtMs", "name"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

const backgroundCronRunSchema = z.object({
  mode: z.enum(["due", "force"]).optional().default("force"),
});

const backgroundCronRunsSchema = z.object({
  scope: z.enum(["job", "all"]).optional(),
  id: z.string().trim().optional(),
  jobId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(["all", "ok", "error", "skipped"]).optional(),
  statuses: z
    .union([z.array(z.enum(["ok", "error", "skipped"])), z.enum(["ok", "error", "skipped"])])
    .optional()
    .transform((value) => (Array.isArray(value) ? value : value ? [value] : undefined)),
  deliveryStatus: z.enum(["delivered", "not-delivered", "unknown", "not-requested"]).optional(),
  deliveryStatuses: z
    .union([
      z.array(z.enum(["delivered", "not-delivered", "unknown", "not-requested"])),
      z.enum(["delivered", "not-delivered", "unknown", "not-requested"]),
    ])
    .optional()
    .transform((value) => (Array.isArray(value) ? value : value ? [value] : undefined)),
  query: z.string().trim().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

const backgroundWakeSchema = z.object({
  mode: z.enum(["now", "next-heartbeat"]).optional().default("now"),
  text: z.string().trim().min(1, "text is required"),
});

const backgroundHeartbeatRequestSchema = z.object({
  reason: z.string().trim().optional(),
  coalesceMs: z.coerce.number().int().min(0).max(120_000).optional(),
  agentId: z.string().trim().optional(),
  sessionKey: z.string().trim().optional(),
});

const backgroundHeartbeatRunSchema = z.object({
  reason: z.string().trim().optional(),
  agentId: z.string().trim().optional(),
  sessionKey: z.string().trim().optional(),
});

const sessionListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  query: z.string().trim().optional(),
  status: z
    .enum(["all", "idle", "active", "error", "interrupted", "recovery-requested"])
    .optional(),
});

const sessionRecoverSchema = z.object({
  reason: z.string().trim().optional(),
  coalesceMs: z.coerce.number().int().min(0).max(120_000).optional(),
});

const connectorCatalogSchema = z.object({
  connected: z.coerce.boolean().optional(),
  enabled: z.coerce.boolean().optional(),
  category: z.string().trim().optional(),
});

const connectorExecuteSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional().default({}),
  chatId: z.string().trim().optional(),
  runId: z.string().trim().optional(),
  confirmed: z.coerce.boolean().optional().default(false),
});

const browserCreateSessionSchema = z.object({
  controller: z.enum(["browser", "computer"]).optional(),
  mode: z.enum(["browser", "desktop"]).optional(),
  profileId: z.string().trim().optional(),
  objective: z.string().trim().optional(),
  allowedDomains: z.array(z.string().trim().min(1)).optional(),
  viewport: z
    .object({
      width: z.coerce.number().int().min(320).max(7680),
      height: z.coerce.number().int().min(240).max(4320),
    })
    .optional(),
});

const browserNavigateSchema = z.object({
  url: z.string().url("url is required"),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).optional(),
  timeout: z.coerce.number().int().min(1000).max(120_000).optional(),
  tabId: z.string().trim().optional(),
});

const browserInteractSchema = z.object({
  action: z.enum(["click", "type", "select", "hover", "scroll", "press_key", "hotkey"]),
  selector: z.string().trim().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  values: z.union([z.string(), z.array(z.string())]).optional(),
  clear: z.coerce.boolean().optional(),
  delay: z.coerce.number().int().min(0).max(5000).optional(),
  pressEnter: z.coerce.boolean().optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.coerce.number().int().min(1).max(5000).optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  clickCount: z.coerce.number().int().min(1).max(5).optional(),
  force: z.coerce.boolean().optional(),
  coordinates: z
    .object({
      x: z.coerce.number().int().min(0).max(20_000),
      y: z.coerce.number().int().min(0).max(20_000),
    })
    .optional(),
  modifiers: z.array(z.string().trim().min(1)).optional(),
});

const browserExtractSchema = z
  .object({
    rules: z
      .array(
        z.object({
          name: z.string().trim().min(1),
          selector: z.string().trim().min(1),
          type: z.enum(["text", "html", "attribute", "list", "table", "screenshot"]),
          attribute: z.string().trim().optional(),
          transform: z
            .enum(["trim", "lowercase", "uppercase", "number", "date"])
            .optional(),
        }),
      )
      .optional(),
    description: z.string().trim().optional(),
  })
  .refine((value) => (value.rules?.length ?? 0) > 0 || Boolean(value.description), {
    message: "Provide rules or description",
  });

const browserAnalyzeSchema = z.object({
  query: z.string().trim().optional(),
});

const browserAgenticSchema = z.object({
  goal: z.string().trim().optional(),
  maxSteps: z.coerce.number().int().min(1).max(100).optional(),
  allowedDomains: z.array(z.string().trim().min(1)).optional(),
  task: z
    .object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1),
      steps: z.array(
        z.object({
          id: z.string().trim().optional(),
          action: z.string().trim().min(1),
          params: z.record(z.string(), z.unknown()).optional(),
          selector: z.string().trim().optional(),
          description: z.string().trim().optional(),
          expectedResult: z.string().trim().optional(),
          continueOnError: z.coerce.boolean().optional(),
          retries: z.coerce.number().int().min(0).max(10).optional(),
        }),
      ),
      retryPolicy: z
        .object({
          maxRetries: z.coerce.number().int().min(0).max(10),
          backoffMs: z.coerce.number().int().min(0).max(60_000),
        })
        .optional(),
      timeout: z.coerce.number().int().min(1000).max(600_000).optional(),
      variables: z.record(z.string(), z.unknown()).optional(),
      onError: z.enum(["retry", "skip", "abort"]).optional(),
    })
    .optional(),
});

const browserScreenshotQuerySchema = z.object({
  fullPage: z.coerce.boolean().optional(),
  selector: z.string().trim().optional(),
  type: z.enum(["png", "jpeg"]).optional(),
  quality: z.coerce.number().int().min(1).max(100).optional(),
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

function parseTimeoutMs(raw: unknown, fallback = 1500): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10_000, Math.max(250, Math.floor(n)));
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

function buildRuntimeModules() {
  return {
    skills: process.env.ENABLE_OPENCLAW_SKILLS === "true",
    tools: process.env.ENABLE_OPENCLAW_TOOLS === "true",
    gateway: process.env.ENABLE_OPENCLAW_GATEWAY === "true",
    plugins: process.env.ENABLE_OPENCLAW_PLUGINS === "true",
  };
}

function summarizeConnectorCatalog(
  connectors: Array<{
    category: string;
    connected: boolean;
    enabledForUser: boolean;
    writeCapabilityCount: number;
  }>,
) {
  const categories = connectors.reduce<Record<string, number>>((acc, connector) => {
    const category = String(connector.category || "general");
    acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total: connectors.length,
    connected: connectors.filter((connector) => connector.connected).length,
    enabledForUser: connectors.filter((connector) => connector.enabledForUser).length,
    writeCapabilities: connectors.reduce(
      (total, connector) => total + connector.writeCapabilityCount,
      0,
    ),
    categories,
    items: connectors,
  };
}

export function createOpenClawRuntimeRouter(): Router {
  const router = Router();
  const ragService = new RAGService();
  void openClawTaskRuntime.ensureStarted().catch(() => undefined);
  void openClawSessionRuntime.ensureStarted().catch(() => undefined);

  router.get("/overview", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const controlPlane = getAgentControlPlaneSnapshot();
      const [superAgent, tasks, jobs, runs, wakes, browser, connectorCatalog] = await Promise.all([
        openClawSuperAgentRuntime.getStatus({
          includeProbes: false,
        }),
        openClawTaskRuntime.status(),
        openClawTaskRuntime.listPage({ limit: 5, offset: 0 }),
        openClawTaskRuntime.listRuns({ scope: "all", limit: 10, offset: 0, sortDir: "desc" }),
        openClawTaskRuntime.listWakeEvents(5),
        openClawBrowserRuntime.getStatus(userId),
        openClawConnectorRuntime.listCatalog(userId),
      ]);
      const processes = openClawProcessRuntime.listSessions();
      const extensions = openClawExtensionRuntime.getSummary();
      const sessions = openClawSessionRuntime.getStatus();
      const subagents = openclawSubagentService.getStatus();
      const orchestratorStatus = orchestrationEngine.getStatus();
      const recentRuns = orchestrationEngine.listRuns(10);
      const warnings: string[] = [];

      if (tasks.startupError) {
        warnings.push(tasks.startupError);
      }
      if (sessions.errorSessions > 0) {
        warnings.push(`Session runtime has ${sessions.errorSessions} error session(s).`);
      }
      if (sessions.interruptedSessions > 0) {
        warnings.push(
          `Session runtime has ${sessions.interruptedSessions} interrupted session(s).`,
        );
      }

      return res.json({
        generatedAt: new Date().toISOString(),
        health: {
          ok: warnings.length === 0,
          modules: buildRuntimeModules(),
          warnings,
        },
        controlPlane,
        superAgent,
        background: {
          tasks,
          jobs,
          runs,
          wakes,
          processes: {
            count: processes.count,
            running: processes.sessions.filter((session) => session.status === "running").length,
            recent: processes.sessions.slice(0, 10),
          },
          extensions,
          subagents,
          sessions,
        },
        browser,
        connectors: summarizeConnectorCatalog(connectorCatalog),
        orchestrator: {
          status: orchestratorStatus,
          recentRuns,
        },
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/health", async (_req, res) => {
    try {
      const controlPlane = getAgentControlPlaneSnapshot();
      const superAgent = await openClawSuperAgentRuntime.getStatus({
        includeProbes: false,
      });
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        modules: buildRuntimeModules(),
        controlPlane: {
          brain: controlPlane.roles.brain,
          research: controlPlane.roles.research,
          speed: controlPlane.roles.speed,
          capabilities: controlPlane.capabilities,
        },
        superAgent: {
          requestedOpenClawTag: superAgent.requestedOpenClawTag,
          localOpenClawVersion: superAgent.localOpenClawVersion,
          connectors: {
            totalConnectors: superAgent.connectors.totalConnectors,
            totalCapabilities: superAgent.connectors.totalCapabilities,
            coreConnectors: superAgent.connectors.coreConnectors,
          },
          ecosystem: {
            enabledServices: superAgent.ecosystem.enabledServices,
            featuredServices: superAgent.ecosystem.featuredServices,
          },
          capabilities: superAgent.capabilities,
        },
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/control-plane", (_req, res) => {
    return res.json(getAgentControlPlaneSnapshot());
  });

  router.get("/superagent/status", async (req, res) => {
    try {
      const timeoutMs = parseTimeoutMs(req.query.timeoutMs, 1500);
      return res.json(
        await openClawSuperAgentRuntime.getStatus({
          includeProbes: true,
          probeTimeoutMs: timeoutMs,
        }),
      );
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/browser/status", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      return res.json(await openClawBrowserRuntime.getStatus(userId));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/browser/profiles", (_req, res) => {
    return res.json({
      profiles: openClawBrowserRuntime.listProfiles(),
    });
  });

  router.get("/browser/sessions", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const sessions = await openClawBrowserRuntime.listSessions(userId);
      return res.json({
        count: sessions.length,
        sessions,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/browser/sessions", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = browserCreateSessionSchema.parse(req.body || {});
      const session = await openClawBrowserRuntime.createSession({
        userId,
        controller: parsed.controller,
        mode: parsed.mode,
        profileId: parsed.profileId,
        objective: parsed.objective,
        allowedDomains: parsed.allowedDomains,
        viewport: parsed.viewport,
      });
      return res.status(201).json(session);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/browser/sessions/:sessionId", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const session = await openClawBrowserRuntime.getSession(userId, req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.json(session);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.delete("/browser/sessions/:sessionId", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const result = await openClawBrowserRuntime.closeSession(userId, req.params.sessionId);
      if (!result) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/browser/sessions/:sessionId/navigate", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = browserNavigateSchema.parse(req.body || {});
      const result = await openClawBrowserRuntime.navigate({
        userId,
        sessionId: req.params.sessionId,
        url: parsed.url,
        waitUntil: parsed.waitUntil,
        timeout: parsed.timeout,
        tabId: parsed.tabId,
      });
      if (!result) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.status(result.success ? 200 : 409).json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/browser/sessions/:sessionId/interact", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = browserInteractSchema.parse(req.body || {});
      const result = await openClawBrowserRuntime.interact({
        userId,
        sessionId: req.params.sessionId,
        action: parsed.action,
        selector: parsed.selector,
        text: parsed.text,
        value: parsed.value,
        values: parsed.values,
        clear: parsed.clear,
        delay: parsed.delay,
        pressEnter: parsed.pressEnter,
        direction: parsed.direction,
        amount: parsed.amount,
        button: parsed.button,
        clickCount: parsed.clickCount,
        force: parsed.force,
        coordinates: parsed.coordinates,
        modifiers: parsed.modifiers,
      });
      if (!result) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.status(result.success ? 200 : 409).json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/browser/sessions/:sessionId/extract", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = browserExtractSchema.parse(req.body || {});
      const result = await openClawBrowserRuntime.extract({
        userId,
        sessionId: req.params.sessionId,
        rules: parsed.rules as any,
        description: parsed.description,
      });
      if (!result) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/browser/sessions/:sessionId/screenshot", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = browserScreenshotQuerySchema.parse(req.query || {});
      const result = await openClawBrowserRuntime.screenshot({
        userId,
        sessionId: req.params.sessionId,
        fullPage: parsed.fullPage,
        selector: parsed.selector,
        type: parsed.type,
        quality: parsed.quality,
      });
      if (!result) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/browser/sessions/:sessionId/analyze", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = browserAnalyzeSchema.parse(req.body || {});
      const result = await openClawBrowserRuntime.analyze({
        userId,
        sessionId: req.params.sessionId,
        query: parsed.query,
      });
      if (!result) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/browser/sessions/:sessionId/agentic", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = browserAgenticSchema.parse(req.body || {});
      const result = await openClawBrowserRuntime.runAgentic({
        userId,
        sessionId: req.params.sessionId,
        goal: parsed.goal,
        maxSteps: parsed.maxSteps,
        allowedDomains: parsed.allowedDomains,
        task: parsed.task as any,
      });
      if (!result) {
        return res.status(404).json({ error: "Browser session not found" });
      }
      return res.json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/connectors/catalog", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = connectorCatalogSchema.parse(req.query || {});
      let connectors = await openClawConnectorRuntime.listCatalog(userId);

      if (parsed.connected === true) {
        connectors = connectors.filter((connector) => connector.connected);
      }
      if (parsed.enabled === true) {
        connectors = connectors.filter((connector) => connector.enabledForUser);
      }
      if (parsed.category) {
        const category = parsed.category.toLowerCase();
        connectors = connectors.filter(
          (connector) => connector.category.toLowerCase() === category,
        );
      }

      return res.json({
        count: connectors.length,
        connectors,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/connectors/:connectorId", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const connector = await openClawConnectorRuntime.getConnector(
        userId,
        req.params.connectorId,
      );
      if (!connector) {
        return res.status(404).json({ error: "Connector not found" });
      }
      return res.json(connector);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/connectors/:connectorId/operations/:operationId/execute", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = connectorExecuteSchema.parse(req.body || {});
      const result = await openClawConnectorRuntime.executeOperation({
        userId,
        connectorId: req.params.connectorId,
        operationId: req.params.operationId,
        input: parsed.input,
        chatId: parsed.chatId,
        runId: parsed.runId,
        confirmed: parsed.confirmed,
      });
      return res.status(mapConnectorExecutionStatus(result)).json(result);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/background/status", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);
      const tasks = await openClawTaskRuntime.status();
      const processes = openClawProcessRuntime.listSessions();
      const extensions = openClawExtensionRuntime.getSummary();
      const orchestrator = orchestrationEngine.getStatus();
      const subagents = openclawSubagentService.getStatus();
      const sessions = openClawSessionRuntime.getStatus();
      const browser = await openClawBrowserRuntime.getStatus(userId);
      const superAgent = await openClawSuperAgentRuntime.getStatus({
        includeProbes: false,
      });
      return res.json({
        tasks,
        processes: {
          count: processes.count,
          running: processes.sessions.filter((session) => session.status === "running").length,
          recent: processes.sessions.slice(0, 10),
        },
        extensions,
        orchestrator,
        subagents,
        sessions,
        browser,
        superAgent,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/extensions/status", (_req, res) => {
    try {
      return res.json(openClawExtensionRuntime.getStatus());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/plugins/status", (_req, res) => {
    try {
      return res.json(openClawExtensionRuntime.getPluginStatus());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/plugins/reload", (_req, res) => {
    try {
      return res.json(openClawExtensionRuntime.reload());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/hooks/status", (_req, res) => {
    try {
      return res.json(openClawExtensionRuntime.getHookStatus());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/background/wakes", async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit, 20);
      return res.json(await openClawTaskRuntime.listWakeEvents(limit));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/background/cron/jobs", async (req, res) => {
    try {
      const parsed = backgroundCronListSchema.parse(req.query || {});
      return res.json(await openClawTaskRuntime.listPage(parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/cron/jobs", async (req, res) => {
    try {
      const job = await openClawTaskRuntime.addJobFromInput(req.body || {});
      return res.status(201).json(job);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.patch("/background/cron/jobs/:jobId", async (req, res) => {
    try {
      const job = await openClawTaskRuntime.updateJobFromInput(req.params.jobId, req.body || {});
      return res.json(job);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.delete("/background/cron/jobs/:jobId", async (req, res) => {
    try {
      return res.json(await openClawTaskRuntime.removeJob(req.params.jobId));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/cron/jobs/:jobId/run", async (req, res) => {
    try {
      const parsed = backgroundCronRunSchema.parse(req.body || {});
      return res.json(await openClawTaskRuntime.runJob(req.params.jobId, parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/background/cron/runs", async (req, res) => {
    try {
      const parsed = backgroundCronRunsSchema.parse(req.query || {});
      return res.json(await openClawTaskRuntime.listRuns(parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/cron/wake", async (req, res) => {
    try {
      const parsed = backgroundWakeSchema.parse(req.body || {});
      return res.json(await openClawTaskRuntime.wake(parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/background/heartbeat", async (_req, res) => {
    try {
      return res.json(await openClawTaskRuntime.getHeartbeatStatus());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/heartbeat/request", async (req, res) => {
    try {
      const parsed = backgroundHeartbeatRequestSchema.parse(req.body || {});
      return res.json(await openClawTaskRuntime.requestHeartbeat(parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/heartbeat/run", async (req, res) => {
    try {
      const parsed = backgroundHeartbeatRunSchema.parse(req.body || {});
      return res.json(await openClawTaskRuntime.runHeartbeatNow(parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/sessions/status", (_req, res) => {
    try {
      return res.json(openClawSessionRuntime.getStatus());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/sessions", (req, res) => {
    try {
      const parsed = sessionListSchema.parse(req.query || {});
      return res.json(openClawSessionRuntime.listSessions(parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/sessions/:sessionKey", (req, res) => {
    try {
      const session = openClawSessionRuntime.getSession(req.params.sessionKey);
      if (!session) {
        return res.status(404).json({ error: "Session runtime not found" });
      }
      return res.json(session);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/sessions/:sessionKey/recover", (req, res) => {
    try {
      const parsed = sessionRecoverSchema.parse(req.body || {});
      return res.json(openClawSessionRuntime.recoverSession(req.params.sessionKey, parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/background/processes", (_req, res) => {
    try {
      return res.json(openClawProcessRuntime.listSessions());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/processes/:sessionId/poll", async (req, res) => {
    try {
      const parsed = backgroundProcessPollSchema.parse(req.body || {});
      return res.json(
        await openClawProcessRuntime.pollSession(req.params.sessionId, parsed.timeoutMs),
      );
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/background/processes/:sessionId/log", (req, res) => {
    try {
      return res.json(
        openClawProcessRuntime.getSessionLog(
          req.params.sessionId,
          typeof req.query.offset === "string" ? Number(req.query.offset) : undefined,
          typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
        ),
      );
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/processes/:sessionId/write", async (req, res) => {
    try {
      const parsed = backgroundProcessWriteSchema.parse(req.body || {});
      return res.json(
        await openClawProcessRuntime.writeToSession(
          req.params.sessionId,
          parsed.data,
          parsed.eof,
        ),
      );
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/processes/:sessionId/send-keys", async (req, res) => {
    try {
      const parsed = backgroundProcessSendKeysSchema.parse(req.body || {});
      return res.json(await openClawProcessRuntime.sendKeys(req.params.sessionId, parsed));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/processes/:sessionId/submit", async (req, res) => {
    try {
      return res.json(await openClawProcessRuntime.submitSession(req.params.sessionId));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/processes/:sessionId/paste", async (req, res) => {
    try {
      const parsed = backgroundProcessPasteSchema.parse(req.body || {});
      return res.json(
        await openClawProcessRuntime.pasteToSession(
          req.params.sessionId,
          parsed.text,
          parsed.bracketed,
        ),
      );
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/processes/:sessionId/kill", (req, res) => {
    try {
      return res.json(openClawProcessRuntime.killSession(req.params.sessionId));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/background/processes/:sessionId/clear", (req, res) => {
    try {
      return res.json(openClawProcessRuntime.clearSession(req.params.sessionId));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.delete("/background/processes/:sessionId", (req, res) => {
    try {
      return res.json(openClawProcessRuntime.removeSession(req.params.sessionId));
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/skills", (_req, res) => {
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
      const config = getOpenClawConfig();
      await initSkills(config);
      return res.json({
        reloaded: true,
        count: skillRegistry.list().length,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || "Failed to reload skills",
      });
    }
  });

  router.post("/skills/resolve", (req, res) => {
    try {
      const parsed = skillsResolveSchema.parse(req.body || {});
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

  router.get("/orchestrator/runs", (req, res) => {
    try {
      const limit = parseLimit(req.query.limit, 20);
      return res.json({
        runs: orchestrationEngine.listRuns(limit),
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/orchestrator/status", (_req, res) => {
    try {
      return res.json(orchestrationEngine.getStatus());
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/orchestrator/runs/:runId", (req, res) => {
    try {
      const run = orchestrationEngine.getRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: "Orchestration run not found" });
      }
      return res.json(run);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/orchestrator/plan", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = objectiveSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const orchestratorSkill = await resolveOrchestratorSkillContextForUser({
        userId,
        objective: parsed.objective,
      });
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity, {
        skillContext: orchestratorSkill.skillContext,
      });
      const plan = orchestrationEngine.buildExecutionPlan(subtasks, {
        skillContext: orchestratorSkill.skillContext,
      });
      return res.json({
        objective: parsed.objective,
        complexity,
        subtasks,
        plan,
        activeSkillId: orchestratorSkill.activeSkillId,
        skillContext: orchestratorSkill.skillContext,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/orchestrator/run", async (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = objectiveSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const orchestratorSkill = await resolveOrchestratorSkillContextForUser({
        userId,
        objective: parsed.objective,
      });
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity, {
        skillContext: orchestratorSkill.skillContext,
      });
      const plan = orchestrationEngine.buildExecutionPlan(subtasks, {
        skillContext: orchestratorSkill.skillContext,
      });
      const execution = await orchestrationEngine.executeParallel(plan);
      const combined = orchestrationEngine.combineResults(execution);
      return res.json({
        objective: parsed.objective,
        complexity,
        subtasks,
        plan,
        execution,
        combined,
        activeSkillId: orchestratorSkill.activeSkillId,
        skillContext: orchestratorSkill.skillContext,
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
      const parsed = orchestratorFlowSchema.parse(req.body || {});
      const complexity = normalizeComplexity(parsed.objective, parsed.complexity);
      const orchestratorSkill = await resolveOrchestratorSkillContextForUser({
        userId,
        objective: parsed.objective,
      });
      const subtasks = await orchestrationEngine.decomposeTask(parsed.objective, complexity, {
        skillContext: orchestratorSkill.skillContext,
      });
      const plan = orchestrationEngine.buildExecutionPlan(subtasks, {
        skillContext: orchestratorSkill.skillContext,
      });

      const delegatedRuns = parsed.spawnSubagents
        ? subtasks.slice(0, parsed.maxSubagents).map((subtask) =>
            openclawSubagentService.spawn({
              requesterUserId: userId,
              objective: subtask.description,
              planHint: subtask.toolId ? [`use:${subtask.toolId}`] : [],
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
        activeSkillId: orchestratorSkill.activeSkillId,
        skillContext: orchestratorSkill.skillContext,
      });
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.post("/subagents", (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    try {
      const parsed = spawnSubagentSchema.parse(req.body || {});
      const run = openclawSubagentService.spawn({
        requesterUserId: userId,
        objective: parsed.objective,
        planHint: parsed.planHint || [],
        parentRunId: parsed.parentRunId,
      });
      return res.status(202).json(run);
    } catch (error) {
      return respondError(res, error);
    }
  });

  router.get("/subagents", (req, res) => {
    const userId = getOrCreateSecureUserId(req);
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

  router.get("/subagents/status", (_req, res) => {
    return res.json(openclawSubagentService.getStatus());
  });

  router.get("/subagents/:runId", (req, res) => {
    const userId = getOrCreateSecureUserId(req);
    const run = openclawSubagentService.get(req.params.runId);
    if (!run || run.requesterUserId !== userId) {
      return res.status(404).json({ error: "Subagent run not found" });
    }
    return res.json(run);
  });

  router.post("/subagents/:runId/cancel", (req, res) => {
    const userId = getOrCreateSecureUserId(req);
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
