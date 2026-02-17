import { describe, expect, it } from "vitest";
import { normalizeGptActionRequestPayload, parseRetryAfterHeader } from "./gptActionRuntime";

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
  });
});
