import dotenv from "dotenv";
import path from "path";

// Load environment variables based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || "development";
if (nodeEnv === "production") {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.production") });
}
// Also load standard .env as fallback
dotenv.config();

import { env } from "./config/env"; // Validates env vars immediately on import
import compression from "compression";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { requestTracerMiddleware } from "./lib/requestTracer";
import { requestLoggerMiddleware } from "./middleware/requestLogger";
import { updateContext } from "./middleware/correlationContext";
import { startAggregator } from "./services/analyticsAggregator";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { seedProductionData } from "./seed-production";
import { verifyDatabaseConnection, startHealthChecks, stopHealthChecks, drainConnections } from "./db";
import hpp from "hpp";
import { apiSecurityHeaders } from "./middleware/securityHeaders";
import { setupGracefulShutdown, registerCleanup } from "./lib/gracefulShutdown";
import { pythonServiceManager } from "./lib/pythonServiceManager";
import { idempotency } from "./middleware/idempotency";
import { globalLimiter, authLimiter } from "./middleware/rateLimiter";
import { Logger } from "./lib/logger";
import { initTracing, shutdownTracing, getTracingMetrics } from "./lib/tracing";
import { apiErrorHandler } from "./middleware/apiErrorHandler";
import { corsMiddleware } from "./middleware/cors";
import { csrfTokenMiddleware, csrfProtection } from "./middleware/csrf";
import { canonicalUrlMiddleware } from "./middleware/canonicalUrl";
import { setupSecurity } from "./middleware/security";
import { runCleanup } from "./lib/cleanup";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { startChatScheduleRunner } from "./services/chatScheduleRunner";
import { sessionDeviceInfoMiddleware } from "./middleware/sessionDeviceInfo";
import { getUserId } from "./types/express";

initTracing();

const app = express();
app.set("trust proxy", 1); // Trust first proxy (critical for rate limiting behind load balancers)
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Request logger middleware with correlation context - must go first
app.use(requestLoggerMiddleware);

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

// Legacy request tracer middleware for stats
app.use(requestTracerMiddleware);

// Defense in Depth
app.disable("x-powered-by");

// Global Body Limit: Reduced to 1MB to prevent DoS
// For large file uploads, use specific routes with increased limits (e.g. Multer)
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
    // SECURITY FIX #15: Strict JSON parsing to reject malformed JSON
    strict: true,
  }),
);

app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 1000 }));

export function log(message: string, source = "express") {
  Logger.info(`[${source}] ${message}`);
}

(async () => {
  const isProduction = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test";
  const startPythonService = process.env.START_PYTHON_SERVICE === "true";

  // Start Python Agent Tools service if enabled
  if (startPythonService) {
    log("Starting Python Agent Tools service...");
    const pythonStarted = await pythonServiceManager.start();
    if (pythonStarted) {
      log(`Python service running on port ${pythonServiceManager.getPort()}`);
    } else {
      log("[WARNING] Python service failed to start - some features may not work");
    }
  }

  // Verify database connection before starting (critical in production)
  log("Verifying database connection...");
  const dbConnected = await verifyDatabaseConnection();

  if (!dbConnected && isProduction) {
    log("[FATAL] Cannot start production server without database connection");
    process.exit(1);
  }

  if (dbConnected) {
    log("Database connection verified successfully");
    startHealthChecks();
    log("Database health checks started");

    // Setup Full-Text Search
    const { setupFts } = await import("./lib/fts");
    await setupFts();
  } else {
    log("[WARNING] Database connection failed - some features may not work");
  }

  // Verify LLM connectivity in production
  if (isProduction) {
    try {
      const { llmGateway } = await import("./lib/llmGateway");
      const llmHealth = await llmGateway.healthCheck();
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

  // Session + Passport (must be before csrfProtection/rateLimiter/idempotency)
  await setupAuth(app);
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
  if (!isTest) {
    app.use("/api", csrfProtection);
  } else {
    log("CSRF protection disabled in test environment", "security");
  }

  // Rate Limiting (User-based) - Applied AFTER auth to use req.user
  app.use("/api", globalLimiter);
  app.use("/api/auth", authLimiter);

  // Idempotency for mutations
  app.use("/api", idempotency);

  await registerRoutes(httpServer, app);

  // API Error Handler (Centralized)
  app.use("/api", apiErrorHandler);
  
  // App-level error handler (catch-all)
  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (isProduction) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  const port = env.PORT;

  const listenOptions = isProduction
    ? ({ port, host: "0.0.0.0", reusePort: true } as const)
    : port;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = (httpServer.listen as any)(listenOptions, async () => {
    log(`serving on port ${port}`);
    log(`Environment: ${isProduction ? "PRODUCTION" : "development"}`);
    log(`Database: ${dbConnected ? "connected" : "NOT CONNECTED"}`);
    startAggregator();
    await seedProductionData();
    if (dbConnected) {
      startChatScheduleRunner();
    } else {
      log("[Schedules] Skipping schedule runner start because DB is not connected");
    }

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
  });

  // Hardened Server Timeouts (Slowloris Protection)
  server.headersTimeout = 60000; // 60s
  server.keepAliveTimeout = 65000; // 65s larger than headersTimeout
})();
