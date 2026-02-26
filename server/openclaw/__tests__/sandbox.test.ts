import { describe, it, expect } from 'vitest';
import { sanitizeEnvVars, envToDockerFormat } from '../sandbox/sanitizeEnv';
import {
  validateBindMounts,
  validateNetworkMode,
  validateSecurityProfiles,
  validateSandboxSecurity,
} from '../sandbox/validateSecurity';
import { isToolAllowed, resolveToolPolicy, filterAllowedTools } from '../sandbox/toolPolicy';
import { computeSandboxConfigHash, isConfigStale } from '../sandbox/configHash';
import { createDefaultSandboxConfig } from '../sandbox/index';
import type { SandboxConfig } from '../sandbox/types';
import type { OpenClawConfig } from '../config';

// ── sanitizeEnv ─────────────────────────────────────────────────────────

describe('sanitizeEnvVars', () => {
  it('blocks env vars matching API key patterns', () => {
    const result = sanitizeEnvVars({
      OPENAI_API_KEY: 'sk-xxx',
      GITHUB_TOKEN: 'ghp_xxx',
      PATH: '/usr/bin',
      HOME: '/home/user',
      MY_SECRET_KEY: 'secret',
    });

    expect(result.blocked).toContain('OPENAI_API_KEY');
    expect(result.blocked).toContain('MY_SECRET_KEY');
    expect(result.allowed).toHaveProperty('PATH');
    expect(result.allowed).toHaveProperty('HOME');
    expect(result.allowed).not.toHaveProperty('OPENAI_API_KEY');
  });

  it('blocks AUTH_TOKEN patterns', () => {
    const result = sanitizeEnvVars({
      AUTH_TOKEN: 'abc123',
      ACCESS_TOKEN: 'xyz789',
      NODE_ENV: 'production',
    });

    expect(result.blocked).toContain('AUTH_TOKEN');
    expect(result.blocked).toContain('ACCESS_TOKEN');
    expect(result.allowed).toHaveProperty('NODE_ENV');
  });

  it('warns about suspicious base64 values', () => {
    const longBase64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
    const result = sanitizeEnvVars({
      CUSTOM_VAR: longBase64,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.blocked).toContain('CUSTOM_VAR');
  });

  it('blocks values with null bytes', () => {
    const result = sanitizeEnvVars({
      BAD_VAR: 'hello\0world',
    });

    expect(result.warnings).toContain('BAD_VAR: contains null byte');
    expect(result.blocked).toContain('BAD_VAR');
  });

  it('strict mode only allows explicitly allowed patterns', () => {
    const result = sanitizeEnvVars(
      {
        PATH: '/usr/bin',
        HOME: '/home/user',
        CUSTOM_SETTING: 'value',
        MY_APP_CONFIG: 'config',
      },
      { strictMode: true },
    );

    expect(result.allowed).toHaveProperty('PATH');
    expect(result.allowed).toHaveProperty('HOME');
    expect(result.blocked).toContain('CUSTOM_SETTING');
    expect(result.blocked).toContain('MY_APP_CONFIG');
  });

  it('envToDockerFormat converts to KEY=VALUE array', () => {
    const formatted = envToDockerFormat({ PATH: '/usr/bin', HOME: '/root' });
    expect(formatted).toEqual(['PATH=/usr/bin', 'HOME=/root']);
  });
});

// ── validateSecurity ────────────────────────────────────────────────────

describe('validateBindMounts', () => {
  it('blocks Docker socket mounts', () => {
    const issues = validateBindMounts(['/var/run/docker.sock:/var/run/docker.sock']);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('BIND_DOCKER_SOCKET');
    expect(issues[0].severity).toBe('error');
  });

  it('blocks /etc mounts', () => {
    const issues = validateBindMounts(['/etc/passwd:/etc/passwd:ro']);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('BIND_SYSTEM_PATH');
  });

  it('blocks /proc and /sys', () => {
    const issues = validateBindMounts(['/proc:/proc', '/sys:/sys']);
    expect(issues).toHaveLength(2);
    expect(issues.every(i => i.severity === 'error')).toBe(true);
  });

  it('allows workspace mounts', () => {
    const issues = validateBindMounts(['/tmp/workspace:/app']);
    expect(issues).toHaveLength(0);
  });

  it('warns about writable home directory mounts', () => {
    const issues = validateBindMounts(['/home/user:/workspace']);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('BIND_HOME_WRITABLE');
    expect(issues[0].severity).toBe('warning');
  });

  it('allows read-only system paths in permissive mode', () => {
    const issues = validateBindMounts(['/etc/resolv.conf:/etc/resolv.conf:ro'], {
      allowReadOnlySystem: true,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning'); // downgraded from error
    expect(issues[0].code).toBe('BIND_SYSTEM_PATH_RO');
  });
});

describe('validateNetworkMode', () => {
  it('blocks host network mode', () => {
    const issues = validateNetworkMode('host');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('NETWORK_HOST');
    expect(issues[0].severity).toBe('error');
  });

  it('blocks container network sharing', () => {
    const issues = validateNetworkMode('container:abc123');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('NETWORK_CONTAINER');
  });

  it('allows "none" without issues', () => {
    const issues = validateNetworkMode('none');
    expect(issues).toHaveLength(0);
  });

  it('notes bridge mode as info', () => {
    const issues = validateNetworkMode('bridge');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
  });
});

describe('validateSecurityProfiles', () => {
  it('blocks unconfined seccomp', () => {
    const issues = validateSecurityProfiles(['seccomp=unconfined']);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('SECCOMP_UNCONFINED');
  });

  it('blocks unconfined apparmor', () => {
    const issues = validateSecurityProfiles(['apparmor=unconfined']);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('APPARMOR_UNCONFINED');
  });

  it('allows normal security options', () => {
    const issues = validateSecurityProfiles(['no-new-privileges']);
    expect(issues).toHaveLength(0);
  });
});

describe('validateSandboxSecurity (full)', () => {
  it('passes a well-configured sandbox', () => {
    const config: SandboxConfig = {
      enabled: true,
      workspaceDir: '/tmp/ws',
      docker: {
        networkMode: 'none',
        readonlyRootfs: false,
        capDrop: ['ALL'],
        securityOpt: ['no-new-privileges'],
      },
      tools: {},
      blockApiKeyLeak: true,
    };

    const report = validateSandboxSecurity(config);
    expect(report.passed).toBe(true);
    expect(report.issues.every(i => i.severity !== 'error')).toBe(true);
    expect(report.configHash).toBeTruthy();
  });

  it('fails with host networking', () => {
    const config: SandboxConfig = {
      enabled: true,
      workspaceDir: '/tmp/ws',
      docker: {
        networkMode: 'host',
        readonlyRootfs: false,
        capDrop: ['ALL'],
        securityOpt: ['no-new-privileges'],
      },
      tools: {},
      blockApiKeyLeak: true,
    };

    const report = validateSandboxSecurity(config);
    expect(report.passed).toBe(false);
    expect(report.issues.some(i => i.code === 'NETWORK_HOST')).toBe(true);
  });
});

// ── toolPolicy ──────────────────────────────────────────────────────────

describe('isToolAllowed', () => {
  it('allows everything with empty policy', () => {
    expect(isToolAllowed({}, 'anything')).toBe(true);
  });

  it('denies tools matching deny patterns', () => {
    expect(isToolAllowed({ deny: ['rm', 'dd'] }, 'rm')).toBe(false);
    expect(isToolAllowed({ deny: ['rm', 'dd'] }, 'ls')).toBe(true);
  });

  it('supports glob wildcards in deny', () => {
    expect(isToolAllowed({ deny: ['docker*'] }, 'docker')).toBe(false);
    expect(isToolAllowed({ deny: ['docker*'] }, 'docker-compose')).toBe(false);
    expect(isToolAllowed({ deny: ['docker*'] }, 'node')).toBe(true);
  });

  it('allow list acts as whitelist', () => {
    expect(isToolAllowed({ allow: ['ls', 'cat', 'echo'] }, 'ls')).toBe(true);
    expect(isToolAllowed({ allow: ['ls', 'cat', 'echo'] }, 'rm')).toBe(false);
  });

  it('deny takes precedence over allow', () => {
    expect(isToolAllowed({ allow: ['*'], deny: ['rm'] }, 'rm')).toBe(false);
    expect(isToolAllowed({ allow: ['*'], deny: ['rm'] }, 'ls')).toBe(true);
  });

  it('supports ? wildcard', () => {
    expect(isToolAllowed({ allow: ['l?'] }, 'ls')).toBe(true);
    expect(isToolAllowed({ allow: ['l?'] }, 'cat')).toBe(false);
  });
});

describe('resolveToolPolicy', () => {
  it('returns empty policy when neither exists', () => {
    const result = resolveToolPolicy(undefined, undefined);
    expect(result).toEqual({});
  });

  it('returns global when no agent policy', () => {
    const global = { allow: ['ls'], deny: ['rm'] };
    expect(resolveToolPolicy(undefined, global)).toBe(global);
  });

  it('merges deny lists from both', () => {
    const result = resolveToolPolicy(
      { deny: ['dd'] },
      { deny: ['rm'] },
    );
    expect(result.deny).toEqual(['rm', 'dd']);
  });

  it('agent allow overrides global allow', () => {
    const result = resolveToolPolicy(
      { allow: ['ls'] },
      { allow: ['*'] },
    );
    expect(result.allow).toEqual(['ls']); // agent-specific
  });
});

describe('filterAllowedTools', () => {
  it('filters by policy', () => {
    const result = filterAllowedTools({ deny: ['rm', 'dd'] }, ['ls', 'rm', 'cat', 'dd']);
    expect(result).toEqual(['ls', 'cat']);
  });
});

// ── configHash ──────────────────────────────────────────────────────────

describe('computeSandboxConfigHash', () => {
  it('produces consistent hash for same config', () => {
    const config = { a: 1, b: 'hello', c: [1, 2, 3] };
    const hash1 = computeSandboxConfigHash(config);
    const hash2 = computeSandboxConfigHash(config);
    expect(hash1).toBe(hash2);
  });

  it('produces same hash regardless of key order', () => {
    const hash1 = computeSandboxConfigHash({ a: 1, b: 2 });
    const hash2 = computeSandboxConfigHash({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different configs', () => {
    const hash1 = computeSandboxConfigHash({ network: 'none' });
    const hash2 = computeSandboxConfigHash({ network: 'bridge' });
    expect(hash1).not.toBe(hash2);
  });

  it('produces a valid hex SHA-256 hash', () => {
    const hash = computeSandboxConfigHash({ test: true });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('isConfigStale', () => {
  it('returns false when hashes match', () => {
    expect(isConfigStale('abc123', 'abc123')).toBe(false);
  });

  it('returns true when hashes differ', () => {
    expect(isConfigStale('abc123', 'def456')).toBe(true);
  });
});

// ── createDefaultSandboxConfig ──────────────────────────────────────────

describe('createDefaultSandboxConfig', () => {
  it('creates config from OpenClawConfig', () => {
    const openclawConfig = {
      sandbox: {
        enabled: true,
        defaultNetworkMode: 'none' as const,
        blockApiKeyLeak: true,
        readonlyRootfs: false,
      },
      tools: {
        workspaceRoot: '/tmp/workspaces',
      },
    } as OpenClawConfig;

    const config = createDefaultSandboxConfig(openclawConfig);
    expect(config.enabled).toBe(true);
    expect(config.docker.networkMode).toBe('none');
    expect(config.docker.capDrop).toEqual(['ALL']);
    expect(config.blockApiKeyLeak).toBe(true);
    expect(config.workspaceDir).toBe('/tmp/workspaces');
  });
});
