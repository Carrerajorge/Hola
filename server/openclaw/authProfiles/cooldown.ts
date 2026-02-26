/**
 * Exponential backoff cooldown for auth profiles.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/auth-profiles/usage.ts
 *
 * Transient failures: 1m → 5m → 25m → 60m (capped)
 * Billing failures:   5h → 10h → 20h → 24h (capped)
 *
 * Cooldowns use immutable windows — retries within an active window cannot
 * push the recovery time further out (prevents runaway escalation).
 */

import type { AuthProfileFailureReason, ProfileUsageStats } from './types';

const FAILURE_REASON_PRIORITY: AuthProfileFailureReason[] = [
  'auth', 'billing', 'format', 'model_not_found', 'timeout', 'rate_limit', 'unknown',
];
const FAILURE_REASON_SET = new Set(FAILURE_REASON_PRIORITY);

/** Transient cooldown: 1m * 5^(n-1), max 1h */
export function calculateTransientCooldownMs(errorCount: number): number {
  const normalized = Math.max(1, errorCount);
  return Math.min(
    60 * 60 * 1000, // 1 hour max
    60 * 1000 * 5 ** Math.min(normalized - 1, 3),
  );
}

/** Billing cooldown: base * 2^(n-1), capped at max */
export function calculateBillingCooldownMs(
  errorCount: number,
  baseHours: number = 5,
  maxHours: number = 24,
): number {
  const normalized = Math.max(1, errorCount);
  const baseMs = Math.max(60_000, baseHours * 60 * 60 * 1000);
  const maxMs = Math.max(baseMs, maxHours * 60 * 60 * 1000);
  const exponent = Math.min(normalized - 1, 10);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

/** Resolve the latest "unusable until" timestamp from cooldown + disabled fields */
export function resolveUnusableUntil(
  stats: Pick<ProfileUsageStats, 'cooldownUntil' | 'disabledUntil'>,
): number | null {
  const values = [stats.cooldownUntil, stats.disabledUntil]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return values.length === 0 ? null : Math.max(...values);
}

/** Check if a profile is currently in cooldown */
export function isProfileInCooldown(stats: ProfileUsageStats | undefined, now?: number): boolean {
  if (!stats) return false;
  const until = resolveUnusableUntil(stats);
  return until !== null && (now ?? Date.now()) < until;
}

/** Keep existing active window OR recompute (prevents window extension during retry storms) */
function keepActiveWindowOrRecompute(
  existingUntil: number | undefined,
  now: number,
  recomputedUntil: number,
): number {
  if (typeof existingUntil === 'number' && Number.isFinite(existingUntil) && existingUntil > now) {
    return existingUntil;
  }
  return recomputedUntil;
}

/**
 * Compute next usage stats after a failure. Handles:
 * - Failure window expiry (resets error count after 24h of silence)
 * - Billing vs transient backoff strategies
 * - Immutable cooldown windows
 */
export function computeNextUsageStats(
  existing: ProfileUsageStats,
  reason: AuthProfileFailureReason,
  now: number,
  config: { billingBaseHours: number; billingMaxHours: number; failureWindowMs: number },
): ProfileUsageStats {
  // Check if the failure window has expired (24h by default)
  const windowExpired =
    typeof existing.lastFailureAt === 'number' &&
    existing.lastFailureAt > 0 &&
    now - existing.lastFailureAt > config.failureWindowMs;

  const baseErrorCount = windowExpired ? 0 : (existing.errorCount ?? 0);
  const nextErrorCount = baseErrorCount + 1;
  const failureCounts = windowExpired ? {} : { ...existing.failureCounts };
  failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;

  const updated: ProfileUsageStats = {
    ...existing,
    errorCount: nextErrorCount,
    failureCounts,
    lastFailureAt: now,
  };

  if (reason === 'billing') {
    const billingCount = failureCounts.billing ?? 1;
    const backoffMs = calculateBillingCooldownMs(
      billingCount,
      config.billingBaseHours,
      config.billingMaxHours,
    );
    updated.disabledUntil = keepActiveWindowOrRecompute(
      existing.disabledUntil,
      now,
      now + backoffMs,
    );
    updated.disabledReason = 'billing';
  } else {
    const backoffMs = calculateTransientCooldownMs(nextErrorCount);
    updated.cooldownUntil = keepActiveWindowOrRecompute(
      existing.cooldownUntil,
      now,
      now + backoffMs,
    );
  }

  return updated;
}

/**
 * Clear expired cooldowns — circuit-breaker half-open → closed.
 * Resets error counters so the profile gets a fair retry window.
 */
export function clearExpiredCooldowns(
  statsMap: Record<string, ProfileUsageStats>,
  now?: number,
): boolean {
  const ts = now ?? Date.now();
  let mutated = false;

  for (const [id, stats] of Object.entries(statsMap)) {
    if (!stats) continue;

    let profileMutated = false;

    if (typeof stats.cooldownUntil === 'number' && stats.cooldownUntil > 0 && ts >= stats.cooldownUntil) {
      stats.cooldownUntil = undefined;
      profileMutated = true;
    }
    if (typeof stats.disabledUntil === 'number' && stats.disabledUntil > 0 && ts >= stats.disabledUntil) {
      stats.disabledUntil = undefined;
      stats.disabledReason = undefined;
      profileMutated = true;
    }

    // Reset error counters when ALL cooldowns expired
    if (profileMutated && !resolveUnusableUntil(stats)) {
      stats.errorCount = 0;
      stats.failureCounts = undefined;
    }

    if (profileMutated) {
      statsMap[id] = stats;
      mutated = true;
    }
  }

  return mutated;
}

/**
 * Infer the most likely reason all candidate profiles are unavailable.
 * Disabled reasons (billing/auth) are weighted heavily over cooldown-based signals.
 */
export function resolveUnavailableReason(
  statsMap: Record<string, ProfileUsageStats>,
  profileIds: string[],
  now?: number,
): AuthProfileFailureReason | null {
  const ts = now ?? Date.now();
  const scores = new Map<AuthProfileFailureReason, number>();

  for (const id of profileIds) {
    const stats = statsMap[id];
    if (!stats) continue;

    // Active disabled = high-signal
    if (typeof stats.disabledUntil === 'number' && stats.disabledUntil > 0 && ts < stats.disabledUntil) {
      if (stats.disabledReason && FAILURE_REASON_SET.has(stats.disabledReason)) {
        scores.set(stats.disabledReason, (scores.get(stats.disabledReason) ?? 0) + 1000);
        continue;
      }
    }

    // Active cooldown
    if (typeof stats.cooldownUntil === 'number' && stats.cooldownUntil > 0 && ts < stats.cooldownUntil) {
      let recorded = false;
      for (const [rawReason, rawCount] of Object.entries(stats.failureCounts ?? {})) {
        const reason = rawReason as AuthProfileFailureReason;
        const count = typeof rawCount === 'number' ? rawCount : 0;
        if (FAILURE_REASON_SET.has(reason) && count > 0) {
          scores.set(reason, (scores.get(reason) ?? 0) + count);
          recorded = true;
        }
      }
      if (!recorded) {
        scores.set('rate_limit', (scores.get('rate_limit') ?? 0) + 1);
      }
    }
  }

  if (scores.size === 0) return null;

  let best: AuthProfileFailureReason | null = null;
  let bestScore = -1;

  for (const reason of FAILURE_REASON_PRIORITY) {
    const score = scores.get(reason);
    if (typeof score === 'number' && score > bestScore) {
      best = reason;
      bestScore = score;
    }
  }

  return best;
}
