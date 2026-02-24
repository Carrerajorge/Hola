import type { ModelRef, ModelFallbackResult, ModelFallbackAttempt } from '../types';

// Track cooldown per provider
const cooldownMap = new Map<string, number>();

interface FallbackOptions<T> {
  candidates: ModelRef[];
  execute: (ref: ModelRef) => Promise<T>;
  cooldownMs: number;
}

export async function runWithModelFallback<T>(opts: FallbackOptions<T>): Promise<ModelFallbackResult<T>> {
  const attempts: ModelFallbackAttempt[] = [];
  const now = Date.now();

  // Filter out candidates in cooldown
  const available = opts.candidates.filter(c => {
    const cooldownUntil = cooldownMap.get(c.provider) ?? 0;
    return now >= cooldownUntil;
  });

  // If all in cooldown, try all anyway
  const candidates = available.length > 0 ? available : opts.candidates;

  for (const candidate of candidates) {
    const start = Date.now();
    try {
      const result = await opts.execute(candidate);
      attempts.push({ provider: candidate.provider, model: candidate.model, durationMs: Date.now() - start });
      // Clear cooldown on success
      cooldownMap.delete(candidate.provider);
      return { result, provider: candidate.provider, model: candidate.model, attempts };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      attempts.push({ provider: candidate.provider, model: candidate.model, error: err, durationMs });
      // Set cooldown
      cooldownMap.set(candidate.provider, Date.now() + opts.cooldownMs);
    }
  }

  throw new Error(`All model candidates failed after ${attempts.length} attempts`);
}

export function clearCooldowns(): void {
  cooldownMap.clear();
}
