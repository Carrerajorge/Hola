import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpTestClient, createHttpTestClient } from "../helpers/httpTestClient";
import { createSkillPlatformRouter } from "../../server/routes/skillPlatformRouter";

const mockSkillService = {
  executeFromMessage: vi.fn(),
  listSkills: vi.fn(),
  getSkillHistory: vi.fn(),
  rollbackSkill: vi.fn(),
  getExecutionMetrics: vi.fn(),
};

vi.mock("../../server/services/skillPlatform", () => ({
  getSkillPlatformService: () => mockSkillService,
}));

function createSkillPlatformApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/skill-platform", createSkillPlatformRouter());
  return app;
}

describe("skill platform router", () => {
  let client: HttpTestClient;
  let closeClient: () => Promise<void>;

  beforeEach(async () => {
    const app = createSkillPlatformApp();
    const created = await createHttpTestClient(app);
    client = created.client;
    closeClient = created.close;

    Object.values(mockSkillService).forEach((method) => method.mockReset());
  });

  afterEach(async () => {
    await closeClient();
  });

  it("rejects execute requests without a valid request id header", async () => {
    const response = await client
      .post("/api/skill-platform/execute")
      .send({ userMessage: "hola mundo" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("forwards execute payload to platform service and returns structured response", async () => {
    mockSkillService.executeFromMessage.mockResolvedValue({
      status: "skipped",
      continueWithModel: true,
      outputText: "",
      autoCreated: false,
      requiresConfirmation: false,
      traces: [],
    });

    const response = await client
      .post("/api/skill-platform/execute")
      .set("x-request-id", "rq_20260217_001")
      .set("x-idempotency-key", "idem_abc")
      .send({
        userMessage: "resumen de este texto",
        runId: "run_abc",
        userId: "user_123",
        attachments: [{ id: "a1", name: "archivo.txt", mimeType: "text/plain", size: 120 }],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.requestId).toBe("rq_20260217_001");
    expect(mockSkillService.executeFromMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "rq_20260217_001",
        runId: "run_abc",
        userId: "user_123",
      })
    );
  });

  it("uses idempotency key when run id is not provided", async () => {
    mockSkillService.executeFromMessage.mockResolvedValue({
      status: "skipped",
      continueWithModel: true,
      outputText: "",
      autoCreated: false,
      requiresConfirmation: false,
      traces: [],
    });

    const response = await client
      .post("/api/skill-platform/execute")
      .set("x-request-id", "rq_20260217_002")
      .set("x-idempotency-key", "idem_456")
      .send({
        userMessage: "comprobar idempotencia",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockSkillService.executeFromMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "idem_456",
      })
    );
  });

  it("returns 400 for invalid execution payload", async () => {
    const response = await client
      .post("/api/skill-platform/execute")
      .set("x-request-id", "rq_20260217_003")
      .send({
        userMessage: "",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid execute payload");
  });

  it("returns catalog history 404 when skill does not exist", async () => {
    mockSkillService.getSkillHistory.mockResolvedValue([]);

    const response = await client
      .get("/api/skill-platform/catalog/no-exists/history");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });

  it("returns metrics payload", async () => {
    mockSkillService.getExecutionMetrics.mockReturnValue({
      totalRequests: 1,
      completed: 0,
      partial: 0,
      blocked: 0,
      failed: 0,
      skipped: 0,
      autoCreated: 0,
      cacheHit: 0,
      avgLatencyMs: 10,
      lastErrors: [],
      startedAt: Date.now() - 1000,
      stageMetrics: {
        planner: 0,
        retrieval: 0,
        factory: 0,
        validation: 0,
        execution: 0,
        tooling: 0,
        model: 0,
        policy: 0,
        risk_gate: 0,
        cleanup: 0,
        finish: 0,
      },
      peakConcurrent: 0,
      activeRuns: 0,
      circuit: {
        execution: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          timeouts: 0,
          fallbackCalls: 0,
          totalLatencyMs: 0,
          lastCallTime: 0,
          averageLatencyMs: 0,
          successRate: "0%",
          state: "CLOSED",
          failures: 0,
          successes: 0,
          consecutiveSuccesses: 0,
          totalRequests: 0,
          lastFailureTime: null,
          lastSuccessTime: null,
          lastStateChange: Date.now(),
          lastActivityTime: Date.now(),
          openedAt: null,
          tenantId: "__legacy__",
          provider: "skill-platform.execution",
        },
        factory: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          timeouts: 0,
          fallbackCalls: 0,
          totalLatencyMs: 0,
          lastCallTime: 0,
          averageLatencyMs: 0,
          successRate: "0%",
          state: "CLOSED",
          failures: 0,
          successes: 0,
          consecutiveSuccesses: 0,
          totalRequests: 0,
          lastFailureTime: null,
          lastSuccessTime: null,
          lastStateChange: Date.now(),
          lastActivityTime: Date.now(),
          openedAt: null,
          tenantId: "__legacy__",
          provider: "skill-platform.factory",
        },
      },
    });

    const response = await client.get("/api/skill-platform/metrics");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.metrics.totalRequests).toBe(1);
    expect(response.body.metrics.circuit.execution).toHaveProperty("state");
  });
});
