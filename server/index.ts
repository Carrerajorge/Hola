
// Polyfill browser globals needed by pdf-parse and canvas libraries in Node.js
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    a: number; b: number; c: number; d: number; e: number; f: number;
    m11: number; m12: number; m13: number; m14: number;
    m21: number; m22: number; m23: number; m24: number;
    m31: number; m32: number; m33: number; m34: number;
    m41: number; m42: number; m43: number; m44: number;
    constructor() { this.m11=1;this.m12=0;this.m13=0;this.m14=0;this.m21=0;this.m22=1;this.m23=0;this.m24=0;this.m31=0;this.m32=0;this.m33=1;this.m34=0;this.m41=0;this.m42=0;this.m43=0;this.m44=1;this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; }
  } as any;
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData { 
    width: number; height: number; data: Uint8ClampedArray;
    constructor(w: number, h: number) { this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4); } 
  } as any;
}
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D { constructor() {} } as any;
}

import "./otel";

import "./config/load-env";
import "./lib/expressAsyncPatch";
import { env } from "./config/env"; // Validates env vars immediately on import

import compression from "compression";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import hpp from "hpp";

import { serveStatic } from "./static";

import { apiErrorHandler } from "./middleware/apiErrorHandler";
import { canonicalUrlMiddleware } from "./middleware/canonicalUrl";
import { corsMiddleware } from "./middleware/cors";
import { CSRF_COOKIE_NAME, CSRF_TOKEN_PATTERN, csrfProtection, csrfTokenMiddleware, issueCsrfCookie } from "./middleware/csrf";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { idempotency } from "./middleware/idempotency";
import { apiSecurityHeaders } from "./middleware/securityHeaders";
import { sessionDeviceInfoMiddleware } from "./middleware/sessionDeviceInfo";
import { setupSecurity } from "./middleware/security";
import { requestBoundaryGuard } from "./middleware/requestBoundary";
import { correlationIdMiddleware } from "./middleware/correlationId";

import { authLimiter, billingLimiter, globalLimiter } from "./middleware/rateLimiter";
import { responseBudget } from "./middleware/responseBudget";
import { abuseDetection, stopAbuseDetectionCleanup } from "./middleware/abuseDetection";
import { requestIntegrity, stopIntegrityCleanup } from "./middleware/requestIntegrity";
import { hostValidation } from "./middleware/hostValidation";
import { hardenServer } from "./middleware/socketHardening";

import { runCleanup } from "./lib/cleanup";
import { db, drainConnections, startHealthChecks, stopHealthChecks, verifyDatabaseConnection } from "./db";
import { setupGracefulShutdown, registerCleanup } from "./lib/gracefulShutdown";
import { Logger } from "./lib/logger";
import { GEMINI_MODELS_REGISTRY, XAI_MODELS } from "./lib/modelRegistry";
import { generateAnonToken } from "./lib/anonToken";
import { pythonServiceManager } from "./lib/pythonServiceManager";
import { requestTracerMiddleware } from "./lib/requestTracer";
import { getTracingMetrics, initTracing, shutdownTracing } from "./lib/tracing";
import { isModelEligibleForPublic } from "./services/modelIntegration";
import { getPublicSettings } from "./services/settingsConfigService";
import { storage } from "./storage";

import { startTelemetryPipeline } from "./telemetry/pipeline";

import { registerAuthRoutes, setupAuth } from "./replit_integrations/auth";
import { getUserId } from "./types/express";
import { runWithContext, type CorrelationContext, updateContext } from "./middleware/correlationContext";
import { validateApiKey } from "./routes/apiKeysRouter";
import { AppError } from "./utils/errors";
import { AgentOS } from "./agentos/index";

const bootTraceEnabled = process.env.BOOT_TRACE === "true";

function bootTrace(message: string) {
  if (bootTraceEnabled) {
    console.error(`[boot] ${message}`);
  }
}

type PublicModelSummary = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string | null;
  isEnabled: string;
  enabledAt: Date | string | null;
  displayOrder: number;
  icon: string | null;
  modelType: string;
  contextWindow: number | null;
};

const PUBLIC_MODEL_FALLBACKS: ReadonlyArray<PublicModelSummary> = Object.freeze([
  {
    id: "fallback-gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    modelId: GEMINI_MODELS_REGISTRY.FLASH_25,
    description: "Modelo rapido y estable",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 0,
    icon: null,
    modelType: "TEXT",
    contextWindow: 1000000,
  },
  {
    id: "fallback-grok-4.1-fast",
    name: "Grok 4.1 Fast",
    provider: "xai",
    modelId: XAI_MODELS.GROK_4_1_FAST,
    description: "Modelo rapido con contexto amplio",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 1,
    icon: null,
    modelType: "TEXT",
    contextWindow: 2000000,
  },
]);

function toPublicModelSummary(model: any): PublicModelSummary {
  return {
    id: String(model.id ?? ""),
    name: String(model.name ?? model.modelId ?? ""),
    provider: String(model.provider ?? ""),
    modelId: String(model.modelId ?? ""),
    description: typeof model.description === "string" ? model.description : null,
    isEnabled: String(model.isEnabled ?? "false"),
    enabledAt: model.enabledAt ?? null,
    displayOrder: Number(model.displayOrder || 0),
    icon: typeof model.icon === "string" ? model.icon : null,
    modelType: String(model.modelType ?? "TEXT"),
    contextWindow:
      typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
        ? model.contextWindow
        : null,
  };
}

const DEFAULT_PUBLIC_USER_PREFERENCES = Object.freeze({
  pushNotifications: true,
  emailNotifications: true,
  soundEffects: true,
  theme: "system",
  language: "es",
  fontSize: "medium",
  streamResponses: true,
  showToolUsage: false,
  autoSaveChats: true,
  reducedMotion: false,
  highContrast: false,
  screenReaderOptimized: false,
});

type MinimalApiUserSettings = {
  userId: string;
  responsePreferences: {
    responseStyle: string;
    responseTone?: string;
    customInstructions: string;
  };
  userProfile: {
    nickname: string;
    occupation: string;
    bio: string;
    showName: boolean;
    linkedInUrl: string;
    githubUrl: string;
    websiteDomain: string;
    receiveEmailComments: boolean;
  };
  featureFlags: {
    memoryEnabled: boolean;
    recordingHistoryEnabled: boolean;
    webSearchAuto: boolean;
    codeInterpreterEnabled: boolean;
    canvasEnabled: boolean;
    voiceEnabled: boolean;
    voiceAdvanced: boolean;
    connectorSearchAuto: boolean;
  };
};

const minimalUserSettingsStore = new Map<string, MinimalApiUserSettings>();

function createDefaultMinimalUserSettings(userId: string): MinimalApiUserSettings {
  return {
    userId,
    responsePreferences: {
      responseStyle: "default",
      customInstructions: "",
    },
    userProfile: {
      nickname: "",
      occupation: "",
      bio: "",
      showName: true,
      linkedInUrl: "",
      githubUrl: "",
      websiteDomain: "",
      receiveEmailComments: false,
    },
    featureFlags: {
      memoryEnabled: true,
      recordingHistoryEnabled: false,
      webSearchAuto: true,
      codeInterpreterEnabled: true,
      canvasEnabled: true,
      voiceEnabled: true,
      voiceAdvanced: false,
      connectorSearchAuto: false,
    },
  };
}

const REQUEST_LOG_SENSITIVE_KEYS = [
  "token",
  "key",
  "secret",
  "password",
  "apiKey",
  "api_key",
  "access_token",
  "refresh_token",
  "code",
  "state",
];

function sanitizeRequestLogValue(value: unknown, depth = 0): unknown {
  if (depth >= 3) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeRequestLogValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = Object.create(null);
    for (const [rawKey, nested] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (rawKey === "__proto__" || rawKey === "prototype" || rawKey === "constructor" || rawKey.startsWith("__")) {
        continue;
      }
      result[rawKey] = sanitizeRequestLogValue(nested, depth + 1);
    }
    return result;
  }
  if (typeof value === "string" && value.length > 200) {
    return `${value.slice(0, 200)}...`;
  }
  return value;
}

function sanitizeQueryForRequestLog(query: Request["query"]): Record<string, unknown> | undefined {
  const entries = Object.entries((query ?? {}) as Record<string, unknown>);
  if (entries.length === 0) {
    return undefined;
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const [key, value] of entries.slice(0, 40)) {
    if (REQUEST_LOG_SENSITIVE_KEYS.some((token) => key.toLowerCase().includes(token.toLowerCase()))) {
      result[key] = "[REDACTED]";
      continue;
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor" || key.startsWith("__")) {
      continue;
    }
    result[key] = sanitizeRequestLogValue(value, 1);
  }
  return result;
}

function requestLoggerMiddlewareLite(req: Request, res: Response, next: NextFunction): void {
  const requestId =
    typeof res.locals.requestId === "string"
      ? res.locals.requestId
      : typeof (req as any).requestId === "string"
        ? (req as any).requestId
        : req.correlationId;
  const startTime = Date.now();

  if (requestId) {
    res.setHeader("X-Trace-Id", requestId);
    res.setHeader("X-Request-Id", requestId);
    res.locals.traceId = requestId;
    res.locals.requestId = requestId;
  }

  const context: CorrelationContext = {
    traceId: requestId || "unknown",
    requestId,
    startTime,
    userId: (req as any).user?.id,
    workspaceId:
      (req as any).user?.workspaceId ??
      (typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"] : undefined),
  };

  runWithContext(context, () => {
    console.info(
      JSON.stringify({
        level: "info",
        component: "http",
        message: "Request started",
        traceId: context.traceId,
        method: req.method,
        path: req.path,
        query: sanitizeQueryForRequestLog(req.query),
        userAgent: req.get("user-agent"),
        ip: req.ip || req.socket.remoteAddress,
      }),
    );

    res.on("finish", () => {
      const payload = {
        level: res.statusCode >= 400 ? "warn" : "info",
        component: "http",
        message: "Request completed",
        traceId: context.traceId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startTime,
      };
      console[res.statusCode >= 400 ? "warn" : "info"](JSON.stringify(payload));
    });

    res.on("error", (error: Error) => {
      console.error(
        JSON.stringify({
          level: "error",
          component: "http",
          message: "Request error",
          traceId: context.traceId,
          method: req.method,
          path: req.path,
          durationMs: Date.now() - startTime,
          error: error.message,
        }),
      );
    });

    next();
  });
}

bootTrace("server/index imports resolved");
initTracing();

const app = express();
app.set("trust proxy", 1); // Trust first proxy (critical for rate limiting behind load balancers)
const httpServer = createServer(app);
let stopTelegramPollingBridge: (() => void) | null = null;

function clampConfigNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

const stopSocketHardening = hardenServer(httpServer, {
  headersTimeout: Number(process.env.SOCKET_HEADERS_TIMEOUT_MS) || 60_000, // 1 min (was 10_000)
  keepAliveTimeout: Number(process.env.SOCKET_KEEP_ALIVE_TIMEOUT_MS) || 605_000, // 10 min 5 sec (was 65_000)
  requestTimeout: Number(process.env.SOCKET_REQUEST_TIMEOUT_MS) || 600_000, // 10 min (was 120_000)
  maxConnectionsPerIP: Number(process.env.SOCKET_MAX_CONNECTIONS_PER_IP) || 300, // accommodate higher traffic
  minBytesPerSecond: Number(process.env.SOCKET_MIN_BYTES_PER_SEC) || 100, // Prevent slowloris but allow slow streams
  cleanupIntervalMs: Number(process.env.SOCKET_CLEANUP_INTERVAL_MS) || 60_000,
});

const telemetryPipelineController = startTelemetryPipeline({
  db,
  batchSize: clampConfigNumber(process.env.TELEMETRY_BATCH_SIZE, 100, 5, 5_000),
  flushIntervalMs: clampConfigNumber(process.env.TELEMETRY_FLUSH_INTERVAL_MS, 2_000, 200, 60_000),
  maxQueueSize: clampConfigNumber(process.env.TELEMETRY_MAX_QUEUE_SIZE, 5_000, 200, 200_000),
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// DNS rebinding protection — must be very early, before any routing
app.use(hostValidation());

// Request logger middleware with correlation context - must go first
app.use(correlationIdMiddleware);
app.use(requestLoggerMiddlewareLite);

// Canonical URL redirect (www -> non-www) - must be before CORS and sessions
app.use(canonicalUrlMiddleware);

// Compression middleware - skip SSE streams (text/event-stream) to prevent buffering.
// compression() buffers output to build compression blocks, which breaks real-time SSE.
app.use(
  compression({
    filter: (req, res) => {
      if (
        req.url?.includes("/chat/stream") ||
        req.url?.includes("/super/stream") ||
        req.headers.accept === "text/event-stream" ||
        res.getHeader("Content-Type")?.toString().includes("text/event-stream")
      ) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

// CORS configuration - must be before other middleware
app.use(corsMiddleware);

// Security Middleware (Helmet + HPP)
app.use(hpp()); // Prevent HTTP Parameter Pollution
setupSecurity(app); // Enhanced Helmet Config

// CSRF Token Generation (sets cookie)
app.use(csrfTokenMiddleware);

// API-specific security headers for /api routes
app.use("/api", apiSecurityHeaders());

// Keep health probes ahead of the heavier /api middleware stack.
app.get("/api/health", (_req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get("/api/health/live", (_req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Defense in Depth
app.disable("x-powered-by");

// Route-specific body limits (MUST come before global parser)
// /api/chat/stream needs a higher limit to support inline image base64 for vision
app.use("/api/chat/stream", express.json({
  limit: "500mb", // Supports massive contexts > 1M tokens and heavy files
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
  strict: true,
}));

// Global Body Limit: Reduced to 1MB to prevent DoS
// For large file uploads, use specific routes with increased limits (e.g. Multer)
app.use(
  express.json({
    limit: "500mb",
    verify: (req: any, res: any, buf: Buffer) => {
      req.rawBody = buf.toString();
    },
    // SECURITY FIX #15: Strict JSON parsing to reject malformed JSON
    strict: true,
  }),
);

app.use(express.urlencoded({ extended: false, limit: '500mb', parameterLimit: 1000 }));

// API hardening boundary: path/query/payload validation and canonicalization
app.use("/api", requestBoundaryGuard);
app.use("/api", requestIntegrity());

// Response time budget: tracks latency and logs overruns (observability layer)
app.use("/api", responseBudget());

// Legacy request tracer middleware for stats
app.use(requestTracerMiddleware);

export function log(message: string, source = "express") {
  Logger.info(`[${source}] ${message}`);
}

function startAgentOSKernel() {
  const agentOSEnabled = process.env.AGENTOS_BOOT_ENABLED !== "false";
  if (!agentOSEnabled) {
    log("AgentOS kernel boot disabled via AGENTOS_BOOT_ENABLED=false", "agentos");
    return;
  }

  const timeoutMs = clampConfigNumber(process.env.AGENTOS_BOOT_TIMEOUT_MS, 15000, 1000, 120000);

  try {
    const agentOS = AgentOS.getInstance({
      mode: process.env.NODE_ENV === "production" ? "SAFE" : "SUPERVISED",
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || process.cwd(),
      logLevel: process.env.NODE_ENV === "production" ? "info" : "debug",
    });

    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        log(
          `[WARNING] AgentOS kernel boot is still pending after ${timeoutMs}ms; continuing without blocking HTTP startup`,
          "agentos",
        );
      }
    }, timeoutMs);

    void agentOS
      .boot()
      .then(() => {
        finished = true;
        clearTimeout(timer);
        log(`AgentOS kernel ready in mode ${agentOS.config.mode}`, "agentos");
      })
      .catch((err) => {
        finished = true;
        clearTimeout(timer);
        Logger.error("Failed to boot AgentOS Kernel:", err);
      });
  } catch (err) {
    Logger.error("Failed to initialize AgentOS Kernel:", err);
  }
}

(async () => {
  bootTrace("startup begin");
  startAgentOSKernel();
  bootTrace("after AgentOS background boot trigger");

  const isProduction = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test";
  const startPythonService = process.env.START_PYTHON_SERVICE === "true";
  const minimalBootMode = isProduction && process.env.FULL_ROUTE_BOOT !== "true";

  // Start Python Agent Tools service if enabled
  if (startPythonService) {
    bootTrace("starting python service");
    log("Starting Python Agent Tools service...");
    const pythonStarted = await pythonServiceManager.start();
    if (pythonStarted) {
      log(`Python service running on port ${pythonServiceManager.getPort()}`);
    } else {
      log("[WARNING] Python service failed to start - some features may not work");
    }
  }

  // Verify database connection before starting (critical in production)
  bootTrace("before verifyDatabaseConnection");
  log("Verifying database connection...");
  const dbConnected = await verifyDatabaseConnection();
  bootTrace(`after verifyDatabaseConnection:${dbConnected ? "connected" : "failed"}`);

  if (!dbConnected && isProduction) {
    log("[FATAL] Cannot start production server without database connection");
    process.exit(1);
  }

  if (dbConnected) {
    log("Database connection verified successfully");
    startHealthChecks();
    log("Database health checks started");
  } else {
    log("[WARNING] Database connection failed - some features may not work");
  }

  // Session + Passport (must be before csrfProtection/rateLimiter/idempotency)
  bootTrace("before setupAuth");
  await setupAuth(app);
  bootTrace("after setupAuth");
  // Ensure CorrelationContext has the authenticated userId (req.user can be populated by Passport/session).
  // Also bind the session to the authenticated userId for simpler secure queries later.
  app.use((req, _res, next) => {
    const userId = getUserId(req);
    if (userId && !userId.startsWith("anon_")) {
      updateContext({ userId });

      const session = (req as any).session as any | undefined;
      if (session && !session.authUserId) {
        session.authUserId = userId;
      }
    }
    next();
  });

  registerAuthRoutes(app);

  // Capture best-effort device metadata for session management UI.
  app.use("/api", sessionDeviceInfoMiddleware);

  // CSRF Protection for API (validates header)
  // NOTE: /api/packages is an API endpoint; protect it via auth/feature-flags/policy (not CSRF),
  // and allow local/automation calls without Secure-cookie issues.
  if (!isTest) {
    app.use("/api", validateApiKey);
    app.use("/api", (req, res, next) => {
      if (req.path.startsWith("/packages")) return next(); // /api/packages/*
      // Node-to-server endpoints (devices) are token-based and not cookie-session CSRF.
      if (req.path === "/nodes" || req.path.startsWith("/nodes/")) return next(); // /api/nodes/*
      if (minimalBootMode && req.path === "/workspace/analytics/track") return next();
      // Local/dev fast-path: file uploads must remain operational even when
      // browser/session CSRF state is temporarily out of sync.
      if (process.env.NODE_ENV !== "production") {
        const csrfUploadExempt = [
          "/objects/upload",
          "/objects/multipart/create",
          "/objects/multipart/sign-part",
          "/objects/multipart/complete",
          "/objects/multipart/abort",
          "/local-upload",
          "/files",
          "/spreadsheet/upload",
        ];
        const requestPaths = [req.path || "", req.originalUrl || ""];
        const isCsrfExemptUploadRoute = requestPaths.some((pathValue) =>
          csrfUploadExempt.some((prefix) =>
            pathValue === prefix ||
            pathValue.startsWith(`${prefix}/`) ||
            pathValue === `/api${prefix}` ||
            pathValue.startsWith(`/api${prefix}/`)
          )
        );
        if (isCsrfExemptUploadRoute) {
          return next();
        }
      }
      return csrfProtection(req, res, next);
    });
  } else {
    log("CSRF protection disabled in test environment", "security");
  }

  // Rate Limiting (User-based) - Applied AFTER auth to use req.user
  
  // [AgentOS] Capabilities & Status Endpoint

  
  app.use("/api", globalLimiter);
  // Legacy/public routes outside /api should still be rate-limited.
  app.use(["/tools", "/agents", "/metrics", "/mcp"], globalLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/checkout", billingLimiter);
  app.use("/api/billing", billingLimiter);
  app.use("/api/stripe", billingLimiter);

  // Behavioral abuse detection (anomaly scoring, complementary to rate limiter)
  app.use("/api", abuseDetection());

  // Idempotency for mutations
  app.use("/api", idempotency);

  let routesReady = false;
  let routeRegistrationPromise: Promise<void> | null = null;

  app.get("/api/health", (_req, res) => {
    const db = getDbHealthStatus();
    res.json({
      status: routesReady ? "ok" : "starting",
      routesReady,
      database: db.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get("/api/health/live", (_req, res) => {
    res.json({
      status: "ok",
      routesReady,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/health/ready", (_req, res) => {
    const db = getDbHealthStatus();
    const ready = routesReady && db.status === "HEALTHY";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "starting",
      routesReady,
      database: db.status,
      timestamp: new Date().toISOString(),
    });
  });

  if (minimalBootMode) {
    app.get("/api/settings/public", async (_req, res) => {
      try {
        const result = await getPublicSettings();
        res.setHeader("Cache-Control", "no-store");
        res.json(result);
      } catch (error: any) {
        res.status(500).json({
          error: "Failed to load public settings",
          message: error?.message || String(error),
        });
      }
    });

    app.get("/api/models/available", async (_req, res) => {
      res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });

      try {
        const allModels = await storage.getAiModels();
        const models = allModels
          .filter((model: any) => isModelEligibleForPublic(model))
          .sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((model: any) => toPublicModelSummary(model));
        res.json({ models });
      } catch (error) {
        console.error("[Models] Error fetching available models:", error);
        res.json({ models: PUBLIC_MODEL_FALLBACKS });
      }
    });

    app.get("/api/csrf/token", (req, res) => {
      const wantRotate =
        String(req.query.rotate || req.query.force || "").toLowerCase() === "1" ||
        String(req.query.refresh || "").toLowerCase() === "1" ||
        String(req.query.rotate || req.query.force || "").toLowerCase() === "true";

      const isReplitDeployment = Boolean(process.env.REPL_SLUG);
      const csrfProduction = process.env.NODE_ENV === "production" || isReplitDeployment;
      const existing = req.cookies?.[CSRF_COOKIE_NAME];

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");

      if (!wantRotate && existing && CSRF_TOKEN_PATTERN.test(existing)) {
        return res.json({ ok: true, csrfToken: existing, rotated: false });
      }

      const token = issueCsrfCookie(req, res, isReplitDeployment, csrfProduction);
      return res.json({ ok: true, csrfToken: token, rotated: true });
    });

    app.get("/api/session/identity", (req, res) => {
      const user = (req as any).user;
      const session = req.session as any;

      const authUserId = user?.claims?.sub || user?.id || session?.authUserId || null;
      const authEmail = user?.claims?.email || user?.email || session?.passport?.user?.claims?.email || session?.passport?.user?.email || null;

      if (authUserId) {
        return res.json({
          userId: authUserId,
          email: authEmail,
          role: "user",
          isAnonymous: false,
        });
      }

      if (session && !session.anonUserId) {
        const sessionId = req.sessionID;
        session.anonUserId = sessionId ? `anon_${sessionId}` : null;
      }

      const anonUserId = session?.anonUserId ?? null;
      return res.json({
        userId: anonUserId,
        token: anonUserId ? generateAnonToken(anonUserId) : null,
        email: null,
        isAnonymous: true,
      });
    });

    app.get("/api/chats", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json([]);
    });

    app.post("/api/workspace/analytics/track", (_req, res) => {
      res.status(204).end();
    });

    app.get("/api/user/preferences", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(DEFAULT_PUBLIC_USER_PREFERENCES);
    });

    app.patch("/api/user/preferences", (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ...DEFAULT_PUBLIC_USER_PREFERENCES,
        ...(req.body && typeof req.body === "object" ? req.body : {}),
      });
    });

    app.put("/api/user/preferences", (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ...DEFAULT_PUBLIC_USER_PREFERENCES,
        ...(req.body && typeof req.body === "object" ? req.body : {}),
      });
    });

    app.get("/api/users/:id/settings", (req, res) => {
      const userId = String(req.params.id || "anonymous");
      res.setHeader("Cache-Control", "no-store");
      res.json(minimalUserSettingsStore.get(userId) ?? createDefaultMinimalUserSettings(userId));
    });

    app.put("/api/users/:id/settings", (req, res) => {
      const userId = String(req.params.id || "anonymous");
      const current = minimalUserSettingsStore.get(userId) ?? createDefaultMinimalUserSettings(userId);
      const nextValue = {
        ...current,
        ...(req.body && typeof req.body === "object" ? req.body : {}),
        userId,
      };
      minimalUserSettingsStore.set(userId, nextValue);
      res.setHeader("Cache-Control", "no-store");
      res.json(nextValue);
    });

    app.use("/api", (req, _res, next) => {
      next(
        new AppError(
          `Route ${req.method} ${req.originalUrl || req.path} not found`,
          404,
          "NOT_FOUND",
          true,
        ),
      );
    });

    app.use("/api", apiErrorHandler);
    app.use(errorHandler);
  }

  const registerApplicationRoutes = async () => {
    if (!routeRegistrationPromise) {
      routeRegistrationPromise = (async () => {
        bootTrace("before import routes");
        const { registerRoutes } = await import("./routes");
        bootTrace("after import routes");
        bootTrace("before registerRoutes");
        await registerRoutes(httpServer, app);
        bootTrace("after registerRoutes");

        // Ensure unmatched API routes return consistent JSON (instead of Express' default HTML 404).
        // This MUST be registered after all routes, but before the API error handler.
        app.use("/api", (req, _res, next) => {
          next(
            new AppError(
              `Route ${req.method} ${req.originalUrl || req.path} not found`,
              404,
              "NOT_FOUND",
              true,
            ),
          );
        });

        app.use("/api", apiErrorHandler);
        app.use(errorHandler);

        if (isProduction) {
          bootTrace("before serveStatic");
          serveStatic(app);
          bootTrace("after serveStatic");
        } else {
          const { setupVite } = await import("./vite");
          await setupVite(httpServer, app);
        }

        routesReady = true;
      })();
    }

    return routeRegistrationPromise;
  };

  if (isProduction) {
    bootTrace("before bootstrap static");
    serveStatic(app, { catchAll: minimalBootMode });
    bootTrace("after bootstrap static");
    if (minimalBootMode) {
      routesReady = true;
      log("Minimal production boot enabled; public site is serving without full route graph", "startup");
    }
  } else {
    await registerApplicationRoutes();
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  const port = env.PORT;

  const listenOptions = isProduction
    ? ({ port, host: "0.0.0.0", reusePort: true } as const)
    : port;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = (httpServer.listen as any)(listenOptions, async () => {
    bootTrace("httpServer.listen callback entered");
    log(`serving on port ${port}`);
    log(`Environment: ${isProduction ? "PRODUCTION" : "development"}`);
    log(`Database: ${dbConnected ? "connected" : "NOT CONNECTED"}`);

    if (isProduction && !minimalBootMode) {
      void registerApplicationRoutes().catch((error) => {
        Logger.error("[Startup] Deferred route registration failed", error);
      });
    }

    if (!minimalBootMode) {
      void (async () => {
        try {
          if (dbConnected) {
            bootTrace("before setupFts");
            const { setupFts } = await import("./lib/fts");
            await setupFts();
            bootTrace("after setupFts");

            const { initAdminProjection } = await import("./services/adminProjection");
            initAdminProjection();

            const { actionTriggerDaemon } = await import("./services/actionTriggerDaemon");
            await actionTriggerDaemon.start();
            bootTrace("after actionTriggerDaemon.start");
          }

          bootTrace("before connector initialization");
          const { initializeConnectorManifests, mountConnectorTools } = await import("./integrations/kernel");
          await initializeConnectorManifests();
          await mountConnectorTools();
          bootTrace("after connector initialization");
          log("Connector manifests initialized and tools mounted", "integrations");
        } catch (err: any) {
          log(`[WARNING] Connector initialization failed: ${err?.message || err}`, "integrations");
        }

        if (isProduction) {
          try {
            bootTrace("before llmGateway.healthCheck");
            const { llmGateway } = await import("./lib/llmGateway");
            const llmHealth = await llmGateway.healthCheck();
            bootTrace("after llmGateway.healthCheck");
            if (llmHealth.xai?.available) {
              log("✅ xAI LLM connected");
            }
            if (llmHealth.gemini?.available) {
              log("✅ Gemini LLM connected");
            }
            if (!llmHealth.xai?.available && !llmHealth.gemini?.available) {
              log("[WARNING] No LLM providers available - chat will not work");
            }
          } catch (error) {
            log("[WARNING] LLM health check failed:", error);
          }
        }

        try {
          bootTrace("before initializeOpenClaw");
          const { initializeOpenClaw } = await import("./openclaw/index");
          await initializeOpenClaw(httpServer);
          bootTrace("after initializeOpenClaw");
        } catch (error) {
          log(`[OpenClaw] initialization skipped after error: ${String((error as Error)?.message || error)}`);
        }
      })();

      void (async () => {
        try {
          const [{ startAggregator }, { seedProductionData }] = await Promise.all([
            import("./services/analyticsAggregator"),
            import("./seed-production"),
          ]);

          startAggregator();
          await seedProductionData();

          if (dbConnected) {
            const { startChatScheduleRunner } = await import("./services/chatScheduleRunner");
            startChatScheduleRunner();
          } else {
            log("[Schedules] Skipping schedule runner start because DB is not connected");
          }
        } catch (error) {
          Logger.error("[Startup] Deferred post-listen initialization failed", error);
        }
      })();
    } else {
      log("Heavy route graph and background agents are deferred in minimal production boot", "startup");
    }

    // Advanced 1 Million Tokens Hyperparametrizations - Deep Scaling
    // Keeps connection alive for up to 6 minutes for massive O(N^2) context generations
    server.keepAliveTimeout = 360000;
    server.headersTimeout = 361000;

    // Setup graceful shutdown with connection draining
    setupGracefulShutdown(httpServer, {
      timeout: 30000,
      onShutdown: async () => {
        log("Running application cleanup...");
      },
    });

    // Register database cleanup
    registerCleanup(async () => {
      log("Stopping database health checks...");
      stopHealthChecks();
      log("Draining database connections...");
      await drainConnections();
      log("Database cleanup complete");
    });

    // Register Python service cleanup
    if (startPythonService && pythonServiceManager.isRunning()) {
      registerCleanup(async () => {
        log("Stopping Python service...");
        pythonServiceManager.stop();
      });
    }

    // Register WhatsApp Web cleanup
    registerCleanup(async () => {
      log("Shutting down WhatsApp Web sessions...");
      const { whatsappWebManager } = await import('./integrations/whatsappWeb');
      await whatsappWebManager.shutdownAll();
      log("WhatsApp Web cleanup complete");
    });

    // Register OpenTelemetry tracing cleanup
    registerCleanup(async () => {
      log("Shutting down OpenTelemetry tracing...");
      await shutdownTracing();
      log("OpenTelemetry tracing shutdown complete");
    });

    // Register security middleware cleanup
    registerCleanup(async () => {
      stopAbuseDetectionCleanup();
      stopIntegrityCleanup();
      log("Security middleware cleanup complete");
    });

    registerCleanup(async () => {
      await telemetryPipelineController.stop();
      log("Telemetry pipeline cleanup complete");
    });

    registerCleanup(async () => {
      stopSocketHardening();
      log("Socket hardening cleanup complete");
    });

    // Schedule Daily Cleanup (24h)
    setInterval(() => {
      runCleanup().catch(err => log(`[Cleanup Error] ${err.message}`));
    }, 24 * 60 * 60 * 1000);
    // Run once on startup after delay
    setTimeout(() => {
      runCleanup().catch(err => log(`[Cleanup Error] ${err.message}`));
    }, 60 * 1000);

    const tracingStatus = getTracingMetrics();
    log(
      `OpenTelemetry: initialized=${tracingStatus.isInitialized}, sampleRate=${tracingStatus.sampleRate * 100}%`,
    );

    log("Graceful shutdown handler configured");

    // Optional: auto-register Telegram webhook after the server is reachable.
    if (env.TELEGRAM_AUTO_SET_WEBHOOK && env.TELEGRAM_WEBHOOK_URL && env.TELEGRAM_BOT_TOKEN) {
      setTimeout(() => {
        import("./channels/telegram/telegramApi")
          .then(({ telegramSetWebhook }) =>
            telegramSetWebhook({
              webhookUrl: env.TELEGRAM_WEBHOOK_URL as string,
              secretToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
            }),
          )
          .then(() => log(`[Telegram] Webhook configured: ${env.TELEGRAM_WEBHOOK_URL}`))
          .catch((e) => log(`[Telegram] Webhook auto-config failed: ${e?.message || e}`));
      }, 1500);
    }

    // Local/dev fallback: if webhook isn't publicly reachable, consume updates via getUpdates.
    if (!isProduction) {
      import("./channels/telegram/telegramPollingBridge")
        .then(({ startTelegramPollingBridge }) => {
          stopTelegramPollingBridge = startTelegramPollingBridge();
        })
        .catch((error) => {
          log(`[Telegram] Polling bridge startup failed: ${String((error as Error)?.message || error)}`);
        });
    }

    registerCleanup(async () => {
      if (stopTelegramPollingBridge) {
        stopTelegramPollingBridge();
        stopTelegramPollingBridge = null;
        log("Telegram polling bridge stopped");
      }
    });
  });
})();
