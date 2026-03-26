import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const isAuthenticatedMock = vi.fn();
const loadConfigMock = vi.fn();
const resolveGatewayAuthMock = vi.fn();

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: () => "user_test",
  isAuthenticated: (...args: unknown[]) => isAuthenticatedMock(...args),
}));

vi.mock("../services/superIntelligence/config/config.js", () => ({
  loadConfig: (...args: unknown[]) => loadConfigMock(...args),
}));

vi.mock("../services/superIntelligence/gateway/auth.js", () => ({
  resolveGatewayAuth: (...args: unknown[]) => resolveGatewayAuthMock(...args),
}));

async function createTestApp() {
  const { default: openClawRouter } = await import("../routes/openClawRouter");
  const app = express();
  app.use(express.json());
  app.use("/api/openclaw", openClawRouter);
  return app;
}

describe("openClawRouter control-ui launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAuthenticatedMock.mockReturnValue(true);
    loadConfigMock.mockReturnValue({
      gateway: {
        controlUi: {
          enabled: true,
          basePath: "/openclaw-ui",
        },
        auth: {
          mode: "token",
          token: "top-secret-token",
        },
      },
    });
    resolveGatewayAuthMock.mockReturnValue({
      mode: "token",
      token: "top-secret-token",
      allowTailscale: false,
    });
  });

  it("GET /api/openclaw/control-ui/meta returns native launch metadata without leaking the token", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.get("/api/openclaw/control-ui/meta");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        available: true,
        authMode: "token",
        basePath: "/openclaw-ui",
        manualUrl: "/openclaw-ui/?session=main",
        launchUrl: "/api/openclaw/control-ui/launch?session=main",
        embedding: "same-origin",
      });
      expect(JSON.stringify(res.body)).not.toContain("top-secret-token");
    } finally {
      await close();
    }
  });

  it("GET /api/openclaw/control-ui/launch redirects to a tokenized fragment URL", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.get("/api/openclaw/control-ui/launch").redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/openclaw-ui/?session=main#token=top-secret-token");
      expect(res.headers["cache-control"]).toContain("no-store");
    } finally {
      await close();
    }
  });

  it("requires an authenticated application session", async () => {
    isAuthenticatedMock.mockReturnValue(false);

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.get("/api/openclaw/control-ui/meta");

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        error: "Authentication required",
      });
    } finally {
      await close();
    }
  });

  it("reports unavailable launch metadata for password-mode gateways", async () => {
    resolveGatewayAuthMock.mockReturnValue({
      mode: "password",
      password: "manual-only-password",
      allowTailscale: false,
    });

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const meta = await client.get("/api/openclaw/control-ui/meta");
      expect(meta.status).toBe(200);
      expect(meta.body.available).toBe(false);
      expect(meta.body.reason).toContain("manual sign-in");

      const launch = await client.get("/api/openclaw/control-ui/launch").redirects(0);
      expect(launch.status).toBe(409);
      expect(launch.body.error).toContain("manual sign-in");
    } finally {
      await close();
    }
  });
});
