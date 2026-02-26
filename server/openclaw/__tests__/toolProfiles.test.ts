import { describe, it, expect } from 'vitest';
import { getToolProfile, listProfiles } from '../tools/toolProfiles';

describe('getToolProfile', () => {
  it('should return minimal profile', () => {
    const profile = getToolProfile('minimal');
    expect(profile.allow).toBeDefined();
    expect(profile.allow!.length).toBeGreaterThan(0);
    expect(profile.allow).toContain('session_status');
  });

  it('should return coding profile', () => {
    const profile = getToolProfile('coding');
    expect(profile.allow).toContain('read_file');
    expect(profile.allow).toContain('write_file');
    expect(profile.allow).toContain('exec_command');
  });

  it('should return full profile with no restrictions', () => {
    const profile = getToolProfile('full');
    expect(profile.allow).toBeUndefined();
    expect(profile.deny).toBeUndefined();
  });

  it('should return messaging profile', () => {
    const profile = getToolProfile('messaging');
    expect(profile.allow).toContain('send_message');
  });
});

describe('listProfiles', () => {
  it('should return all 4 profiles', () => {
    expect(listProfiles()).toHaveLength(4);
  });
});
