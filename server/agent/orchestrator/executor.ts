// server/agent/orchestrator/executor.ts
// ---------------------------------------------------------------------------
// SuperPlanner Executor — the brain that coordinates everything.
//
// orchestrate(goal, opts) → plans → schedules → executes → recovers → delivers
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import { decompose } from "./planner";
import { buildWaves, rebuildWaves, shouldReplan, skipDependents } from "./scheduler";
import type {
  SubTask,
  ExecutionPlan,
  ProcessMemory,
  OrchestratorOptions,
  OrchestratorResult,
} from "./types";

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

function emitSSE(res: any, event: string, data: any): void {
  if (!res || typeof res.write !== "function") return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// ProcessMemory helpers
// ---------------------------------------------------------------------------

function createMemory(goal: string): ProcessMemory {
  return {
    goal,
    completedResults: {},
    failedAttempts: [],
    context: {},
    timeline: [],
  };
}

function logEvent(memory: ProcessMemory, event: string, detail: string): void {
  memory.timeline.push({ ts: Date.now(), event, detail });
}

// ---------------------------------------------------------------------------
// Tool execution — routes a subtask to the right backend
// ---------------------------------------------------------------------------

async function executeSubTask(
  subtask: SubTask,
  memory: ProcessMemory,
  opts: OrchestratorOptions,
): Promise<any> {
  const { toolHint, args = {} } = subtask;

  // 1. Handle "synthesize" — LLM reasoning step
  if (toolHint === "synthesize") {
    return await executeSynthesize(subtask, memory);
  }

  // 2. Build context from completed dependencies
  const depContext: Record<string, any> = {};
  for (const depId of subtask.dependencies) {
    if (memory.completedResults[depId] !== undefined) {
      depContext[depId] = memory.completedResults[depId];
    }
  }

  // Inject dependency results into args if referenced
  const enrichedArgs = { ...args, _dependencyResults: depContext };

  // 3. Try built-in tools first (web_search, fetch_url, etc.)
  try {
    const builtinResult = await executeBuiltinTool(toolHint, enrichedArgs);
    if (builtinResult !== null) return builtinResult;
  } catch (err: any) {
    // Built-in failed — continue to other backends
    console.warn(`[Orchestrator] Built-in ${toolHint} failed:`, err.message);
  }

  // 4. Try toolRegistry
  try {
    const { toolRegistry } = await import("../registry/toolRegistry");
    const toolResult = await toolRegistry.execute(toolHint, enrichedArgs, {
      userId: opts.userId || "orchestrator",
      chatId: opts.chatId || opts.runId,
      runId: opts.runId,
    });
    if (toolResult.success) return toolResult.output;
    if (toolResult.error?.code !== "NOT_FOUND_ERROR") {
      throw new Error(toolResult.error?.message || "Tool execution failed");
    }
  } catch (err: any) {
    if (!err.message?.includes("NOT_FOUND")) {
      // Real error, not just missing tool
      console.warn(`[Orchestrator] toolRegistry ${toolHint} error:`, err.message);
    }
  }

  // 5. Try selfExpand — auto-discover and fuse the capability
  try {
    const { expandAndExecute } = await import("../selfExpand/capabilityExpander");
    const expanded = await expandAndExecute(
      toolHint,
      enrichedArgs,
      { userId: opts.userId, chatId: opts.chatId, runId: opts.runId, userMessage: subtask.description },
      opts.runId,
      opts.sseRes,
    );
    if (expanded) {
      emitSSE(opts.sseRes, "self_expanding", {
        subtaskId: subtask.id,
        tool: toolHint,
        status: "acquired",
      });
      return expanded.result;
    }
  } catch (err: any) {
    console.warn(`[Orchestrator] selfExpand ${toolHint} failed:`, err.message);
  }

  // 6. Last resort: use LLM to attempt the task directly
  return await executeSynthesize(subtask, memory);
}

// ---------------------------------------------------------------------------
// Built-in tool execution (direct imports, no registry)
// ---------------------------------------------------------------------------

async function executeBuiltinTool(
  toolName: string,
  args: Record<string, any>,
): Promise<any | null> {
  switch (toolName) {
    case "web_search": {
      const { searchWeb } = await import("../../services/webSearch");
      const result = await searchWeb(args.query, args.maxResults || 5);
      return result.results?.length > 0
        ? result.results.map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
          }))
        : { message: "No results found", query: args.query };
    }

    case "fetch_url": {
      const { fetchUrl } = await import("../../services/webSearch");
      return await fetchUrl(args.url, {
        extractText: args.extractText ?? true,
        maxLength: 50000,
      });
    }

    case "create_document":
    case "create_presentation":
    case "create_spreadsheet": {
      // These use the toolRegistry directly — return null to fall through
      return null;
    }

    case "analyze_data": {
      const ss = await import("simple-statistics");
      let data: any[] = [];
      if (typeof args.data === "string") {
        data = JSON.parse(args.data);
      } else if (Array.isArray(args.data)) {
        data = args.data;
      }
      if (data.length === 0) return { error: "No valid data" };

      const numKeys = Object.keys(data[0]).filter(
        (k) => typeof data[0][k] === "number",
      );
      const insights = numKeys.map((key) => {
        const values = data.map((d) => d[key]);
        return {
          field: key,
          mean: ss.mean(values),
          median: ss.median(values),
          min: ss.min(values),
          max: ss.max(values),
          stdDev: ss.standardDeviation(values),
        };
      });

      return {
        recordCount: data.length,
        fieldsAnalyzed: numKeys,
        insights,
      };
    }

    default:
      return null; // Not a known built-in
  }
}

// ---------------------------------------------------------------------------
// Synthesize — LLM reasoning/assembly step
// ---------------------------------------------------------------------------

async function executeSynthesize(
  subtask: SubTask,
  memory: ProcessMemory,
): Promise<string> {
  const { getGeminiClient, GEMINI_MODELS } = await import("../../lib/gemini");
  const client = getGeminiClient();

  // Build context from all completed results
  let contextStr = "";
  for (const [id, result] of Object.entries(memory.completedResults)) {
    const preview =
      typeof result === "string"
        ? result.slice(0, 1000)
        : JSON.stringify(result, null, 2).slice(0, 1000);
    contextStr += `\n### ${id}\n${preview}\n`;
  }

  const prompt = `You are an expert analyst and writer.

ORIGINAL GOAL: ${memory.goal}

CURRENT TASK: ${subtask.description}

CONTEXT FROM COMPLETED STEPS:
${contextStr || "(no previous results)"}

${subtask.args?.instructions || ""}

Execute the current task using the context above. Provide a thorough, detailed response.
If the task asks you to create a report, document, or analysis — produce the FULL content, not a summary.
If the task asks you to combine results — integrate ALL available data.`;

  if (!client) {
    // No LLM — return a deterministic summary
    return `[Synthesize fallback] Task: ${subtask.description}\nContext keys: ${Object.keys(memory.completedResults).join(", ")}`;
  }

  try {
    const result = await client.models.generateContent({
      model: GEMINI_MODELS.FLASH,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });

    return result.text ?? "[No response from LLM]";
  } catch (err: any) {
    return `[Synthesize error: ${err.message}] Task: ${subtask.description}`;
  }
}

// ---------------------------------------------------------------------------
// orchestrate — Main entry point
// ---------------------------------------------------------------------------

/**
 * Takes an open-ended natural language goal and autonomously:
 * 1. Decomposes it into subtasks (Planner)
 * 2. Schedules execution waves (Scheduler)
 * 3. Executes each subtask with routing, retry, and selfExpand
 * 4. Handles errors with retry → alternate strategy → replan
 * 5. Delivers the assembled final result
 */
export async function orchestrate(
  goal: string,
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const planId = randomUUID();
  const maxRetries = opts.maxRetries ?? 2;
  const maxReplanAttempts = opts.maxReplanAttempts ?? 2;
  let replanCount = 0;
  let selfExpandCount = 0;

  const memory = createMemory(goal);
  logEvent(memory, "orchestration_start", goal);

  emitSSE(opts.sseRes, "orchestration_start", { planId, goal });

  // ── Phase 1: Plan ──
  emitSSE(opts.sseRes, "planning", { planId, status: "decomposing" });
  logEvent(memory, "planning", "Decomposing goal into subtasks");

  const plannerOutput = await decompose(goal);

  const subtasks: SubTask[] = plannerOutput.subtasks.map((st) => ({
    ...st,
    status: "pending" as const,
    retryCount: 0,
    maxRetries,
  }));

  const plan: ExecutionPlan = {
    id: planId,
    goal,
    subtasks,
    waves: [],
    status: "executing",
    memory,
    createdAt: Date.now(),
  };

  // ── Phase 2: Schedule ──
  plan.waves = buildWaves(subtasks);

  emitSSE(opts.sseRes, "plan_created", {
    planId,
    subtaskCount: subtasks.length,
    waveCount: plan.waves.length,
    reasoning: plannerOutput.reasoning,
    subtasks: subtasks.map((t) => ({
      id: t.id,
      description: t.description,
      toolHint: t.toolHint,
      dependencies: t.dependencies,
      priority: t.priority,
    })),
    waves: plan.waves,
  });

  logEvent(
    memory,
    "plan_created",
    `${subtasks.length} subtasks in ${plan.waves.length} waves`,
  );

  // ── Phase 3: Execute waves ──
  for (let waveIdx = 0; waveIdx < plan.waves.length; waveIdx++) {
    const wave = plan.waves[waveIdx];
    const waveTasks = wave
      .map((id) => subtasks.find((t) => t.id === id))
      .filter((t): t is SubTask => t !== undefined && t.status === "pending");

    if (waveTasks.length === 0) continue;

    emitSSE(opts.sseRes, "wave_start", {
      waveIndex: waveIdx,
      subtaskIds: wave,
      parallel: waveTasks.length > 1,
    });

    logEvent(memory, "wave_start", `Wave ${waveIdx}: [${wave.join(", ")}]`);

    // Execute all tasks in this wave in parallel
    const waveResults = await Promise.allSettled(
      waveTasks.map(async (task) => {
        task.status = "running";
        task.startedAt = Date.now();

        emitSSE(opts.sseRes, "subtask_start", {
          subtaskId: task.id,
          description: task.description,
          toolHint: task.toolHint,
        });

        try {
          const result = await executeSubTask(task, memory, opts);
          task.status = "completed";
          task.result = result;
          task.completedAt = Date.now();
          memory.completedResults[task.id] = result;

          logEvent(
            memory,
            "subtask_completed",
            `${task.id} (${task.toolHint}): ${typeof result === "string" ? result.slice(0, 100) : "ok"}`,
          );

          emitSSE(opts.sseRes, "subtask_result", {
            subtaskId: task.id,
            status: "completed",
            durationMs: task.completedAt - task.startedAt!,
            resultPreview:
              typeof result === "string"
                ? result.slice(0, 200)
                : JSON.stringify(result).slice(0, 200),
          });

          return { taskId: task.id, result };
        } catch (err: any) {
          return await handleSubTaskError(task, err, memory, opts, maxRetries);
        }
      }),
    );

    // Check for failures that need replanning
    for (const waveResult of waveResults) {
      if (waveResult.status === "rejected") continue;
      const { taskId } = waveResult.value as any;
      const task = subtasks.find((t) => t.id === taskId);
      if (task && task.status === "failed" && replanCount < maxReplanAttempts) {
        if (shouldReplan(task, subtasks)) {
          // ── Replan ──
          replanCount++;
          logEvent(memory, "replan", `Triggered by ${task.id} failure`);
          emitSSE(opts.sseRes, "replan", {
            reason: `Subtask ${task.id} failed: ${task.error}`,
            attempt: replanCount,
          });

          const newPlan = await decompose(goal, memory);
          const newSubtasks: SubTask[] = newPlan.subtasks.map((st) => ({
            ...st,
            status: "pending" as const,
            retryCount: 0,
            maxRetries,
          }));

          // Replace remaining subtasks
          const completedIds = new Set(
            subtasks.filter((t) => t.status === "completed").map((t) => t.id),
          );
          for (const nst of newSubtasks) {
            if (!completedIds.has(nst.id)) {
              const existing = subtasks.findIndex((t) => t.id === nst.id);
              if (existing >= 0) {
                subtasks[existing] = nst;
              } else {
                subtasks.push(nst);
              }
            }
          }

          plan.waves = rebuildWaves(subtasks);
          plan.status = "executing";

          emitSSE(opts.sseRes, "plan_updated", {
            newSubtaskCount: newSubtasks.length,
            newWaveCount: plan.waves.length,
          });

          // Restart wave execution from the new wave 0
          waveIdx = -1; // Will be incremented to 0 by the for loop
          break;
        } else {
          // Skip dependents of this non-critical failure
          const skipped = skipDependents(task.id, subtasks);
          if (skipped.length > 0) {
            logEvent(memory, "skipped", `Skipped ${skipped.join(", ")} due to ${task.id}`);
            emitSSE(opts.sseRes, "subtasks_skipped", {
              reason: `Dependency ${task.id} failed`,
              skippedIds: skipped,
            });
          }
        }
      }
    }
  }

  // ── Phase 4: Assemble final result ──
  const completed = subtasks.filter((t) => t.status === "completed");
  const failed = subtasks.filter((t) => t.status === "failed");
  const skipped = subtasks.filter((t) => t.status === "skipped");

  // The final output is the last completed subtask's result
  const lastCompleted = completed[completed.length - 1];
  const finalOutput = lastCompleted?.result ?? null;

  plan.status = failed.length === 0 ? "completed" : completed.length > 0 ? "completed" : "failed";
  plan.completedAt = Date.now();

  const resultStatus: OrchestratorResult["status"] =
    failed.length === 0
      ? "completed"
      : completed.length > 0
        ? "partial"
        : "failed";

  const orchestratorResult: OrchestratorResult = {
    planId,
    status: resultStatus,
    results: memory.completedResults,
    finalOutput,
    timeline: memory.timeline,
    stats: {
      totalSubtasks: subtasks.length,
      completed: completed.length,
      failed: failed.length,
      skipped: skipped.length,
      selfExpanded: selfExpandCount,
      replanned: replanCount,
      totalDurationMs: Date.now() - startTime,
    },
  };

  logEvent(
    memory,
    "orchestration_done",
    `${resultStatus}: ${completed.length}/${subtasks.length} completed in ${orchestratorResult.stats.totalDurationMs}ms`,
  );

  emitSSE(opts.sseRes, "orchestration_done", {
    planId,
    status: resultStatus,
    stats: orchestratorResult.stats,
    finalOutputPreview:
      typeof finalOutput === "string"
        ? finalOutput.slice(0, 500)
        : JSON.stringify(finalOutput).slice(0, 500),
  });

  return orchestratorResult;
}

// ---------------------------------------------------------------------------
// Error handling with retry + alternate strategy
// ---------------------------------------------------------------------------

async function handleSubTaskError(
  task: SubTask,
  err: Error,
  memory: ProcessMemory,
  opts: OrchestratorOptions,
  maxRetries: number,
): Promise<{ taskId: string; result: any }> {
  task.retryCount++;

  memory.failedAttempts.push({
    subtaskId: task.id,
    error: err.message,
    strategy: task.toolHint,
    attempt: task.retryCount,
  });

  logEvent(
    memory,
    "subtask_error",
    `${task.id} attempt ${task.retryCount}: ${err.message}`,
  );

  emitSSE(opts.sseRes, "subtask_retry", {
    subtaskId: task.id,
    attempt: task.retryCount,
    maxRetries,
    error: err.message,
  });

  // Retry with same strategy
  if (task.retryCount < maxRetries) {
    try {
      const result = await executeSubTask(task, memory, opts);
      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();
      memory.completedResults[task.id] = result;
      return { taskId: task.id, result };
    } catch (retryErr: any) {
      task.retryCount++;
      memory.failedAttempts.push({
        subtaskId: task.id,
        error: retryErr.message,
        strategy: task.toolHint,
        attempt: task.retryCount,
      });
    }
  }

  // Try alternate strategy
  if (task.alternateStrategy && task.retryCount <= maxRetries + 1) {
    logEvent(memory, "alternate_strategy", `${task.id}: trying ${task.alternateStrategy}`);

    emitSSE(opts.sseRes, "subtask_alternate", {
      subtaskId: task.id,
      alternateStrategy: task.alternateStrategy,
    });

    const altTask: SubTask = {
      ...task,
      toolHint: "synthesize",
      args: {
        ...task.args,
        instructions: `Original approach (${task.toolHint}) failed. Alternate strategy: ${task.alternateStrategy}. ${task.description}`,
      },
    };

    try {
      const result = await executeSubTask(altTask, memory, opts);
      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();
      memory.completedResults[task.id] = result;
      return { taskId: task.id, result };
    } catch (altErr: any) {
      memory.failedAttempts.push({
        subtaskId: task.id,
        error: altErr.message,
        strategy: "alternate:" + task.alternateStrategy,
        attempt: task.retryCount + 1,
      });
    }
  }

  // Final failure
  task.status = "failed";
  task.error = err.message;
  task.completedAt = Date.now();

  emitSSE(opts.sseRes, "subtask_result", {
    subtaskId: task.id,
    status: "failed",
    error: err.message,
  });

  return { taskId: task.id, result: null };
}
