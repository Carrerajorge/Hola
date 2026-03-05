/**
 * AgentOS Control-Plane — Task Executor
 *
 * Executes plan steps with retry/timeout logic, parallel and sequential
 * modes, state tracking, and budget integration. Reports every result
 * back through the event bus so the critic can evaluate it.
 */

import {
  AgentPlan,
  AgentStep,
  ExecutionResult,
  StepKind,
  LlmProvider,
  ToolProvider,
  ControlPlaneEmitter,
  StepId,
  TaskId,
} from "../types.js";
import { BudgetManager, BudgetExceededError } from "../budgeting/budget-manager.js";
import { SoulPolicyEngine, StepGateResult } from "../soul/soul-policies.js";
import type { WorldState } from "../types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ExecutorConfig {
  /** Global concurrency limit for parallel steps. */
  maxConcurrency: number;
  /** Grace period (ms) added to step timeouts for cleanup. */
  timeoutGraceMs: number;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  maxConcurrency: 5,
  timeoutGraceMs: 2_000,
};

// ---------------------------------------------------------------------------
// Task Executor
// ---------------------------------------------------------------------------

export class TaskExecutor {
  private readonly config: ExecutorConfig;
  private readonly llm: LlmProvider;
  private readonly tools: Map<string, ToolProvider> = new Map();
  private readonly budgetManager: BudgetManager;
  private readonly soul: SoulPolicyEngine;
  private readonly emitter: ControlPlaneEmitter;

  /** Results collected during the current execution run. */
  private results: Map<StepId, ExecutionResult> = new Map();
  /** Steps currently in-flight (for concurrency control). */
  private inFlight = 0;
  /** Signal to abort the entire execution. */
  private aborted = false;

  constructor(
    llm: LlmProvider,
    budgetManager: BudgetManager,
    soul: SoulPolicyEngine,
    emitter: ControlPlaneEmitter,
    config?: Partial<ExecutorConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = llm;
    this.budgetManager = budgetManager;
    this.soul = soul;
    this.emitter = emitter;
  }

  /** Register a tool the executor can call. */
  registerTool(tool: ToolProvider): void {
    this.tools.set(tool.name, tool);
  }

  /** Abort the current execution run. */
  abort(): void {
    this.aborted = true;
  }

  // -----------------------------------------------------------------------
  // Plan Execution
  // -----------------------------------------------------------------------

  /**
   * Execute all steps in a plan, respecting dependency ordering.
   * Returns the full set of execution results.
   */
  async executePlan(
    plan: AgentPlan,
    worldState: WorldState,
    taskId?: TaskId,
  ): Promise<ExecutionResult[]> {
    this.results.clear();
    this.aborted = false;

    // Build adjacency for dependency-aware scheduling
    const completed = new Set<StepId>();
    const stepMap = new Map(plan.steps.map((s) => [s.id, s]));
    const pending = new Set(plan.steps.map((s) => s.id));

    while (pending.size > 0 && !this.aborted) {
      // Find steps whose dependencies are all satisfied
      const ready: AgentStep[] = [];
      for (const id of pending) {
        const step = stepMap.get(id)!;
        if (step.dependsOn.every((dep) => completed.has(dep))) {
          ready.push(step);
        }
      }

      if (ready.length === 0 && pending.size > 0) {
        // Deadlock — unresolvable dependencies
        for (const id of pending) {
          this.results.set(id, this.makeFailureResult(id, "Deadlocked: unresolvable dependencies."));
        }
        break;
      }

      // Execute ready steps (up to concurrency limit)
      const batch = ready.slice(0, this.config.maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((step) => this.executeStep(step, worldState, taskId)),
      );

      for (const result of batchResults) {
        this.results.set(result.stepId, result);
        completed.add(result.stepId);
        pending.delete(result.stepId);
        this.emitter.emit("step:complete", result);

        // If a step failed and later steps depend on it, cancel them
        if (!result.success) {
          this.cancelDependents(result.stepId, plan.steps, pending, completed);
        }
      }
    }

    return Array.from(this.results.values());
  }

  /**
   * Execute a single step with optional start offset in a larger plan.
   * Useful for partial re-execution after backtracking.
   */
  async executeSingleStep(
    step: AgentStep,
    worldState: WorldState,
    taskId?: TaskId,
  ): Promise<ExecutionResult> {
    return this.executeStep(step, worldState, taskId);
  }

  /** Retrieve all results from the last run. */
  getResults(): ReadonlyMap<StepId, ExecutionResult> {
    return this.results;
  }

  // -----------------------------------------------------------------------
  // Core Step Execution
  // -----------------------------------------------------------------------

  private async executeStep(
    step: AgentStep,
    worldState: WorldState,
    taskId?: TaskId,
  ): Promise<ExecutionResult> {
    // Soul gate — check policy before executing
    const gate: StepGateResult = this.soul.evaluateStep(step, worldState);
    if (!gate.allowed) {
      return this.makeFailureResult(step.id, `Blocked by soul policy: ${gate.reason}`);
    }

    // Budget pre-flight
    try {
      this.budgetManager.canAfford(step.estimatedTokens, taskId);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return this.makeFailureResult(step.id, err.message);
      }
      throw err;
    }

    this.emitter.emit("step:start", step);

    // Retry loop
    let lastError = "";
    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      if (this.aborted) {
        return this.makeFailureResult(step.id, "Execution aborted.");
      }

      if (attempt > 0) {
        this.emitter.emit("step:retry", step, attempt);
      }

      try {
        const result = await this.runWithTimeout(step, worldState, taskId);
        this.soul.recordStepExecution();

        // Record budget usage
        this.budgetManager.record(
          result.tokensUsed,
          result.costUsd,
          result.durationMs,
          1,
          taskId,
        );

        if (result.success) {
          return { ...result, retries: attempt };
        }
        lastError = result.error ?? "Unknown failure";
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return this.makeFailureResult(step.id, `Failed after ${step.maxRetries + 1} attempts: ${lastError}`);
  }

  // -----------------------------------------------------------------------
  // Step Dispatch by Kind
  // -----------------------------------------------------------------------

  private async runWithTimeout(
    step: AgentStep,
    worldState: WorldState,
    taskId?: TaskId,
  ): Promise<ExecutionResult> {
    const totalTimeout = step.timeoutMs + this.config.timeoutGraceMs;

    return new Promise<ExecutionResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve(this.makeFailureResult(step.id, `Step timed out after ${step.timeoutMs}ms`));
      }, totalTimeout);

      this.dispatch(step, worldState, taskId)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          resolve(this.makeFailureResult(step.id, err instanceof Error ? err.message : String(err)));
        });
    });
  }

  private async dispatch(
    step: AgentStep,
    worldState: WorldState,
    _taskId?: TaskId,
  ): Promise<ExecutionResult> {
    const start = Date.now();

    switch (step.kind) {
      case StepKind.LlmCall:
        return this.executeLlmCall(step, worldState, start);

      case StepKind.ToolUse:
        return this.executeToolCall(step, start);

      case StepKind.Parallel:
        return this.executeParallel(step, worldState, start);

      case StepKind.HumanInput:
        return this.executeHumanInput(step, start);

      case StepKind.Checkpoint:
        return this.executeCheckpoint(step, start);

      case StepKind.SubPlan:
        // SubPlans should have been flattened by the planner.
        // If one slips through, treat it as an LLM call.
        return this.executeLlmCall(step, worldState, start);

      default:
        return this.makeFailureResult(step.id, `Unknown step kind: ${step.kind}`);
    }
  }

  private async executeLlmCall(
    step: AgentStep,
    worldState: WorldState,
    start: number,
  ): Promise<ExecutionResult> {
    const prompt = `Execute the following task and provide the result.

Task: ${step.description}

Current context:
${JSON.stringify(worldState.context, null, 2)}

Relevant facts:
${JSON.stringify(worldState.facts, null, 2)}

Expected outcomes: ${step.expectedOutcomes.join("; ")}

Provide a clear, structured response.`;

    const response = await this.llm.complete(prompt, {
      maxTokens: step.estimatedTokens,
      temperature: 0.2,
    });

    return {
      stepId: step.id,
      success: true,
      output: response.text,
      llmResponse: response.text,
      tokensUsed: response.tokensUsed,
      costUsd: response.costUsd,
      durationMs: Date.now() - start,
      retries: 0,
      timestamp: Date.now(),
    };
  }

  private async executeToolCall(
    step: AgentStep,
    start: number,
  ): Promise<ExecutionResult> {
    if (!step.toolName) {
      return this.makeFailureResult(step.id, "Tool step missing toolName.");
    }

    const tool = this.tools.get(step.toolName);
    if (!tool) {
      return this.makeFailureResult(step.id, `Tool "${step.toolName}" not registered.`);
    }

    const toolResult = await tool.execute(step.toolInput ?? {});

    return {
      stepId: step.id,
      success: toolResult.success,
      output: toolResult.output,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Date.now() - start,
      error: toolResult.error,
      retries: 0,
      timestamp: Date.now(),
    };
  }

  private async executeParallel(
    step: AgentStep,
    worldState: WorldState,
    start: number,
  ): Promise<ExecutionResult> {
    if (!step.parallelSteps || step.parallelSteps.length === 0) {
      return this.makeFailureResult(step.id, "Parallel step has no sub-steps.");
    }

    const subResults = await Promise.all(
      step.parallelSteps.map((sub) => this.dispatch(sub, worldState)),
    );

    const allSucceeded = subResults.every((r) => r.success);
    const totalTokens = subResults.reduce((s, r) => s + r.tokensUsed, 0);
    const totalCost = subResults.reduce((s, r) => s + r.costUsd, 0);

    return {
      stepId: step.id,
      success: allSucceeded,
      output: subResults.map((r) => r.output),
      tokensUsed: totalTokens,
      costUsd: totalCost,
      durationMs: Date.now() - start,
      error: allSucceeded ? undefined : "One or more parallel sub-steps failed.",
      retries: 0,
      timestamp: Date.now(),
    };
  }

  private async executeHumanInput(
    step: AgentStep,
    start: number,
  ): Promise<ExecutionResult> {
    // In a real system this would invoke the escalation channel and wait.
    // Here we produce a result indicating human input is needed.
    return {
      stepId: step.id,
      success: false,
      output: null,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Date.now() - start,
      error: `Human input required: ${step.description}`,
      retries: 0,
      timestamp: Date.now(),
    };
  }

  private async executeCheckpoint(
    step: AgentStep,
    start: number,
  ): Promise<ExecutionResult> {
    // Checkpoints always succeed — they are bookkeeping markers.
    return {
      stepId: step.id,
      success: true,
      output: { checkpoint: step.description, timestamp: Date.now() },
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Date.now() - start,
      retries: 0,
      timestamp: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // Dependency Cancellation
  // -----------------------------------------------------------------------

  private cancelDependents(
    failedId: StepId,
    allSteps: AgentStep[],
    pending: Set<StepId>,
    completed: Set<StepId>,
  ): void {
    const toCancelQueue = [failedId];

    while (toCancelQueue.length > 0) {
      const parentId = toCancelQueue.shift()!;
      for (const step of allSteps) {
        if (pending.has(step.id) && step.dependsOn.includes(parentId)) {
          const result = this.makeFailureResult(
            step.id,
            `Cancelled: dependency ${parentId} failed.`,
          );
          this.results.set(step.id, result);
          pending.delete(step.id);
          completed.add(step.id);
          toCancelQueue.push(step.id);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeFailureResult(stepId: StepId, error: string): ExecutionResult {
    return {
      stepId,
      success: false,
      output: null,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: 0,
      error,
      retries: 0,
      timestamp: Date.now(),
    };
  }
}
