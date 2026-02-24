import { describe, it, expect } from 'vitest';
import { checkSkillEligibility } from '../skills/eligibility';

describe('checkSkillEligibility', () => {
  it('should pass when no requirements specified', () => {
    expect(checkSkillEligibility({})).toEqual({ eligible: true, reasons: [] });
  });

  it('should check OS compatibility', () => {
    const result = checkSkillEligibility({ os: ['win32'] }); // Current OS is darwin
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain('OS');
  });

  it('should pass on matching OS', () => {
    const result = checkSkillEligibility({ os: ['darwin', 'linux'] });
    expect(result.eligible).toBe(true);
  });

  it('should check env var requirements', () => {
    delete process.env.SOME_REQUIRED_VAR;
    const result = checkSkillEligibility({ envVars: ['SOME_REQUIRED_VAR'] });
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain('SOME_REQUIRED_VAR');
  });

  it('should pass when env var exists', () => {
    process.env.TEST_SKILL_VAR = 'present';
    const result = checkSkillEligibility({ envVars: ['TEST_SKILL_VAR'] });
    expect(result.eligible).toBe(true);
    delete process.env.TEST_SKILL_VAR;
  });
});
