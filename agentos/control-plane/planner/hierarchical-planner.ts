/**
 * AgentOS Control-Plane — Hierarchical Planner
 *
 * Decomposes high-level goals into executable sub-plans using a combination
 * of LLM reasoning and symbolic rules. Features:
 *  - Recursive goal decomposition with depth control
 *  - Budget-aware planning (estimates token/cost before committing)
 *  - World-model-based state-transition prediction
 *  - Backtracking and plan refinement
 */

import {
  AgentPlan,
  AgentStep,
  AgentTask,
  WorldState,
  StepKind,
  LlmProvider,
  LlmResponse,
  ControlPlaneEmitter,
  makeId,
  StepId,
  CriticFeedback,
} from "../types.js";
import { BudgetManager } from "../budgeting/budget-manager.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PlannerConfig {
  /** Maximum recursive decomposition depth. */
  maxDepth: number;
  /** Maximum total steps in a plan. */
  maxSteps: number;
  /** Default timeout per step (ms). */
  defaultStepTimeoutMs: number;
  /** Default max retries per step. */
  defaultMaxRetries: number;
  /** Temperature for planning LLM calls. */
  temperature: number;
  /** Available tool names the planner can reference. */
  availableTools: string[];
}

const DEFAULT_CONFIG: PlannerConfig = {
  maxDepth: 4,
  maxSteps: 30,
  defaultStepTimeoutMs: 30_000,
  defaultMaxRetries: 2,
  temperature: 0.3,
  availableTools: [],
};

// ---------------------------------------------------------------------------
// Symbolic Rule
// ---------------------------------------------------------------------------

/**
 * A symbolic decomposition rule. If the pattern matches a goal description,
 * the rule produces a set of sub-steps without invoking the LLM.
 */
export interface SymbolicRule {
  name: string;
  /** Returns true if this rule applies to the given goal. */
  matches(goal: string, worldState: WorldState): boolean;
  /** Produce sub-steps for the goal. */
  decompose(goal: string, worldState: WorldState): Omit<AgentStep, "id">[];
}

// ---------------------------------------------------------------------------
// Hierarchical Planner
// ---------------------------------------------------------------------------

export class HierarchicalPlanner {
  private readonly config: PlannerConfig;
  private readonly llm: LlmProvider;
  private readonly budgetManager: BudgetManager;
  private readonly emitter: ControlPlaneEmitter;
  private readonly symbolicRules: SymbolicRule[] = [];

  constructor(
    llm: LlmProvider,
    budgetManager: BudgetManager,
    emitter: ControlPlaneEmitter,
    config?: Partial<PlannerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = llm;
    this.budgetManager = budgetManager;
    this.emitter = emitter;
  }

  /** Register a symbolic decomposition rule. */
  addRule(rule: SymbolicRule): void {
    this.symbolicRules.push(rule);
  }

  // -----------------------------------------------------------------------
  // Plan Generation
  // -----------------------------------------------------------------------

  /**
   * Generate a hierarchical plan for the given task.
   * Combines symbolic rules (fast, deterministic) with LLM reasoning
   * (flexible, creative) based on the current world state.
   */
  async plan(task: AgentTask, worldState: WorldState): Promise<AgentPlan> {
    const steps = await this.decompose(task.description, worldState, 0);

    // Assign dependency chains for sequential steps
    this.linkDependencies(steps);

    const plan: AgentPlan = {
      id: makeId("Plan"),
      taskId: task.id,
      steps,
      worldStateVersion: worldState.version,
      confidence: this.estimateConfidence(steps, worldState),
      reasoningTrace: [`Decomposed "${task.description}" into ${steps.length} steps.`],
      createdAt: Date.now(),
    };

    this.emitter.emit("plan:created", plan);
    return plan;
  }

  /**
   * Refine an existing plan based on critic feedback.
   * Replaces or patches steps that the critic flagged, starting from the
   * failed step and re-planning from that point forward (backtracking).
   */
  async refine(
    plan: AgentPlan,
    feedback: CriticFeedback[],
    worldState: WorldState,
  ): Promise<AgentPlan> {
    const failedStepIds = new Set(
      feedback.filter((f) => f.requiresReplan).map((f) => f.stepId),
    );

    if (failedStepIds.size === 0) return plan;

    // Find the earliest failed step index
    const failIdx = plan.steps.findIndex((s) => failedStepIds.has(s.id));
    if (failIdx === -1) return plan;

    // Keep steps before the failure, re-plan from failure onward
    const keptSteps = plan.steps.slice(0, failIdx);
    const failedGoals = plan.steps
      .slice(failIdx)
      .map((s) => s.description);

    const issueContext = feedback
      .filter((f) => f.requiresReplan)
      .map((f) => `Step ${f.stepId}: ${f.suggestion}`)
      .join("\n");

    const replanGoal = `Re-plan the following goals considering these issues:\n${issueContext}\n\nGoals:\n${failedGoals.join("\n")}`;

    const newSteps = await this.decompose(replanGoal, worldState, 0);
    const allSteps = [...keptSteps, ...newSteps];
    this.linkDependencies(allSteps);

    const refined: AgentPlan = {
      id: makeId("Plan"),
      taskId: plan.taskId,
      steps: allSteps,
      worldStateVersion: worldState.version,
      confidence: this.estimateConfidence(allSteps, worldState),
      reasoningTrace: [
        ...plan.reasoningTrace,
        `Refined plan from step index ${failIdx}: backtracked and re-planned ${newSteps.length} steps.`,
      ],
      createdAt: Date.now(),
    };

    this.emitter.emit("plan:refined", refined, "critic_feedback");
    return refined;
  }

  // -----------------------------------------------------------------------
  // Recursive Decomposition
  // -----------------------------------------------------------------------

  private async decompose(
    goal: string,
    worldState: WorldState,
    depth: number,
  ): Promise<AgentStep[]> {
    if (depth >= this.config.maxDepth) {
      return [this.makeAtomicStep(goal)];
    }

    // 1. Try symbolic rules first (cheap, deterministic)
    for (const rule of this.symbolicRules) {
      if (rule.matches(goal, worldState)) {
        const rawSteps = rule.decompose(goal, worldState);
        return rawSteps.map((s) => ({ ...s, id: makeId("Step") }));
      }
    }

    // 2. Fall back to LLM decomposition
    if (!this.budgetManager.canAfford(1500)) {
      // Not enough budget for an LLM call — produce a single atomic step
      return [this.makeAtomicStep(goal)];
    }

    const llmSteps = await this.llmDecompose(goal, worldState);

    // 3. Recursively decompose complex sub-steps
    const result: AgentStep[] = [];
    for (const step of llmSteps) {
      if (step.kind === StepKind.SubPlan && depth + 1 < this.config.maxDepth) {
        const subSteps = await this.decompose(step.description, worldState, depth + 1);
        result.push(...subSteps);
      } else {
        result.push(step);
      }

      if (result.length >= this.config.maxSteps) break;
    }

    return result.slice(0, this.config.maxSteps);
  }

  // -----------------------------------------------------------------------
  // LLM Decomposition
  // -----------------------------------------------------------------------

  private async llmDecompose(
    goal: string,
    worldState: WorldState,
  ): Promise<AgentStep[]> {
    const toolList = this.config.availableTools.length > 0
      ? `Available tools: ${this.config.availableTools.join(", ")}`
      : "No tools registered — all steps will be LLM calls.";

    const prompt = `You are a planning engine. Decompose the following goal into 2-6 concrete, actionable steps.

Goal: ${goal}

Current world state facts:
${JSON.stringify(worldState.facts, null, 2)}

Open goals: ${worldState.openGoals.join("; ")}
Achieved goals: ${worldState.achievedGoals.join("; ")}

${toolList}

Respond with a JSON array of objects, each with:
- "description": string — what this step does
- "kind": one of "llm_call", "tool_use", "sub_plan", "human_input", "checkpoint"
- "toolName": string or null — tool to use (if kind is "tool_use")
- "toolInput": object or null — inputs for the tool
- "expectedOutcomes": string[] — postconditions this step should achieve
- "estimatedTokens": number — rough token estimate

Return ONLY the JSON array, no markdown.`;

    let response: LlmResponse;
    try {
      response = await this.llm.complete(prompt, {
        temperature: this.config.temperature,
        maxTokens: 1500,
        jsonMode: true,
      });
    } catch {
      return [this.makeAtomicStep(goal)];
    }

    this.budgetManager.record(response.tokensUsed, response.costUsd, response.durationMs);

    return this.parseLlmPlan(response.text);
  }

  private parseLlmPlan(text: string): AgentStep[] {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];

      return arr.map((item: Record<string, unknown>) => ({
        id: makeId("Step"),
        kind: toStepKind(item.kind as string),
        description: String(item.description ?? ""),
        toolName: item.toolName ? String(item.toolName) : undefined,
        toolInput: (item.toolInput as Record<string, unknown>) ?? undefined,
        expectedOutcomes: Array.isArray(item.expectedOutcomes)
          ? item.expectedOutcomes.map(String)
          : [],
        maxRetries: this.config.defaultMaxRetries,
        timeoutMs: this.config.defaultStepTimeoutMs,
        estimatedTokens: Number(item.estimatedTokens) || 500,
        dependsOn: [],
      }));
    } catch {
      // If LLM output is unparseable, fall back to single step
      return [this.makeAtomicStep(text.slice(0, 200))];
    }
  }

  // -----------------------------------------------------------------------
  // World Model Prediction
  // -----------------------------------------------------------------------

  /**
   * Predict the world state after executing a step.
   * Used by the orchestrator to maintain a running world model.
   */
  predictStateTransition(
    step: AgentStep,
    currentState: WorldState,
  ): WorldState {
    const next: WorldState = {
      version: currentState.version + 1,
      facts: { ...currentState.facts },
      openGoals: [...currentState.openGoals],
      achievedGoals: [...currentState.achievedGoals],
      context: { ...currentState.context },
      timestamp: Date.now(),
    };

    // Move expected outcomes from open to achieved
    for (const outcome of step.expectedOutcomes) {
      const idx = next.openGoals.indexOf(outcome);
      if (idx >= 0) {
        next.openGoals.splice(idx, 1);
        next.achievedGoals.push(outcome);
      }
    }

    return next;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeAtomicStep(description: string): AgentStep {
    return {
      id: makeId("Step"),
      kind: StepKind.LlmCall,
      description,
      expectedOutcomes: [description],
      maxRetries: this.config.defaultMaxRetries,
      timeoutMs: this.config.defaultStepTimeoutMs,
      estimatedTokens: 500,
      dependsOn: [],
    };
  }

  /** Link sequential steps so each depends on its predecessor. */
  private linkDependencies(steps: AgentStep[]): void {
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].kind !== StepKind.Parallel && steps[i].dependsOn.length === 0) {
        steps[i].dependsOn = [steps[i - 1].id];
      }
    }
  }

  /** Heuristic confidence score based on plan quality indicators. */
  private estimateConfidence(steps: AgentStep[], worldState: WorldState): number {
    let score = 0.8;

    // Penalise very long plans
    if (steps.length > 15) score -= 0.1;
    if (steps.length > 25) score -= 0.15;

    // Boost if all steps have expected outcomes
    const allHaveOutcomes = steps.every((s) => s.expectedOutcomes.length > 0);
    if (allHaveOutcomes) score += 0.1;

    // Penalise if many open goals remain unaddressed
    const addressed = new Set(steps.flatMap((s) => s.expectedOutcomes));
    const unaddressed = worldState.openGoals.filter((g) => !addressed.has(g));
    score -= unaddressed.length * 0.05;

    return Math.max(0, Math.min(1, score));
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function toStepKind(raw: string): StepKind {
  const map: Record<string, StepKind> = {
    llm_call: StepKind.LlmCall,
    tool_use: StepKind.ToolUse,
    sub_plan: StepKind.SubPlan,
    human_input: StepKind.HumanInput,
    checkpoint: StepKind.Checkpoint,
    parallel: StepKind.Parallel,
  };
  return map[raw] ?? StepKind.LlmCall;
}
