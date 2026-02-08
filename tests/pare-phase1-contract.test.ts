import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { pareRequestContract } from "../server/middleware/pareRequestContract";
import { pareRateLimiter, clearPareRateLimitStores } from "../server/middleware/pareRateLimiter";
import { pareQuotaGuard } from "../server/middleware/pareQuotaGuard";
import { createMockReq, createMockRes, runMiddlewares, type MiddlewareLike } from "./helpers/mockExpress";

async function postToTestEndpoint(options: {
  middlewares: MiddlewareLike[];
  body?: any;
  headers?: Record<string, string>;
  userId?: string | null;
  ip?: string;
}) {
  const req = createMockReq({
    method: "POST",
    path: "/test",
    headers: options.headers,
    body: options.body,
    ip: options.ip ?? "203.0.113.10",
    socketRemoteAddress: options.ip ?? "203.0.113.10",
    user: options.userId ? { claims: { sub: options.userId } } : undefined,
  });
  const res = createMockRes();

  await runMiddlewares(req, res, [
    ...options.middlewares,
    (req: any, res: any) => {
      const pareContext = (req as any).pareContext;
      res.json({
        success: true,
        pareContext: pareContext
          ? {
              requestId: pareContext.requestId,
              idempotencyKey: pareContext.idempotencyKey,
              isDataMode: pareContext.isDataMode,
              attachmentsCount: pareContext.attachmentsCount,
              hasStartTime: typeof pareContext.startTime === "number",
              hasClientIp: typeof pareContext.clientIp === "string",
              userId: pareContext.userId,
            }
          : null,
      });
    },
  ]);

  return { req, res };
}

describe("PARE Phase 1 Request Contract Infrastructure", () => {
  describe("pareRequestContract Middleware", () => {
    it("should generate X-Request-Id if not provided", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.body.pareContext.requestId).toBeDefined();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(res.body.pareContext.requestId)).toBe(true);
    });

    it("should preserve valid X-Request-Id if provided", async () => {
      const customRequestId = "550e8400-e29b-41d4-a716-446655440000";

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        headers: { "x-request-id": customRequestId },
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-request-id"]).toBe(customRequestId);
      expect(res.body.pareContext.requestId).toBe(customRequestId);
    });

    it("should regenerate invalid X-Request-Id", async () => {
      const invalidRequestId = "not-a-valid-uuid";

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        headers: { "x-request-id": invalidRequestId },
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.requestId).not.toBe(invalidRequestId);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(res.body.pareContext.requestId)).toBe(true);
    });

    it("should extract X-Idempotency-Key header", async () => {
      const idempotencyKey = "idem-key-12345";

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        headers: { "x-idempotency-key": idempotencyKey },
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.idempotencyKey).toBe(idempotencyKey);
    });

    it("should return null idempotencyKey when header not provided", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.idempotencyKey).toBeNull();
    });

    it("should detect DATA_MODE when attachments are present", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: {
          attachments: [
            { name: "doc1.pdf", type: "application/pdf" },
            { name: "doc2.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.isDataMode).toBe(true);
      expect(res.body.pareContext.attachmentsCount).toBe(2);
    });

    it("should NOT detect DATA_MODE when no attachments", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.isDataMode).toBe(false);
      expect(res.body.pareContext.attachmentsCount).toBe(0);
    });

    it("should NOT detect DATA_MODE when attachments undefined", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { message: "hello" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.isDataMode).toBe(false);
      expect(res.body.pareContext.attachmentsCount).toBe(0);
    });

    it("should include startTime in context", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.hasStartTime).toBe(true);
    });

    it("should propagate requestId in response header", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      const headerRequestId = res.headers["x-request-id"];
      const contextRequestId = res.body.pareContext.requestId;
      expect(headerRequestId).toBe(contextRequestId);
    });
  });

  describe("pareRateLimiter Middleware", () => {
    beforeEach(() => {
      clearPareRateLimitStores();
    });

    afterEach(() => {
      clearPareRateLimitStores();
    });

    it("should allow requests within IP rate limit", async () => {
      for (let i = 0; i < 5; i++) {
        const { res } = await postToTestEndpoint({
          middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 5, ipWindowMs: 60000 })],
          body: { attachments: [] },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it("should return 429 when IP rate limit exceeded", async () => {
      for (let i = 0; i < 3; i++) {
        await postToTestEndpoint({
          middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 3, ipWindowMs: 60000 })],
          body: { attachments: [] },
        });
      }

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 3, ipWindowMs: 60000 })],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(429);
      expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
      expect(res.body.error.limitType).toBe("ip");
      expect(res.headers["retry-after"]).toBeDefined();
    });

    it("should include Retry-After header on rate limit", async () => {
      await postToTestEndpoint({
        middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 1, ipWindowMs: 60000 })],
        body: { attachments: [] },
      });

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 1, ipWindowMs: 60000 })],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      const retryAfter = parseInt(res.headers["retry-after"], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it("should set rate limit headers on successful requests", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 10, ipWindowMs: 60000 })],
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-ratelimit-limit"]).toBe("10");
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
      expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    });

    it("should track user rate limit when userId present", async () => {
      const limiter = pareRateLimiter({ userMaxRequests: 2, userWindowMs: 60000, ipMaxRequests: 100 });

      await postToTestEndpoint({
        middlewares: [pareRequestContract, limiter],
        userId: "user-123",
        body: { attachments: [] },
      });
      await postToTestEndpoint({
        middlewares: [pareRequestContract, limiter],
        userId: "user-123",
        body: { attachments: [] },
      });

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, limiter],
        userId: "user-123",
        body: { attachments: [] },
      });

      expect(res.statusCode).toBe(429);
      expect(res.body.error.limitType).toBe("user");
    });
  });

  describe("pareQuotaGuard Middleware", () => {
    it("should allow requests within quota limits", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareQuotaGuard({ maxFilesPerRequest: 20 })],
        body: {
          attachments: [
            { name: "doc1.pdf", size: 1000 },
            { name: "doc2.pdf", size: 2000 },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it("should return 422 when max files exceeded", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareQuotaGuard({ maxFilesPerRequest: 2 })],
        body: {
          attachments: [
            { name: "doc1.pdf", size: 1000 },
            { name: "doc2.pdf", size: 1000 },
            { name: "doc3.pdf", size: 1000 },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(res.body.error.violations.some((v: any) => v.type === "MAX_FILES_EXCEEDED")).toBe(true);
    });

    it("should return 422 when single file size exceeded", async () => {
      const MB = 1024 * 1024;
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareQuotaGuard({ maxFileSizeBytes: 10 * MB })],
        body: { attachments: [{ name: "large-doc.pdf", size: 20 * MB }] },
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(res.body.error.violations.some((v: any) => v.type === "FILE_SIZE_EXCEEDED")).toBe(true);
    });

    it("should return 422 when total size exceeded", async () => {
      const MB = 1024 * 1024;
      const { res } = await postToTestEndpoint({
        middlewares: [
          pareRequestContract,
          pareQuotaGuard({
            maxFileSizeBytes: 100 * MB,
            maxTotalSizeBytes: 50 * MB,
          }),
        ],
        body: {
          attachments: [
            { name: "doc1.pdf", size: 30 * MB },
            { name: "doc2.pdf", size: 30 * MB },
          ],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(res.body.error.violations.some((v: any) => v.type === "TOTAL_SIZE_EXCEEDED")).toBe(true);
    });

    it("should return 422 when max pages estimate exceeded", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [
          pareRequestContract,
          pareQuotaGuard({
            maxPagesEstimate: 10,
            bytesPerPageEstimate: 3000,
            maxFileSizeBytes: 100 * 1024 * 1024,
            maxTotalSizeBytes: 200 * 1024 * 1024,
          }),
        ],
        body: { attachments: [{ name: "big-doc.pdf", size: 50000 }] },
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
      expect(res.body.error.violations.some((v: any) => v.type === "MAX_PAGES_EXCEEDED")).toBe(true);
    });

    it("should include limit details in quota error response", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareQuotaGuard({ maxFilesPerRequest: 1 })],
        body: { attachments: [{ name: "doc1.pdf", size: 1000 }, { name: "doc2.pdf", size: 1000 }] },
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.error.limits).toBeDefined();
      expect(res.body.error.limits.maxFiles).toBe(1);
      expect(res.body.error.requestId).toBeDefined();
    });

    it("should pass through when no attachments", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareQuotaGuard()],
        body: { message: "hello" },
      });

      expect(res.statusCode).toBe(200);
    });

    it("should calculate size from base64 content", async () => {
      const largeBase64 = "data:application/pdf;base64," + "A".repeat(200);

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareQuotaGuard({ maxFileSizeBytes: 100 })],
        body: { attachments: [{ name: "doc.pdf", content: largeBase64 }] },
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
    });
  });

  describe("DATA_MODE Server-Side Enforcement", () => {
    it("should enforce DATA_MODE based on attachments.length, ignoring frontend flag", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { documentMode: false, attachments: [{ name: "doc.pdf" }] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.isDataMode).toBe(true);
    });

    it("should NOT enforce DATA_MODE when attachments empty, even if frontend says true", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract],
        body: { documentMode: true, attachments: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.isDataMode).toBe(false);
    });
  });

  describe("Middleware Integration", () => {
    beforeEach(() => {
      clearPareRateLimitStores();
    });

    afterEach(() => {
      clearPareRateLimitStores();
    });

    it("should work with all 3 middlewares in sequence", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 100 }), pareQuotaGuard({ maxFilesPerRequest: 10 })],
        headers: { "x-idempotency-key": "test-key-123" },
        body: { attachments: [{ name: "doc.pdf", size: 1000 }] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.pareContext.idempotencyKey).toBe("test-key-123");
      expect(res.body.pareContext.isDataMode).toBe(true);
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    });

    it("should block at rate limiter before reaching quota guard", async () => {
      const limiter = pareRateLimiter({ ipMaxRequests: 1 });

      await postToTestEndpoint({
        middlewares: [pareRequestContract, limiter, pareQuotaGuard({ maxFilesPerRequest: 10 })],
        body: { attachments: [] },
      });

      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, limiter, pareQuotaGuard({ maxFilesPerRequest: 10 })],
        body: { attachments: [{ name: "doc.pdf", size: 1000 }] },
      });

      expect(res.statusCode).toBe(429);
    });

    it("should propagate requestId through all middleware responses", async () => {
      const { res } = await postToTestEndpoint({
        middlewares: [pareRequestContract, pareRateLimiter({ ipMaxRequests: 100 }), pareQuotaGuard({ maxFilesPerRequest: 1 })],
        body: { attachments: [{ name: "doc1.pdf", size: 1000 }, { name: "doc2.pdf", size: 1000 }] },
      });

      expect(res.statusCode).toBe(422);
      expect(res.body.error.requestId).toBeDefined();
      expect(res.headers["x-request-id"]).toBe(res.body.error.requestId);
    });
  });
});

