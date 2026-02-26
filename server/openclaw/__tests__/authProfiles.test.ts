import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  AuthProfileCredential,
  AuthProfileFailureReason,
  ProfileUsageStats,
  AuthProfileRow,
  SessionProfileOverride,
  AuthProfileSummary,
} from '../authProfiles/types';

// ── Types ───────────────────────────────────────────────────────────────

describe('AuthProfileCredential types', () => {
  it('api_key credential', () => {
    const cred: AuthProfileCredential = {
      type: 'api_key',
      provider: 'openai',
      key: 'sk-test-123',
      email: 'user@example.com',
    };
    expect(cred.type).toBe('api_key');
    expect(cred.key).toBe('sk-test-123');
  });

  it('token credential', () => {
    const cred: AuthProfileCredential = {
      type: 'token',
      provider: 'google',
      token: 'ya29.test-token',
      expires: Date.now() + 3600000,
    };
    expect(cred.type).toBe('token');
    expect(cred.expires).toBeGreaterThan(Date.now());
  });

  it('token credential without expiry', () => {
    const cred: AuthProfileCredential = {
      type: 'token',
      provider: 'anthropic',
      token: 'pat-test',
    };
    expect(cred.expires).toBeUndefined();
  });
});

describe('ProfileUsageStats', () => {
  it('empty stats', () => {
    const stats: ProfileUsageStats = {};
    expect(stats.errorCount).toBeUndefined();
    expect(stats.cooldownUntil).toBeUndefined();
  });

  it('stats with cooldown', () => {
    const stats: ProfileUsageStats = {
      lastUsed: Date.now() - 60000,
      cooldownUntil: Date.now() + 300000,
      errorCount: 2,
      failureCounts: { rate_limit: 2 },
      lastFailureAt: Date.now() - 10000,
    };
    expect(stats.errorCount).toBe(2);
    expect(stats.cooldownUntil).toBeGreaterThan(Date.now());
  });

  it('stats with billing disable', () => {
    const stats: ProfileUsageStats = {
      disabledUntil: Date.now() + 18000000, // 5 hours
      disabledReason: 'billing',
      errorCount: 1,
    };
    expect(stats.disabledReason).toBe('billing');
  });
});

// ── Cooldown ────────────────────────────────────────────────────────────

describe('calculateTransientCooldownMs', () => {
  let calculateTransientCooldownMs: typeof import('../authProfiles/cooldown').calculateTransientCooldownMs;

  beforeEach(async () => {
    ({ calculateTransientCooldownMs } = await import('../authProfiles/cooldown'));
  });

  it('1st error → 1 minute', () => {
    expect(calculateTransientCooldownMs(1)).toBe(60_000);
  });

  it('2nd error → 5 minutes', () => {
    expect(calculateTransientCooldownMs(2)).toBe(300_000);
  });

  it('3rd error → 25 minutes', () => {
    expect(calculateTransientCooldownMs(3)).toBe(1_500_000);
  });

  it('4th+ error → capped at 1 hour', () => {
    expect(calculateTransientCooldownMs(4)).toBe(3_600_000);
    expect(calculateTransientCooldownMs(10)).toBe(3_600_000);
  });

  it('handles 0 and negative counts', () => {
    expect(calculateTransientCooldownMs(0)).toBe(60_000);
    expect(calculateTransientCooldownMs(-1)).toBe(60_000);
  });
});

describe('calculateBillingCooldownMs', () => {
  let calculateBillingCooldownMs: typeof import('../authProfiles/cooldown').calculateBillingCooldownMs;

  beforeEach(async () => {
    ({ calculateBillingCooldownMs } = await import('../authProfiles/cooldown'));
  });

  it('1st billing error → base hours', () => {
    const result = calculateBillingCooldownMs(1, 5, 24);
    expect(result).toBe(5 * 60 * 60 * 1000); // 5h
  });

  it('2nd billing error → 2x base', () => {
    const result = calculateBillingCooldownMs(2, 5, 24);
    expect(result).toBe(10 * 60 * 60 * 1000); // 10h
  });

  it('3rd billing error → 4x base', () => {
    const result = calculateBillingCooldownMs(3, 5, 24);
    expect(result).toBe(20 * 60 * 60 * 1000); // 20h
  });

  it('capped at max hours', () => {
    const result = calculateBillingCooldownMs(4, 5, 24);
    expect(result).toBe(24 * 60 * 60 * 1000); // 24h cap
  });
});

describe('resolveUnusableUntil', () => {
  let resolveUnusableUntil: typeof import('../authProfiles/cooldown').resolveUnusableUntil;

  beforeEach(async () => {
    ({ resolveUnusableUntil } = await import('../authProfiles/cooldown'));
  });

  it('returns null for empty stats', () => {
    expect(resolveUnusableUntil({})).toBeNull();
  });

  it('returns cooldownUntil when set', () => {
    const until = Date.now() + 60000;
    expect(resolveUnusableUntil({ cooldownUntil: until })).toBe(until);
  });

  it('returns max of cooldown and disabled', () => {
    const cooldown = Date.now() + 60000;
    const disabled = Date.now() + 300000;
    expect(resolveUnusableUntil({ cooldownUntil: cooldown, disabledUntil: disabled })).toBe(disabled);
  });

  it('ignores zero and negative values', () => {
    expect(resolveUnusableUntil({ cooldownUntil: 0 })).toBeNull();
    expect(resolveUnusableUntil({ cooldownUntil: -1 })).toBeNull();
  });
});

describe('isProfileInCooldown', () => {
  let isProfileInCooldown: typeof import('../authProfiles/cooldown').isProfileInCooldown;

  beforeEach(async () => {
    ({ isProfileInCooldown } = await import('../authProfiles/cooldown'));
  });

  it('returns false for undefined stats', () => {
    expect(isProfileInCooldown(undefined)).toBe(false);
  });

  it('returns false for empty stats', () => {
    expect(isProfileInCooldown({})).toBe(false);
  });

  it('returns true when cooldown is in the future', () => {
    expect(isProfileInCooldown({ cooldownUntil: Date.now() + 60000 })).toBe(true);
  });

  it('returns false when cooldown is in the past', () => {
    expect(isProfileInCooldown({ cooldownUntil: Date.now() - 60000 })).toBe(false);
  });

  it('returns true when disabled is in the future', () => {
    expect(isProfileInCooldown({ disabledUntil: Date.now() + 60000 })).toBe(true);
  });
});

describe('computeNextUsageStats', () => {
  let computeNextUsageStats: typeof import('../authProfiles/cooldown').computeNextUsageStats;

  const defaultConfig = {
    billingBaseHours: 5,
    billingMaxHours: 24,
    failureWindowMs: 24 * 60 * 60 * 1000,
  };

  beforeEach(async () => {
    ({ computeNextUsageStats } = await import('../authProfiles/cooldown'));
  });

  it('sets cooldown for transient failure', () => {
    const now = Date.now();
    const result = computeNextUsageStats({}, 'rate_limit', now, defaultConfig);
    expect(result.errorCount).toBe(1);
    expect(result.cooldownUntil).toBe(now + 60_000); // 1 min
    expect(result.failureCounts?.rate_limit).toBe(1);
  });

  it('escalates cooldown on repeated failures (after first cooldown expires)', () => {
    const now = Date.now();
    const first = computeNextUsageStats({}, 'rate_limit', now, defaultConfig);
    expect(first.cooldownUntil).toBe(now + 60_000); // 1 min

    // Simulate: first cooldown has expired, then second failure occurs
    const afterFirstExpiry = now + 61_000;
    const expiredFirst = { ...first, cooldownUntil: undefined }; // Cleared by clearExpiredCooldowns
    const second = computeNextUsageStats(expiredFirst, 'rate_limit', afterFirstExpiry, defaultConfig);
    expect(second.errorCount).toBe(2);
    // Second error → 5 min cooldown
    expect(second.cooldownUntil).toBe(afterFirstExpiry + 300_000);
  });

  it('sets disabledUntil for billing failure', () => {
    const now = Date.now();
    const result = computeNextUsageStats({}, 'billing', now, defaultConfig);
    expect(result.disabledUntil).toBe(now + 5 * 60 * 60 * 1000); // 5h
    expect(result.disabledReason).toBe('billing');
  });

  it('resets error count after failure window expires', () => {
    const now = Date.now();
    const old: ProfileUsageStats = {
      errorCount: 3,
      lastFailureAt: now - 25 * 60 * 60 * 1000, // 25h ago
    };
    const result = computeNextUsageStats(old, 'timeout', now, defaultConfig);
    expect(result.errorCount).toBe(1); // Reset, then +1
  });

  it('preserves active cooldown window (no extension during retry storms)', () => {
    const now = Date.now();
    const existingCooldown = now + 300_000; // 5 min from now
    const existing: ProfileUsageStats = {
      errorCount: 2,
      cooldownUntil: existingCooldown,
      lastFailureAt: now - 1000,
    };
    const result = computeNextUsageStats(existing, 'rate_limit', now, defaultConfig);
    // Should keep existing window, not extend it
    expect(result.cooldownUntil).toBe(existingCooldown);
  });
});

describe('clearExpiredCooldowns', () => {
  let clearExpiredCooldowns: typeof import('../authProfiles/cooldown').clearExpiredCooldowns;

  beforeEach(async () => {
    ({ clearExpiredCooldowns } = await import('../authProfiles/cooldown'));
  });

  it('clears expired cooldowns', () => {
    const now = Date.now();
    const stats: Record<string, ProfileUsageStats> = {
      profile1: { cooldownUntil: now - 60000, errorCount: 2 },
      profile2: { cooldownUntil: now + 60000, errorCount: 1 },
    };

    const mutated = clearExpiredCooldowns(stats, now);
    expect(mutated).toBe(true);
    expect(stats.profile1.cooldownUntil).toBeUndefined();
    expect(stats.profile1.errorCount).toBe(0); // Reset
    expect(stats.profile2.cooldownUntil).toBe(now + 60000); // Unchanged
  });

  it('returns false when nothing to clear', () => {
    const stats: Record<string, ProfileUsageStats> = {
      profile1: { cooldownUntil: Date.now() + 60000 },
    };
    expect(clearExpiredCooldowns(stats)).toBe(false);
  });

  it('handles empty stats map', () => {
    expect(clearExpiredCooldowns({})).toBe(false);
  });
});

describe('resolveUnavailableReason', () => {
  let resolveUnavailableReason: typeof import('../authProfiles/cooldown').resolveUnavailableReason;

  beforeEach(async () => {
    ({ resolveUnavailableReason } = await import('../authProfiles/cooldown'));
  });

  it('returns null when no profiles have issues', () => {
    expect(resolveUnavailableReason({}, ['p1'])).toBeNull();
  });

  it('returns billing when profiles are disabled for billing', () => {
    const now = Date.now();
    const stats: Record<string, ProfileUsageStats> = {
      p1: { disabledUntil: now + 60000, disabledReason: 'billing', errorCount: 1 },
    };
    expect(resolveUnavailableReason(stats, ['p1'], now)).toBe('billing');
  });

  it('returns rate_limit when profiles are in cooldown without specific reason', () => {
    const now = Date.now();
    const stats: Record<string, ProfileUsageStats> = {
      p1: { cooldownUntil: now + 60000, errorCount: 1 },
    };
    expect(resolveUnavailableReason(stats, ['p1'], now)).toBe('rate_limit');
  });
});

// ── Rotation ────────────────────────────────────────────────────────────

function makeProfile(id: string, provider: string, key: string, stats: ProfileUsageStats = {}): AuthProfileRow {
  return {
    id,
    provider,
    credential: { type: 'api_key', provider, key },
    usageStats: stats,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('resolveAuthProfileOrder', () => {
  let resolveAuthProfileOrder: typeof import('../authProfiles/rotation').resolveAuthProfileOrder;

  beforeEach(async () => {
    ({ resolveAuthProfileOrder } = await import('../authProfiles/rotation'));
  });

  it('returns empty for empty profiles', () => {
    expect(resolveAuthProfileOrder({ profiles: [] })).toEqual([]);
  });

  it('returns single profile', () => {
    const profiles = [makeProfile('p1', 'openai', 'sk-1')];
    expect(resolveAuthProfileOrder({ profiles })).toEqual(['p1']);
  });

  it('round-robins by lastUsed (oldest first)', () => {
    const now = Date.now();
    const profiles = [
      makeProfile('p1', 'openai', 'sk-1', { lastUsed: now - 1000 }),
      makeProfile('p2', 'openai', 'sk-2', { lastUsed: now - 5000 }),
      makeProfile('p3', 'openai', 'sk-3', { lastUsed: now - 3000 }),
    ];
    const order = resolveAuthProfileOrder({ profiles });
    expect(order).toEqual(['p2', 'p3', 'p1']); // oldest first
  });

  it('puts cooldown profiles at end', () => {
    const now = Date.now();
    const profiles = [
      makeProfile('p1', 'openai', 'sk-1', { cooldownUntil: now + 60000 }),
      makeProfile('p2', 'openai', 'sk-2'),
    ];
    const order = resolveAuthProfileOrder({ profiles });
    expect(order[0]).toBe('p2'); // available first
    expect(order[1]).toBe('p1'); // cooldown last
  });

  it('moves preferred profile to front', () => {
    const profiles = [
      makeProfile('p1', 'openai', 'sk-1'),
      makeProfile('p2', 'openai', 'sk-2'),
      makeProfile('p3', 'openai', 'sk-3'),
    ];
    const order = resolveAuthProfileOrder({ profiles, preferredProfileId: 'p3' });
    expect(order[0]).toBe('p3');
  });

  it('filters out profiles with empty keys', () => {
    const profiles = [
      makeProfile('p1', 'openai', ''),
      makeProfile('p2', 'openai', 'sk-valid'),
    ];
    const order = resolveAuthProfileOrder({ profiles });
    expect(order).toEqual(['p2']);
  });

  it('filters out expired token credentials', () => {
    const row: AuthProfileRow = {
      id: 'p1',
      provider: 'openai',
      credential: { type: 'token', provider: 'openai', token: 'tk-1', expires: Date.now() - 1000 },
      usageStats: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(resolveAuthProfileOrder({ profiles: [row] })).toEqual([]);
  });
});

describe('getSoonestCooldownExpiry', () => {
  let getSoonestCooldownExpiry: typeof import('../authProfiles/rotation').getSoonestCooldownExpiry;

  beforeEach(async () => {
    ({ getSoonestCooldownExpiry } = await import('../authProfiles/rotation'));
  });

  it('returns null when no cooldowns', () => {
    const profiles = [makeProfile('p1', 'openai', 'sk-1')];
    expect(getSoonestCooldownExpiry(profiles)).toBeNull();
  });

  it('returns soonest expiry', () => {
    const now = Date.now();
    const profiles = [
      makeProfile('p1', 'openai', 'sk-1', { cooldownUntil: now + 300000 }),
      makeProfile('p2', 'openai', 'sk-2', { cooldownUntil: now + 60000 }),
    ];
    expect(getSoonestCooldownExpiry(profiles)).toBe(now + 60000);
  });
});

// ── Session Override ────────────────────────────────────────────────────

describe('Session overrides', () => {
  let pinProfileToSession: typeof import('../authProfiles/sessionOverride').pinProfileToSession;
  let getSessionOverride: typeof import('../authProfiles/sessionOverride').getSessionOverride;
  let clearSessionOverride: typeof import('../authProfiles/sessionOverride').clearSessionOverride;
  let clearAllSessionOverrides: typeof import('../authProfiles/sessionOverride').clearAllSessionOverrides;
  let getSessionOverrides: typeof import('../authProfiles/sessionOverride').getSessionOverrides;
  let cleanupExpiredOverrides: typeof import('../authProfiles/sessionOverride').cleanupExpiredOverrides;
  let _resetOverrides: typeof import('../authProfiles/sessionOverride')._resetOverrides;

  beforeEach(async () => {
    const mod = await import('../authProfiles/sessionOverride');
    pinProfileToSession = mod.pinProfileToSession;
    getSessionOverride = mod.getSessionOverride;
    clearSessionOverride = mod.clearSessionOverride;
    clearAllSessionOverrides = mod.clearAllSessionOverrides;
    getSessionOverrides = mod.getSessionOverrides;
    cleanupExpiredOverrides = mod.cleanupExpiredOverrides;
    _resetOverrides = mod._resetOverrides;
    _resetOverrides();
  });

  afterEach(() => {
    _resetOverrides();
  });

  it('pins and retrieves a session override', () => {
    pinProfileToSession('session-1', 'openai', 'profile-1');
    const override = getSessionOverride('session-1', 'openai');
    expect(override).not.toBeNull();
    expect(override!.profileId).toBe('profile-1');
    expect(override!.source).toBe('auto');
  });

  it('returns null for non-existent override', () => {
    expect(getSessionOverride('session-1', 'openai')).toBeNull();
  });

  it('returns null for expired override', () => {
    pinProfileToSession('session-1', 'openai', 'profile-1', 'auto', 0); // 0ms TTL = instant expiry
    expect(getSessionOverride('session-1', 'openai')).toBeNull();
  });

  it('clears a specific override', () => {
    pinProfileToSession('session-1', 'openai', 'profile-1');
    expect(clearSessionOverride('session-1', 'openai')).toBe(true);
    expect(getSessionOverride('session-1', 'openai')).toBeNull();
  });

  it('clears all overrides for a session', () => {
    pinProfileToSession('session-1', 'openai', 'profile-1');
    pinProfileToSession('session-1', 'google', 'profile-2');
    pinProfileToSession('session-2', 'openai', 'profile-3');

    const cleared = clearAllSessionOverrides('session-1');
    expect(cleared).toBe(2);
    expect(getSessionOverride('session-1', 'openai')).toBeNull();
    expect(getSessionOverride('session-2', 'openai')).not.toBeNull();
  });

  it('gets all overrides for a session', () => {
    pinProfileToSession('session-1', 'openai', 'profile-1');
    pinProfileToSession('session-1', 'google', 'profile-2');

    const overrides = getSessionOverrides('session-1');
    expect(overrides).toHaveLength(2);
  });

  it('supports user source', () => {
    const override = pinProfileToSession('session-1', 'openai', 'profile-1', 'user');
    expect(override.source).toBe('user');
  });

  it('cleanupExpiredOverrides removes expired entries', () => {
    pinProfileToSession('session-1', 'openai', 'profile-1', 'auto', 0); // instant expiry
    pinProfileToSession('session-2', 'openai', 'profile-2', 'auto', 3600000); // 1h TTL

    const cleaned = cleanupExpiredOverrides();
    expect(cleaned).toBe(1);
    expect(getSessionOverride('session-2', 'openai')).not.toBeNull();
  });
});

// ── Persistence ─────────────────────────────────────────────────────────

describe('InMemoryAuthProfilePersistence', () => {
  let persistence: import('../authProfiles/persistence').InMemoryAuthProfilePersistence;

  beforeEach(async () => {
    const { InMemoryAuthProfilePersistence } = await import('../authProfiles/persistence');
    persistence = new InMemoryAuthProfilePersistence();
    await persistence.initialize();
  });

  it('adds and retrieves a profile', async () => {
    const cred: AuthProfileCredential = { type: 'api_key', provider: 'openai', key: 'sk-test' };
    const row = await persistence.add('openai', cred);
    expect(row.id).toBeTruthy();
    expect(row.provider).toBe('openai');

    const retrieved = await persistence.getById(row.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.credential.type).toBe('api_key');
  });

  it('lists by provider', async () => {
    await persistence.add('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    await persistence.add('openai', { type: 'api_key', provider: 'openai', key: 'sk-2' });
    await persistence.add('google', { type: 'api_key', provider: 'google', key: 'ai-1' });

    const openai = await persistence.listByProvider('openai');
    expect(openai).toHaveLength(2);

    const google = await persistence.listByProvider('google');
    expect(google).toHaveLength(1);
  });

  it('removes a profile', async () => {
    const row = await persistence.add('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    expect(await persistence.remove(row.id)).toBe(true);
    expect(await persistence.getById(row.id)).toBeNull();
  });

  it('remove returns false for non-existent ID', async () => {
    expect(await persistence.remove('non-existent')).toBe(false);
  });

  it('updates usage stats', async () => {
    const row = await persistence.add('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    const stats: ProfileUsageStats = { lastUsed: Date.now(), errorCount: 2 };
    await persistence.updateUsageStats(row.id, stats);

    const updated = await persistence.getById(row.id);
    expect(updated!.usageStats.errorCount).toBe(2);
  });

  it('getAll returns all profiles', async () => {
    await persistence.add('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    await persistence.add('google', { type: 'api_key', provider: 'google', key: 'ai-1' });

    const all = await persistence.getAll();
    expect(all).toHaveLength(2);
  });

  it('normalizes provider to lowercase', async () => {
    await persistence.add('OpenAI', { type: 'api_key', provider: 'OpenAI', key: 'sk-1' });
    const result = await persistence.listByProvider('openai');
    expect(result).toHaveLength(1);
  });
});

describe('profileToSummary', () => {
  let profileToSummary: typeof import('../authProfiles/persistence').profileToSummary;

  beforeEach(async () => {
    ({ profileToSummary } = await import('../authProfiles/persistence'));
  });

  it('creates summary with cooldown info', () => {
    const row: AuthProfileRow = {
      id: 'p1',
      provider: 'openai',
      credential: { type: 'api_key', provider: 'openai', key: 'sk-1', email: 'test@example.com' },
      usageStats: { cooldownUntil: Date.now() + 60000, errorCount: 2, lastUsed: Date.now() - 1000 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const summary = profileToSummary(row);
    expect(summary.id).toBe('p1');
    expect(summary.type).toBe('api_key');
    expect(summary.email).toBe('test@example.com');
    expect(summary.inCooldown).toBe(true);
    expect(summary.errorCount).toBe(2);
  });
});

// ── Service ─────────────────────────────────────────────────────────────

describe('AuthProfileService', () => {
  let AuthProfileService: typeof import('../authProfiles/service').AuthProfileService;
  let _resetService: typeof import('../authProfiles/service')._resetService;
  let _resetPersistence: typeof import('../authProfiles/persistence')._resetPersistence;
  let _resetOverrides: typeof import('../authProfiles/sessionOverride')._resetOverrides;

  beforeEach(async () => {
    const serviceModule = await import('../authProfiles/service');
    AuthProfileService = serviceModule.AuthProfileService;
    _resetService = serviceModule._resetService;
    const persistenceModule = await import('../authProfiles/persistence');
    _resetPersistence = persistenceModule._resetPersistence;
    const sessionModule = await import('../authProfiles/sessionOverride');
    _resetOverrides = sessionModule._resetOverrides;

    _resetService();
    _resetPersistence();
    _resetOverrides();
  });

  afterEach(() => {
    _resetService();
    _resetPersistence();
    _resetOverrides();
  });

  it('addProfile and listProfiles', async () => {
    const service = new AuthProfileService();
    await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-2' });

    const profiles = await service.listProfiles('openai');
    expect(profiles).toHaveLength(2);
  });

  it('enforces max profiles per provider', async () => {
    const service = new AuthProfileService({ maxProfilesPerProvider: 2, cooldownBaseMinutes: 1, billingCooldownHours: 5 });
    await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-2' });

    await expect(
      service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-3' }),
    ).rejects.toThrow('Maximum 2 profiles per provider');
  });

  it('removeProfile', async () => {
    const service = new AuthProfileService();
    const profile = await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    expect(await service.removeProfile(profile.id)).toBe(true);
    expect(await service.listProfiles('openai')).toHaveLength(0);
  });

  it('markUsed resets error counters', async () => {
    const service = new AuthProfileService();
    const profile = await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });

    // Simulate failure then success
    await service.markFailure(profile.id, 'rate_limit');
    await service.markUsed(profile.id);

    const profiles = await service.listProfiles('openai');
    expect(profiles[0].errorCount).toBe(0);
    expect(profiles[0].inCooldown).toBe(false);
  });

  it('markFailure applies cooldown', async () => {
    const service = new AuthProfileService();
    const profile = await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });

    await service.markFailure(profile.id, 'rate_limit');

    const profiles = await service.listProfiles('openai');
    expect(profiles[0].errorCount).toBe(1);
    expect(profiles[0].inCooldown).toBe(true);
  });

  it('getStatus returns aggregate info', async () => {
    const service = new AuthProfileService();
    await service.addProfile('openai', { type: 'api_key', provider: 'openai', key: 'sk-1' });
    await service.addProfile('google', { type: 'api_key', provider: 'google', key: 'ai-1' });

    const status = await service.getStatus();
    expect(status.totalProfiles).toBe(2);
    expect(status.byProvider.openai.total).toBe(1);
    expect(status.byProvider.google.total).toBe(1);
  });
});

// ── Tool Definitions ────────────────────────────────────────────────────

describe('Auth Profile Tools', () => {
  it('creates 2 tools', async () => {
    const { createAuthProfileTools } = await import('../tools/authProfileTools');
    const tools = createAuthProfileTools();
    expect(tools).toHaveLength(2);
  });

  it('openclaw_auth_profiles_list has correct schema', async () => {
    const { createAuthProfileTools } = await import('../tools/authProfileTools');
    const tools = createAuthProfileTools();
    const tool = tools.find(t => t.name === 'openclaw_auth_profiles_list');
    expect(tool).toBeDefined();
    const shape = (tool!.inputSchema as any).shape;
    expect(shape).toHaveProperty('provider');
  });

  it('openclaw_auth_profiles_status has correct schema', async () => {
    const { createAuthProfileTools } = await import('../tools/authProfileTools');
    const tools = createAuthProfileTools();
    const tool = tools.find(t => t.name === 'openclaw_auth_profiles_status');
    expect(tool).toBeDefined();
    expect(typeof tool!.execute).toBe('function');
  });
});

// ── Index Re-exports ────────────────────────────────────────────────────

describe('authProfiles/index', () => {
  it('exports all expected symbols', async () => {
    const mod = await import('../authProfiles/index');
    expect(mod.calculateTransientCooldownMs).toBeDefined();
    expect(mod.calculateBillingCooldownMs).toBeDefined();
    expect(mod.resolveUnusableUntil).toBeDefined();
    expect(mod.isProfileInCooldown).toBeDefined();
    expect(mod.computeNextUsageStats).toBeDefined();
    expect(mod.clearExpiredCooldowns).toBeDefined();
    expect(mod.resolveUnavailableReason).toBeDefined();
    expect(mod.resolveAuthProfileOrder).toBeDefined();
    expect(mod.getSoonestCooldownExpiry).toBeDefined();
    expect(mod.pinProfileToSession).toBeDefined();
    expect(mod.getSessionOverride).toBeDefined();
    expect(mod.clearSessionOverride).toBeDefined();
    expect(mod.getAuthProfilePersistence).toBeDefined();
    expect(mod.profileToSummary).toBeDefined();
    expect(mod.AuthProfileService).toBeDefined();
    expect(mod.getAuthProfileService).toBeDefined();
    expect(mod.initAuthProfiles).toBeDefined();
  });
});

// ── Config Integration ──────────────────────────────────────────────────

describe('authProfiles config', () => {
  it('getOpenClawConfig includes authProfiles section', async () => {
    const { getOpenClawConfig } = await import('../config');
    const config = getOpenClawConfig();

    expect(config.authProfiles).toBeDefined();
    expect(config.authProfiles.enabled).toBeDefined();
    expect(config.authProfiles.maxProfilesPerProvider).toBe(5);
    expect(config.authProfiles.cooldownBaseMinutes).toBe(1);
    expect(config.authProfiles.billingCooldownHours).toBe(5);
  });
});
