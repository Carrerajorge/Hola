/**
 * OpenClaw 500 Capabilities Verification API
 * Endpoints for querying, verifying, and reporting on all 500 capabilities.
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
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
import {
  DEFAULT_OPENCLAW_RELEASE_TAG,
  getOpenClawReleaseSnapshot,
} from "../services/openClawReleaseService";
import { executeOpenClawNativePrompt } from "../services/openClawNativeExecution";
import {
  getOrCreateSecureUserId,
  isAuthenticated as isAuthenticatedRequest,
} from "../lib/anonUserHelper";
import { loadConfig } from "../services/superIntelligence/config/config.js";
import {
  resolveGatewayAuth,
  type ResolvedGatewayAuthMode,
} from "../services/superIntelligence/gateway/auth.js";

// Native OpenClaw Integration

const openClawNativeExecuteSchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required"),
  context: z.unknown().optional(),
  chatId: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  model: z.string().trim().optional(),
  timeoutMs: z.coerce.number().int().min(5_000).max(600_000).optional(),
  enableTools: z.boolean().optional().default(false),
});

const OPENCLAW_CONTROL_UI_FALLBACK_BASE_PATH = "/openclaw-ui";

type OpenClawControlUiLaunchState = {
  available: boolean;
  authMode: ResolvedGatewayAuthMode;
  basePath: string;
  manualUrl: string;
  launchUrl: string;
  token?: string;
  reason?: string;
};

const router = Router();

function ensureAuthenticatedRequest(req: Request, res: Response): boolean {
  if (isAuthenticatedRequest(req)) {
    return true;
  }
  res.status(401).json({
    success: false,
    error: "Authentication required",
  });
  return false;
}

function normalizeOpenClawControlUiSessionKey(value: unknown): string {
  if (typeof value !== "string") {
    return "main";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "main";
  }
  return /^[a-zA-Z0-9:_-]{1,120}$/.test(trimmed) ? trimmed : "main";
}

function buildOpenClawControlUiManualUrl(basePath: string, sessionKey: string): string {
  const normalizedBasePath = basePath === "" ? "/" : `${basePath}/`;
  const url = new URL(normalizedBasePath, "http://localhost");
  url.searchParams.set("session", sessionKey);
  return `${url.pathname}${url.search}`;
}

function buildOpenClawControlUiLaunchLocation(
  state: OpenClawControlUiLaunchState,
  sessionKey: string,
): string {
  const manualUrl = buildOpenClawControlUiManualUrl(state.basePath, sessionKey);
  if (state.authMode !== "token" || !state.token) {
    return manualUrl;
  }
  return `${manualUrl}#token=${encodeURIComponent(state.token)}`;
}

function resolveOpenClawControlUiLaunchState(sessionKey = "main"): OpenClawControlUiLaunchState {
  const cfg = loadConfig();
  // This application hard-mounts the embedded Control UI at /openclaw-ui.
  // Keep launcher URLs aligned with that served route instead of a gateway-only basePath.
  const basePath = OPENCLAW_CONTROL_UI_FALLBACK_BASE_PATH;
  const auth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    env: process.env,
    tailscaleMode: cfg.gateway?.tailscale?.mode,
  });
  const manualUrl = buildOpenClawControlUiManualUrl(basePath, sessionKey);
  const launchUrl = `/api/openclaw/control-ui/launch?session=${encodeURIComponent(sessionKey)}`;
  const token = typeof auth.token === "string" ? auth.token.trim() : "";

  if (cfg.gateway?.controlUi?.enabled === false) {
    return {
      available: false,
      authMode: auth.mode,
      basePath,
      manualUrl,
      launchUrl,
      reason: "Control UI is disabled in gateway.controlUi.enabled.",
    };
  }

  if (auth.mode === "password") {
    return {
      available: false,
      authMode: auth.mode,
      basePath,
      manualUrl,
      launchUrl,
      reason: "Gateway password mode still requires manual sign-in inside the Control UI.",
    };
  }

  if (auth.mode === "token" && !token) {
    return {
      available: false,
      authMode: auth.mode,
      basePath,
      manualUrl,
      launchUrl,
      reason: auth.allowTailscale
        ? "Gateway auth is satisfied by Tailscale identity but no reusable dashboard token is configured."
        : "Gateway token auth is enabled but no gateway.auth.token is configured.",
    };
  }

  return {
    available: true,
    authMode: auth.mode,
    basePath,
    manualUrl,
    launchUrl,
    token: token || undefined,
  };
}

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
 * GET /api/openclaw/release
 * Returns the requested OpenClaw release plus latest-release sync status.
 */
router.get("/release", async (req: Request, res: Response) => {
  try {
    const tag =
      typeof req.query.tag === "string" && req.query.tag.trim()
        ? req.query.tag.trim()
        : DEFAULT_OPENCLAW_RELEASE_TAG;

    const snapshot = await getOpenClawReleaseSnapshot(tag);
    res.json({
      success: true,
      ...snapshot,
    });
  } catch (error: any) {
    console.error("[OpenClaw] Error fetching release snapshot:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to fetch OpenClaw release snapshot",
    });
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

router.get("/control-ui/meta", rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests",
  },
}), (req: Request, res: Response) => {
  try {
    if (!ensureAuthenticatedRequest(req, res)) {
      return;
    }

    const sessionKey = normalizeOpenClawControlUiSessionKey(req.query.session);
    const state = resolveOpenClawControlUiLaunchState(sessionKey);

    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Vary", "Cookie");
    res.json({
      success: true,
      available: state.available,
      authMode: state.authMode,
      basePath: state.basePath,
      manualUrl: state.manualUrl,
      launchUrl: state.launchUrl,
      embedding: "same-origin",
      ...(state.reason ? { reason: state.reason } : {}),
    });
  } catch (error: any) {
    console.error("[OpenClaw Control UI] Error resolving launch metadata:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to resolve OpenClaw Control UI metadata",
    });
  }
});

router.get("/control-ui/launch", rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests",
  },
}), (req: Request, res: Response) => {
  try {
    if (!ensureAuthenticatedRequest(req, res)) {
      return;
    }

    const sessionKey = normalizeOpenClawControlUiSessionKey(req.query.session);
    const state = resolveOpenClawControlUiLaunchState(sessionKey);
    if (!state.available) {
      return res.status(409).json({
        success: false,
        error: state.reason || "OpenClaw Control UI launch is not available.",
        authMode: state.authMode,
        manualUrl: state.manualUrl,
      });
    }

    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Vary", "Cookie");
    res.redirect(302, buildOpenClawControlUiLaunchLocation(state, sessionKey));
  } catch (error: any) {
    console.error("[OpenClaw Control UI] Error launching native dashboard:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to launch OpenClaw Control UI",
    });
  }
});

/**
 * =========================
 * OpenClaw Native Fusion Endpoint (RAG & Intent Understanding)
 * =========================
 */
router.post("/execute", async (req: Request, res: Response) => {
  try {
    const parsed = openClawNativeExecuteSchema.parse(req.body || {});
    const userId = getOrCreateSecureUserId(req);
    const result = await executeOpenClawNativePrompt({
      prompt: parsed.prompt,
      context: parsed.context,
      chatId: parsed.chatId,
      userId,
      provider: parsed.provider,
      model: parsed.model,
      timeoutMs: parsed.timeoutMs,
      enableTools: parsed.enableTools,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        details: error.flatten(),
      });
    }
    console.error("[OpenClaw Native] Error executing native engine:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
