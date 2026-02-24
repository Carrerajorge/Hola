import { describe, it, expect } from 'vitest';
import { getOpenClawConfig } from '../config';

describe('OpenClaw Config', () => {
  it('returns disabled by default when env vars are not set', () => {
    const config = getOpenClawConfig();
    expect(config.gateway.enabled).toBe(false);
    expect(config.tools.enabled).toBe(false);
    expect(config.plugins.enabled).toBe(false);
    expect(config.skills.enabled).toBe(false);
    expect(config.streaming.enabled).toBe(false);
  });

  it('reads safe-bins from env', () => {
    process.env.OPENCLAW_SAFE_BINS = 'python,node,git';
    const config = getOpenClawConfig();
    expect(config.tools.safeBins).toEqual(['python', 'node', 'git']);
    delete process.env.OPENCLAW_SAFE_BINS;
  });

  it('returns default safe-bins when env is not set', () => {
    delete process.env.OPENCLAW_SAFE_BINS;
    const config = getOpenClawConfig();
    expect(config.tools.safeBins).toContain('python');
    expect(config.tools.safeBins).toContain('node');
    expect(config.tools.safeBins).toContain('git');
    expect(config.tools.safeBins.length).toBeGreaterThan(10);
  });

  it('reads gateway path from env', () => {
    process.env.OPENCLAW_WS_PATH = '/custom/ws';
    const config = getOpenClawConfig();
    expect(config.gateway.path).toBe('/custom/ws');
    delete process.env.OPENCLAW_WS_PATH;
  });
});
