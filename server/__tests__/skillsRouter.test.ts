import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const insertReturningQueue: any[] = [];
const updateReturningQueue: any[] = [];
const deleteReturningQueue: any[] = [];
let lastUpdatePatch: any | null = null;

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => {}),
      returning: vi.fn(async () => insertReturningQueue.shift() || []),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((patch: any) => {
      lastUpdatePatch = patch;
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => updateReturningQueue.shift() || []),
        })),
      };
    }),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => deleteReturningQueue.shift() || []),
    })),
  })),
};

vi.mock("../db", () => ({ db: dbMock }));
vi.mock("../lib/anonUserHelper", () => ({ getOrCreateSecureUserId: () => "user_test" }));

async function createTestApp() {
  const { createSkillsRouter } = await import("../routes/skillsRouter");
  const app = express();
  app.use(express.json());
  app.use("/api/skills", createSkillsRouter());
  return app;
}

describe("skillsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertReturningQueue.length = 0;
    updateReturningQueue.length = 0;
    deleteReturningQueue.length = 0;
    lastUpdatePatch = null;
  });

  it("GET /api/skills returns skills (including triggers conversion)", async () => {
    const rows = [
      {
        id: "skill_1",
        userId: "user_test",
        name: "Mi Skill",
        description: "Desc",
        instructions: "Instr",
        category: "custom",
        enabled: true,
        features: ["f1"],
        triggers: [{ type: "keyword", value: "foo", priority: 0 }],
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-02T00:00:00.000Z"),
      },
    ];

    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    }));

    const app = await createTestApp();
    const res = await request(app).get("/api/skills");

    expect(res.status).toBe(200);
    expect(res.body.skills).toHaveLength(1);
    expect(res.body.skills[0].id).toBe("skill_1");
    expect(res.body.skills[0].triggers).toEqual(["foo"]);
  });

  it("GET /api/skills/active returns active skill id from user preferences", async () => {
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ preferences: { skills: { activeSkillId: "skill_active" } } }],
        }),
      }),
    }));

    const app = await createTestApp();
    const res = await request(app).get("/api/skills/active");

    expect(res.status).toBe(200);
    expect(res.body.activeSkillId).toBe("skill_active");
  });

  it("PUT /api/skills/active stores activeSkillId under preferences.skills.activeSkillId", async () => {
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ preferences: { other: 1, skills: { foo: "bar" } } }],
        }),
      }),
    }));
    updateReturningQueue.push([{ id: "user_test" }]);

    const app = await createTestApp();
    const res = await request(app)
      .put("/api/skills/active")
      .send({ activeSkillId: "skill_active_2" });

    expect(res.status).toBe(200);
    expect(res.body.activeSkillId).toBe("skill_active_2");

    expect(lastUpdatePatch?.preferences).toEqual({
      other: 1,
      skills: { foo: "bar", activeSkillId: "skill_active_2" },
    });
    expect(lastUpdatePatch?.updatedAt instanceof Date).toBe(true);
  });

  it("POST /api/skills creates a skill", async () => {
    const createdRow = {
      id: "skill_2",
      userId: "user_test",
      name: "Nuevo",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      features: ["f1"],
      triggers: [{ type: "keyword", value: "t1", priority: 0 }],
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    };
    insertReturningQueue.push([createdRow]);

    const app = await createTestApp();
    const res = await request(app).post("/api/skills").send({
      name: "Nuevo",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      features: ["f1"],
      triggers: ["t1"],
    });

    expect(res.status).toBe(201);
    expect(res.body.skill.id).toBe("skill_2");
    expect(res.body.skill.triggers).toEqual(["t1"]);
  });

  it("PUT /api/skills/:id returns 404 when skill not found", async () => {
    updateReturningQueue.push([]);
    const app = await createTestApp();
    const res = await request(app).put("/api/skills/does-not-exist").send({ description: "x" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Skill not found");
  });

  it("PUT /api/skills/:id converts triggers to DB shape", async () => {
    const updatedRow = {
      id: "skill_3",
      userId: "user_test",
      name: "Upd",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      features: [],
      triggers: [{ type: "keyword", value: "x", priority: 0 }],
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-03T00:00:00.000Z"),
    };
    updateReturningQueue.push([updatedRow]);

    const app = await createTestApp();
    const res = await request(app).put("/api/skills/skill_3").send({ triggers: ["x"] });

    expect(res.status).toBe(200);
    expect(res.body.skill.id).toBe("skill_3");
    expect(res.body.skill.triggers).toEqual(["x"]);
    expect(lastUpdatePatch?.triggers).toEqual([{ type: "keyword", value: "x", priority: 0 }]);
  });

  it("DELETE /api/skills/:id returns 404 when missing", async () => {
    deleteReturningQueue.push([]);
    const app = await createTestApp();
    const res = await request(app).delete("/api/skills/skill_404");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Skill not found");
  });

  it("POST /api/skills/import skips duplicate names (case-insensitive)", async () => {
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: async () => [{ name: "dup" }],
      }),
    }));

    const insertedRow = {
      id: "skill_new",
      userId: "user_test",
      name: "New",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      features: [],
      triggers: [{ type: "keyword", value: "k", priority: 0 }],
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    };
    insertReturningQueue.push([insertedRow]);

    const app = await createTestApp();
    const res = await request(app)
      .post("/api/skills/import")
      .send({
        skills: [
          { name: "Dup", description: "d", instructions: "i", category: "custom", enabled: true, features: [], triggers: [] },
          { name: "New", description: "d", instructions: "i", category: "custom", enabled: true, features: [], triggers: ["k"] },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toHaveLength(1);
    expect(res.body.imported[0].name).toBe("New");
    expect(res.body.skipped).toBe(1);
  });
});
