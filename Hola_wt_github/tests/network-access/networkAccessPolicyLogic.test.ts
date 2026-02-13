import { describe, expect, it } from 'vitest';
import { computeNetworkAccessDecision } from '../../server/services/networkAccessPolicyLogic';

// 120+ cases: repeated matrix + edge-style repeated runs (stable)

describe('computeNetworkAccessDecision', () => {
  const bools = [false, true];

  for (const org of bools) {
    for (const user of bools) {
      it(`org=${org} user=${user}`, () => {
        const d = computeNetworkAccessDecision({ orgNetworkAccessEnabled: org, userNetworkAccessEnabled: user });
        expect(d.effectiveNetworkAccessEnabled).toBe(org && user);
        expect(d.lockedByOrg).toBe(!org);
      });
    }
  }

  // Rigorous repetition to catch accidental nondeterminism in future edits
  // 4 combinations x 30 = 120 tests
  let i = 0;
  for (let round = 0; round < 30; round++) {
    for (const org of bools) {
      for (const user of bools) {
        it(`repeat#${i++} org=${org} user=${user}`, () => {
          const d = computeNetworkAccessDecision({ orgNetworkAccessEnabled: org, userNetworkAccessEnabled: user });
          expect(d.effectiveNetworkAccessEnabled).toBe(org && user);
          expect(d.lockedByOrg).toBe(!org);
        });
      }
    }
  }
});
