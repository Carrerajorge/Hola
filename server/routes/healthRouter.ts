import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getRedisStatus, isRedisAvailable } from "../lib/redisConfig";
import { getSystemStatus } from "../services/autonomy";
import { getRobustnessStatus } from "../services/robustness";
import { getEnhancedStatus } from "../services/enhanced";

const router = Router();

// Configurable memory threshold (default 800MB, can override via env)
const MEMORY_WARNING_THRESHOLD = parseInt(process.env.MEMORY_WARNING_THRESHOLD_MB || '800') * 1024 * 1024;

// Basic liveliness check
router.get("/live", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Deep readiness check with expanded service checks
router.get("/ready", async (req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; details?: any }> = {};
  let allHealthy = true;
  let hasWarnings = false;

  // Database check with latency measurement
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = {
      status: "healthy",
      latencyMs: Date.now() - dbStart
    };
  } catch (error: any) {
    console.error("Health check - Database error:", error);
    checks.database = {
      status: "unhealthy",
      latencyMs: Date.now() - dbStart,
      details: { error: error.message }
    };
    allHealthy = false;
  }

  // Redis check using unified configuration
  const redisStatus = getRedisStatus();
  if (redisStatus.configured) {
    const redisStart = Date.now();
    try {
      const available = await isRedisAvailable();
      checks.redis = {
        status: available ? "healthy" : "unhealthy",
        latencyMs: Date.now() - redisStart,
        details: { connectionStatus: redisStatus.status }
      };
      if (!available) allHealthy = false;
    } catch (error: any) {
      checks.redis = {
        status: "unhealthy",
        latencyMs: Date.now() - redisStart,
        details: { error: error.message }
      };
      allHealthy = false;
    }
  } else {
    checks.redis = { status: "not_configured" };
  }

  // Memory check with configurable threshold
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const memoryHealthy = memUsage.heapUsed < MEMORY_WARNING_THRESHOLD;
  checks.memory = {
    status: memoryHealthy ? "healthy" : "warning",
    details: {
      heapUsedMB,
      heapTotalMB,
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      thresholdMB: MEMORY_WARNING_THRESHOLD / 1024 / 1024
    }
  };
  if (!memoryHealthy) hasWarnings = true;

  // Process uptime check
  const uptimeSeconds = Math.floor(process.uptime());
  checks.uptime = {
    status: uptimeSeconds > 10 ? "healthy" : "starting",
    details: { seconds: uptimeSeconds }
  };

  // External services health checks
  // OpenAI/Anthropic API availability (lightweight check)
  const externalServices: Record<string, { configured: boolean; envVar: string }> = {
    openai: { configured: !!process.env.OPENAI_API_KEY, envVar: 'OPENAI_API_KEY' },
    anthropic: { configured: !!process.env.ANTHROPIC_API_KEY, envVar: 'ANTHROPIC_API_KEY' },
    google_ai: { configured: !!process.env.GEMINI_API_KEY, envVar: 'GEMINI_API_KEY' },
    stripe: { configured: !!process.env.STRIPE_SECRET_KEY, envVar: 'STRIPE_SECRET_KEY' },
  };

  checks.external_services = {
    status: "info",
    details: Object.fromEntries(
      Object.entries(externalServices).map(([name, info]) => [
        name,
        info.configured ? "configured" : "not_configured"
      ])
    )
  };

  // Determine overall status
  let overallStatus: "ready" | "degraded" | "unhealthy";
  let httpStatus: number;

  if (!allHealthy) {
    overallStatus = "unhealthy";
    httpStatus = 503;
  } else if (hasWarnings) {
    overallStatus = "degraded";
    httpStatus = 200;
  } else {
    overallStatus = "ready";
    httpStatus = 200;
  }

  res.status(httpStatus).json({
    status: overallStatus,
    checks,
    uptime: uptimeSeconds,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0"
  });
});

// Deep health check (alias for /ready)
router.get("/deep", async (req, res) => {
  res.redirect("/api/health/ready");
});

// General info
router.get("/", async (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: "ok",
    version: process.env.npm_package_version || "1.0.0",
    node: process.version,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB"
    },
    uptime: Math.floor(process.uptime()) + "s",
    timestamp: new Date().toISOString()
  });
});

// Autonomous systems status
router.get("/autonomy", async (req, res) => {
  try {
    const status = await getSystemStatus();
    res.json({
      status: status.healthy ? "healthy" : "degraded",
      ...status,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Robustness services status
router.get("/robustness", async (req, res) => {
  try {
    const status = await getRobustnessStatus();
    res.json({
      status: status.healthy ? "healthy" : "degraded",
      ...status,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced services status (201-400)
router.get("/enhanced", async (req, res) => {
  try {
    const status = getEnhancedStatus();
    res.json({
      status: status.healthy ? "healthy" : "degraded",
      ...status,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Prometheus-compatible metrics endpoint
router.get("/metrics", async (req, res) => {
  const memUsage = process.memoryUsage();
  const uptimeSeconds = Math.floor(process.uptime());

  // Prometheus text format
  const metrics = `
# HELP nodejs_heap_size_bytes Heap size in bytes
# TYPE nodejs_heap_size_bytes gauge
nodejs_heap_size_bytes{type="used"} ${memUsage.heapUsed}
nodejs_heap_size_bytes{type="total"} ${memUsage.heapTotal}

# HELP nodejs_rss_bytes Resident set size in bytes
# TYPE nodejs_rss_bytes gauge
nodejs_rss_bytes ${memUsage.rss}

# HELP nodejs_external_memory_bytes External memory in bytes
# TYPE nodejs_external_memory_bytes gauge
nodejs_external_memory_bytes ${memUsage.external}

# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds counter
process_uptime_seconds ${uptimeSeconds}

# HELP process_start_time_seconds Unix timestamp when process started
# TYPE process_start_time_seconds gauge
process_start_time_seconds ${Math.floor((Date.now() - uptimeSeconds * 1000) / 1000)}
`.trim();

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.status(200).send(metrics);
});

export default router;
