/**
 * AgentOS Control-Plane — Judge
 *
 * Final arbiter that evaluates the overall mission state and decides
 * whether to continue, stop, escalate, retry, or backtrack. The judge
 * operates on aggregated signals from:
 *  - Execution results
 *  - Critic feedback
 *  - Budget status
 *  - Soul risk assessment
 *  - World state progress
 */

import {
  JudgeVerdict,
  JudgeDecision,
  ExecutionResult,
  CriticFeedback,
  AgentPlan,
  WorldState,
  Severity,
  LlmProvider,
  ControlPlaneEmitter,
  StepId,
} from "../types.js";
import { BudgetManager } from "../budgeting/budget-manager.js";
import { SoulPolicyEngine, RiskAssessment } from "../soul/soul-policies.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface JudgeConfig {
  /** Completion score above this => mission considered successful. */
  successThreshold: number;
  /** Maximum consecutive replan cycles before forcing escalation. */
  maxReplanCycles: number;
  /** If true, use LLM for nuanced judgment (costs tokens). */
  enableLlmJudgment: boolean;
  /** Max tokens for LLM judgment call. */
  judgmentMaxTokens: number;
}

const DEFAULT_CONFIG: JudgeConfig = {
  successThreshold: 0.85,
  maxReplanCycles: 3,
  enableLlmJudgment: true,
  judgmentMaxTokens: 600,
};

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

export class Judge {
  private readonly config: JudgeConfig;
  private readonly llm: LlmProvider;
  private readonly budgetManager: BudgetManager;
  private readonly soul: SoulPolicyEngine;
  private readonly emitter: ControlPlaneEmitter;

  /** Counter of consecutive replan cycles. */
  private replanCycles = 0;

  constructor(
    llm: LlmProvider,
    budgetManager: BudgetManager,
    soul: SoulPolicyEngine,
    emitter: ControlPlaneEmitter,
    config?: Partial<JudgeConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = llm;
    this.budgetManager = budgetManager;
    this.soul = soul;
    this.emitter = emitter;
  }

  /**
   * Produce a verdict on the current mission state.
   */
  async evaluate(
    plan: AgentPlan,
    results: ExecutionResult[],
    feedback: CriticFeedback[],
    worldState: WorldState,
  ): Promise<JudgeVerdict> {
    // 1. Compute completion score
    const completionScore = this.computeCompletion(plan, results, feedback, worldState);

    // 2. Risk assessment from soul
    const riskAssessment = this.soul.assessRisk(feedback, worldState);

    // 3. Budget health
    const budgetExhausted = this.budgetManager.isExhausted();
    const utilization = this.budgetManager.getUtilization();

    // 4. Escalation triggers
    const firedTriggers = this.soul.checkEscalationTriggers(worldState, results);

    // 5. Decide via rule engine first, then optionally consult LLM
    let verdict = this.ruleBasedDecision(
      completionScore,
      riskAssessment,
      budgetExhausted,
      utilization,
      firedTriggers.length > 0,
      feedback,
      results,
    );

    // 6. LLM refinement for ambiguous cases
    if (
      this.config.enableLlmJudgment &&
      verdict.decision === JudgeDecision.Continue &&
      completionScore > 0.5 &&
      completionScore < this.config.successThreshold &&
      this.budgetManager.canAfford(this.config.judgmentMaxTokens)
    ) {
      verdict = await this.llmRefineVerdict(verdict, plan, results, feedback, worldState);
    }

    // Track replan cycles
    if (verdict.decision === JudgeDecision.Retry || verdict.decision === JudgeDecision.Backtrack) {
      this.replanCycles++;
    } else {
      this.replanCycles = 0;
    }

    this.emitter.emit("judge:verdict", verdict);
    return verdict;
  }

  /** Reset the replan cycle counter (e.g., after human intervention). */
  resetCycles(): void {
    this.replanCycles = 0;
  }

  // -----------------------------------------------------------------------
  // Rule-Based Decision Engine
  // -----------------------------------------------------------------------

  private ruleBasedDecision(
    completionScore: number,
    risk: RiskAssessment,
    budgetExhausted: boolean,
    utilization: { tokens: number; costUsd: number; latencyMs: number; apiCalls: number },
    escalationTriggered: boolean,
    feedback: CriticFeedback[],
    results: ExecutionResult[],
  ): JudgeVerdict {
    const now = Date.now();

    // Rule 1: Mission complete
    if (completionScore >= this.config.successThreshold) {
      return {
        decision: JudgeDecision.Stop,
        rationale: `Mission completion score (${(completionScore * 100).toFixed(1)}%) meets success threshold.`,
        completionScore,
        riskLevel: risk.severity,
        timestamp: now,
      };
    }

    // Rule 2: Budget exhausted — must stop
    if (budgetExhausted) {
      return {
        decision: JudgeDecision.Stop,
        rationale: "Budget exhausted. Cannot continue.",
        completionScore,
        riskLevel: Severity.High,
        timestamp: now,
      };
    }

    // Rule 3: Escalation trigger fired
    if (escalationTriggered) {
      return {
        decision: JudgeDecision.Escalate,
        rationale: "Escalation trigger fired — human review required.",
        completionScore,
        riskLevel: risk.severity,
        escalationReason: "One or more escalation triggers activated.",
        timestamp: now,
      };
    }

    // Rule 4: Critical risk not within tolerance
    if (risk.severity === Severity.Critical && !risk.withinTolerance) {
      return {
        decision: JudgeDecision.Escalate,
        rationale: `Critical risk detected and outside tolerance: ${risk.concerns.join("; ")}`,
        completionScore,
        riskLevel: Severity.Critical,
        escalationReason: risk.concerns.join("; "),
        timestamp: now,
      };
    }

    // Rule 5: Too many replan cycles — escalate
    if (this.replanCycles >= this.config.maxReplanCycles) {
      return {
        decision: JudgeDecision.Escalate,
        rationale: `Exceeded maximum replan cycles (${this.config.maxReplanCycles}). Human guidance needed.`,
        completionScore,
        riskLevel: Severity.High,
        escalationReason: "Repeated replanning without convergence.",
        timestamp: now,
      };
    }

    // Rule 6: Critic requesting replan — backtrack
    const replanRequests = feedback.filter((f) => f.requiresReplan);
    if (replanRequests.length > 0) {
      const backtrackTo = this.findBacktrackTarget(replanRequests);
      return {
        decision: JudgeDecision.Backtrack,
        rationale: `Critic requested replan for ${replanRequests.length} step(s). Backtracking.`,
        completionScore,
        riskLevel: risk.severity,
        backtrackToStep: backtrackTo,
        timestamp: now,
      };
    }

    // Rule 7: All recent steps failed — retry
    const recentResults = results.slice(-3);
    if (recentResults.length >= 3 && recentResults.every((r) => !r.success)) {
      return {
        decision: JudgeDecision.Retry,
        rationale: "Last 3 steps all failed. Retrying with adjusted plan.",
        completionScore,
        riskLevel: Severity.Medium,
        timestamp: now,
      };
    }

    // Rule 8: Budget getting tight — proceed cautiously
    const maxUtil = Math.max(utilization.tokens, utilization.costUsd, utilization.apiCalls);
    if (maxUtil > 0.9) {
      return {
        decision: JudgeDecision.Continue,
        rationale: `Budget at ${(maxUtil * 100).toFixed(0)}% — proceeding cautiously.`,
        completionScore,
        riskLevel: Severity.Medium,
        timestamp: now,
      };
    }

    // Default: continue
    return {
      decision: JudgeDecision.Continue,
      rationale: `Completion at ${(completionScore * 100).toFixed(1)}%. Continuing.`,
      completionScore,
      riskLevel: risk.severity,
      timestamp: now,
    };
  }

  // -----------------------------------------------------------------------
  // Completion Scoring
  // -----------------------------------------------------------------------

  private computeCompletion(
    plan: AgentPlan,
    results: ExecutionResult[],
    feedback: CriticFeedback[],
    worldState: WorldState,
  ): number {
    if (plan.steps.length === 0) return 0;

    // Factor 1: Step success ratio
    const succeeded = results.filter((r) => r.success).length;
    const stepRatio = succeeded / plan.steps.length;

    // Factor 2: Outcome satisfaction from critic
    const satisfiedCount = feedback.filter((f) => f.outcomeSatisfied).length;
    const outcomeRatio = feedback.length > 0 ? satisfiedCount / feedback.length : 0;

    // Factor 3: Goal progress from world state
    const totalGoals = worldState.openGoals.length + worldState.achievedGoals.length;
    const goalRatio = totalGoals > 0
      ? worldState.achievedGoals.length / totalGoals
      : 0;

    // Factor 4: Average grounding score
    const avgGrounding = feedback.length > 0
      ? feedback.reduce((s, f) => s + f.groundingScore, 0) / feedback.length
      : 0.5;

    // Weighted combination
    return (
      stepRatio * 0.25 +
      outcomeRatio * 0.30 +
      goalRatio * 0.30 +
      avgGrounding * 0.15
    );
  }

  // -----------------------------------------------------------------------
  // LLM Judgment Refinement
  // -----------------------------------------------------------------------

  private async llmRefineVerdict(
    baseVerdict: JudgeVerdict,
    plan: AgentPlan,
    results: ExecutionResult[],
    feedback: CriticFeedback[],
    worldState: WorldState,
  ): Promise<JudgeVerdict> {
    const issuesSummary = feedback
      .flatMap((f) => f.issues)
      .map((i) => `[${i.severity}] ${i.kind}: ${i.description}`)
      .slice(0, 10)
      .join("\n");

    const prompt = `You are a mission judge. Given the current state, decide if the agent should continue, stop, escalate, retry, or backtrack.

Plan: ${plan.steps.length} steps, confidence ${plan.confidence.toFixed(2)}
Results: ${results.filter((r) => r.success).length}/${results.length} succeeded
Completion: ${(baseVerdict.completionScore * 100).toFixed(1)}%
Open goals: ${worldState.openGoals.join("; ")}
Achieved goals: ${worldState.achievedGoals.join("; ")}
Issues:
${issuesSummary}

Budget remaining: ${this.budgetManager.summarize()}

Respond with JSON: { "decision": "continue"|"stop"|"escalate"|"retry"|"backtrack", "rationale": "..." }
Return ONLY the JSON.`;

    try {
      const response = await this.llm.complete(prompt, {
        maxTokens: this.config.judgmentMaxTokens,
        temperature: 0.1,
        jsonMode: true,
      });

      this.budgetManager.record(response.tokensUsed, response.costUsd, response.durationMs);

      const parsed = JSON.parse(response.text) as {
        decision?: string;
        rationale?: string;
      };

      const decision = toJudgeDecision(parsed.decision);
      if (decision) {
        return {
          ...baseVerdict,
          decision,
          rationale: parsed.rationale ?? baseVerdict.rationale,
        };
      }
    } catch {
      // Fall through to base verdict
    }

    return baseVerdict;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private findBacktrackTarget(replanFeedback: CriticFeedback[]): StepId | undefined {
    if (replanFeedback.length > 0) {
      return replanFeedback[0].stepId;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function toJudgeDecision(raw?: string): JudgeDecision | undefined {
  if (!raw) return undefined;
  const map: Record<string, JudgeDecision> = {
    continue: JudgeDecision.Continue,
    stop: JudgeDecision.Stop,
    escalate: JudgeDecision.Escalate,
    retry: JudgeDecision.Retry,
    backtrack: JudgeDecision.Backtrack,
  };
  return map[raw.toLowerCase()];
}
