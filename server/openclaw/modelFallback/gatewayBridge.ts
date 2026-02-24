// server/openclaw/modelFallback/gatewayBridge.ts
//
// Bridge between the OpenClaw model fallback module and the existing
// LLM gateway. Provides an enhanced fallback chain that can be used
// alongside the gateway's built-in provider fallback.
//
// The bridge is opt-in: only active when config.modelFallback.enabled.

import { getOpenClawServices } from '../index';
import { runWithModelFallback } from './fallback';
import { resolveModelAlias, normalizeModelRef } from './selection';
import type { ModelRef, ModelFallbackResult } from '../types';

/**
 * Build a fallback chain from an agent config's model + fallback list.
 * Resolves aliases and normalizes model IDs.
 */
export function buildFallbackChain(primary: string, fallbacks: string[]): ModelRef[] {
  const refs: ModelRef[] = [];
  const seen = new Set<string>();

  for (const input of [primary, ...fallbacks]) {
    const ref = normalizeModelRef(input);
    const key = `${ref.provider}/${ref.model}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  }

  return refs;
}

/**
 * Execute a function with OpenClaw-enhanced model fallback.
 *
 * @param primary   - The primary model identifier (alias or full ref)
 * @param fallbacks - Fallback model identifiers
 * @param execute   - The function to execute with each model candidate
 * @returns The result from the first successful candidate
 *
 * If the OpenClaw model fallback module is disabled, this simply
 * calls execute() with the primary model (no fallback chain).
 */
export async function executeWithEnhancedFallback<T>(
  primary: string,
  fallbacks: string[],
  execute: (ref: ModelRef) => Promise<T>,
): Promise<ModelFallbackResult<T>> {
  const services = getOpenClawServices();
  const config = services?.config;

  if (!config?.modelFallback.enabled) {
    // Module disabled — just run with the primary model directly
    const ref = normalizeModelRef(primary);
    const start = Date.now();
    const result = await execute(ref);
    return {
      result,
      provider: ref.provider,
      model: ref.model,
      attempts: [{ provider: ref.provider, model: ref.model, durationMs: Date.now() - start }],
    };
  }

  const candidates = buildFallbackChain(primary, fallbacks);

  return runWithModelFallback({
    candidates,
    execute,
    cooldownMs: config.modelFallback.cooldownMs,
  });
}

/**
 * Resolve a model alias string to its concrete ModelRef.
 * Convenience re-export for use by the gateway.
 */
export function resolveModel(input: string): ModelRef {
  return normalizeModelRef(input);
}
