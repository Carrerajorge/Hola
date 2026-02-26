/**
 * Auth Profiles Module — re-exports + initialization.
 *
 * Multi-credential management per AI provider with rotation,
 * exponential backoff cooldowns, and per-session pinning.
 */

import type { OpenClawConfig } from '../config';
import { Logger } from '../../lib/logger';

export type {
  ApiKeyCredential,
  TokenCredential,
  AuthProfileCredential,
  AuthProfileFailureReason,
  ProfileUsageStats,
  SessionProfileOverride,
  AuthProfileRow,
  AuthProfileSummary,
} from './types';

export {
  calculateTransientCooldownMs,
  calculateBillingCooldownMs,
  resolveUnusableUntil,
  isProfileInCooldown,
  computeNextUsageStats,
  clearExpiredCooldowns,
  resolveUnavailableReason,
} from './cooldown';

export {
  resolveAuthProfileOrder,
  getSoonestCooldownExpiry,
} from './rotation';

export {
  pinProfileToSession,
  getSessionOverride,
  clearSessionOverride,
  clearAllSessionOverrides,
  getSessionOverrides,
  cleanupExpiredOverrides,
} from './sessionOverride';

export {
  getAuthProfilePersistence,
  profileToSummary,
  InMemoryAuthProfilePersistence,
} from './persistence';

export {
  AuthProfileService,
  getAuthProfileService,
} from './service';

/**
 * Initialize the auth profiles module.
 * Called from index.ts when authProfiles.enabled=true.
 */
export async function initAuthProfiles(config: OpenClawConfig): Promise<void> {
  const persistence = (await import('./persistence')).getAuthProfilePersistence();
  await persistence.initialize();

  // Initialize the service singleton with config values
  const { getAuthProfileService } = await import('./service');
  getAuthProfileService({
    maxProfilesPerProvider: config.authProfiles.maxProfilesPerProvider,
    cooldownBaseMinutes: config.authProfiles.cooldownBaseMinutes,
    billingCooldownHours: config.authProfiles.billingCooldownHours,
  });

  Logger.info(
    `[OpenClaw:AuthProfiles] Initialized — ` +
    `maxProfiles=${config.authProfiles.maxProfilesPerProvider}, ` +
    `cooldownBase=${config.authProfiles.cooldownBaseMinutes}m, ` +
    `billingCooldown=${config.authProfiles.billingCooldownHours}h`,
  );
}
