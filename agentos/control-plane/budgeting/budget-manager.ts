/**
 * AgentOS Control-Plane — Budget Manager
 *
 * Tracks and enforces budgets across four dimensions: tokens, cost ($),
 * latency, and API calls. Supports per-task overrides, configurable alert
 * thresholds, and hard-limit enforcement.
 */

import {
  Budget,
  BudgetUsage,
  BudgetAlert,
  Severity,
  TaskId,
  ControlPlaneEmitter,
} from "../types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Fraction thresholds at which alerts fire. */
export interface AlertThresholds {
  warn: number;   // e.g. 0.7 = 70%
  danger: number; // e.g. 0.9 = 90%
}

export interface BudgetManagerConfig {
  globalBudget: Budget;
  alertThresholds?: AlertThresholds;
  /** If true, exceeding any hard limit throws BudgetExceededError. */
  enforceHardLimits?: boolean;
}

const DEFAULT_THRESHOLDS: AlertThresholds = { warn: 0.7, danger: 0.9 };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BudgetExceededError extends Error {
  constructor(
    public readonly dimension: keyof Budget,
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(`Budget exceeded on "${dimension}": ${used} / ${limit}`);
    this.name = "BudgetExceededError";
  }
}

// ---------------------------------------------------------------------------
// Budget Manager
// ---------------------------------------------------------------------------

export class BudgetManager {
  private readonly globalBudget: Budget;
  private readonly thresholds: AlertThresholds;
  private readonly enforceHard: boolean;
  private readonly emitter: ControlPlaneEmitter;

  /** Cumulative global usage. */
  private globalUsage: BudgetUsage;
  /** Per-task usage and optional budget overrides. */
  private taskBudgets: Map<TaskId, { budget: Budget; usage: BudgetUsage }> = new Map();
  /** Already-fired alert keys (to avoid duplicate alerts). */
  private firedAlerts: Set<string> = new Set();
  /** Wall-clock start time for latency tracking. */
  private readonly startTime: number;

  constructor(config: BudgetManagerConfig, emitter: ControlPlaneEmitter) {
    this.globalBudget = { ...config.globalBudget };
    this.thresholds = config.alertThresholds ?? DEFAULT_THRESHOLDS;
    this.enforceHard = config.enforceHardLimits ?? true;
    this.emitter = emitter;
    this.startTime = Date.now();

    this.globalUsage = { tokensUsed: 0, costUsd: 0, elapsedMs: 0, apiCalls: 0 };
  }

  // -----------------------------------------------------------------------
  // Task Registration
  // -----------------------------------------------------------------------

  /**
   * Register a task with an optional per-task budget.
   * If no budget is given, the task shares the global budget.
   */
  registerTask(taskId: TaskId, budget?: Partial<Budget>): void {
    const resolved: Budget = {
      maxTokens: budget?.maxTokens ?? this.globalBudget.maxTokens,
      maxCostUsd: budget?.maxCostUsd ?? this.globalBudget.maxCostUsd,
      maxLatencyMs: budget?.maxLatencyMs ?? this.globalBudget.maxLatencyMs,
      maxApiCalls: budget?.maxApiCalls ?? this.globalBudget.maxApiCalls,
    };
    this.taskBudgets.set(taskId, {
      budget: resolved,
      usage: { tokensUsed: 0, costUsd: 0, elapsedMs: 0, apiCalls: 0 },
    });
  }

  // -----------------------------------------------------------------------
  // Recording Usage
  // -----------------------------------------------------------------------

  /**
   * Record resource consumption from a step execution.
   * Checks thresholds and enforces hard limits.
   */
  record(
    tokens: number,
    costUsd: number,
    durationMs: number,
    apiCalls: number = 1,
    taskId?: TaskId,
  ): void {
    // Update global
    this.globalUsage.tokensUsed += tokens;
    this.globalUsage.costUsd += costUsd;
    this.globalUsage.elapsedMs = Date.now() - this.startTime;
    this.globalUsage.apiCalls += apiCalls;

    // Update per-task
    if (taskId) {
      const entry = this.taskBudgets.get(taskId);
      if (entry) {
        entry.usage.tokensUsed += tokens;
        entry.usage.costUsd += costUsd;
        entry.usage.elapsedMs += durationMs;
        entry.usage.apiCalls += apiCalls;
        this.checkThresholds(entry.usage, entry.budget, `task:${taskId}`);
      }
    }

    this.checkThresholds(this.globalUsage, this.globalBudget, "global");
  }

  // -----------------------------------------------------------------------
  // Pre-flight Check
  // -----------------------------------------------------------------------

  /**
   * Check whether a proposed step is affordable. Returns true if all
   * dimensions are within budget; throws if enforceHardLimits is on.
   */
  canAfford(estimatedTokens: number, taskId?: TaskId): boolean {
    const budget = this.resolveBudget(taskId);
    const usage = this.resolveUsage(taskId);

    if (usage.tokensUsed + estimatedTokens > budget.maxTokens) {
      if (this.enforceHard) {
        throw new BudgetExceededError("maxTokens", usage.tokensUsed + estimatedTokens, budget.maxTokens);
      }
      return false;
    }

    if (usage.apiCalls + 1 > budget.maxApiCalls) {
      if (this.enforceHard) {
        throw new BudgetExceededError("maxApiCalls", usage.apiCalls + 1, budget.maxApiCalls);
      }
      return false;
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed > budget.maxLatencyMs) {
      if (this.enforceHard) {
        throw new BudgetExceededError("maxLatencyMs", elapsed, budget.maxLatencyMs);
      }
      return false;
    }

    return true;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Snapshot of global usage. */
  getGlobalUsage(): Readonly<BudgetUsage> {
    this.globalUsage.elapsedMs = Date.now() - this.startTime;
    return { ...this.globalUsage };
  }

  /** Snapshot of per-task usage. */
  getTaskUsage(taskId: TaskId): Readonly<BudgetUsage> | undefined {
    return this.taskBudgets.get(taskId)?.usage;
  }

  /** Remaining budget on each dimension (global). */
  getRemaining(): BudgetRemaining {
    const u = this.getGlobalUsage();
    return {
      tokens: Math.max(0, this.globalBudget.maxTokens - u.tokensUsed),
      costUsd: Math.max(0, this.globalBudget.maxCostUsd - u.costUsd),
      latencyMs: Math.max(0, this.globalBudget.maxLatencyMs - u.elapsedMs),
      apiCalls: Math.max(0, this.globalBudget.maxApiCalls - u.apiCalls),
    };
  }

  /** Utilization as fractions (0-1) for each dimension. */
  getUtilization(taskId?: TaskId): BudgetUtilization {
    const budget = this.resolveBudget(taskId);
    const usage = this.resolveUsage(taskId);
    return {
      tokens: safeDivide(usage.tokensUsed, budget.maxTokens),
      costUsd: safeDivide(usage.costUsd, budget.maxCostUsd),
      latencyMs: safeDivide(Date.now() - this.startTime, budget.maxLatencyMs),
      apiCalls: safeDivide(usage.apiCalls, budget.maxApiCalls),
    };
  }

  /** True if any global dimension is at or over 100%. */
  isExhausted(): boolean {
    const u = this.getUtilization();
    return u.tokens >= 1 || u.costUsd >= 1 || u.latencyMs >= 1 || u.apiCalls >= 1;
  }

  /** Human-readable summary for logging / reporting. */
  summarize(taskId?: TaskId): string {
    const u = this.getUtilization(taskId);
    const scope = taskId ? `task ${taskId}` : "global";
    return [
      `Budget (${scope}):`,
      `  tokens  ${pct(u.tokens)}`,
      `  cost    ${pct(u.costUsd)}`,
      `  latency ${pct(u.latencyMs)}`,
      `  calls   ${pct(u.apiCalls)}`,
    ].join("\n");
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private resolveBudget(taskId?: TaskId): Budget {
    if (taskId) {
      const entry = this.taskBudgets.get(taskId);
      if (entry) return entry.budget;
    }
    return this.globalBudget;
  }

  private resolveUsage(taskId?: TaskId): BudgetUsage {
    if (taskId) {
      const entry = this.taskBudgets.get(taskId);
      if (entry) return entry.usage;
    }
    return this.globalUsage;
  }

  private checkThresholds(usage: BudgetUsage, budget: Budget, scope: string): void {
    const checks: Array<{ dim: keyof Budget; used: number; limit: number }> = [
      { dim: "maxTokens", used: usage.tokensUsed, limit: budget.maxTokens },
      { dim: "maxCostUsd", used: usage.costUsd, limit: budget.maxCostUsd },
      { dim: "maxLatencyMs", used: Date.now() - this.startTime, limit: budget.maxLatencyMs },
      { dim: "maxApiCalls", used: usage.apiCalls, limit: budget.maxApiCalls },
    ];

    for (const { dim, used, limit } of checks) {
      if (limit <= 0) continue;
      const frac = used / limit;

      // Hard limit
      if (frac >= 1.0) {
        const key = `${scope}:${dim}:exceeded`;
        if (!this.firedAlerts.has(key)) {
          this.firedAlerts.add(key);
          this.emitter.emit("budget:exceeded", dim);
          this.fireAlert(dim, 1.0, used, limit, Severity.Critical);
        }
        if (this.enforceHard) {
          throw new BudgetExceededError(dim, used, limit);
        }
      }

      // Danger threshold
      if (frac >= this.thresholds.danger) {
        const key = `${scope}:${dim}:danger`;
        if (!this.firedAlerts.has(key)) {
          this.firedAlerts.add(key);
          this.fireAlert(dim, this.thresholds.danger, used, limit, Severity.High);
        }
      }

      // Warn threshold
      if (frac >= this.thresholds.warn) {
        const key = `${scope}:${dim}:warn`;
        if (!this.firedAlerts.has(key)) {
          this.firedAlerts.add(key);
          this.fireAlert(dim, this.thresholds.warn, used, limit, Severity.Medium);
        }
      }
    }
  }

  private fireAlert(
    dimension: keyof Budget,
    threshold: number,
    currentUsage: number,
    limit: number,
    severity: Severity,
  ): void {
    const alert: BudgetAlert = { dimension, threshold, currentUsage, limit, severity, timestamp: Date.now() };
    this.emitter.emit("budget:alert", alert);
  }
}

// ---------------------------------------------------------------------------
// Utility Types & Helpers
// ---------------------------------------------------------------------------

export interface BudgetRemaining {
  tokens: number;
  costUsd: number;
  latencyMs: number;
  apiCalls: number;
}

export interface BudgetUtilization {
  tokens: number;
  costUsd: number;
  latencyMs: number;
  apiCalls: number;
}

function safeDivide(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

function pct(frac: number): string {
  return `${(frac * 100).toFixed(1)}%`;
}
