// server/agent/orchestrator/__tests__/scheduler.test.ts
import { describe, it, expect } from "vitest";
import { buildWaves, rebuildWaves, shouldReplan, skipDependents } from "../scheduler";
import type { SubTask } from "../types";

function makeTask(overrides: Partial<SubTask> & { id: string }): SubTask {
  return {
    description: `Task ${overrides.id}`,
    toolHint: "test_tool",
    dependencies: [],
    priority: "normal",
    estimatedComplexity: "simple",
    status: "pending",
    retryCount: 0,
    maxRetries: 2,
    ...overrides,
  };
}

describe("Scheduler — buildWaves", () => {
  it("puts independent tasks in the same wave", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" }),
    ];
    const waves = buildWaves(tasks);
    expect(waves).toEqual([["a", "b", "c"]]);
  });

  it("creates sequential waves for a linear dependency chain", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependencies: ["a"] }),
      makeTask({ id: "c", dependencies: ["b"] }),
    ];
    const waves = buildWaves(tasks);
    expect(waves).toEqual([["a"], ["b"], ["c"]]);
  });

  it("creates parallel waves for a diamond dependency", () => {
    // A → B, A → C, B+C → D
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependencies: ["a"] }),
      makeTask({ id: "c", dependencies: ["a"] }),
      makeTask({ id: "d", dependencies: ["b", "c"] }),
    ];
    const waves = buildWaves(tasks);
    expect(waves).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("handles complex DAG with mixed parallelism", () => {
    // A (no deps), B (no deps), C (dep A), D (dep A+B), E (dep C+D)
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c", dependencies: ["a"] }),
      makeTask({ id: "d", dependencies: ["a", "b"] }),
      makeTask({ id: "e", dependencies: ["c", "d"] }),
    ];
    const waves = buildWaves(tasks);
    expect(waves).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("skips non-pending tasks", () => {
    const tasks = [
      makeTask({ id: "a", status: "completed" }),
      makeTask({ id: "b", dependencies: ["a"] }),
    ];
    const waves = buildWaves(tasks);
    // Only pending task 'b' should be in waves, but its dep 'a' is completed (not scheduled)
    // Since 'a' was never scheduled by buildWaves, 'b' can't resolve its dep
    // buildWaves only processes pending tasks, so 'a' won't be in scheduled set
    // This means 'b' will be forced (cycle breaker)
    expect(waves.length).toBeGreaterThan(0);
    expect(waves.flat()).toContain("b");
  });

  it("breaks cyclic dependencies gracefully", () => {
    const tasks = [
      makeTask({ id: "a", dependencies: ["c"] }),
      makeTask({ id: "b", dependencies: ["a"] }),
      makeTask({ id: "c", dependencies: ["b"] }),
    ];
    const waves = buildWaves(tasks);
    // Should force all tasks into a single wave
    expect(waves.flat().sort()).toEqual(["a", "b", "c"]);
  });
});

describe("Scheduler — rebuildWaves", () => {
  it("rebuilds waves excluding completed tasks", () => {
    const tasks = [
      makeTask({ id: "a", status: "completed" }),
      makeTask({ id: "b", status: "completed" }),
      makeTask({ id: "c", dependencies: ["a", "b"], status: "pending" }),
      makeTask({ id: "d", dependencies: ["c"], status: "pending" }),
    ];
    const waves = rebuildWaves(tasks);
    // c's deps on a,b should be removed (they're completed)
    expect(waves).toEqual([["c"], ["d"]]);
  });
});

describe("Scheduler — shouldReplan", () => {
  it("returns true for critical priority failures", () => {
    const task = makeTask({ id: "a", priority: "critical" });
    expect(shouldReplan(task, [task])).toBe(true);
  });

  it("returns true when many tasks depend on the failed one", () => {
    const failed = makeTask({ id: "a", priority: "normal" });
    const tasks = [
      failed,
      makeTask({ id: "b", dependencies: ["a"] }),
      makeTask({ id: "c", dependencies: ["a"] }),
    ];
    expect(shouldReplan(failed, tasks)).toBe(true);
  });

  it("returns false for non-critical with few dependents", () => {
    const failed = makeTask({ id: "a", priority: "normal" });
    const tasks = [
      failed,
      makeTask({ id: "b", dependencies: ["a"] }),
    ];
    expect(shouldReplan(failed, tasks)).toBe(false);
  });
});

describe("Scheduler — skipDependents", () => {
  it("skips direct and transitive dependents", () => {
    const tasks = [
      makeTask({ id: "a", status: "failed" }),
      makeTask({ id: "b", dependencies: ["a"] }),
      makeTask({ id: "c", dependencies: ["b"] }),
      makeTask({ id: "d" }), // independent
    ];
    const skipped = skipDependents("a", tasks);
    expect(skipped).toEqual(["b", "c"]);
    expect(tasks.find((t) => t.id === "b")!.status).toBe("skipped");
    expect(tasks.find((t) => t.id === "c")!.status).toBe("skipped");
    expect(tasks.find((t) => t.id === "d")!.status).toBe("pending");
  });
});
