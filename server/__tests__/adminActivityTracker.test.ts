import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const auditLogMock = vi.fn(async () => undefined);

vi.mock("../services/auditLogger", () => ({
  auditLog: (...args: any[]) => auditLogMock(...args),
}));

describe("adminActivityTracker", () => {
  beforeEach(() => {
    auditLogMock.mockReset();
    auditLogMock.mockResolvedValue(undefined);
  });

  it("logs canonical admin paths with resource and resourceId", async () => {
    const { adminActivityTracker } = await import("../middleware/adminActivityTracker");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: "admin-1", email: "admin@example.com" };
      next();
    });
    app.use("/api/admin", adminActivityTracker);
    app.post("/api/admin/users/user_1234/block", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/admin/users/user_1234/block").send({ password: "secret", reason: "fraud" });
      expect(res.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(auditLogMock).toHaveBeenCalledTimes(1);
      const [, payload] = auditLogMock.mock.calls[0];
      expect(payload.action).toBe("admin.post.users.user_1234.block");
      expect(payload.resource).toBe("users");
      expect(payload.resourceId).toBe("user_1234");
      expect(payload.details.path).toBe("/api/admin/users/user_1234/block");
      expect(payload.details.body).toEqual({
        password: "[REDACTED]",
        reason: "fraud",
      });
    } finally {
      await close();
    }
  });

  it("skips excluded realtime routes even when mounted under /api/admin", async () => {
    const { adminActivityTracker } = await import("../middleware/adminActivityTracker");
    const app = express();
    app.use("/api/admin", adminActivityTracker);
    app.post("/api/admin/dashboard/realtime", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/admin/dashboard/realtime").send({});
      expect(res.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(auditLogMock).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
