/**
 * Auth Profiles service — orchestrator for credential rotation.
 * Combines persistence, rotation, cooldown, and session overrides.
 *
 * Primary method: `resolveApiKey(provider, sessionId?)` — returns the best
 * API key for a provider, respecting cooldowns, round-robin, and session pinning.
 * Falls back to secretManager when no profiles exist.
 */

import type { AuthProfileCredential, AuthProfileFailureReason, AuthProfileRow, AuthProfileSummary } from './types';
import { getAuthProfilePersistence, profileToSummary } from './persistence';
import { resolveAuthProfileOrder, getSoonestCooldownExpiry } from './rotation';
import { computeNextUsageStats, isProfileInCooldown } from './cooldown';
import { getSessionOverride, pinProfileToSession, clearSessionOverride } from './sessionOverride';
import { Logger } from '../../lib/logger';

/** Extract the actual API key/token string from a credential */
function extractKey(credential: AuthProfileCredential): string | null {
  if (credential.type === 'api_key') {
    return credential.key?.trim() || null;
  }
  if (credential.type === 'token') {
    return credential.token?.trim() || null;
  }
  return null;
}

export interface AuthProfileServiceConfig {
  maxProfilesPerProvider: number;
  cooldownBaseMinutes: number;
  billingCooldownHours: number;
}

const DEFAULT_CONFIG: AuthProfileServiceConfig = {
  maxProfilesPerProvider: 5,
  cooldownBaseMinutes: 1,
  billingCooldownHours: 5,
};

export class AuthProfileService {
  private config: AuthProfileServiceConfig;

  constructor(config?: Partial<AuthProfileServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Resolve the best API key for a provider.
   * Flow: session override → profile rotation → secretManager fallback
   */
  async resolveApiKey(provider: string, sessionId?: string): Promise<string | null> {
    const persistence = getAuthProfilePersistence();
    const normalizedProvider = provider.toLowerCase();

    // 1. Check session override first
    if (sessionId) {
      const override = getSessionOverride(sessionId, normalizedProvider);
      if (override) {
        const profile = await persistence.getById(override.profileId);
        if (profile && !isProfileInCooldown(profile.usageStats)) {
          const key = extractKey(profile.credential);
          if (key) return key;
        }
        // Override is stale, clear it
        clearSessionOverride(sessionId, normalizedProvider);
      }
    }

    // 2. Get profiles and apply rotation
    const profiles = await persistence.listByProvider(normalizedProvider);
    if (profiles.length === 0) {
      // 3. Fallback to secretManager (env-var based keys)
      return this.fallbackToSecretManager(normalizedProvider);
    }

    const order = resolveAuthProfileOrder({ profiles });
    if (order.length === 0) {
      return this.fallbackToSecretManager(normalizedProvider);
    }

    // Use the first profile in rotation order
    const selectedId = order[0];
    const selectedProfile = profiles.find(p => p.id === selectedId);
    if (!selectedProfile) {
      return this.fallbackToSecretManager(normalizedProvider);
    }

    const key = extractKey(selectedProfile.credential);
    if (!key) {
      return this.fallbackToSecretManager(normalizedProvider);
    }

    // Pin to session if we have a session ID
    if (sessionId) {
      pinProfileToSession(sessionId, normalizedProvider, selectedId, 'auto');
    }

    Logger.info(`[AuthProfiles:Service] Resolved ${normalizedProvider} → profile ${selectedId.slice(0, 8)}...`);
    return key;
  }

  /**
   * Mark a profile as successfully used. Resets error counters.
   */
  async markUsed(profileId: string): Promise<void> {
    const persistence = getAuthProfilePersistence();
    const profile = await persistence.getById(profileId);
    if (!profile) return;

    await persistence.updateUsageStats(profileId, {
      ...profile.usageStats,
      lastUsed: Date.now(),
      errorCount: 0,
      cooldownUntil: undefined,
      disabledUntil: undefined,
      disabledReason: undefined,
      failureCounts: undefined,
    });
  }

  /**
   * Mark a profile as failed. Applies appropriate cooldown.
   */
  async markFailure(profileId: string, reason: AuthProfileFailureReason): Promise<void> {
    const persistence = getAuthProfilePersistence();
    const profile = await persistence.getById(profileId);
    if (!profile) return;

    const now = Date.now();
    const updated = computeNextUsageStats(
      profile.usageStats,
      reason,
      now,
      {
        billingBaseHours: this.config.billingCooldownHours,
        billingMaxHours: 24,
        failureWindowMs: 24 * 60 * 60 * 1000,
      },
    );

    await persistence.updateUsageStats(profileId, updated);
    Logger.info(
      `[AuthProfiles:Service] Marked ${profileId.slice(0, 8)}... as failed (${reason}), ` +
      `errorCount=${updated.errorCount}`,
    );
  }

  /**
   * Add a new auth profile for a provider.
   */
  async addProfile(provider: string, credential: AuthProfileCredential): Promise<AuthProfileRow> {
    const persistence = getAuthProfilePersistence();
    const normalizedProvider = provider.toLowerCase();

    // Check max profiles limit
    const existing = await persistence.listByProvider(normalizedProvider);
    if (existing.length >= this.config.maxProfilesPerProvider) {
      throw new Error(
        `Maximum ${this.config.maxProfilesPerProvider} profiles per provider reached for ${normalizedProvider}`,
      );
    }

    return persistence.add(normalizedProvider, credential);
  }

  /**
   * Remove an auth profile.
   */
  async removeProfile(id: string): Promise<boolean> {
    const persistence = getAuthProfilePersistence();
    return persistence.remove(id);
  }

  /**
   * List all profiles for a provider with summary info.
   */
  async listProfiles(provider: string): Promise<AuthProfileSummary[]> {
    const persistence = getAuthProfilePersistence();
    const profiles = await persistence.listByProvider(provider.toLowerCase());
    return profiles.map(profileToSummary);
  }

  /**
   * Get status info for all profiles across all providers.
   */
  async getStatus(): Promise<{
    totalProfiles: number;
    byProvider: Record<string, { total: number; available: number; inCooldown: number }>;
    soonestCooldownExpiry: number | null;
  }> {
    const persistence = getAuthProfilePersistence();
    const all = await persistence.getAll();

    const byProvider: Record<string, { total: number; available: number; inCooldown: number }> = {};

    for (const profile of all) {
      if (!byProvider[profile.provider]) {
        byProvider[profile.provider] = { total: 0, available: 0, inCooldown: 0 };
      }
      byProvider[profile.provider].total++;
      if (isProfileInCooldown(profile.usageStats)) {
        byProvider[profile.provider].inCooldown++;
      } else {
        byProvider[profile.provider].available++;
      }
    }

    return {
      totalProfiles: all.length,
      byProvider,
      soonestCooldownExpiry: getSoonestCooldownExpiry(all),
    };
  }

  /** Fallback to secretManager for env-var based API keys */
  private async fallbackToSecretManager(provider: string): Promise<string | null> {
    try {
      const { getLLMProviderKey } = await import('../../services/secretManager');
      const key = await getLLMProviderKey(provider);
      return key ?? null;
    } catch {
      return null;
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────

let singleton: AuthProfileService | null = null;

export function getAuthProfileService(config?: Partial<AuthProfileServiceConfig>): AuthProfileService {
  if (!singleton) {
    singleton = new AuthProfileService(config);
  }
  return singleton;
}

/** For testing: reset singleton */
export function _resetService(): void {
  singleton = null;
}
