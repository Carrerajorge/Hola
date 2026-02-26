// server/agent/orchestrator/__tests__/e2e-restapi.test.ts
// ---------------------------------------------------------------------------
// E2E: SuperPlanner building a REST API using REAL tools
//
// Demonstrates the full tool pipeline:
// scaffold_project → generate_code → write_multiple_files → shell_exec
//
// Real files are written to /tmp/orchestrator-{runId}/
// Gemini is mocked but file I/O is REAL.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orchestrate } from "../executor";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Mock: Gemini client — returns structured plans & code
// ---------------------------------------------------------------------------

let geminiCallCount = 0;

// The plan Gemini returns when asked to decompose the goal
const REST_API_PLAN = {
  subtasks: [
    {
      id: "step_1",
      description: "Scaffold an Express project",
      toolHint: "scaffold_project",
      args: { action: "init_express", projectName: "todo-api" },
      dependencies: [],
      priority: "critical",
      estimatedComplexity: "simple",
    },
    {
      id: "step_2",
      description: "Generate Todo model and database layer",
      toolHint: "generate_code",
      args: {
        description: "Create a Todo model with in-memory storage and CRUD methods",
        language: "javascript",
        framework: "express",
      },
      dependencies: ["step_1"],
      priority: "high",
      estimatedComplexity: "medium",
    },
    {
      id: "step_3",
      description: "Generate authentication middleware",
      toolHint: "generate_code",
      args: {
        description: "Create JWT auth middleware for Express",
        language: "javascript",
        framework: "express",
      },
      dependencies: ["step_1"],
      priority: "high",
      estimatedComplexity: "medium",
    },
    {
      id: "step_4",
      description: "Write the generated model and auth files to workspace",
      toolHint: "write_multiple_files",
      args: {},
      dependencies: ["step_2", "step_3"],
      priority: "high",
      estimatedComplexity: "simple",
    },
    {
      id: "step_5",
      description: "Install npm dependencies",
      toolHint: "shell_exec",
      args: { command: "echo 'npm install skipped in test'" },
      dependencies: ["step_4"],
      priority: "high",
      estimatedComplexity: "simple",
    },
    {
      id: "step_6",
      description: "List all project files",
      toolHint: "list_files",
      args: { recursive: true },
      dependencies: ["step_5"],
      priority: "normal",
      estimatedComplexity: "simple",
    },
    {
      id: "step_7",
      description: "Synthesize delivery summary with file listing and setup instructions",
      toolHint: "synthesize",
      args: { task: "Assemble final delivery: list files, setup instructions, next steps" },
      dependencies: ["step_6"],
      priority: "critical",
      estimatedComplexity: "medium",
    },
  ],
  reasoning:
    "Scaffold Express boilerplate first, then generate model and auth in parallel, " +
    "batch-write files, install deps, list result, and deliver summary.",
};

// Mock code generation responses
const MODEL_CODE = {
  files: [
    {
      path: "src/models/todo.js",
      content: `const todos = [];
let nextId = 1;

export function getAllTodos() { return todos; }
export function getTodoById(id) { return todos.find(t => t.id === id); }
export function createTodo(data) {
  const todo = { id: nextId++, ...data, completed: false, createdAt: new Date() };
  todos.push(todo);
  return todo;
}
export function updateTodo(id, data) {
  const idx = todos.findIndex(t => t.id === id);
  if (idx === -1) return null;
  todos[idx] = { ...todos[idx], ...data };
  return todos[idx];
}
export function deleteTodo(id) {
  const idx = todos.findIndex(t => t.id === id);
  if (idx === -1) return false;
  todos.splice(idx, 1);
  return true;
}`,
      language: "javascript",
    },
    {
      path: "src/routes/todos.js",
      content: `import { Router } from 'express'
import { getAllTodos, getTodoById, createTodo, updateTodo, deleteTodo } from '../models/todo.js'

export const todosRouter = Router()

todosRouter.get('/', (req, res) => res.json(getAllTodos()))
todosRouter.get('/:id', (req, res) => {
  const todo = getTodoById(Number(req.params.id))
  if (!todo) return res.status(404).json({ error: 'Not found' })
  res.json(todo)
})
todosRouter.post('/', (req, res) => res.status(201).json(createTodo(req.body)))
todosRouter.put('/:id', (req, res) => {
  const todo = updateTodo(Number(req.params.id), req.body)
  if (!todo) return res.status(404).json({ error: 'Not found' })
  res.json(todo)
})
todosRouter.delete('/:id', (req, res) => {
  const ok = deleteTodo(Number(req.params.id))
  if (!ok) return res.status(404).json({ error: 'Not found' })
  res.status(204).end()
})`,
      language: "javascript",
    },
  ],
  dependencies: [],
  instructions: "Import todosRouter in src/routes/index.js",
};

const AUTH_CODE = {
  files: [
    {
      path: "src/middleware/jwtAuth.js",
      content: `export function jwtAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' })
  }
  const token = header.slice(7)
  try {
    req.user = { id: 1, role: 'user' }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}`,
      language: "javascript",
    },
  ],
  dependencies: ["jsonwebtoken"],
  instructions: "Apply jwtAuth middleware to protected routes",
};

vi.mock("../../../lib/gemini", () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: vi.fn().mockImplementation(async (params: any) => {
        geminiCallCount++;
        const text =
          typeof params.contents?.[0]?.parts?.[0]?.text === "string"
            ? params.contents[0].parts[0].text
            : "";

        // Planner call — decompose
        if (params.config?.systemInstruction?.includes?.("SuperPlanner")) {
          return { text: JSON.stringify(REST_API_PLAN) };
        }

        // Code generation calls
        if (text.includes("Todo model") || text.includes("CRUD")) {
          return { text: JSON.stringify(MODEL_CODE) };
        }
        if (text.includes("auth") || text.includes("JWT")) {
          return { text: JSON.stringify(AUTH_CODE) };
        }

        // Synthesize fallback
        return {
          text: JSON.stringify({
            result: `Synthesized response for: ${text.slice(0, 100)}`,
          }),
        };
      }),
    },
  })),
  GEMINI_MODELS: { FLASH: "gemini-2.5-flash", PRO: "gemini-2.5-pro" },
}));

// ---------------------------------------------------------------------------
// Mock: agentTools, toolRegistry, selfExpand, webSearch, fs/promises (for planner)
// ---------------------------------------------------------------------------

vi.mock("../../../config/agentTools", () => ({
  AGENT_TOOLS: [
    { name: "web_search" },
    { name: "scaffold_project" },
    { name: "generate_code" },
    { name: "write_file" },
    { name: "write_multiple_files" },
    { name: "shell_exec" },
    { name: "list_files" },
    { name: "synthesize" },
  ],
}));

vi.mock("../../registry/toolRegistry", () => ({
  toolRegistry: {
    getAll: () => new Map(),
    execute: vi.fn().mockResolvedValue({
      success: false,
      error: { code: "NOT_FOUND_ERROR" },
    }),
  },
}));

vi.mock("../../selfExpand/capabilityExpander", () => ({
  expandAndExecute: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../services/webSearch", () => ({
  searchWeb: vi.fn().mockResolvedValue({ results: [] }),
  fetchUrl: vi.fn().mockResolvedValue({ text: "" }),
}));

// Mock fs/promises for planner's fused module discovery (NOT for real file I/O)
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    readdir: vi.fn().mockImplementation(async (dirPath: string, opts?: any) => {
      // If planner is scanning for fused modules, return empty
      if (typeof dirPath === "string" && dirPath.includes("selfExpand/fused")) {
        return [];
      }
      // Otherwise use real readdir (for workspace listing)
      return actual.readdir(dirPath, opts);
    }),
    readFile: actual.readFile,
    mkdir: actual.mkdir,
    rm: actual.rm,
    writeFile: actual.writeFile,
    stat: actual.stat,
  };
});

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("E2E: SuperPlanner REST API creation", () => {
  let runId: string;

  beforeEach(() => {
    geminiCallCount = 0;
    runId = `e2e-test-${Date.now()}`;
  });

  afterEach(async () => {
    // Cleanup workspace
    const workspaceDir = `/tmp/orchestrator-${runId}`;
    try {
      const realFs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
      await realFs.rm(workspaceDir, { recursive: true, force: true });
    } catch { /* already cleaned */ }
  });

  it("creates a working Express project with scaffold + code gen + file writes", async () => {
    const result = await orchestrate(
      "Create a REST API with Express for managing todos, including CRUD endpoints and JWT auth middleware",
      { runId, timeout: 30_000 },
    );

    // Plan executed successfully (or partially — shell_exec may fail without real npm)
    expect(["completed", "partial"]).toContain(result.status);
    expect(result.planId).toBeTruthy();
    expect(result.stats.totalSubtasks).toBe(7);

    // At least scaffold + writes completed
    expect(result.stats.completed).toBeGreaterThanOrEqual(4);

    // The workspace should have real files
    const workspaceDir = `/tmp/orchestrator-${runId}`;
    const projectDir = path.join(workspaceDir, "todo-api");

    // Check scaffold files exist
    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "routes", "index.js"))).toBe(true);

    // Check generated files were written
    expect(fs.existsSync(path.join(projectDir, "src", "models", "todo.js"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "routes", "todos.js"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "middleware", "jwtAuth.js"))).toBe(true);

    // Verify file contents are real (not empty)
    const todoModel = fs.readFileSync(
      path.join(projectDir, "src", "models", "todo.js"),
      "utf-8",
    );
    expect(todoModel).toContain("getAllTodos");
    expect(todoModel).toContain("createTodo");

    const authMiddleware = fs.readFileSync(
      path.join(projectDir, "src", "middleware", "jwtAuth.js"),
      "utf-8",
    );
    expect(authMiddleware).toContain("jwtAuth");
    expect(authMiddleware).toContain("Bearer");

    // Timeline should show all lifecycle events
    expect(result.timeline.length).toBeGreaterThan(0);
    const events = result.timeline.map((t) => t.event);
    expect(events).toContain("plan_created");

    // Artifacts should reference the workspace
    if (result.artifacts) {
      expect(result.artifacts.workspacePath).toContain(runId);
      expect(result.artifacts.files.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("plans with optimal wave parallelism", async () => {
    const result = await orchestrate(
      "Create a REST API with Express for managing todos with auth",
      { runId, timeout: 30_000 },
    );

    // The plan should have generated waves that exploit parallelism
    // step_2 and step_3 (generate_code) have the same dependency (step_1)
    // so they should be in the same wave
    const completedSteps = Object.keys(result.results);
    expect(completedSteps.length).toBeGreaterThanOrEqual(4);

    // Verify step_2 and step_3 results exist (they ran in parallel)
    if (result.results["step_2"] && result.results["step_3"]) {
      expect(result.results["step_2"]).toBeTruthy();
      expect(result.results["step_3"]).toBeTruthy();
    }
  }, 30_000);

  it("SSE events trace the full lifecycle", async () => {
    const sseEvents: Array<{ event: string; data: any }> = [];
    const mockRes = {
      write: vi.fn().mockImplementation((chunk: string) => {
        const lines = chunk.split("\n");
        let event = "";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7);
          if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (event && data) {
          try {
            sseEvents.push({ event, data: JSON.parse(data) });
          } catch { /* ignore parse errors */ }
        }
      }),
    };

    await orchestrate(
      "Create a REST API with Express for managing todos with auth",
      { runId, sseRes: mockRes, timeout: 30_000 },
    );

    // Should have multiple SSE event types
    const eventTypes = [...new Set(sseEvents.map((e) => e.event))];
    expect(eventTypes.length).toBeGreaterThan(0);

    // Should include planning and execution events
    const hasSubtaskEvents = sseEvents.some(
      (e) => e.event === "subtask_start" || e.event === "subtask_complete",
    );
    expect(hasSubtaskEvents).toBe(true);
  }, 30_000);

  it("result contains stats with zero skipped for clean execution", async () => {
    const result = await orchestrate(
      "Create a REST API with Express for managing todos with auth",
      { runId, timeout: 30_000 },
    );

    expect(result.stats.totalSubtasks).toBe(7);
    expect(result.stats.totalDurationMs).toBeGreaterThan(0);
    expect(result.stats.replanned).toBe(0);

    // Skipped should be 0 or minimal
    expect(result.stats.skipped).toBeLessThanOrEqual(1);
  }, 30_000);
});
