/**
 * Per-session profile pinning with TTL.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/auth-profiles/session-override.ts
 *
 * Allows pinning a specific auth profile to a session so all requests in that
 * session use the same API key. Auto-expires after 1 hour (configurable).
 */

import type { SessionProfileOverride } from './types';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/** In-memory session override store */
const sessionOverrides = new Map<string, SessionProfileOverride>();

/**
 * Pin a profile to a session.
 */
export function pinProfileToSession(
  sessionId: string,
  provider: string,
  profileId: string,
  source: 'user' | 'auto' = 'auto',
  ttlMs: number = DEFAULT_TTL_MS,
): SessionProfileOverride {
  const now = Date.now();
  const override: SessionProfileOverride = {
    sessionId,
    provider,
    profileId,
    source,
    pinnedAt: now,
    expiresAt: now + ttlMs,
  };
  sessionOverrides.set(`${sessionId}:${provider}`, override);
  return override;
}

/**
 * Get the pinned profile for a session+provider.
 * Returns null if no pin exists or if it has expired.
 */
export function getSessionOverride(
  sessionId: string,
  provider: string,
): SessionProfileOverride | null {
  const key = `${sessionId}:${provider}`;
  const override = sessionOverrides.get(key);
  if (!override) return null;

  if (Date.now() >= override.expiresAt) {
    sessionOverrides.delete(key);
    return null;
  }

  return override;
}

/**
 * Clear the pinned profile for a session+provider.
 */
export function clearSessionOverride(sessionId: string, provider: string): boolean {
  return sessionOverrides.delete(`${sessionId}:${provider}`);
}

/**
 * Clear all overrides for a session.
 */
export function clearAllSessionOverrides(sessionId: string): number {
  let cleared = 0;
  for (const [key] of sessionOverrides) {
    if (key.startsWith(`${sessionId}:`)) {
      sessionOverrides.delete(key);
      cleared++;
    }
  }
  return cleared;
}

/**
 * Get all active (non-expired) overrides for a session.
 */
export function getSessionOverrides(sessionId: string): SessionProfileOverride[] {
  const now = Date.now();
  const results: SessionProfileOverride[] = [];

  for (const [key, override] of sessionOverrides) {
    if (!key.startsWith(`${sessionId}:`)) continue;

    if (now >= override.expiresAt) {
      sessionOverrides.delete(key);
      continue;
    }
    results.push(override);
  }

  return results;
}

/**
 * Cleanup all expired overrides (called periodically).
 */
export function cleanupExpiredOverrides(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, override] of sessionOverrides) {
    if (now >= override.expiresAt) {
      sessionOverrides.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}

/** For testing: clear all overrides */
export function _resetOverrides(): void {
  sessionOverrides.clear();
}
