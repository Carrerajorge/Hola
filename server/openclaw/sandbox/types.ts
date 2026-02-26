/**
 * Sandbox types — ported from upstream OpenClaw v2026.2.24
 * src/agents/sandbox/types.ts
 *
 * Adapted: removed Pi-AI runtime references, aligned with our dockerode config.
 */

export interface SandboxToolPolicy {
  allow?: string[];
  deny?: string[];
}

export type SandboxNetworkMode = 'none' | 'bridge' | 'host';

export interface SandboxDockerConfig {
  image?: string;
  networkMode: SandboxNetworkMode;
  readonlyRootfs: boolean;
  capDrop: string[];
  securityOpt: string[];
  memory?: number;
  cpuShares?: number;
  pidsLimit?: number;
  tmpfs?: Record<string, string>;
}

export interface SandboxConfig {
  enabled: boolean;
  workspaceDir: string;
  docker: SandboxDockerConfig;
  tools: SandboxToolPolicy;
  blockApiKeyLeak: boolean;
}

export interface SandboxSecurityReport {
  passed: boolean;
  issues: SandboxSecurityIssue[];
  timestamp: number;
  configHash: string;
}

export interface SandboxSecurityIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  detail?: string;
}

export interface EnvSanitizeResult {
  allowed: Record<string, string>;
  blocked: string[];
  warnings: string[];
}
