/**
 * AgentOS Control-Plane — Soul Policies
 *
 * The "soul" encodes the agent's purpose, ethical boundaries, risk posture,
 * and escalation behaviour. It is the normative layer that every other
 * component consults before acting.
 */

import {
  Soul,
  EscalationPolicy,
  EscalationTrigger,
  Severity,
  WorldState,
  ExecutionResult,
  AgentStep,
  CriticFeedback,
} from "../types.js";

// ---------------------------------------------------------------------------
// Default Soul Factory
// ---------------------------------------------------------------------------

/** Sensible default soul — conservative, transparent, human-in-the-loop. */
export function createDefaultSoul(overrides?: Partial<Soul>): Soul {
  return {
    purpose: "Assist the user by completing tasks accurately, safely, and transparently.",
    ethicalConstraints: [
      "Never produce harmful, illegal, or deceptive content.",
      "Respect user privacy — do not exfiltrate data.",
      "Do not take irreversible actions without explicit human approval.",
      "Acknowledge uncertainty rather than fabricating answers.",
      "Do not bypass security controls or access restrictions.",
    ],
    priorityRules: [
      "Safety > Correctness > Completeness > Speed > Cost",
      "User explicit instructions override inferred goals.",
      "When in doubt, ask rather than guess.",
    ],
    riskTolerance: {
      [Severity.Low]: 0.8,
      [Severity.Medium]: 0.4,
      [Severity.High]: 0.1,
      [Severity.Critical]: 0.0,
    },
    escalationPolicy: createDefaultEscalationPolicy(),
    forbiddenDomains: [],
    maxAutonomousSteps: 25,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default Escalation Policy
// ---------------------------------------------------------------------------

function createDefaultEscalationPolicy(): EscalationPolicy {
  return {
    triggers: [
      {
        name: "high_cost_spike",
        condition: (_state, results) => {
          const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
          return totalCost > 1.0; // > $1 in a single evaluation window
        },
        message: "Cost has exceeded $1.00 in the current window. Please confirm continuation.",
        severity: Severity.High,
      },
      {
        name: "repeated_failures",
        condition: (_state, results) => {
          const recent = results.slice(-5);
          return recent.length >= 5 && recent.every((r) => !r.success);
        },
        message: "Five consecutive step failures detected. Human review required.",
        severity: Severity.High,
      },
      {
        name: "irreversible_action",
        condition: (state) => {
          const facts = state.facts as Record<string, unknown>;
          return facts["pending_irreversible"] === true;
        },
        message: "An irreversible action is pending. Explicit approval needed.",
        severity: Severity.Critical,
      },
    ],
    humanResponseTimeoutMs: 300_000, // 5 minutes
    timeoutFallback: "abort",
    channel: "stdio",
  };
}

// ---------------------------------------------------------------------------
// Soul Policy Engine
// ---------------------------------------------------------------------------

/**
 * Runtime policy engine that evaluates steps, results, and state against
 * the configured Soul. Components call into this before acting.
 */
export class SoulPolicyEngine {
  private readonly soul: Soul;
  private autonomousStepCount = 0;

  constructor(soul: Soul) {
    this.soul = soul;
  }

  /** Return the underlying soul config (read-only access). */
  getSoul(): Readonly<Soul> {
    return this.soul;
  }

  // -----------------------------------------------------------------------
  // Pre-execution Gate
  // -----------------------------------------------------------------------

  /**
   * Evaluate whether a proposed step is permissible.
   * Returns `{ allowed, reason }`.
   */
  evaluateStep(step: AgentStep, worldState: WorldState): StepGateResult {
    // Check forbidden domains
    for (const domain of this.soul.forbiddenDomains) {
      if (
        step.description.toLowerCase().includes(domain.toLowerCase()) ||
        (step.toolName && step.toolName.toLowerCase().includes(domain.toLowerCase()))
      ) {
        return {
          allowed: false,
          reason: `Step touches forbidden domain "${domain}".`,
          requiresEscalation: true,
        };
      }
    }

    // Check ethical constraints via keyword heuristics (symbolic guard)
    for (const constraint of this.soul.ethicalConstraints) {
      const violation = this.checkConstraintViolation(constraint, step, worldState);
      if (violation) {
        return {
          allowed: false,
          reason: `Potential ethical constraint violation: ${constraint} — ${violation}`,
          requiresEscalation: true,
        };
      }
    }

    // Check autonomous step limit
    if (this.autonomousStepCount >= this.soul.maxAutonomousSteps) {
      return {
        allowed: false,
        reason: `Autonomous step limit (${this.soul.maxAutonomousSteps}) reached. Human check-in required.`,
        requiresEscalation: true,
      };
    }

    return { allowed: true, reason: "Step permitted by soul policies." };
  }

  /**
   * Record that a step executed (for autonomous-step counting).
   */
  recordStepExecution(): void {
    this.autonomousStepCount++;
  }

  /**
   * Reset the autonomous step counter (e.g., after human check-in).
   */
  resetAutonomousCounter(): void {
    this.autonomousStepCount = 0;
  }

  // -----------------------------------------------------------------------
  // Risk Assessment
  // -----------------------------------------------------------------------

  /**
   * Assess risk of proceeding given critic feedback and current state.
   * Returns a severity level and whether it's within tolerance.
   */
  assessRisk(
    feedback: CriticFeedback[],
    worldState: WorldState,
  ): RiskAssessment {
    let maxSeverity = Severity.Low;
    const concerns: string[] = [];

    for (const fb of feedback) {
      for (const issue of fb.issues) {
        if (severityRank(issue.severity) > severityRank(maxSeverity)) {
          maxSeverity = issue.severity;
        }
        if (issue.severity === Severity.High || issue.severity === Severity.Critical) {
          concerns.push(`[${issue.kind}] ${issue.description}`);
        }
      }
    }

    // Factor in open goals — many open goals at low grounding = higher risk
    const avgGrounding =
      feedback.length > 0
        ? feedback.reduce((s, f) => s + f.groundingScore, 0) / feedback.length
        : 1.0;

    if (avgGrounding < 0.3 && worldState.openGoals.length > 3) {
      if (severityRank(Severity.High) > severityRank(maxSeverity)) {
        maxSeverity = Severity.High;
      }
      concerns.push("Low grounding with many open goals.");
    }

    const tolerance = this.soul.riskTolerance[maxSeverity];
    const withinTolerance = avgGrounding >= tolerance;

    return {
      severity: maxSeverity,
      withinTolerance,
      concerns,
      groundingScore: avgGrounding,
    };
  }

  // -----------------------------------------------------------------------
  // Escalation Evaluation
  // -----------------------------------------------------------------------

  /**
   * Check all escalation triggers against current state and results.
   * Returns triggers that fired.
   */
  checkEscalationTriggers(
    worldState: WorldState,
    results: ExecutionResult[],
  ): EscalationTrigger[] {
    return this.soul.escalationPolicy.triggers.filter((t) => {
      try {
        return t.condition(worldState, results);
      } catch {
        // If the trigger predicate throws, treat it as not firing
        // but log the concern.
        return false;
      }
    });
  }

  /** Get the escalation policy for external handling. */
  getEscalationPolicy(): Readonly<EscalationPolicy> {
    return this.soul.escalationPolicy;
  }

  // -----------------------------------------------------------------------
  // Priority Sorting
  // -----------------------------------------------------------------------

  /**
   * Sort goals according to the soul's priority rules.
   * This is a heuristic ordering; the planner can refine further.
   */
  prioritizeGoals(goals: string[]): string[] {
    // Apply simple lexicographic priority based on rule keywords.
    // In a full implementation this would use the LLM for nuanced ranking.
    const safetyKeywords = ["safe", "security", "protect", "prevent harm"];
    const correctnessKeywords = ["correct", "accurate", "valid", "verify"];

    return [...goals].sort((a, b) => {
      const aScore = this.goalPriorityScore(a, safetyKeywords, correctnessKeywords);
      const bScore = this.goalPriorityScore(b, safetyKeywords, correctnessKeywords);
      return bScore - aScore; // higher score = higher priority
    });
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private goalPriorityScore(
    goal: string,
    safetyKw: string[],
    correctnessKw: string[],
  ): number {
    const lower = goal.toLowerCase();
    let score = 0;
    if (safetyKw.some((k) => lower.includes(k))) score += 100;
    if (correctnessKw.some((k) => lower.includes(k))) score += 50;
    return score;
  }

  private checkConstraintViolation(
    constraint: string,
    step: AgentStep,
    _worldState: WorldState,
  ): string | null {
    const desc = step.description.toLowerCase();
    const constraintLower = constraint.toLowerCase();

    // Heuristic: if constraint says "never" do X and step description
    // mentions X-related verbs, flag it.
    if (constraintLower.includes("never") || constraintLower.includes("do not")) {
      const forbidden = extractForbiddenAction(constraintLower);
      if (forbidden && desc.includes(forbidden)) {
        return `Step description mentions "${forbidden}" which is constrained.`;
      }
    }

    // Check for irreversible actions
    if (
      constraintLower.includes("irreversible") &&
      (desc.includes("delete") || desc.includes("drop") || desc.includes("destroy"))
    ) {
      return "Step may perform an irreversible action.";
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityRank(s: Severity): number {
  switch (s) {
    case Severity.Low: return 0;
    case Severity.Medium: return 1;
    case Severity.High: return 2;
    case Severity.Critical: return 3;
  }
}

/**
 * Very simple extractor: grabs the verb/noun after "never" or "do not".
 * A production system would use NLP or explicit rule syntax.
 */
function extractForbiddenAction(constraintLower: string): string | null {
  const patterns = [/never\s+(\w+)/i, /do not\s+(\w+)/i];
  for (const p of patterns) {
    const m = p.exec(constraintLower);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface StepGateResult {
  allowed: boolean;
  reason: string;
  requiresEscalation?: boolean;
}

export interface RiskAssessment {
  severity: Severity;
  withinTolerance: boolean;
  concerns: string[];
  groundingScore: number;
}
