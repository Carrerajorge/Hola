import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const queryAdminUsersMock = vi.fn();

vi.mock("../services/adminProjection", () => ({
  queryAdminUsers: (...args: any[]) => queryAdminUsersMock(...args),
}));

vi.mock("../storage", () => ({
  storage: {},
}));

vi.mock("../db", () => ({
  db: {},
}));

vi.mock("../utils/password", () => ({
  hashPassword: vi.fn(async () => "hashed-password"),
}));

vi.mock("../middleware/validateRequest", () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../middleware/jitElevation", () => ({
  requireRecentAuth: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../middleware/errorHandler", () => ({
  asyncHandler: (fn: any) => fn,
}));

vi.mock("../services/auditLogger", () => ({
  auditLog: vi.fn(async () => undefined),
  AuditActions: {},
}));

describe("admin users router", () => {
  beforeEach(() => {
    queryAdminUsersMock.mockReset();
  });

  async function buildApp() {
    const { usersRouter } = await import("../routes/admin/users");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: "admin-1", email: "admin@example.com" };
      next();
    });
    app.use("/api/admin/users", usersRouter);
    return app;
  }

  it("forwards server-side filters, search, sorting, and pagination to the admin projection query", async () => {
    const responsePayload = {
      users: [{ id: "u1", email: "alice@example.com", role: "admin" }],
      pagination: { page: 2, limit: 50, total: 1, totalPages: 1, hasNext: false, hasPrev: true },
    };
    queryAdminUsersMock.mockResolvedValue(responsePayload);

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .get("/api/admin/users")
        .query({
          page: 2,
          limit: 50,
          search: "Alice",
          status: "active",
          role: "admin",
          plan: "pro",
          sortBy: "email",
          sortOrder: "asc",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(responsePayload);
      expect(queryAdminUsersMock).toHaveBeenCalledWith({
        page: 2,
        limit: 50,
        search: "Alice",
        sortBy: "email",
        sortOrder: "asc",
        status: "active",
        role: "admin",
        plan: "pro",
      });
    } finally {
      await close();
    }
  });

  it("exports CSV from the same filtered data source used by the table", async () => {
    queryAdminUsersMock.mockResolvedValue({
      users: [
        {
          id: "u1",
          email: "=alice@example.com",
          fullName: "Alice, Admin",
          plan: "enterprise",
          role: "admin",
          status: "active",
          queryCount: 42,
          tokensConsumed: 9000,
          createdAt: new Date("2026-03-01T10:00:00.000Z"),
          lastLoginAt: new Date("2026-03-02T12:00:00.000Z"),
        },
      ],
      pagination: { page: 1, limit: 2000, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
    });

    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .get("/api/admin/users/export")
        .query({
          format: "csv",
          search: "Alice",
          status: "active",
          sortBy: "createdAt",
          sortOrder: "desc",
        });

      expect(res.status).toBe(200);
      expect(String(res.headers["content-type"])).toContain("text/csv");
      expect(queryAdminUsersMock).toHaveBeenCalledWith({
        page: 1,
        limit: 2000,
        search: "Alice",
        sortBy: "createdAt",
        sortOrder: "desc",
        status: "active",
        role: undefined,
        plan: undefined,
      });
      expect(res.text).toContain('"id","email","fullName"');
      expect(res.text).toContain('"Alice, Admin"');
      expect(res.text).toContain('"\'=alice@example.com"');
    } finally {
      await close();
    }
  });
});
