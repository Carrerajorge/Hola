import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/live", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get("/ready", async (req, res) => {
  const checks: Record<string, string> = {};
  let allHealthy = true;

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "healthy";
  } catch (error) {
    checks.database = "unhealthy";
    allHealthy = false;
  }

  checks.memory = process.memoryUsage().heapUsed < 500 * 1024 * 1024 ? "healthy" : "warning";
  checks.uptime = process.uptime() > 10 ? "healthy" : "starting";

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "ready" : "degraded",
    checks,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

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

export default router;
