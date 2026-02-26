/**
 * Auth Profiles types.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/auth-profiles/types.ts
 *
 * Multi-credential management per AI provider with rotation, cooldowns, and session pinning.
 */

/** Credential types */
export type ApiKeyCredential = {
  type: 'api_key';
  provider: string;
  key?: string;
  email?: string;
  metadata?: Record<string, string>;
};

export type TokenCredential = {
  type: 'token';
  provider: string;
  token: string;
  expires?: number;
  email?: string;
};

export type AuthProfileCredential = ApiKeyCredential | TokenCredential;

/** Failure classification for cooldown strategy */
export type AuthProfileFailureReason =
  | 'auth'
  | 'format'
  | 'rate_limit'
  | 'billing'
  | 'timeout'
  | 'model_not_found'
  | 'unknown';

/** Per-profile usage statistics for round-robin and cooldown tracking */
export interface ProfileUsageStats {
  lastUsed?: number;
  cooldownUntil?: number;
  disabledUntil?: number;
  disabledReason?: AuthProfileFailureReason;
  errorCount?: number;
  failureCounts?: Partial<Record<AuthProfileFailureReason, number>>;
  lastFailureAt?: number;
}

/** Session-level profile override */
export interface SessionProfileOverride {
  sessionId: string;
  provider: string;
  profileId: string;
  source: 'user' | 'auto';
  pinnedAt: number;
  expiresAt: number;
}

/** Full profile entry (stored in DB) */
export interface AuthProfileRow {
  id: string;
  provider: string;
  credential: AuthProfileCredential;
  usageStats: ProfileUsageStats;
  createdAt: number;
  updatedAt: number;
}

/** Summary for listing */
export interface AuthProfileSummary {
  id: string;
  provider: string;
  type: AuthProfileCredential['type'];
  email?: string;
  inCooldown: boolean;
  cooldownUntil?: number;
  errorCount: number;
  lastUsed?: number;
}
