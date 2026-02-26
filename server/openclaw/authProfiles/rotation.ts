/**
 * Auth profile rotation — cooldown-aware round-robin ordering.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/auth-profiles/order.ts
 *
 * Profiles are sorted by:
 *   1. Available vs in-cooldown (available first)
 *   2. Type preference (api_key first — our simplified model)
 *   3. Last-used timestamp (oldest first = round-robin)
 *
 * Cooldown profiles are appended at the end, sorted by earliest expiry.
 */

import type { AuthProfileCredential, AuthProfileRow, ProfileUsageStats } from './types';
import { isProfileInCooldown, resolveUnusableUntil, clearExpiredCooldowns } from './cooldown';

export interface RotationInput {
  profiles: AuthProfileRow[];
  preferredProfileId?: string;
}

/**
 * Resolve the ordered list of profile IDs for a provider.
 * Returns profile IDs in rotation order (best candidate first).
 */
export function resolveAuthProfileOrder(input: RotationInput): string[] {
  const { profiles, preferredProfileId } = input;
  if (profiles.length === 0) return [];

  // Collect all usage stats for cooldown clearing
  const allStats: Record<string, ProfileUsageStats> = {};
  for (const p of profiles) {
    allStats[p.id] = p.usageStats;
  }
  clearExpiredCooldowns(allStats);

  // Validate profiles: must have valid credentials
  const valid = profiles.filter(p => isValidProfile(p));
  if (valid.length === 0) return [];

  const now = Date.now();

  // Partition into available and in-cooldown
  const available: AuthProfileRow[] = [];
  const inCooldown: AuthProfileRow[] = [];

  for (const profile of valid) {
    if (isProfileInCooldown(allStats[profile.id], now)) {
      inCooldown.push(profile);
    } else {
      available.push(profile);
    }
  }

  // Sort available: by lastUsed (oldest first = round-robin)
  const sortedAvailable = available
    .map(p => ({
      id: p.id,
      lastUsed: allStats[p.id]?.lastUsed ?? 0,
    }))
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .map(e => e.id);

  // Sort cooldown: by earliest expiry (soonest-available first)
  const sortedCooldown = inCooldown
    .map(p => ({
      id: p.id,
      cooldownUntil: resolveUnusableUntil(allStats[p.id] ?? {}) ?? now,
    }))
    .sort((a, b) => a.cooldownUntil - b.cooldownUntil)
    .map(e => e.id);

  const ordered = [...sortedAvailable, ...sortedCooldown];

  // Move preferred profile to front if specified and present
  if (preferredProfileId && ordered.includes(preferredProfileId)) {
    return [preferredProfileId, ...ordered.filter(id => id !== preferredProfileId)];
  }

  return ordered;
}

/** Validate a profile has a usable credential */
function isValidProfile(profile: AuthProfileRow): boolean {
  const cred = profile.credential;
  if (!cred) return false;

  if (cred.type === 'api_key') {
    return Boolean(cred.key?.trim());
  }
  if (cred.type === 'token') {
    if (!cred.token?.trim()) return false;
    // Check token expiry
    if (typeof cred.expires === 'number' && cred.expires > 0 && Date.now() >= cred.expires) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Get the soonest cooldown expiry across profiles.
 * Useful for showing "retry in X minutes" to users.
 */
export function getSoonestCooldownExpiry(
  profiles: AuthProfileRow[],
): number | null {
  let soonest: number | null = null;

  for (const p of profiles) {
    const until = resolveUnusableUntil(p.usageStats);
    if (typeof until === 'number' && until > 0) {
      if (soonest === null || until < soonest) {
        soonest = until;
      }
    }
  }

  return soonest;
}
