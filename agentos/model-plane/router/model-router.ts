// AgentOS Model-Plane — Model Router
// Policy-based router that selects the best model per request, with canary
// testing, fallback chains, and capability matching.

import {
  ModelRequest,
  ModelResponse,
  ModelInfo,
  RoutingPolicy,
  CanaryConfig,
  CanaryVariant,
  CanaryResult,
  ModelCapability,
  Logger,
  defaultLogger,
} from '../types';
import { ProviderRegistry } from '../providers/provider-registry';
import { PolicyEvaluator, weightsForStrategy, rankModels } from '../policy/routing-policies';

// ---------------------------------------------------------------------------
// Router options
// ---------------------------------------------------------------------------

export interface ModelRouterOptions {
  registry: ProviderRegistry;
  defaultPolicy: RoutingPolicy;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class ModelRouter {
  private registry: ProviderRegistry;
  private policy: RoutingPolicy;
  private evaluator: PolicyEvaluator;
  private logger: Logger;

  /** Per-experiment sticky session map: hash -> variant name. */
  private stickyMap = new Map<string, string>();

  constructor(options: ModelRouterOptions) {
    this.registry = options.registry;
    this.policy = options.defaultPolicy;
    this.evaluator = new PolicyEvaluator(options.logger);
    this.logger = options.logger ?? defaultLogger;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Route a request and execute it against the selected provider. */
  async route(request: ModelRequest): Promise<ModelResponse> {
    // 1. If the request already pins a model, skip routing.
    if (request.model) {
      return this.executeOnModel(request, request.model);
    }

    // 2. Check canary experiment first.
    const canary = this.policy.canary;
    if (canary?.enabled) {
      return this.routeCanary(request, canary);
    }

    // 3. Evaluate policy rules for explicit targets.
    const ruleTargets = this.evaluator.evaluateRules(this.policy, request);
    if (ruleTargets.length > 0) {
      const target = ruleTargets[0];
      this.logger.log('debug', 'Rule-based routing', { target: target.modelId });
      return this.executeWithFallback(request, [target.modelId, ...this.policy.fallbackChain]);
    }

    // 4. Score-based selection from all eligible models.
    const selectedModel = this.selectModel(request);
    if (selectedModel) {
      this.logger.log('debug', 'Score-based routing', { model: selectedModel.id });
      return this.executeWithFallback(request, [selectedModel.id, ...this.policy.fallbackChain]);
    }

    // 5. Last resort: fallback chain.
    if (this.policy.fallbackChain.length > 0) {
      this.logger.log('warn', 'No scored model found, using fallback chain');
      return this.executeWithFallback(request, this.policy.fallbackChain);
    }

    throw new Error('ModelRouter: no model available for request');
  }

  /** Update the active routing policy at runtime. */
  setPolicy(policy: RoutingPolicy): void {
    this.policy = policy;
    this.logger.log('info', `Routing policy changed to: ${policy.name}`);
  }

  getPolicy(): RoutingPolicy {
    return this.policy;
  }

  clearStickySessions(): void {
    this.stickyMap.clear();
  }

  // -----------------------------------------------------------------------
  // Model selection
  // -----------------------------------------------------------------------

  private selectModel(request: ModelRequest): ModelInfo | undefined {
    const requiredCaps = this.inferCapabilities(request);
    let candidates = this.registry.findModels(requiredCaps);

    // Only include models from healthy providers.
    const healthy = new Set(this.registry.getHealthyProviders());
    candidates = candidates.filter((m) => healthy.has(m.provider));

    if (candidates.length === 0) {
      this.logger.log('warn', 'No candidates match required capabilities', { caps: requiredCaps });
      // Relax: try all healthy models.
      candidates = this.registry.listAllModels().filter((m) => healthy.has(m.provider));
    }

    return this.evaluator.selectBest(candidates, this.policy, request);
  }

  /** Infer required capabilities from the request when not explicitly set. */
  private inferCapabilities(request: ModelRequest): ModelCapability[] {
    if (request.requiredCapabilities?.length) return request.requiredCapabilities;

    const caps: ModelCapability[] = [];
    switch (request.taskType) {
      case 'chat':
      case 'completion':
        caps.push('text-generation');
        break;
      case 'embedding':
        caps.push('text-embedding');
        break;
      case 'image':
        caps.push('image-generation');
        break;
      case 'video':
        caps.push('video-generation');
        break;
      case 'voice':
        caps.push('voice-synthesis');
        break;
      case 'code':
        caps.push('code-generation');
        break;
      case 'reasoning':
        caps.push('reasoning');
        break;
      case 'multi-modal':
        caps.push('text-generation', 'image-understanding');
        break;
    }

    if (request.tools?.length) caps.push('function-calling');
    return caps;
  }

  // -----------------------------------------------------------------------
  // Canary / A-B testing
  // -----------------------------------------------------------------------

  private async routeCanary(request: ModelRequest, canary: CanaryConfig): Promise<ModelResponse> {
    const variant = this.pickVariant(request, canary);
    this.logger.log('debug', 'Canary routing', { experiment: canary.experimentId, variant: variant.name });

    const response = await this.executeWithFallback(request, [variant.model, ...this.policy.fallbackChain]);

    // Report metrics
    if (canary.metricsCallback) {
      const result: CanaryResult = {
        experimentId: canary.experimentId,
        variant: variant.name,
        requestId: request.requestId,
        latencyMs: response.latencyMs,
        costUsd: response.costUsd,
      };
      try {
        canary.metricsCallback(result);
      } catch (err) {
        this.logger.log('warn', 'Canary metrics callback failed', { error: String(err) });
      }
    }

    return response;
  }

  private pickVariant(request: ModelRequest, canary: CanaryConfig): CanaryVariant {
    // Sticky sessions: deterministic assignment per user/session.
    if (canary.stickySessions) {
      const sessionKey = String(request.metadata?.sessionId ?? request.metadata?.userId ?? request.requestId);
      const stickyKey = `${canary.experimentId}:${sessionKey}`;
      const existing = this.stickyMap.get(stickyKey);
      if (existing) {
        const v = canary.variants.find((v) => v.name === existing);
        if (v) return v;
      }
      const selected = this.weightedRandom(canary.variants, this.hashString(sessionKey));
      this.stickyMap.set(stickyKey, selected.name);
      return selected;
    }

    return this.weightedRandom(canary.variants, Math.random());
  }

  private weightedRandom(variants: CanaryVariant[], rand: number): CanaryVariant {
    let cumulative = 0;
    for (const v of variants) {
      cumulative += v.weight;
      if (rand < cumulative) return v;
    }
    return variants[variants.length - 1]; // safety
  }

  private hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) / 2_147_483_647; // normalise to 0-1
  }

  // -----------------------------------------------------------------------
  // Execution with fallback
  // -----------------------------------------------------------------------

  private async executeWithFallback(request: ModelRequest, chain: string[]): Promise<ModelResponse> {
    const seen = new Set<string>();
    const errors: string[] = [];

    for (const modelId of chain) {
      if (seen.has(modelId)) continue;
      seen.add(modelId);

      try {
        return await this.executeOnModel(request, modelId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${modelId}: ${msg}`);
        this.logger.log('warn', `Model ${modelId} failed, trying next in fallback chain`, { error: msg });
      }
    }

    throw new Error(`All models in fallback chain failed:\n${errors.join('\n')}`);
  }

  private async executeOnModel(request: ModelRequest, modelId: string): Promise<ModelResponse> {
    const entry = this.registry.getModelInfo(modelId);
    if (!entry) throw new Error(`Model ${modelId} not found in registry`);

    const { provider } = entry;
    const augmented = { ...request, model: modelId };
    return provider.complete(augmented);
  }
}
