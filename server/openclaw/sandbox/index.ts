/**
 * Sandbox Enhancement Module — re-exports + initialization.
 *
 * Provides security hardening for Docker-based sandboxed execution:
 * - Environment variable sanitization (strip API keys/tokens)
 * - Bind mount validation (block /etc, /proc, docker socket)
 * - Network mode enforcement (default: 'none')
 * - Security profile validation (seccomp, apparmor)
 * - Tool policy (glob-based allow/deny for commands)
 * - Config hashing (detect stale containers)
 */

import type { OpenClawConfig } from '../config';
import type { SandboxConfig } from './types';
import { Logger } from '../../lib/logger';

export { sanitizeEnvVars, envToDockerFormat } from './sanitizeEnv';
export type { SanitizeEnvOptions } from './sanitizeEnv';

export {
  validateBindMounts,
  validateNetworkMode,
  validateSecurityProfiles,
  validateSandboxSecurity,
} from './validateSecurity';

export { isToolAllowed, resolveToolPolicy, filterAllowedTools } from './toolPolicy';
export { computeSandboxConfigHash, isConfigStale } from './configHash';

export type {
  SandboxToolPolicy,
  SandboxNetworkMode,
  SandboxDockerConfig,
  SandboxConfig,
  SandboxSecurityReport,
  SandboxSecurityIssue,
  EnvSanitizeResult,
} from './types';

/**
 * Create a default SandboxConfig from the OpenClaw config.
 */
export function createDefaultSandboxConfig(config: OpenClawConfig): SandboxConfig {
  return {
    enabled: config.sandbox.enabled,
    workspaceDir: config.tools.workspaceRoot,
    docker: {
      networkMode: config.sandbox.defaultNetworkMode,
      readonlyRootfs: config.sandbox.readonlyRootfs,
      capDrop: ['ALL'],
      securityOpt: ['no-new-privileges'],
    },
    tools: {},
    blockApiKeyLeak: config.sandbox.blockApiKeyLeak,
  };
}

/** Module state */
let _sandboxConfig: SandboxConfig | null = null;

export function getSandboxConfig(): SandboxConfig | null {
  return _sandboxConfig;
}

/**
 * Initialize the sandbox module. Called from index.ts when sandbox.enabled=true.
 */
export function initSandbox(config: OpenClawConfig): void {
  _sandboxConfig = createDefaultSandboxConfig(config);
  Logger.info(
    `[OpenClaw:Sandbox] Initialized — network=${_sandboxConfig.docker.networkMode}, ` +
    `blockApiKeyLeak=${_sandboxConfig.blockApiKeyLeak}, ` +
    `readonlyRootfs=${_sandboxConfig.docker.readonlyRootfs}`,
  );
}
