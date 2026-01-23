import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { createClient } from "redis";

const router = Router();

// Basic liveliness check
router.get("/live", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Deep readiness check
router.get("/ready", async (req, res) => {
  const checks: Record<string, string> = {};
  let allHealthy = true;

  // Database check
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "healthy";
  } catch (error) {
    console.error("Health check - Database error:", error);
    checks.database = "unhealthy";
    allHealthy = false;
  }

  // Redis check
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const redis = createClient({ url: redisUrl });
      await redis.connect();
      await redis.ping();
      await redis.quit();
      checks.redis = "healthy";
    } catch (error) {
      console.error("Health check - Redis error:", error);
      checks.redis = "unhealthy";
      allHealthy = false;
    }
  } else {
    checks.redis = "not_configured";
  }

  // Memory check (warning if > 800MB heap used)
  const memUsage = process.memoryUsage();
  checks.memory = memUsage.heapUsed < 800 * 1024 * 1024 ? "healthy" : "warning";
  checks.uptime = process.uptime() > 10 ? "healthy" : "starting";

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "ready" : "degraded",
    checks,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
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
