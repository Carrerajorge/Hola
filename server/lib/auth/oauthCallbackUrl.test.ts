import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

describe("resolveOAuthCallbackUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      DATABASE_URL: originalEnv.DATABASE_URL || "postgres://localhost/testdb",
      SESSION_SECRET: originalEnv.SESSION_SECRET || "a".repeat(32),
      BASE_URL: "http://localhost:5050",
      PORT: "5001",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function mockReq(headers: Record<string, string | undefined>, protocol = "http"): Request {
    return {
      protocol,
      get: vi.fn((name: string) => headers[name.toLowerCase()]),
    } as any;
  }

  it("uses forwarded host and proto when present", async () => {
    const { resolveOAuthCallbackUrl } = await import("./oauthCallbackUrl");
    const req = mockReq({
      host: "127.0.0.1:5001",
      "x-forwarded-host": "iliagpt.com",
      "x-forwarded-proto": "https",
    });

    expect(resolveOAuthCallbackUrl(req, "/api/auth/google/callback")).toBe(
      "https://iliagpt.com/api/auth/google/callback",
    );
  });

  it("uses the browser referer origin when the request host is the internal dev server", async () => {
    const { resolveOAuthCallbackUrl } = await import("./oauthCallbackUrl");
    const req = mockReq({
      host: "127.0.0.1:5001",
      referer: "http://127.0.0.1:5050/login",
    });

    expect(resolveOAuthCallbackUrl(req, "/api/auth/google/callback")).toBe(
      "http://127.0.0.1:5050/api/auth/google/callback",
    );
  });

  it("falls back to BASE_URL when the request is proxied and browser headers are unavailable", async () => {
    const { resolveOAuthCallbackUrl } = await import("./oauthCallbackUrl");
    const req = mockReq({
      host: "127.0.0.1:5001",
    });

    expect(resolveOAuthCallbackUrl(req, "/api/auth/google/callback")).toBe(
      "http://localhost:5050/api/auth/google/callback",
    );
  });

  it("keeps the current host for direct requests", async () => {
    const { resolveOAuthCallbackUrl } = await import("./oauthCallbackUrl");
    const req = mockReq({
      host: "localhost:5050",
    });

    expect(resolveOAuthCallbackUrl(req, "/api/auth/google/callback")).toBe(
      "http://localhost:5050/api/auth/google/callback",
    );
  });
});
