// server/agent/orchestrator/scheduler.ts
// ---------------------------------------------------------------------------
// Wave Scheduler — converts a subtask DAG into parallel execution waves.
// Pure logic, no LLM, no I/O.
// ---------------------------------------------------------------------------

import type { SubTask } from "./types";

/**
 * Groups subtasks into waves for parallel execution.
 * Wave N contains subtasks whose dependencies are ALL in waves 0..N-1.
 *
 * Example:
 *   A (no deps), B (no deps), C (depends on A+B), D (depends on C)
 *   → Wave 0: [A, B]  Wave 1: [C]  Wave 2: [D]
 */
export function buildWaves(subtasks: SubTask[]): string[][] {
  const waves: string[][] = [];
  const scheduled = new Set<string>();
  const taskMap = new Map(subtasks.map((t) => [t.id, t]));
  let remaining = subtasks.filter((t) => t.status === "pending");

  // Safety limit to prevent infinite loops on cyclic dependencies
  let iterations = 0;
  const maxIterations = remaining.length + 1;

  while (remaining.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find all tasks whose dependencies are fully scheduled
    const ready = remaining.filter((t) =>
      t.dependencies.every((dep) => scheduled.has(dep)),
    );

    if (ready.length === 0) {
      // Remaining tasks have unresolvable dependencies — force them
      console.warn(
        "[Scheduler] Breaking dependency cycle, forcing:",
        remaining.map((t) => t.id),
      );
      waves.push(remaining.map((t) => t.id));
      break;
    }

    const wave = ready.map((t) => t.id);
    waves.push(wave);

    for (const id of wave) {
      scheduled.add(id);
    }

    remaining = remaining.filter((t) => !scheduled.has(t.id));
  }

  return waves;
}

/**
 * Rebuilds waves for remaining (pending) subtasks after a replan.
 * Skips completed/failed/running subtasks.
 */
export function rebuildWaves(subtasks: SubTask[]): string[][] {
  const pending = subtasks.filter((t) => t.status === "pending");
  const completed = new Set(
    subtasks.filter((t) => t.status === "completed").map((t) => t.id),
  );

  // Adjust dependencies: remove references to completed tasks
  for (const task of pending) {
    task.dependencies = task.dependencies.filter((dep) => !completed.has(dep));
  }

  return buildWaves(pending);
}

/**
 * Returns true if a failed subtask should trigger replanning.
 * Criteria: the subtask is critical OR too many tasks depend on it.
 */
export function shouldReplan(
  failedTask: SubTask,
  allSubtasks: SubTask[],
): boolean {
  if (failedTask.priority === "critical") return true;

  // Check how many tasks depend on the failed one
  const dependentCount = allSubtasks.filter((t) =>
    t.dependencies.includes(failedTask.id),
  ).length;

  return dependentCount >= 2;
}

/**
 * Marks dependents of a failed task as 'skipped'.
 * Returns the IDs of newly skipped tasks.
 */
export function skipDependents(
  failedTaskId: string,
  subtasks: SubTask[],
): string[] {
  const skipped: string[] = [];
  const toSkip = new Set<string>();

  // BFS to find all transitive dependents
  const queue = [failedTaskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const task of subtasks) {
      if (
        task.dependencies.includes(current) &&
        task.status === "pending" &&
        !toSkip.has(task.id)
      ) {
        toSkip.add(task.id);
        queue.push(task.id);
      }
    }
  }

  for (const id of toSkip) {
    const task = subtasks.find((t) => t.id === id);
    if (task) {
      task.status = "skipped";
      task.error = `Skipped: dependency ${failedTaskId} failed`;
      skipped.push(id);
    }
  }

  return skipped;
}
