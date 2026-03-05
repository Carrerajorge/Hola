/**
 * AgentOS Control-Plane "Cerebro" — Core Type Definitions
 *
 * Neuro-symbolic type system that underpins every component in the
 * planner -> executor -> critic -> judge loop.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Identifiers & Enums
// ---------------------------------------------------------------------------

/** Opaque branded identifier */
export type Id<T extends string> = string & { readonly __brand: T };

export type TaskId = Id<"Task">;
export type PlanId = Id<"Plan">;
export type StepId = Id<"Step">;

export function makeId<T extends string>(prefix: T): Id<T> {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` as Id<T>;
}

export enum TaskStatus {
  Pending = "pending",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Cancelled = "cancelled",
  Blocked = "blocked",
}

export enum StepKind {
  LlmCall = "llm_call",
  ToolUse = "tool_use",
  SubPlan = "sub_plan",
  HumanInput = "human_input",
  Checkpoint = "checkpoint",
  Parallel = "parallel",
}

export enum Severity {
  Low = "low",
  Medium = "medium",
  High = "high",
  Critical = "critical",
}

export enum JudgeDecision {
  Continue = "continue",
  Stop = "stop",
  Escalate = "escalate",
  Retry = "retry",
  Backtrack = "backtrack",
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Budget dimensions the system tracks and enforces. */
export interface Budget {
  /** Maximum LLM tokens (prompt + completion combined). */
  maxTokens: number;
  /** Maximum dollar spend. */
  maxCostUsd: number;
  /** Maximum wall-clock milliseconds for the entire mission. */
  maxLatencyMs: number;
  /** Maximum discrete API/tool calls. */
  maxApiCalls: number;
}

/** Snapshot of consumed resources at a point in time. */
export interface BudgetUsage {
  tokensUsed: number;
  costUsd: number;
  elapsedMs: number;
  apiCalls: number;
}

/** Alert fired when a budget threshold is crossed. */
export interface BudgetAlert {
  dimension: keyof Budget;
  threshold: number; // 0-1 fraction
  currentUsage: number;
  limit: number;
  severity: Severity;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// World State
// ---------------------------------------------------------------------------

/**
 * An immutable snapshot of the world as the agent perceives it.
 * The planner uses this to predict effects of actions.
 */
export interface WorldState {
  /** Monotonically increasing version counter. */
  version: number;
  /** Arbitrary structured facts keyed by domain. */
  facts: Record<string, unknown>;
  /** Open goals not yet achieved. */
  openGoals: string[];
  /** Goals confirmed achieved. */
  achievedGoals: string[];
  /** Environment variables / context. */
  context: Record<string, string>;
  /** Timestamp of this snapshot. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Agent Task & Plan
// ---------------------------------------------------------------------------

/** A single unit of work the agent must accomplish. */
export interface AgentTask {
  id: TaskId;
  /** Human-readable description of what needs to happen. */
  description: string;
  status: TaskStatus;
  /** Parent task for hierarchical decomposition. */
  parentId?: TaskId;
  /** Priority — lower is more urgent. */
  priority: number;
  /** Optional per-task budget override. */
  budget?: Partial<Budget>;
  /** Metadata / tags. */
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** A single step within a plan. */
export interface AgentStep {
  id: StepId;
  kind: StepKind;
  description: string;
  /** Tool or LLM config needed for this step. */
  toolName?: string;
  toolInput?: Record<string, unknown>;
  /** For Parallel kind — nested steps to run concurrently. */
  parallelSteps?: AgentStep[];
  /** Expected postconditions (symbolic predicates). */
  expectedOutcomes: string[];
  /** Maximum retries for this step. */
  maxRetries: number;
  /** Timeout in ms for this step. */
  timeoutMs: number;
  /** Estimated token cost. */
  estimatedTokens: number;
  /** Dependencies — step IDs that must complete first. */
  dependsOn: StepId[];
}

/** A full plan produced by the hierarchical planner. */
export interface AgentPlan {
  id: PlanId;
  taskId: TaskId;
  steps: AgentStep[];
  /** The world state the plan was generated against. */
  worldStateVersion: number;
  /** Confidence score 0-1 from the planner. */
  confidence: number;
  /** Symbolic reasoning trace (for explainability). */
  reasoningTrace: string[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Result of executing a single AgentStep. */
export interface ExecutionResult {
  stepId: StepId;
  success: boolean;
  output: unknown;
  /** Raw LLM response if applicable. */
  llmResponse?: string;
  /** Actual tokens consumed. */
  tokensUsed: number;
  /** Actual cost in USD. */
  costUsd: number;
  /** Wall-clock duration ms. */
  durationMs: number;
  /** Error message if failed. */
  error?: string;
  /** Number of retries performed. */
  retries: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Critic
// ---------------------------------------------------------------------------

/** Feedback from the critic on an execution result. */
export interface CriticFeedback {
  stepId: StepId;
  /** Did the output satisfy the expected outcomes? */
  outcomeSatisfied: boolean;
  /** Grounding score 0-1 — how well-grounded is the output? */
  groundingScore: number;
  /** Detected issues. */
  issues: CriticIssue[];
  /** Suggested remediation. */
  suggestion: string;
  /** Should the planner re-plan from this point? */
  requiresReplan: boolean;
  timestamp: number;
}

export interface CriticIssue {
  kind: "hallucination" | "inconsistency" | "incomplete" | "policy_violation" | "quality";
  description: string;
  severity: Severity;
  evidence: string[];
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

/** Verdict from the judge on the overall mission state. */
export interface JudgeVerdict {
  decision: JudgeDecision;
  /** Reasoning for the decision. */
  rationale: string;
  /** Overall mission completion 0-1. */
  completionScore: number;
  /** Remaining risk assessment. */
  riskLevel: Severity;
  /** If Escalate — what to escalate about. */
  escalationReason?: string;
  /** If Backtrack — which step to return to. */
  backtrackToStep?: StepId;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Soul & Escalation
// ---------------------------------------------------------------------------

/** Trigger condition that requires human intervention. */
export interface EscalationTrigger {
  /** Unique name for this trigger. */
  name: string;
  /** Predicate evaluated against world state + results. */
  condition: (state: WorldState, results: ExecutionResult[]) => boolean;
  /** Message to present to the human. */
  message: string;
  severity: Severity;
}

/** How to handle escalations. */
export interface EscalationPolicy {
  triggers: EscalationTrigger[];
  /** Maximum time to wait for human response (ms). 0 = block forever. */
  humanResponseTimeoutMs: number;
  /** Fallback action if human doesn't respond in time. */
  timeoutFallback: "abort" | "continue_cautiously" | "retry";
  /** Channel for escalation (webhook, stdio, etc.). */
  channel: string;
}

/** The agent's "soul" — its purpose, ethics, and behavioural policies. */
export interface Soul {
  /** The agent's declared purpose / mission statement. */
  purpose: string;
  /** Ethical constraints that must never be violated. */
  ethicalConstraints: string[];
  /** Priority ordering for competing objectives. */
  priorityRules: string[];
  /** Risk tolerance (maps severity to acceptable probability). */
  riskTolerance: Record<Severity, number>;
  /** Escalation configuration. */
  escalationPolicy: EscalationPolicy;
  /** Domains the agent is NOT allowed to operate in. */
  forbiddenDomains: string[];
  /** Maximum autonomous actions before mandatory human check-in. */
  maxAutonomousSteps: number;
}

// ---------------------------------------------------------------------------
// LLM Provider Abstraction
// ---------------------------------------------------------------------------

/** Minimal interface the control-plane expects from an LLM provider. */
export interface LlmProvider {
  complete(prompt: string, options?: LlmOptions): Promise<LlmResponse>;
}

export interface LlmOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  jsonMode?: boolean;
}

export interface LlmResponse {
  text: string;
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Tool Provider Abstraction
// ---------------------------------------------------------------------------

/** A tool the executor can invoke. */
export interface ToolProvider {
  name: string;
  description: string;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

/** Typed event map for the control-plane event emitter. */
export interface ControlPlaneEvents {
  "plan:created": (plan: AgentPlan) => void;
  "plan:refined": (plan: AgentPlan, reason: string) => void;
  "step:start": (step: AgentStep) => void;
  "step:complete": (result: ExecutionResult) => void;
  "step:retry": (step: AgentStep, attempt: number) => void;
  "critic:feedback": (feedback: CriticFeedback) => void;
  "judge:verdict": (verdict: JudgeVerdict) => void;
  "budget:alert": (alert: BudgetAlert) => void;
  "budget:exceeded": (dimension: keyof Budget) => void;
  "escalation:triggered": (trigger: EscalationTrigger) => void;
  "mission:complete": (verdict: JudgeVerdict) => void;
  "mission:aborted": (reason: string) => void;
}

/** Typed EventEmitter for the control-plane. */
export class ControlPlaneEmitter extends EventEmitter {
  override emit<K extends keyof ControlPlaneEvents>(
    event: K,
    ...args: Parameters<ControlPlaneEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof ControlPlaneEvents>(
    event: K,
    listener: ControlPlaneEvents[K],
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof ControlPlaneEvents>(
    event: K,
    listener: ControlPlaneEvents[K],
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
}
