// AgentOS Model-Plane — Routing Policies
// Predefined and custom routing policies with a lightweight DSL.

import {
  RoutingPolicy,
  RoutingRule,
  RoutingCondition,
  RoutingTarget,
  RoutingStrategy,
  ModelCapability,
  ModelInfo,
  ModelRequest,
  TaskType,
  Logger,
  defaultLogger,
} from '../types';

// ---------------------------------------------------------------------------
// Policy DSL builder
// ---------------------------------------------------------------------------

export class PolicyBuilder {
  private name = 'custom';
  private strategy: RoutingStrategy = 'custom';
  private rules: RoutingRule[] = [];
  private fallback: string[] = [];
  private canary?: RoutingPolicy['canary'];

  static create(name: string): PolicyBuilder {
    const b = new PolicyBuilder();
    b.name = name;
    return b;
  }

  withStrategy(s: RoutingStrategy): this {
    this.strategy = s;
    return this;
  }

  addRule(condition: RoutingCondition, target: RoutingTarget, priority = 100): this {
    this.rules.push({ condition, target, priority });
    return this;
  }

  /** Shorthand: route a task type to a specific model. */
  routeTask(task: TaskType, modelId: string, provider: RoutingTarget['provider']): this {
    return this.addRule({ taskTypes: [task] }, { modelId, provider });
  }

  /** Shorthand: route a capability requirement to a specific model. */
  routeCapability(cap: ModelCapability, modelId: string, provider: RoutingTarget['provider']): this {
    return this.addRule({ capabilities: [cap] }, { modelId, provider });
  }

  withFallbackChain(chain: string[]): this {
    this.fallback = chain;
    return this;
  }

  withCanary(canary: RoutingPolicy['canary']): this {
    this.canary = canary;
    return this;
  }

  build(): RoutingPolicy {
    return {
      name: this.name,
      strategy: this.strategy,
      rules: this.rules.sort((a, b) => a.priority - b.priority),
      fallbackChain: this.fallback,
      canary: this.canary,
    };
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

export interface ScoringWeights {
  cost: number;
  quality: number;
  latency: number;
}

/** Score a model — lower is better. */
export function scoreModel(model: ModelInfo, weights: ScoringWeights): number {
  // Normalise into comparable ranges:
  //  cost:    per-1k total tokens, typical 0-0.1 USD
  //  quality: 0-1 (inverted so lower = better)
  //  latency: ms, typical 100-10000
  const costNorm = (model.costPer1kInputTokens + model.costPer1kOutputTokens) * 10; // scale up
  const qualityNorm = 1 - model.qualityScore;                                       // invert
  const latencyNorm = model.avgLatencyMs / 10_000;                                   // scale down

  return weights.cost * costNorm + weights.quality * qualityNorm + weights.latency * latencyNorm;
}

/** Return the best model from a list according to weights. */
export function rankModels(models: ModelInfo[], weights: ScoringWeights): ModelInfo[] {
  return [...models].sort((a, b) => scoreModel(a, weights) - scoreModel(b, weights));
}

// ---------------------------------------------------------------------------
// Predefined policies
// ---------------------------------------------------------------------------

/** Minimize cost — pick the cheapest model that satisfies requirements. */
export const CostOptimizedPolicy: RoutingPolicy = PolicyBuilder.create('cost-optimized')
  .withStrategy('cost-optimized')
  .withFallbackChain(['gpt-4o-mini', 'claude-haiku-3-5-20241022'])
  .build();

/** Maximize quality — pick the best benchmark score. */
export const QualityOptimizedPolicy: RoutingPolicy = PolicyBuilder.create('quality-optimized')
  .withStrategy('quality-optimized')
  .withFallbackChain(['claude-opus-4-20250514', 'gpt-4.1', 'claude-sonnet-4-20250514'])
  .build();

/** Minimize latency — pick the fastest model. */
export const LatencyOptimizedPolicy: RoutingPolicy = PolicyBuilder.create('latency-optimized')
  .withStrategy('latency-optimized')
  .withFallbackChain(['claude-haiku-3-5-20241022', 'gpt-4o-mini'])
  .build();

/** Balanced — equal weighting between cost, quality, and latency. */
export const BalancedPolicy: RoutingPolicy = PolicyBuilder.create('balanced')
  .withStrategy('balanced')
  .withFallbackChain(['claude-sonnet-4-20250514', 'gpt-4o', 'claude-haiku-3-5-20241022'])
  .build();

// ---------------------------------------------------------------------------
// Weights per strategy
// ---------------------------------------------------------------------------

const STRATEGY_WEIGHTS: Record<RoutingStrategy, ScoringWeights> = {
  'cost-optimized':    { cost: 0.8,  quality: 0.1,  latency: 0.1 },
  'quality-optimized': { cost: 0.05, quality: 0.85, latency: 0.1 },
  'latency-optimized': { cost: 0.1,  quality: 0.1,  latency: 0.8 },
  'balanced':          { cost: 0.34, quality: 0.33, latency: 0.33 },
  'custom':            { cost: 0.34, quality: 0.33, latency: 0.33 },
};

export function weightsForStrategy(strategy: RoutingStrategy): ScoringWeights {
  return STRATEGY_WEIGHTS[strategy];
}

// ---------------------------------------------------------------------------
// Policy evaluator
// ---------------------------------------------------------------------------

export class PolicyEvaluator {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? defaultLogger;
  }

  /** Evaluate rules and return matching targets in priority order. */
  evaluateRules(policy: RoutingPolicy, request: ModelRequest): RoutingTarget[] {
    const targets: RoutingTarget[] = [];

    for (const rule of policy.rules) {
      if (this.matchesCondition(rule.condition, request)) {
        targets.push(rule.target);
      }
    }

    return targets;
  }

  /** Select the best model from candidates using the policy's strategy weights. */
  selectBest(candidates: ModelInfo[], policy: RoutingPolicy, request: ModelRequest): ModelInfo | undefined {
    // Filter by budget constraints
    let filtered = candidates;
    if (request.budget) {
      filtered = candidates.filter((m) => {
        const estimatedTokens = (request.maxTokens ?? 2048);
        const estCost = (estimatedTokens / 1000) * (m.costPer1kInputTokens + m.costPer1kOutputTokens);
        return estCost <= request.budget!.maxCostUsd;
      });
      if (request.budget.maxLatencyMs) {
        filtered = filtered.filter((m) => m.avgLatencyMs <= request.budget!.maxLatencyMs);
      }
    }

    if (request.qos) {
      if (request.qos.minQualityScore > 0) {
        filtered = filtered.filter((m) => m.qualityScore >= request.qos!.minQualityScore);
      }
      if (request.qos.maxLatencyMs > 0) {
        filtered = filtered.filter((m) => m.avgLatencyMs <= request.qos!.maxLatencyMs);
      }
      if (request.qos.maxCostPerRequestUsd > 0) {
        filtered = filtered.filter((m) => {
          const estCost = ((request.maxTokens ?? 2048) / 1000) * (m.costPer1kInputTokens + m.costPer1kOutputTokens);
          return estCost <= request.qos!.maxCostPerRequestUsd;
        });
      }
    }

    if (filtered.length === 0) {
      this.logger.log('warn', 'No models satisfy constraints, falling back to unfiltered set');
      filtered = candidates;
    }

    const weights = weightsForStrategy(policy.strategy);
    const ranked = rankModels(filtered, weights);

    this.logger.log('debug', 'Model ranking', {
      strategy: policy.strategy,
      top3: ranked.slice(0, 3).map((m) => `${m.id}(${scoreModel(m, weights).toFixed(3)})`),
    });

    return ranked[0];
  }

  /** Resolve a predefined policy by strategy name. */
  static resolve(strategy: RoutingStrategy): RoutingPolicy {
    switch (strategy) {
      case 'cost-optimized':    return CostOptimizedPolicy;
      case 'quality-optimized': return QualityOptimizedPolicy;
      case 'latency-optimized': return LatencyOptimizedPolicy;
      case 'balanced':          return BalancedPolicy;
      case 'custom':            return BalancedPolicy; // custom requires explicit policy
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private matchesCondition(cond: RoutingCondition, request: ModelRequest): boolean {
    if (cond.taskTypes && !cond.taskTypes.includes(request.taskType)) return false;
    if (cond.capabilities) {
      const reqCaps = request.requiredCapabilities ?? [];
      if (!cond.capabilities.every((c) => reqCaps.includes(c))) return false;
    }
    if (cond.custom && !cond.custom(request)) return false;
    return true;
  }
}
