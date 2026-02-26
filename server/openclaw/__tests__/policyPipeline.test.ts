import { describe, it, expect } from 'vitest';
import { buildPolicyPipeline, applyPolicyPipeline } from '../tools/policyPipeline';

describe('buildPolicyPipeline', () => {
  it('should build pipeline from steps', () => {
    const pipeline = buildPolicyPipeline([
      { label: 'profile', policy: { allow: ['read_file', 'write_file', 'exec_command'] } },
      { label: 'agent', policy: { deny: ['exec_command'] } },
    ]);
    expect(pipeline).toHaveLength(2);
  });

  it('should skip null policies', () => {
    const pipeline = buildPolicyPipeline([
      { label: 'profile', policy: { allow: ['read_file'] } },
      { label: 'empty', policy: null },
    ]);
    expect(pipeline).toHaveLength(1);
  });
});

describe('applyPolicyPipeline', () => {
  it('should allow tool that passes all steps', () => {
    const result = applyPolicyPipeline('read_file', [
      { label: 'profile', policy: { allow: ['read_file', 'write_file'] } },
    ]);
    expect(result.allowed).toBe(true);
  });

  it('should deny tool not in allowlist', () => {
    const result = applyPolicyPipeline('exec_command', [
      { label: 'profile', policy: { allow: ['read_file'] } },
    ]);
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('profile');
  });

  it('should deny tool in denylist', () => {
    const result = applyPolicyPipeline('exec_command', [
      { label: 'profile', policy: { allow: ['read_file', 'exec_command'] } },
      { label: 'agent', policy: { deny: ['exec_command'] } },
    ]);
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('agent');
  });

  it('should allow all tools when no allowlist (full profile)', () => {
    const result = applyPolicyPipeline('anything', [
      { label: 'profile', policy: {} },
    ]);
    expect(result.allowed).toBe(true);
  });
});
