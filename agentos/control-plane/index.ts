/**
 * AgentOS Control-Plane "Cerebro" — Public API
 *
 * Neuro-symbolic agent orchestration system.
 * Import everything you need from this single entry point.
 *
 * @example
 * ```ts
 * import {
 *   Orchestrator,
 *   type MissionRequest,
 *   type LlmProvider,
 *   createDefaultSoul,
 * } from "./agentos/control-plane/index.js";
 *
 * const llm: LlmProvider = { ... };
 * const orchestrator = new Orchestrator(llm, {
 *   maxIterations: 10,
 *   budget: { maxTokens: 500_000, maxCostUsd: 5, maxLatencyMs: 120_000, maxApiCalls: 50 },
 * });
 *
 * const report = await orchestrator.runMission({ goal: "Deploy the new feature" });
 * console.log(report.verdict);
 * ```
 */

// ── Core Types ──────────────────────────────────────────────────────────
export {
  // Identifiers
  type Id,
  type TaskId,
  type PlanId,
  type StepId,
  makeId,

  // Enums
  TaskStatus,
  StepKind,
  Severity,
  JudgeDecision,

  // Budget
  type Budget,
  type BudgetUsage,
  type BudgetAlert,

  // World State
  type WorldState,

  // Task & Plan
  type AgentTask,
  type AgentStep,
  type AgentPlan,

  // Execution
  type ExecutionResult,

  // Critic
  type CriticFeedback,
  type CriticIssue,

  // Judge
  type JudgeVerdict,

  // Soul & Escalation
  type Soul,
  type EscalationPolicy,
  type EscalationTrigger,

  // LLM / Tool abstractions
  type LlmProvider,
  type LlmOptions,
  type LlmResponse,
  type ToolProvider,
  type ToolResult,

  // Event system
  type ControlPlaneEvents,
  ControlPlaneEmitter,
} from "./types.js";

// ── Orchestrator (primary entry point) ──────────────────────────────────
export {
  Orchestrator,
  type OrchestratorConfig,
  type MissionRequest,
  type MissionReport,
} from "./orchestrator.js";

// ── Planner ─────────────────────────────────────────────────────────────
export {
  HierarchicalPlanner,
  type PlannerConfig,
  type SymbolicRule,
} from "./planner/hierarchical-planner.js";

// ── Executor ────────────────────────────────────────────────────────────
export {
  TaskExecutor,
  type ExecutorConfig,
} from "./executor/task-executor.js";

// ── Critic ──────────────────────────────────────────────────────────────
export {
  CriticVerifier,
  type CriticConfig,
} from "./critic/critic-verifier.js";

// ── Judge ───────────────────────────────────────────────────────────────
export {
  Judge,
  type JudgeConfig,
} from "./judge/judge.js";

// ── Budget Manager ──────────────────────────────────────────────────────
export {
  BudgetManager,
  BudgetExceededError,
  type BudgetManagerConfig,
  type AlertThresholds,
  type BudgetRemaining,
  type BudgetUtilization,
} from "./budgeting/budget-manager.js";

// ── Soul Policies ───────────────────────────────────────────────────────
export {
  SoulPolicyEngine,
  createDefaultSoul,
  type StepGateResult,
  type RiskAssessment,
} from "./soul/soul-policies.js";
