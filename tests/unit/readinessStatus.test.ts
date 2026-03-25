import { describe, expect, it } from "vitest";
import { buildReadinessResponse } from "../../server/lib/readinessStatus";

const mem: NodeJS.MemoryUsage = {
  arrayBuffers: 0,
  external: 0,
  heapTotal: 20,
  heapUsed: 10,
  rss: 30,
};

describe("buildReadinessResponse", () => {
  it("returns 200 ready when the database is healthy", () => {
    const result = buildReadinessResponse({
      db: {
        status: "HEALTHY",
        lastCheck: new Date("2026-03-25T17:00:00.000Z"),
        latencyMs: 18,
        consecutiveFailures: 0,
      },
      mem,
      rateLimiter: { backend: "redis", initialized: true },
      uptimeSeconds: 120,
      now: new Date("2026-03-25T17:01:00.000Z"),
    });

    expect(result.httpStatus).toBe(200);
    expect(result.payload.status).toBe("ready");
    expect(result.payload.checks.rateLimiter.status).toBe("ok");
  });

  it("returns 200 degraded when the database is degraded", () => {
    const result = buildReadinessResponse({
      db: {
        status: "DEGRADED",
        lastCheck: new Date("2026-03-25T17:00:00.000Z"),
        latencyMs: 220,
        consecutiveFailures: 1,
      },
      mem,
      rateLimiter: { backend: "memory", initialized: false },
      uptimeSeconds: 120,
      now: new Date("2026-03-25T17:01:00.000Z"),
    });

    expect(result.httpStatus).toBe(200);
    expect(result.payload.status).toBe("degraded");
    expect(result.payload.checks.rateLimiter.status).toBe("degraded");
  });

  it("returns 503 when the database is unhealthy", () => {
    const result = buildReadinessResponse({
      db: {
        status: "UNHEALTHY",
        lastCheck: new Date("2026-03-25T17:00:00.000Z"),
        latencyMs: 5000,
        consecutiveFailures: 4,
      },
      mem,
      rateLimiter: { backend: "redis", initialized: true },
      uptimeSeconds: 120,
      now: new Date("2026-03-25T17:01:00.000Z"),
    });

    expect(result.httpStatus).toBe(503);
    expect(result.payload.status).toBe("not_ready");
  });
});
