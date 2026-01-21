import "dotenv/config";
import { env } from "./config/env"; // Validates env vars immediately on import
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
import { rateLimiter } from "./middleware/rateLimiter";
import { Logger } from "./lib/logger";
import { initTracing, shutdownTracing, getTracingMetrics } from "./lib/tracing";
import { apiErrorHandler } from "./middleware/apiErrorHandler";
import { corsMiddleware } from "./middleware/cors";
import { csrfTokenMiddleware, csrfProtection } from "./middleware/csrf";

initTracing();

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Request logger middleware with correlation context - must go first
app.use(requestLoggerMiddleware);

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

app.use(
  express.json({
    limit: '100mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '100mb' }));

export function log(message: string, source = "express") {
  Logger.info(`[${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

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
