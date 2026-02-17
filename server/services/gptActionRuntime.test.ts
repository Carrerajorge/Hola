import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  GptActionRuntime,
  isAllowedResponseMimeTypeForTesting,
  normalizeContentTypeForTesting,
  normalizeGptActionRequestPayload,
  parseRetryAfterHeader,
  sanitizeLogValueForTesting,
} from "./gptActionRuntime";

describe("gptActionRuntime shared helpers", () => {
  describe("normalizeGptActionRequestPayload", () => {
    it("uses request when provided", () => {
      const payload = normalizeGptActionRequestPayload({
        request: { primary: "from-request" },
        input: { fallback: "ignored" },
      } as Record<string, unknown>);

      expect(payload).toEqual({ primary: "from-request" });
      expect(payload).not.toHaveProperty("fallback");
    });

    it("falls back to input when request is missing", () => {
      const payload = normalizeGptActionRequestPayload({
        request: undefined,
        input: { fallback: "used" },
      } as Record<string, unknown>);

      expect(payload).toEqual({ fallback: "used" });
    });

    it("falls back to input when request is null", () => {
      const payload = normalizeGptActionRequestPayload({
        request: null,
        input: { fallback: "used-from-null" },
      } as Record<string, unknown>);

      expect(payload).toEqual({ fallback: "used-from-null" });
    });

    it("returns empty object for non-object request/input", () => {
      const payload = normalizeGptActionRequestPayload({
        request: "invalid",
        input: 123,
      } as Record<string, unknown>);

      expect(payload).toEqual({});
    });

    it("truncates oversized payloads", () => {
      const payload = normalizeGptActionRequestPayload({
        request: {
          text: "x".repeat(60_000),
        },
      } as Record<string, unknown>);

      expect(payload).toBeTypeOf("string");
      expect(payload.length).toBeLessThanOrEqual(50_000);
    });
  });

  describe("parseRetryAfterHeader", () => {
    it("parses numeric Retry-After values", () => {
      expect(parseRetryAfterHeader("120")).toBe(120);
      expect(parseRetryAfterHeader("  15  ")).toBe(15);
      expect(parseRetryAfterHeader("-7")).toBeUndefined();
      expect(parseRetryAfterHeader("0")).toBeUndefined();
    });

    it("parses HTTP-date Retry-After values", () => {
      const future = new Date(Date.now() + 30_000).toUTCString();
      const parsed = parseRetryAfterHeader(future);

      expect(parsed).toBeGreaterThanOrEqual(1);
      expect(parsed).toBeLessThanOrEqual(40);
    });

    it("returns undefined for malformed values", () => {
      expect(parseRetryAfterHeader("invalid")).toBeUndefined();
      expect(parseRetryAfterHeader("")).toBeUndefined();
      expect(parseRetryAfterHeader(undefined)).toBeUndefined();
    });

    it("ignores malformed negative and zero header values", () => {
      expect(parseRetryAfterHeader("-1")).toBeUndefined();
      expect(parseRetryAfterHeader("0")).toBeUndefined();
    });

    it("returns undefined for past HTTP-date values", () => {
      const past = new Date(Date.now() - 30_000).toUTCString();
      expect(parseRetryAfterHeader(past)).toBeUndefined();
    });
  });

  describe("content-type helpers", () => {
    it("normalizes content-type headers", () => {
      expect(normalizeContentTypeForTesting("application/json; charset=utf-8")).toBe("application/json");
      expect(normalizeContentTypeForTesting("  Text/Plain; charset=UTF-8  ")).toBe("text/plain");
      expect(normalizeContentTypeForTesting(null)).toBeNull();
      expect(normalizeContentTypeForTesting("")).toBeNull();
    });

    it("allows only safe response content types", () => {
      expect(isAllowedResponseMimeTypeForTesting("application/json; charset=utf-8")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("text/plain")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("text/csv; charset=utf-8")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("application/problem+json")).toBe(true);
      expect(isAllowedResponseMimeTypeForTesting("image/png")).toBe(false);
      expect(isAllowedResponseMimeTypeForTesting(null)).toBe(false);
    });
  });

  describe("computeBackoff jitter behavior", () => {
    it("respects bounds and fallback delay", () => {
      const runtime = new GptActionRuntime({ random: () => 0.5 });
      const firstAttempt = (runtime as any).computeBackoff(1);
      const secondAttempt = (runtime as any).computeBackoff(2);
      const maxAttempt = (runtime as any).computeBackoff(20);

      expect(firstAttempt).toBe(500);
      expect(secondAttempt).toBe(1000);
      expect(maxAttempt).toBeGreaterThanOrEqual(500);
      expect(maxAttempt).toBeLessThanOrEqual(8000);
    });

    it("bounds random samples", () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (random) => {
          const runtime = new GptActionRuntime({ random: () => random });
          const value = (runtime as any).computeBackoff(4);
          const base = 500 * Math.pow(2, 3);
          const capped = Math.min(8000, base);
          const jitter = capped * 0.2 * (random - 0.5) * 2;
          const expectedMin = Math.max(500, Math.floor(capped + jitter - 0.0001));
          const expectedMax = Math.floor(capped + jitter + 0.0001);
          expect(value).toBeGreaterThanOrEqual(expectedMin);
          expect(value).toBeLessThanOrEqual(expectedMax);
        })
      );
    });
  });

  describe("sanitizeLogValue", () => {
    it("normalizes and redacts risky substrings", () => {
      const result = sanitizeLogValueForTesting({
        title: " <script>alert(1)</script> hello ",
        path: "javascript:alert(1)",
      });

      expect(result).toEqual({
        title: " [redacted] hello ",
        path: "[redacted]alert(1)",
      });
    });
  });

  describe("request/response hardening", () => {
    it("rejects oversized request bodies before fetching", async () => {
      let called = false;
      const runtime = new GptActionRuntime({
        fetch: async () => {
          called = true;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const action = {
        id: "action-1",
        name: "action-test",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "POST",
        bodyTemplate: JSON.stringify({ payload: "x".repeat(90_000) }),
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(called).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error?.message || "").toContain("exceeds");
    });

    it("rejects structured schema responses with unsupported content-type", async () => {
      const runtime = new GptActionRuntime({
        fetch: async () => {
          return new Response("ok", { status: 200, headers: { "content-type": "image/png" } });
        },
      });

      const action = {
        id: "action-2",
        name: "action-test-2",
        endpoint: "https://example.com/api",
        isActive: "true",
        httpMethod: "GET",
        responseSchema: { type: "object", properties: { value: { type: "string" } } },
      } as any;

      const result = await runtime.execute({
        action,
        gptId: "gpt-1",
        conversationId: "conv-1",
        request: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation_error");
      expect(result.error?.message).toContain("content-type");
    });
  });
});
