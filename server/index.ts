import "dotenv/config";
import { env } from "./config/env"; // Validates env vars immediately on import
import compression from "compression";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { requestTracerMiddleware } from "./lib/requestTracer";
import { requestLoggerMiddleware } from "./middleware/requestLogger";
import { startAggregator } from "./services/analyticsAggregator";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { seedProductionData } from "./seed-production";
import { verifyDatabaseConnection, startHealthChecks, stopHealthChecks, drainConnections } from "./db";
import { securityHeaders, apiSecurityHeaders } from "./middleware/securityHeaders";
import { setupGracefulShutdown, registerCleanup } from "./lib/gracefulShutdown";
import { pythonServiceManager } from "./lib/pythonServiceManager";
import { idempotency } from "./middleware/idempotency";
import { rateLimiter } from "./middleware/userRateLimiter";
import { Logger } from "./lib/logger";
import { initTracing, shutdownTracing, getTracingMetrics } from "./lib/tracing";
import { apiErrorHandler } from "./middleware/apiErrorHandler";
import { corsMiddleware } from "./middleware/cors";
import { csrfTokenMiddleware, csrfProtection } from "./middleware/csrf";

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

// Compression middleware - should be early to compress all eligible responses
app.use(compression());

// CORS configuration - must be before other middleware
app.use(corsMiddleware);

// Security headers middleware - CSP, HSTS, X-Frame-Options, etc.
app.use(securityHeaders());

// CSRF Token Generation (sets cookie)
app.use(csrfTokenMiddleware);

// API-specific security headers for /api routes
app.use("/api", apiSecurityHeaders());

// CSRF Protection for API (validates header)
app.use("/api", csrfProtection);

// Rate Limiting (User-based)
app.use("/api", rateLimiter);

// Idempotency for mutations
app.use("/api", idempotency);

// Legacy request tracer middleware for stats
app.use(requestTracerMiddleware);

// SECURITY FIX #14: Reduced default body size limit from 100mb to 10mb
// Use specific larger limits only where needed (file uploads)
const DEFAULT_BODY_LIMIT = process.env.MAX_BODY_SIZE || '10mb';
const LARGE_BODY_LIMIT = '50mb'; // For file uploads only

app.use(
  express.json({
    limit: DEFAULT_BODY_LIMIT,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
    // SECURITY FIX #15: Strict JSON parsing to reject malformed JSON
    strict: true,
  }),
);

app.use(express.urlencoded({
  extended: false,
  limit: DEFAULT_BODY_LIMIT,
  // SECURITY FIX #16: Limit parameter count to prevent parameter pollution
  parameterLimit: 1000
}));

export function log(message: string, source = "express") {
  Logger.info(`[${source}] ${message}`);
}

// Manual logging middleware removed in favor of requestLoggerMiddleware at line 38

(async () => {
  const isProduction = process.env.NODE_ENV === "production";
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


  await registerRoutes(httpServer, app);

  // API Error Handler (Centralized)
  app.use("/api", apiErrorHandler);


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
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = env.PORT;
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);
      log(`Environment: ${isProduction ? "PRODUCTION" : "development"}`);
      log(`Database: ${dbConnected ? "connected" : "NOT CONNECTED"}`);
      startAggregator();
      await seedProductionData();

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

      // Register OpenTelemetry tracing cleanup
      registerCleanup(async () => {
        log("Shutting down OpenTelemetry tracing...");
        await shutdownTracing();
        log("OpenTelemetry tracing shutdown complete");
      });

      const tracingStatus = getTracingMetrics();
      log(`OpenTelemetry: initialized=${tracingStatus.isInitialized}, sampleRate=${tracingStatus.sampleRate * 100}%`);

      log("Graceful shutdown handler configured");
    },
  );
})();
