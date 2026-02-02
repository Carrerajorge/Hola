import { describe, expect, it } from 'vitest';
import { shouldShowWorkspaceDeactivationBanner } from '@/lib/billing';

// Generate a rigorous matrix of cases (120+) to satisfy regression testing.
// NOTE: These are fast unit tests (no network, no browser) and cover edge conditions.

describe('shouldShowWorkspaceDeactivationBanner', () => {
  const now = Date.UTC(2026, 1, 2, 0, 0, 0); // 2026-02-02T00:00:00Z

  it('returns false for active even if period end is future', () => {
    expect(
      shouldShowWorkspaceDeactivationBanner({
        subscriptionStatus: 'active',
        subscriptionPeriodEnd: new Date(now + 86400_000).toISOString(),
        nowMs: now,
      })
    ).toBe(false);
  });

  it('returns false when missing status or periodEnd', () => {
    expect(shouldShowWorkspaceDeactivationBanner({ subscriptionStatus: null, subscriptionPeriodEnd: null, nowMs: now })).toBe(false);
    expect(shouldShowWorkspaceDeactivationBanner({ subscriptionStatus: 'canceled', subscriptionPeriodEnd: null, nowMs: now })).toBe(false);
  });

  it('returns false for invalid date', () => {
    expect(
      shouldShowWorkspaceDeactivationBanner({
        subscriptionStatus: 'canceled',
        subscriptionPeriodEnd: 'not-a-date',
        nowMs: now,
      })
    ).toBe(false);
  });

  const statuses = [
    'canceled',
    'cancelled',
    'past_due',
    'unpaid',
    'incomplete',
    'incomplete_expired',
    'trialing',
    'paused',
    'suspended',
    'inactive',
  ];

  const offsets = [
    -365 * 86400_000,
    -30 * 86400_000,
    -1 * 86400_000,
    -1,
    0,
    1,
    60_000,
    3600_000,
    6 * 3600_000,
    24 * 3600_000,
    7 * 86400_000,
    30 * 86400_000,
    365 * 86400_000,
  ];

  // 10 statuses x 13 offsets = 130 tests
  for (const status of statuses) {
    for (const offset of offsets) {
      it(`status=${status} periodEndOffsetMs=${offset}`, () => {
        const end = new Date(now + offset).toISOString();
        const expected = offset > 0; // only show if end is in the future

        expect(
          shouldShowWorkspaceDeactivationBanner({
            subscriptionStatus: status,
            subscriptionPeriodEnd: end,
            nowMs: now,
          })
        ).toBe(expected);
      });
    }
  }
});
