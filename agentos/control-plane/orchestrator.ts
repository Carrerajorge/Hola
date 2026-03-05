/**
 * AgentOS Control-Plane — Orchestrator
 *
 * The core agent loop that wires planner -> executor -> critic -> judge
 * with soul policies and budget management. This is the beating heart
 * of the Cerebro neuro-symbolic brain.
 *
 * Flow:
 *  1. Receive a mission (goal + budget + soul config)
 *  2. Planner decomposes the goal into an executable plan
 *  3. Executor runs the plan steps (with retries, timeouts)
 *  4. Critic evaluates every result for correctness and grounding
 *  5. Judge decides: continue / stop / escalate / retry / backtrack
 *  6. If backtrack or retry => refine plan and loop again
 *  7. Emit mission:complete or mission:aborted when done
 */

import {
  AgentTask,
  AgentPlan,
  WorldState,
  ExecutionResult,
  CriticFeedback,
  JudgeVerdict,
  JudgeDecision,
  TaskStatus,
  Budget,
  LlmProvider,
  ToolProvider,
  ControlPlaneEmitter,
  Soul,
  makeId,
} from "./types.js";
import { HierarchicalPlanner, SymbolicRule, PlannerConfig } from "./planner/hierarchical-planner.js";
import { TaskExecutor, ExecutorConfig } from "./executor/task-executor.js";
import { CriticVerifier, CriticConfig } from "./critic/critic-verifier.js";
import { Judge, JudgeConfig } from "./judge/judge.js";
import { BudgetManager, BudgetManagerConfig } from "./budgeting/budget-manager.js";
import { SoulPolicyEngine, createDefaultSoul } from "./soul/soul-policies.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  /** Maximum planner-executor-critic-judge iterations per mission. */
  maxIterations: number;
  /** Soul configuration. */
  soul?: Partial<Soul>;
  /** Global budget. */
  budget: Budget;
  /** Sub-component configs. */
  planner?: Partial<PlannerConfig>;
  executor?: Partial<ExecutorConfig>;
  critic?: Partial<CriticConfig>;
  judge?: Partial<JudgeConfig>;
  /** Budget alert thresholds. */
  budgetAlertThresholds?: { warn: number; danger: number };
}

/** Request to start a mission. */
export interface MissionRequest {
  /** The high-level goal. */
  goal: string;
  /** Initial facts about the world. */
  facts?: Record<string, unknown>;
  /** Additional context variables. */
  context?: Record<string, string>;
  /** Per-mission budget override. */
  budget?: Partial<Budget>;
}

/** Final report returned when a mission completes. */
export interface MissionReport {
  missionId: string;
  task: AgentTask;
  finalPlan: AgentPlan;
  results: ExecutionResult[];
  feedbacks: CriticFeedback[];
  verdict: JudgeVerdict;
  worldState: WorldState;
  iterations: number;
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly emitter: ControlPlaneEmitter;
  private readonly soul: SoulPolicyEngine;
  private readonly budgetManager: BudgetManager;
  private readonly planner: HierarchicalPlanner;
  private readonly executor: TaskExecutor;
  private readonly critic: CriticVerifier;
  private readonly judge: Judge;
  private readonly maxIterations: number;

  /** Escalation handler — override to integrate with your human-in-the-loop channel. */
  public onEscalation: (reason: string, worldState: WorldState) => Promise<"continue" | "abort"> =
    async () => "abort";

  constructor(llm: LlmProvider, config: OrchestratorConfig) {
    this.maxIterations = config.maxIterations;

    // Event bus
    this.emitter = new ControlPlaneEmitter();

    // Soul
    const soulConfig = createDefaultSoul(config.soul);
    this.soul = new SoulPolicyEngine(soulConfig);

    // Budget
    const budgetConfig: BudgetManagerConfig = {
      globalBudget: config.budget,
      alertThresholds: config.budgetAlertThresholds,
      enforceHardLimits: true,
    };
    this.budgetManager = new BudgetManager(budgetConfig, this.emitter);

    // Components
    this.planner = new HierarchicalPlanner(llm, this.budgetManager, this.emitter, config.planner);
    this.executor = new TaskExecutor(llm, this.budgetManager, this.soul, this.emitter, config.executor);
    this.critic = new CriticVerifier(llm, this.budgetManager, this.soul, this.emitter, config.critic);
    this.judge = new Judge(llm, this.budgetManager, this.soul, this.emitter, config.judge);
  }

  // -----------------------------------------------------------------------
  // Tool & Rule Registration
  // -----------------------------------------------------------------------

  /** Register a tool the executor can invoke. */
  registerTool(tool: ToolProvider): void {
    this.executor.registerTool(tool);
  }

  /** Register a symbolic decomposition rule on the planner. */
  registerRule(rule: SymbolicRule): void {
    this.planner.addRule(rule);
  }

  /** Access the typed event emitter for external listeners. */
  getEmitter(): ControlPlaneEmitter {
    return this.emitter;
  }

  /** Access sub-components for advanced configuration. */
  getPlanner(): HierarchicalPlanner { return this.planner; }
  getExecutor(): TaskExecutor { return this.executor; }
  getCritic(): CriticVerifier { return this.critic; }
  getJudge(): Judge { return this.judge; }
  getBudgetManager(): BudgetManager { return this.budgetManager; }
  getSoulEngine(): SoulPolicyEngine { return this.soul; }

  // -----------------------------------------------------------------------
  // Mission Execution
  // -----------------------------------------------------------------------

  /**
   * Run a complete mission from goal to final report.
   * This is the primary entry point for the control-plane.
   */
  async runMission(request: MissionRequest): Promise<MissionReport> {
    const missionId = makeId("Mission") as string;

    // Build initial task
    const task: AgentTask = {
      id: makeId("Task"),
      description: request.goal,
      status: TaskStatus.Pending,
      priority: 0,
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Register task budget
    this.budgetManager.registerTask(task.id, request.budget);

    // Initialise world state
    let worldState: WorldState = {
      version: 0,
      facts: request.facts ?? {},
      openGoals: [request.goal],
      achievedGoals: [],
      context: request.context ?? {},
      timestamp: Date.now(),
    };

    task.status = TaskStatus.Running;

    // ─── Phase 1: Plan ──────────────────────────────────────────
    let plan = await this.planner.plan(task, worldState);
    let results: ExecutionResult[] = [];
    let feedbacks: CriticFeedback[] = [];
    let verdict: JudgeVerdict | undefined;
    let iteration = 0;
    let aborted = false;

    // ─── Phase 2: Execute → Critic → Judge loop ─────────────────
    while (iteration < this.maxIterations) {
      iteration++;

      // Check escalation triggers before executing
      const triggers = this.soul.checkEscalationTriggers(worldState, results);
      if (triggers.length > 0) {
        for (const trigger of triggers) {
          this.emitter.emit("escalation:triggered", trigger);
        }
        const humanDecision = await this.handleEscalation(
          triggers.map((t) => t.message).join("; "),
          worldState,
        );
        if (humanDecision === "abort") {
          aborted = true;
          this.emitter.emit("mission:aborted", "Escalation resulted in abort.");
          break;
        }
        // Human said continue — reset autonomous counter
        this.soul.resetAutonomousCounter();
        this.judge.resetCycles();
      }

      // Execute
      results = await this.executor.executePlan(plan, worldState, task.id);

      // Update world state with successful outcomes
      worldState = this.advanceWorldState(worldState, plan, results);

      // Critic evaluation
      feedbacks = await this.critic.evaluate(plan.steps, results, worldState);

      // Judge verdict
      verdict = await this.judge.evaluate(plan, results, feedbacks, worldState);

      // Act on verdict
      switch (verdict.decision) {
        case JudgeDecision.Stop:
          // Mission complete (success or budget exhaustion)
          task.status = verdict.completionScore >= 0.85
            ? TaskStatus.Succeeded
            : TaskStatus.Failed;
          this.emitter.emit("mission:complete", verdict);
          return this.buildReport(missionId, task, plan, results, feedbacks, verdict, worldState, iteration, false);

        case JudgeDecision.Escalate: {
          const humanDecision = await this.handleEscalation(
            verdict.escalationReason ?? verdict.rationale,
            worldState,
          );
          if (humanDecision === "abort") {
            aborted = true;
            task.status = TaskStatus.Cancelled;
            this.emitter.emit("mission:aborted", verdict.escalationReason ?? "Escalated and aborted.");
          } else {
            this.soul.resetAutonomousCounter();
            this.judge.resetCycles();
            // Continue the loop with the existing plan
          }
          break;
        }

        case JudgeDecision.Backtrack:
          // Re-plan from the point of failure
          plan = await this.planner.refine(plan, feedbacks, worldState);
          break;

        case JudgeDecision.Retry:
          // Retry with a refined plan
          plan = await this.planner.refine(plan, feedbacks, worldState);
          break;

        case JudgeDecision.Continue:
          // All steps executed and judge says continue — means plan incomplete.
          // Re-plan for remaining open goals.
          if (worldState.openGoals.length > 0) {
            const continuationTask: AgentTask = {
              ...task,
              description: `Continue: ${worldState.openGoals.join("; ")}`,
              updatedAt: Date.now(),
            };
            plan = await this.planner.plan(continuationTask, worldState);
          }
          break;
      }

      if (aborted) break;
    }

    // Ran out of iterations
    if (!aborted && iteration >= this.maxIterations) {
      task.status = TaskStatus.Failed;
      this.emitter.emit("mission:aborted", `Max iterations (${this.maxIterations}) reached.`);
    }

    return this.buildReport(
      missionId,
      task,
      plan,
      results,
      feedbacks,
      verdict ?? {
        decision: JudgeDecision.Stop,
        rationale: aborted ? "Mission aborted." : "Max iterations reached.",
        completionScore: 0,
        riskLevel: "high" as never,
        timestamp: Date.now(),
      },
      worldState,
      iteration,
      aborted,
    );
  }

  // -----------------------------------------------------------------------
  // World State Management
  // -----------------------------------------------------------------------

  private advanceWorldState(
    current: WorldState,
    plan: AgentPlan,
    results: ExecutionResult[],
  ): WorldState {
    const successStepIds = new Set(results.filter((r) => r.success).map((r) => r.stepId));
    const achievedOutcomes: string[] = [];

    for (const step of plan.steps) {
      if (successStepIds.has(step.id)) {
        achievedOutcomes.push(...step.expectedOutcomes);
      }
    }

    const newAchieved = [...current.achievedGoals];
    const newOpen = [...current.openGoals];

    for (const outcome of achievedOutcomes) {
      if (!newAchieved.includes(outcome)) {
        newAchieved.push(outcome);
      }
      const idx = newOpen.indexOf(outcome);
      if (idx >= 0) newOpen.splice(idx, 1);
    }

    return {
      version: current.version + 1,
      facts: { ...current.facts },
      openGoals: newOpen,
      achievedGoals: newAchieved,
      context: { ...current.context },
      timestamp: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // Escalation Handling
  // -----------------------------------------------------------------------

  private async handleEscalation(
    reason: string,
    worldState: WorldState,
  ): Promise<"continue" | "abort"> {
    try {
      const policy = this.soul.getEscalationPolicy();
      const timeoutMs = policy.humanResponseTimeoutMs;

      if (timeoutMs <= 0) {
        // Block indefinitely — just call the handler
        return await this.onEscalation(reason, worldState);
      }

      // Race the handler against a timeout
      const result = await Promise.race([
        this.onEscalation(reason, worldState),
        new Promise<"continue" | "abort">((resolve) => {
          setTimeout(() => {
            const fallback = policy.timeoutFallback;
            resolve(fallback === "continue_cautiously" ? "continue" : "abort");
          }, timeoutMs);
        }),
      ]);

      return result;
    } catch {
      return "abort";
    }
  }

  // -----------------------------------------------------------------------
  // Report Building
  // -----------------------------------------------------------------------

  private buildReport(
    missionId: string,
    task: AgentTask,
    plan: AgentPlan,
    results: ExecutionResult[],
    feedbacks: CriticFeedback[],
    verdict: JudgeVerdict,
    worldState: WorldState,
    iterations: number,
    aborted: boolean,
  ): MissionReport {
    return {
      missionId,
      task,
      finalPlan: plan,
      results,
      feedbacks,
      verdict,
      worldState,
      iterations,
      aborted,
    };
  }
}
