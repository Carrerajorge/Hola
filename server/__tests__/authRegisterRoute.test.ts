import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const authStorageMock = {
  getUserByEmail: vi.fn(),
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  updateUserLogin: vi.fn(),
};

const hashPasswordMock = vi.fn(async () => "hashed-password");
const dbExecuteMock = vi.fn();
const getSettingValueMock = vi.fn(async () => true);
const auditLogMock = vi.fn(async () => undefined);
const authEventPublishMock = vi.fn();

vi.mock("../replit_integrations/auth/storage", () => ({
  authStorage: authStorageMock,
}));

vi.mock("../replit_integrations/auth/replitAuth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  getSessionStats: vi.fn(() => ({ totalSessions: 0 })),
}));

vi.mock("../storage", () => ({
  storage: {},
}));

vi.mock("../utils/password", () => ({
  hashPassword: (...args: any[]) => hashPasswordMock(...args),
  verifyPassword: vi.fn(async () => false),
  isHashed: vi.fn(() => true),
}));

vi.mock("../middleware/userRateLimiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  getRateLimitStats: vi.fn(() => ({ total: 0 })),
}));

vi.mock("../services/genericEmailService", () => ({
  sendMagicLinkEmail: vi.fn(async () => undefined),
}));

vi.mock("../lib/anonUserHelper", () => ({
  getSecureUserId: vi.fn(() => "anon-user"),
}));

vi.mock("../services/auditLogger", () => ({
  auditLog: (...args: any[]) => auditLogMock(...args),
  AuditActions: {},
}));

vi.mock("../lib/sessionUser", () => ({
  buildSessionUserFromDbUser: vi.fn((user: any) => user),
}));

vi.mock("../services/mfaLogin", () => ({
  computeMfaForUser: vi.fn(async () => ({ required: false })),
  startMfaLoginChallenge: vi.fn(async () => ({ required: false })),
}));

vi.mock("../lib/structuredLogger", () => ({
  createLogger: vi.fn(() => ({
    withRequest() {
      return this;
    },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../services/settingsConfigService", () => ({
  getSettingValue: (...args: any[]) => getSettingValueMock(...args),
}));

vi.mock("../lib/logoutMarker", () => ({
  setLogoutMarker: vi.fn(),
  clearLogoutMarker: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    execute: (...args: any[]) => dbExecuteMock(...args),
  },
}));

vi.mock("../lib/adminRole", () => ({
  isAdminRole: vi.fn(() => false),
}));

vi.mock("@shared/adminIdentity", () => ({
  isPrivilegedAdminEmail: vi.fn(() => false),
}));

vi.mock("../lib/appSessionStore", () => ({
  APP_SESSION_COOKIE_NAME: "siragpt.sid",
}));

vi.mock("../services/authEventBus", () => ({
  authEventBus: {
    publish: (...args: any[]) => authEventPublishMock(...args),
  },
}));

describe("/api/auth/register", () => {
  beforeEach(() => {
    authStorageMock.getUserByEmail.mockReset();
    authStorageMock.getUser.mockReset();
    authStorageMock.upsertUser.mockReset();
    authStorageMock.updateUserLogin.mockReset();
    hashPasswordMock.mockClear();
    dbExecuteMock.mockReset();
    getSettingValueMock.mockReset();
    getSettingValueMock.mockResolvedValue(true);
    auditLogMock.mockReset();
    auditLogMock.mockResolvedValue(undefined);
    authEventPublishMock.mockReset();
  });

  async function buildApp() {
    const { registerAuthRoutes } = await import("../replit_integrations/auth/routes");
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    return app;
  }

  it("creates a self-registered user with the current signup payload and emits a projection refresh event", async () => {
    authStorageMock.getUserByEmail.mockResolvedValue(null);
    dbExecuteMock.mockResolvedValue({ rows: [{ id: "user-123" }] });

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/auth/register").send({
        email: "new.user@example.com",
        password: "StrongPass123",
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: "Cuenta creada correctamente" });
      expect(hashPasswordMock).toHaveBeenCalledWith("StrongPass123");
      expect(authEventPublishMock).toHaveBeenCalledWith(
        "USER_REGISTERED",
        "user-123",
        expect.objectContaining({
          email: "new.user@example.com",
          provider: "email",
        }),
      );
    } finally {
      await close();
    }
  });

  it("rejects weak passwords before touching the database", async () => {
    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/auth/register").send({
        email: "weak@example.com",
        password: "short",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Datos inválidos");
      expect(hashPasswordMock).not.toHaveBeenCalled();
      expect(dbExecuteMock).not.toHaveBeenCalled();
      expect(authEventPublishMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
