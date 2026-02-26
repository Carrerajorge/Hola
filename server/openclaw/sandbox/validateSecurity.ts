/**
 * Sandbox security validation.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/sandbox/validate-sandbox-security.ts
 *
 * Validates bind mounts, network mode, security profiles, and overall
 * container configuration before creating Docker containers.
 * Simplified: inlined host-path/bind-spec/network-mode logic (upstream used separate files).
 */

import type { SandboxConfig, SandboxSecurityIssue, SandboxSecurityReport } from './types';
import { computeSandboxConfigHash } from './configHash';

/** Host paths that MUST NEVER be bind-mounted into containers */
const BLOCKED_HOST_PATHS = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/root',
  '/boot',
  '/run',
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/var/run/docker',
  '/run/containerd',
] as const;

/** Prefixes that indicate sensitive system directories */
const BLOCKED_PATH_PREFIXES = [
  '/etc/',
  '/proc/',
  '/sys/',
  '/dev/',
  '/root/',
  '/boot/',
  '/run/',
] as const;

export interface ValidateBindMountOptions {
  /** Allow read-only mounts to some blocked paths (still blocks docker socket) */
  allowReadOnlySystem?: boolean;
}

/**
 * Parse a Docker bind mount spec: "source:target[:options]"
 */
function parseBindSpec(spec: string): { source: string; target: string; options: string } {
  const parts = spec.split(':');
  if (parts.length < 2) {
    return { source: spec, target: spec, options: '' };
  }
  return {
    source: parts[0],
    target: parts[1],
    options: parts.slice(2).join(':'),
  };
}

/**
 * Check if a path is a blocked host path.
 */
function isBlockedHostPath(hostPath: string): boolean {
  const normalized = hostPath.replace(/\/+$/, ''); // strip trailing slashes

  // Exact match
  if ((BLOCKED_HOST_PATHS as readonly string[]).includes(normalized)) {
    return true;
  }

  // Prefix match (e.g. /etc/passwd, /proc/self)
  return BLOCKED_PATH_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

/**
 * Validate bind mounts don't expose dangerous host paths.
 */
export function validateBindMounts(
  binds: string[],
  options: ValidateBindMountOptions = {},
): SandboxSecurityIssue[] {
  const issues: SandboxSecurityIssue[] = [];

  for (const bind of binds) {
    const { source, options: mountOpts } = parseBindSpec(bind);
    const isReadOnly = mountOpts.includes('ro');

    // Docker socket is ALWAYS blocked, even read-only
    if (source === '/var/run/docker.sock' || source === '/run/docker.sock') {
      issues.push({
        severity: 'error',
        code: 'BIND_DOCKER_SOCKET',
        message: `Docker socket mount blocked: ${bind}`,
        detail: 'Mounting the Docker socket gives container full control over the host Docker daemon',
      });
      continue;
    }

    if (isBlockedHostPath(source)) {
      if (isReadOnly && options.allowReadOnlySystem) {
        issues.push({
          severity: 'warning',
          code: 'BIND_SYSTEM_PATH_RO',
          message: `Read-only mount of system path: ${source}`,
          detail: 'Allowed in permissive mode, but exposes host system information',
        });
      } else {
        issues.push({
          severity: 'error',
          code: 'BIND_SYSTEM_PATH',
          message: `Blocked bind mount to system path: ${source}`,
          detail: `Host path '${source}' is a sensitive system directory`,
        });
      }
    }

    // Warn about home directory mounts (may contain SSH keys, credentials)
    if (source.startsWith('/home/') && !isReadOnly) {
      issues.push({
        severity: 'warning',
        code: 'BIND_HOME_WRITABLE',
        message: `Writable mount of home directory: ${source}`,
        detail: 'Home directories may contain SSH keys, credentials, and config files',
      });
    }
  }

  return issues;
}

/**
 * Validate network mode isn't overly permissive.
 */
export function validateNetworkMode(networkMode: string): SandboxSecurityIssue[] {
  const issues: SandboxSecurityIssue[] = [];

  if (networkMode === 'host') {
    issues.push({
      severity: 'error',
      code: 'NETWORK_HOST',
      message: 'Host network mode blocked',
      detail: 'Host networking gives container full access to host network interfaces',
    });
  }

  if (networkMode.startsWith('container:')) {
    issues.push({
      severity: 'error',
      code: 'NETWORK_CONTAINER',
      message: `Container network sharing blocked: ${networkMode}`,
      detail: 'Sharing another container\'s network namespace can bypass network isolation',
    });
  }

  // 'bridge' is acceptable but worth noting
  if (networkMode === 'bridge') {
    issues.push({
      severity: 'info',
      code: 'NETWORK_BRIDGE',
      message: 'Container has bridge networking (can access external network)',
    });
  }

  return issues;
}

/**
 * Validate security profiles (seccomp, apparmor).
 */
export function validateSecurityProfiles(securityOpt: string[]): SandboxSecurityIssue[] {
  const issues: SandboxSecurityIssue[] = [];

  for (const opt of securityOpt) {
    if (opt.includes('seccomp=unconfined') || opt === 'seccomp:unconfined') {
      issues.push({
        severity: 'error',
        code: 'SECCOMP_UNCONFINED',
        message: 'Unconfined seccomp profile blocked',
        detail: 'Disabling seccomp removes syscall filtering and weakens container isolation',
      });
    }

    if (opt.includes('apparmor=unconfined') || opt === 'apparmor:unconfined') {
      issues.push({
        severity: 'error',
        code: 'APPARMOR_UNCONFINED',
        message: 'Unconfined AppArmor profile blocked',
        detail: 'Disabling AppArmor removes mandatory access control',
      });
    }
  }

  return issues;
}

/**
 * Full sandbox security validation — orchestrates all checks.
 * Returns a report with all issues found.
 */
export function validateSandboxSecurity(config: SandboxConfig): SandboxSecurityReport {
  const issues: SandboxSecurityIssue[] = [];

  // Network validation
  issues.push(...validateNetworkMode(config.docker.networkMode));

  // Security profile validation
  issues.push(...validateSecurityProfiles(config.docker.securityOpt));

  // Capability check: should always drop ALL
  if (!config.docker.capDrop.includes('ALL')) {
    issues.push({
      severity: 'warning',
      code: 'CAP_NOT_DROPPED',
      message: 'Container does not drop ALL capabilities',
      detail: 'Best practice: CapDrop=["ALL"], then add back only needed capabilities',
    });
  }

  const passed = issues.every(i => i.severity !== 'error');

  return {
    passed,
    issues,
    timestamp: Date.now(),
    configHash: computeSandboxConfigHash(config),
  };
}
