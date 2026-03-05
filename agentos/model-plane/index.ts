// AgentOS Model-Plane — Main Exports
// Multi-model router with provider abstraction layer.
//
// Usage:
//   import { ApiGateway, ProviderRegistry, ModelRouter, ... } from './model-plane';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ModelCapability,
  ProviderKind,
  TaskType,
  RoutingStrategy,
  HealthStatus,
  ModelProviderConfig,
  RateLimitConfig,
  ModelInfo,
  ModelProvider,
  ModelMessage,
  ContentPart,
  ToolDefinition,
  ModelRequest,
  BudgetConstraint,
  ModelResponse,
  ToolCall,
  TokenUsage,
  QoSConfig,
  RetryPolicy,
  CostTracker,
  CostSnapshot,
  ProviderHealth,
  CanaryConfig,
  CanaryVariant,
  CanaryResult,
  RoutingPolicy,
  RoutingRule,
  RoutingCondition,
  RoutingTarget,
  LogLevel,
  Logger,
} from './types';

export { defaultLogger } from './types';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export { ProviderRegistry } from './providers/provider-registry';
export { AnthropicProvider } from './providers/anthropic-provider';
export { OpenAIProvider } from './providers/openai-provider';
export { LocalProvider } from './providers/local-provider';
export type { LocalBackend, LocalProviderOptions } from './providers/local-provider';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export { ModelRouter } from './router/model-router';
export type { ModelRouterOptions } from './router/model-router';

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export {
  PolicyBuilder,
  PolicyEvaluator,
  scoreModel,
  rankModels,
  weightsForStrategy,
  CostOptimizedPolicy,
  QualityOptimizedPolicy,
  LatencyOptimizedPolicy,
  BalancedPolicy,
} from './policy/routing-policies';

export type { ScoringWeights } from './policy/routing-policies';

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export { ApiGateway, InMemoryCostTracker, GatewayError } from './gateway/api-gateway';
export type { ApiGatewayOptions, RequestTrace, TraceCallback } from './gateway/api-gateway';

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

import { ProviderRegistry } from './providers/provider-registry';
import { ModelRouter } from './router/model-router';
import { ApiGateway, InMemoryCostTracker } from './gateway/api-gateway';
import { PolicyEvaluator } from './policy/routing-policies';
import type {
  ModelProviderConfig,
  RoutingStrategy,
  RateLimitConfig,
  Logger,
} from './types';
import { defaultLogger } from './types';
import { AnthropicProvider } from './providers/anthropic-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { LocalProvider, LocalBackend } from './providers/local-provider';

export interface ModelPlaneConfig {
  providers?: {
    anthropic?: ModelProviderConfig;
    openai?: ModelProviderConfig;
    local?: { backend: LocalBackend; config: ModelProviderConfig };
  };
  strategy?: RoutingStrategy;
  budgetUsd?: number;
  rateLimit?: RateLimitConfig;
  logger?: Logger;
}

/**
 * Bootstrap a fully-wired model-plane in one call.
 *
 * ```ts
 * const plane = await createModelPlane({
 *   providers: {
 *     anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
 *     openai:    { apiKey: process.env.OPENAI_API_KEY! },
 *   },
 *   strategy: 'balanced',
 *   budgetUsd: 10,
 * });
 *
 * const response = await plane.gateway.complete({ ... });
 * ```
 */
export async function createModelPlane(config: ModelPlaneConfig): Promise<{
  registry: ProviderRegistry;
  router: ModelRouter;
  gateway: ApiGateway;
}> {
  const logger = config.logger ?? defaultLogger;
  const registry = new ProviderRegistry({ logger });

  // Register requested providers concurrently.
  const registrations: Promise<void>[] = [];

  if (config.providers?.anthropic) {
    registrations.push(registry.register(new AnthropicProvider(logger), config.providers.anthropic));
  }
  if (config.providers?.openai) {
    registrations.push(registry.register(new OpenAIProvider(logger), config.providers.openai));
  }
  if (config.providers?.local) {
    const lp = new LocalProvider({ backend: config.providers.local.backend }, logger);
    registrations.push(registry.register(lp, config.providers.local.config));
  }

  await Promise.all(registrations);

  const policy = PolicyEvaluator.resolve(config.strategy ?? 'balanced');
  const router = new ModelRouter({ registry, defaultPolicy: policy, logger });

  const gateway = new ApiGateway({
    router,
    costTracker: new InMemoryCostTracker(config.budgetUsd ?? 100),
    rateLimitConfig: config.rateLimit,
    logger,
  });

  logger.log('info', 'Model-plane ready', {
    providers: registry.listProviders(),
    models: registry.listAllModels().length,
    strategy: config.strategy ?? 'balanced',
  });

  return { registry, router, gateway };
}
