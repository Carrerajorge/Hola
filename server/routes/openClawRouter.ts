/**
 * OpenClaw 500 Capabilities Verification API
 * Endpoints for querying, verifying, and reporting on all 500 capabilities.
 */

import { Router, Request, Response, NextFunction } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAdmin as requireAdminMiddleware } from "./admin/utils";
import {
  OPENCLAW_500,
  getOpenClawStats,
  getCapabilityById,
  getCapabilitiesByCategory,
  getGaps,
  type OpenClawCategory,
} from "../data/openClaw500Mapping";
import {
  verifyCapability,
  verifyBatch,
  generateReport,
  getQuickStats,
} from "../services/openClawVerifier";
import {
  listOpenClaw1000Capabilities,
  getOpenClaw1000Capability,
  getOpenClaw1000QuickStats,
  verifyOpenClaw1000Capability,
  verifyOpenClaw1000Batch,
  generateOpenClaw1000Report,
  getOpenClaw1000ExecutionRoadmap,
} from "../services/openClaw1000Service";


const execFileAsync = promisify(execFile);

const OPENCLAW_CLI_BINARY = process.env.OPENCLAW_CLI_BINARY || "openclaw";
const OPENCLAW_BRIDGE_ENABLED = (process.env.OPENCLAW_BRIDGE_ENABLED ?? "true").toLowerCase() !== "false";
const OPENCLAW_DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.OPENCLAW_DEFAULT_TIMEOUT_MS || "30000", 10);

type CliRunResult = {
  ok: boolean;
  stdout?: unknown;
  stderr?: string;
  command: string;
  args: string[];
  raw?: string;
};

const router = Router();

function parseCliOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch (_e) {
    // CLI may print logs before JSON. Try the last non-empty JSON-ish line.
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch (_inner) {
        // noop
      }
    }
    return null;
  }
}

async function runOpenClawCli(args: string[], timeoutMs = OPENCLAW_DEFAULT_TIMEOUT_MS): Promise<CliRunResult> {
  if (!OPENCLAW_BRIDGE_ENABLED) {
    throw new Error("OpenClaw bridge is disabled. Set OPENCLAW_BRIDGE_ENABLED=true to enable.");
  }

  const command = `${OPENCLAW_CLI_BINARY}`;

  const { stdout, stderr } = await execFileAsync(OPENCLAW_CLI_BINARY, args, {
    timeout: timeoutMs,
    maxBuffer: 12 * 1024 * 1024,
    env: {
      ...process.env,
    },
  });

  const parsed = parseCliOutput(stdout.toString());

  return {
    ok: true,
    stdout: parsed !== null ? parsed : undefined,
    stderr: stderr?.toString() || undefined,
    command,
    args,
    raw: parsed === null ? stdout.toString() : undefined,
  };
}

function enforceJsonArg(args: string[]) {
  if (!args.includes("--json")) {
    return [...args, "--json"];
  }
  return args;
}

function requireBridgeEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!OPENCLAW_BRIDGE_ENABLED) {
    return res.status(503).json({
      success: false,
      error: "OpenClaw bridge disabled",
    });
  }
  return next();
}

// ===== OpenClaw bridge: node control operations (functionality only) =====
router.get("/bridge/health", requireAdminMiddleware, requireBridgeEnabled, async (_req, res) => {
  try {
    const r = await runOpenClawCli(["nodes", "status", "--json"]);
    res.json({ success: true, source: "cli", ...r });
  } catch (error: any) {
    const message = error?.message || "OpenClaw CLI unavailable";
    res.status(500).json({ success: false, error: message });
  }
});

router.get("/bridge/nodes", requireAdminMiddleware, requireBridgeEnabled, async (_req, res) => {
  try {
    const r = await runOpenClawCli(enforceJsonArg(["nodes", "list"]));
    res.json({ success: true, ...r });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to list nodes" });
  }
});


router.get("/bridge/nodes/pending", requireAdminMiddleware, requireBridgeEnabled, async (_req, res) => {
  try {
    const r = await runOpenClawCli(enforceJsonArg(["nodes", "pending"]));
    res.json({ success: true, ...r });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to list pending node requests" });
  }
});

router.get("/bridge/nodes/status", requireAdminMiddleware, requireBridgeEnabled, async (_req, res) => {
  try {
    const r = await runOpenClawCli(enforceJsonArg(["nodes", "status"]));
    res.json({ success: true, ...r });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to get node status" });
  }
});


router.get("/bridge/nodes/:node", requireAdminMiddleware, requireBridgeEnabled, async (req, res) => {
  try {
    const node = req.params.node;
    if (!node) {
      return res.status(400).json({ success: false, error: "node is required" });
    }
    const r = await runOpenClawCli(enforceJsonArg(["nodes", "describe", "--node", node]));
    res.json({ success: true, ...r });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to describe node" });
  }
});

router.post("/bridge/nodes/:node/invoke", requireAdminMiddleware, requireBridgeEnabled, async (req, res) => {
  try {
    const node = req.params.node;
    const { command, params = {}, invokeTimeoutMs, timeoutMs } = req.body || {};

    if (!node) {
      return res.status(400).json({ success: false, error: "node is required" });
    }
    if (typeof command !== "string" || !command.trim()) {
      return res.status(400).json({ success: false, error: "command is required" });
    }

    const safeParams = typeof params === "object" && params !== null ? JSON.stringify(params) : "{}";
    const args = enforceJsonArg(["nodes", "invoke", "--node", node, "--command", command, "--params", safeParams]);

    if (Number.isFinite(invokeTimeoutMs)) {
      args.push("--invoke-timeout", String(Number(invokeTimeoutMs)));
    }

    const r = await runOpenClawCli(args, Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : OPENCLAW_DEFAULT_TIMEOUT_MS);
    res.json({ success: true, ...r });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to invoke node command" });
  }
});

router.post("/bridge/nodes/:node/run", requireAdminMiddleware, requireBridgeEnabled, async (req, res) => {
  try {
    const node = req.params.node;
    const { raw, commandTimeoutMs, timeoutMs, invokeTimeoutMs } = req.body || {};

    if (!node) {
      return res.status(400).json({ success: false, error: "node is required" });
    }
    if (typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({ success: false, error: "raw is required" });
    }

    const args = enforceJsonArg(["nodes", "run", "--node", node, "--raw", raw]);

    if (Number.isFinite(commandTimeoutMs)) {
      args.push("--command-timeout", String(Math.max(1, Number(commandTimeoutMs))));
    }
    if (Number.isFinite(invokeTimeoutMs)) {
      args.push("--invoke-timeout", String(Math.max(1, Number(invokeTimeoutMs))));
    }

    const r = await runOpenClawCli(args, Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : OPENCLAW_DEFAULT_TIMEOUT_MS);
    res.json({ success: true, ...r });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to run node raw command" });
  }
});

router.get("/bridge/openclaw-caps", requireAdminMiddleware, async (_req, res) => {
  res.json({
    success: true,
    enabled: OPENCLAW_BRIDGE_ENABLED,
    cliBinary: OPENCLAW_CLI_BINARY,
    defaultTimeoutMs: OPENCLAW_DEFAULT_TIMEOUT_MS,
    supported: [
      "nodes/list",
      "nodes/status",
      "nodes/describe",
      "nodes/pending",
      "nodes/invoke",
      "nodes/run",
      "bridge/health",
    ],
  });
});

/**
 * GET /api/openclaw/capabilities
 * Returns all 500 capabilities with optional filters.
 * Query params: ?category=academic_research&status=implemented
 */
router.get("/capabilities", (req: Request, res: Response) => {
  try {
    const { category, status } = req.query;

    let capabilities = OPENCLAW_500;

    if (category && typeof category === "string") {
      capabilities = capabilities.filter((c) => c.category === category);
    }

    if (status && typeof status === "string") {
      capabilities = capabilities.filter((c) => c.status === status);
    }

    const stats = getOpenClawStats();

    res.json({
      success: true,
      total: capabilities.length,
      stats,
      capabilities,
    });
  } catch (error: any) {
    console.error("[OpenClaw] Error listing capabilities:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/capabilities/:id
 * Returns a single capability by ID.
 */
router.get("/capabilities/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const capability = getCapabilityById(id);
    if (!capability) {
      return res.status(404).json({ success: false, error: `Capability ${id} not found` });
    }

    res.json({ success: true, capability });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/stats
 * Quick stats without full verification.
 */
router.get("/stats", (_req: Request, res: Response) => {
  try {
    const stats = getQuickStats();
    res.json({ success: true, ...stats });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/gaps
 * Returns only stub/missing capabilities.
 */
router.get("/gaps", (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    let gaps = getGaps();

    if (category && typeof category === "string") {
      gaps = gaps.filter((g) => g.category === category);
    }

    const byCategory = gaps.reduce((acc, g) => {
      if (!acc[g.category]) acc[g.category] = [];
      acc[g.category].push(g);
      return acc;
    }, {} as Record<string, typeof gaps>);

    res.json({
      success: true,
      total: gaps.length,
      byCategory,
      gaps,
    });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting gaps:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/openclaw/verify/:id
 * Run verification for a single capability.
 */
router.post("/verify/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const result = await verifyCapability(id);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("[OpenClaw] Error verifying capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/openclaw/verify/batch
 * Run batch verification.
 * Body: { ids?: number[], category?: string }
 */
router.post("/verify/batch", async (req: Request, res: Response) => {
  try {
    const { ids, category } = req.body || {};

    const results = await verifyBatch({
      ids: ids as number[] | undefined,
      category: category as OpenClawCategory | undefined,
    });

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.verifyStatus === "PASS").length,
      failed: results.filter((r) => r.verifyStatus === "FAIL").length,
      skipped: results.filter((r) => r.verifyStatus === "SKIP").length,
      stubs: results.filter((r) => r.verifyStatus === "STUB").length,
      errors: results.filter((r) => r.verifyStatus === "ERROR").length,
    };

    res.json({ success: true, summary, results });
  } catch (error: any) {
    console.error("[OpenClaw] Error in batch verification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/report
 * Full 500-capability verification report.
 */
router.get("/report", async (_req: Request, res: Response) => {
  try {
    const report = await generateReport();
    res.json({ success: true, report });
  } catch (error: any) {
    console.error("[OpenClaw] Error generating report:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/openclaw/categories
 * Returns capability breakdown by category.
 */
router.get("/categories", (_req: Request, res: Response) => {
  try {
    const categories: OpenClawCategory[] = [
      "academic_research",
      "web_realtime_search",
      "browser_automation",
      "documents_and_library",
      "agent_autonomy_multiagent",
      "platform_messaging_ops_security",
    ];

    const breakdown = categories.map((cat) => {
      const caps = getCapabilitiesByCategory(cat);
      return {
        category: cat,
        total: caps.length,
        implemented: caps.filter((c) => c.status === "implemented").length,
        partial: caps.filter((c) => c.status === "partial").length,
        stub: caps.filter((c) => c.status === "stub").length,
        missing: caps.filter((c) => c.status === "missing").length,
        coveragePercent: Math.round(
          ((caps.filter((c) => c.status === "implemented" || c.status === "partial").length) / caps.length) * 1000
        ) / 10,
      };
    });

    res.json({ success: true, categories: breakdown });
  } catch (error: any) {
    console.error("[OpenClaw] Error getting categories:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * =========================
 * OpenClaw 1000 Endpoints
 * =========================
 */

router.get("/capabilities-1000", (req: Request, res: Response) => {
  try {
    const { category, status } = req.query;
    const capabilities = listOpenClaw1000Capabilities({
      category: typeof category === "string" ? category : undefined,
      status: typeof status === "string" ? status : undefined,
    });

    res.json({
      success: true,
      total: capabilities.length,
      stats: getOpenClaw1000QuickStats(),
      capabilities,
    });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error listing capabilities:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/capabilities-1000/:id", (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const capability = getOpenClaw1000Capability(id);
    if (!capability) {
      return res.status(404).json({ success: false, error: `Capability ${id} not found` });
    }

    res.json({ success: true, capability });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error getting capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/stats-1000", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...getOpenClaw1000QuickStats() });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error getting stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/verify-1000/:id([0-9]+)", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid capability ID" });
    }

    const result = await verifyOpenClaw1000Capability(id);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error verifying capability:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/verify-1000/batch", async (req: Request, res: Response) => {
  try {
    const { ids, category } = req.body || {};
    const results = await verifyOpenClaw1000Batch({
      ids: Array.isArray(ids) ? ids : undefined,
      category: typeof category === "string" ? category : undefined,
    });

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.verifyStatus === "PASS").length,
      failed: results.filter((r) => r.verifyStatus === "FAIL").length,
      skipped: results.filter((r) => r.verifyStatus === "SKIP").length,
      stubs: results.filter((r) => r.verifyStatus === "STUB").length,
      errors: results.filter((r) => r.verifyStatus === "ERROR").length,
    };

    res.json({ success: true, summary, results });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error in batch verification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/report-1000", async (_req: Request, res: Response) => {
  try {
    const report = await generateOpenClaw1000Report();
    res.json({ success: true, report });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error generating report:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/categories-1000", (_req: Request, res: Response) => {
  try {
    const allCapabilities = listOpenClaw1000Capabilities();
    const categories = [...new Set(allCapabilities.map((c) => c.category))];
    const breakdown = categories.map((cat) => {
      const caps = allCapabilities.filter((capability) => capability.category === cat);
      return {
        category: cat,
        total: caps.length,
        implemented: caps.filter((c) => c.status === "implemented").length,
        partial: caps.filter((c) => c.status === "partial").length,
        stub: caps.filter((c) => c.status === "stub").length,
        missing: caps.filter((c) => c.status === "missing").length,
        coveragePercent: Math.round(
          ((caps.filter((c) => c.status === "implemented" || c.status === "partial").length) / caps.length) * 1000
        ) / 10,
      };
    });

    res.json({ success: true, categories: breakdown });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error getting categories:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/roadmap-1000", (req: Request, res: Response) => {
  try {
    const startIdRaw = typeof req.query.startId === "string" ? Number.parseInt(req.query.startId, 10) : 1;
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 50;

    const roadmap = getOpenClaw1000ExecutionRoadmap({
      startId: Number.isFinite(startIdRaw) ? startIdRaw : 1,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });

    res.json({ success: true, roadmap });
  } catch (error: any) {
    console.error("[OpenClaw1000] Error generating roadmap:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
