/**
 * AgentOS Control-Plane — Critic / Verifier
 *
 * Evaluates execution results against expected outcomes using a combination
 * of symbolic checks and LLM-based grounding analysis. Detects:
 *  - Hallucinations (ungrounded claims)
 *  - Inconsistencies (contradictions with known facts)
 *  - Incomplete outputs (missing expected outcomes)
 *  - Policy violations (soul constraint breaches)
 *  - Quality issues (low confidence, vague answers)
 *
 * Produces CriticFeedback that the planner uses for refinement and the
 * judge uses for its verdict.
 */

import {
  AgentStep,
  ExecutionResult,
  CriticFeedback,
  CriticIssue,
  Severity,
  WorldState,
  LlmProvider,
  ControlPlaneEmitter,
} from "../types.js";
import { BudgetManager } from "../budgeting/budget-manager.js";
import { SoulPolicyEngine } from "../soul/soul-policies.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CriticConfig {
  /** Grounding score below this triggers a hallucination flag. */
  hallucinationThreshold: number;
  /** Minimum fraction of expected outcomes that must be addressed. */
  outcomeCompletionThreshold: number;
  /** Whether to use LLM for deep verification (costs tokens). */
  enableLlmVerification: boolean;
  /** Maximum tokens to spend on a single verification call. */
  verificationMaxTokens: number;
}

const DEFAULT_CONFIG: CriticConfig = {
  hallucinationThreshold: 0.4,
  outcomeCompletionThreshold: 0.7,
  enableLlmVerification: true,
  verificationMaxTokens: 800,
};

// ---------------------------------------------------------------------------
// Critic Verifier
// ---------------------------------------------------------------------------

export class CriticVerifier {
  private readonly config: CriticConfig;
  private readonly llm: LlmProvider;
  private readonly budgetManager: BudgetManager;
  private readonly soul: SoulPolicyEngine;
  private readonly emitter: ControlPlaneEmitter;

  constructor(
    llm: LlmProvider,
    budgetManager: BudgetManager,
    soul: SoulPolicyEngine,
    emitter: ControlPlaneEmitter,
    config?: Partial<CriticConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llm = llm;
    this.budgetManager = budgetManager;
    this.soul = soul;
    this.emitter = emitter;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Evaluate a batch of execution results against their corresponding steps.
   * Returns one CriticFeedback per result.
   */
  async evaluate(
    steps: AgentStep[],
    results: ExecutionResult[],
    worldState: WorldState,
  ): Promise<CriticFeedback[]> {
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const feedbacks: CriticFeedback[] = [];

    for (const result of results) {
      const step = stepMap.get(result.stepId);
      if (!step) continue;

      const feedback = await this.evaluateSingle(step, result, worldState);
      feedbacks.push(feedback);
      this.emitter.emit("critic:feedback", feedback);
    }

    return feedbacks;
  }

  /**
   * Evaluate a single step/result pair.
   */
  async evaluateSingle(
    step: AgentStep,
    result: ExecutionResult,
    worldState: WorldState,
  ): Promise<CriticFeedback> {
    const issues: CriticIssue[] = [];

    // 1. Failure check — if the step outright failed, flag it
    if (!result.success) {
      issues.push({
        kind: "incomplete",
        description: `Step failed: ${result.error ?? "unknown error"}`,
        severity: Severity.High,
        evidence: [result.error ?? ""],
      });
    }

    // 2. Outcome completeness check (symbolic)
    const outcomeScore = this.checkOutcomeCompleteness(step, result);
    if (outcomeScore < this.config.outcomeCompletionThreshold) {
      issues.push({
        kind: "incomplete",
        description: `Only ${(outcomeScore * 100).toFixed(0)}% of expected outcomes addressed.`,
        severity: outcomeScore < 0.3 ? Severity.High : Severity.Medium,
        evidence: step.expectedOutcomes,
      });
    }

    // 3. Consistency check against known facts
    const inconsistencies = this.checkConsistency(result, worldState);
    issues.push(...inconsistencies);

    // 4. Policy violation check
    const policyViolations = this.checkPolicyViolations(step, result);
    issues.push(...policyViolations);

    // 5. LLM-based grounding / hallucination check
    let groundingScore = result.success ? 0.7 : 0.2; // baseline
    if (
      this.config.enableLlmVerification &&
      result.llmResponse &&
      this.budgetManager.canAfford(this.config.verificationMaxTokens)
    ) {
      const llmCheck = await this.llmGroundingCheck(step, result, worldState);
      groundingScore = llmCheck.score;
      issues.push(...llmCheck.issues);
    }

    // 6. Quality heuristics
    const qualityIssues = this.checkQuality(result);
    issues.push(...qualityIssues);

    // Determine if re-plan is needed
    const hasCritical = issues.some((i) => i.severity === Severity.Critical);
    const hasMultipleHigh = issues.filter((i) => i.severity === Severity.High).length >= 2;
    const requiresReplan = hasCritical || hasMultipleHigh || groundingScore < this.config.hallucinationThreshold;

    const suggestion = this.generateSuggestion(issues, step);

    return {
      stepId: step.id,
      outcomeSatisfied: outcomeScore >= this.config.outcomeCompletionThreshold && result.success,
      groundingScore,
      issues,
      suggestion,
      requiresReplan,
      timestamp: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // Symbolic Checks
  // -----------------------------------------------------------------------

  /**
   * Check what fraction of expected outcomes are addressed in the output.
   * Uses simple keyword matching as a heuristic.
   */
  private checkOutcomeCompleteness(step: AgentStep, result: ExecutionResult): number {
    if (step.expectedOutcomes.length === 0) return 1.0;
    if (!result.success) return 0.0;

    const output = stringifyOutput(result.output);
    let matched = 0;

    for (const outcome of step.expectedOutcomes) {
      const keywords = outcome.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matchCount = keywords.filter((kw) => output.toLowerCase().includes(kw)).length;
      if (keywords.length > 0 && matchCount / keywords.length >= 0.5) {
        matched++;
      }
    }

    return matched / step.expectedOutcomes.length;
  }

  /**
   * Check if the result contradicts known facts in the world state.
   */
  private checkConsistency(result: ExecutionResult, worldState: WorldState): CriticIssue[] {
    const issues: CriticIssue[] = [];
    if (!result.success || !result.llmResponse) return issues;

    const response = result.llmResponse.toLowerCase();
    const facts = worldState.facts as Record<string, unknown>;

    // Check for contradictions with known string/boolean facts
    for (const [key, value] of Object.entries(facts)) {
      if (typeof value === "string") {
        // If the response claims the opposite of a known fact
        const negated = `not ${value.toLowerCase()}`;
        if (response.includes(negated)) {
          issues.push({
            kind: "inconsistency",
            description: `Response may contradict known fact: ${key} = ${value}`,
            severity: Severity.Medium,
            evidence: [negated],
          });
        }
      }
    }

    // Check for contradictions with achieved goals
    for (const goal of worldState.achievedGoals) {
      const keywords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const negationPatterns = keywords.map((kw) => `not ${kw}`);
      for (const pattern of negationPatterns) {
        if (response.includes(pattern)) {
          issues.push({
            kind: "inconsistency",
            description: `Response may contradict achieved goal: "${goal}"`,
            severity: Severity.Medium,
            evidence: [pattern],
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check if the step or result violates soul policies.
   */
  private checkPolicyViolations(step: AgentStep, result: ExecutionResult): CriticIssue[] {
    const issues: CriticIssue[] = [];
    const soul = this.soul.getSoul();

    // Check output against forbidden domains
    const output = stringifyOutput(result.output).toLowerCase();
    for (const domain of soul.forbiddenDomains) {
      if (output.includes(domain.toLowerCase())) {
        issues.push({
          kind: "policy_violation",
          description: `Output references forbidden domain: "${domain}"`,
          severity: Severity.Critical,
          evidence: [domain],
        });
      }
    }

    // Check ethical constraints
    for (const constraint of soul.ethicalConstraints) {
      if (constraint.toLowerCase().includes("deceptive") && containsDeceptiveMarkers(output)) {
        issues.push({
          kind: "policy_violation",
          description: `Potential deceptive content detected (constraint: "${constraint}")`,
          severity: Severity.High,
          evidence: [],
        });
      }
    }

    return issues;
  }

  // -----------------------------------------------------------------------
  // LLM-Based Grounding Check
  // -----------------------------------------------------------------------

  private async llmGroundingCheck(
    step: AgentStep,
    result: ExecutionResult,
    worldState: WorldState,
  ): Promise<{ score: number; issues: CriticIssue[] }> {
    const prompt = `You are a verification engine. Evaluate the following output for groundedness and accuracy.

Step description: ${step.description}
Expected outcomes: ${step.expectedOutcomes.join("; ")}

Output to verify:
${stringifyOutput(result.output).slice(0, 2000)}

Known facts:
${JSON.stringify(worldState.facts, null, 2)}

Rate the output on these criteria:
1. Grounding: Are claims supported by the known facts or the step context? (0-1)
2. Hallucination: Does the output make unsupported claims? (list any)
3. Completeness: Does it address all expected outcomes? (0-1)

Respond with JSON: { "groundingScore": number, "completenessScore": number, "hallucinations": string[], "notes": string }
Return ONLY the JSON.`;

    try {
      const response = await this.llm.complete(prompt, {
        maxTokens: this.config.verificationMaxTokens,
        temperature: 0.1,
        jsonMode: true,
      });

      this.budgetManager.record(
        response.tokensUsed,
        response.costUsd,
        response.durationMs,
      );

      const parsed = JSON.parse(response.text) as {
        groundingScore?: number;
        hallucinations?: string[];
        notes?: string;
      };

      const issues: CriticIssue[] = [];
      const hallucinations = parsed.hallucinations ?? [];

      if (hallucinations.length > 0) {
        issues.push({
          kind: "hallucination",
          description: `LLM verifier detected ${hallucinations.length} potential hallucination(s).`,
          severity: hallucinations.length > 2 ? Severity.High : Severity.Medium,
          evidence: hallucinations,
        });
      }

      return {
        score: typeof parsed.groundingScore === "number"
          ? Math.max(0, Math.min(1, parsed.groundingScore))
          : 0.5,
        issues,
      };
    } catch {
      // If verification fails, return neutral score
      return { score: 0.5, issues: [] };
    }
  }

  // -----------------------------------------------------------------------
  // Quality Heuristics
  // -----------------------------------------------------------------------

  private checkQuality(result: ExecutionResult): CriticIssue[] {
    const issues: CriticIssue[] = [];
    if (!result.success) return issues;

    const output = stringifyOutput(result.output);

    // Very short responses are suspicious
    if (output.length < 20 && output.length > 0) {
      issues.push({
        kind: "quality",
        description: "Output is suspiciously short — may be incomplete.",
        severity: Severity.Low,
        evidence: [output],
      });
    }

    // Extremely long responses may indicate runaway generation
    if (output.length > 50_000) {
      issues.push({
        kind: "quality",
        description: "Output is unusually long — may contain noise.",
        severity: Severity.Low,
        evidence: [`Length: ${output.length} characters`],
      });
    }

    // Check for common hedging patterns that indicate low confidence
    const hedgePatterns = [
      /i('m| am) not sure/i,
      /i don'?t know/i,
      /this might not be/i,
      /i cannot verify/i,
    ];
    const hedgeCount = hedgePatterns.filter((p) => p.test(output)).length;
    if (hedgeCount >= 2) {
      issues.push({
        kind: "quality",
        description: "Output contains multiple hedging phrases — low confidence.",
        severity: Severity.Medium,
        evidence: hedgePatterns.filter((p) => p.test(output)).map((p) => p.source),
      });
    }

    return issues;
  }

  // -----------------------------------------------------------------------
  // Suggestion Generation
  // -----------------------------------------------------------------------

  private generateSuggestion(issues: CriticIssue[], step: AgentStep): string {
    if (issues.length === 0) return "Step looks good.";

    const parts: string[] = [];

    const hallucinations = issues.filter((i) => i.kind === "hallucination");
    if (hallucinations.length > 0) {
      parts.push("Re-run with stricter grounding: include source references and cross-check facts.");
    }

    const incomplete = issues.filter((i) => i.kind === "incomplete");
    if (incomplete.length > 0) {
      parts.push(
        `Address missing outcomes: ${step.expectedOutcomes.join(", ")}. Consider decomposing into smaller steps.`,
      );
    }

    const policyViolations = issues.filter((i) => i.kind === "policy_violation");
    if (policyViolations.length > 0) {
      parts.push("Remove content that violates policies. Escalate to human if unsure.");
    }

    const inconsistencies = issues.filter((i) => i.kind === "inconsistency");
    if (inconsistencies.length > 0) {
      parts.push("Reconcile contradictions with known facts before proceeding.");
    }

    return parts.join(" ");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output == null) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function containsDeceptiveMarkers(text: string): boolean {
  const markers = [
    "pretend to be",
    "impersonate",
    "fake identity",
    "mislead the user",
    "fabricated source",
  ];
  return markers.some((m) => text.includes(m));
}
