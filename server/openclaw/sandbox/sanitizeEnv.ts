/**
 * Environment variable sanitization for sandbox containers.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/sandbox/sanitize-env-vars.ts
 *
 * Strips API keys, tokens, and secrets from container environment to prevent
 * accidental credential leakage into sandboxed processes.
 */

import type { EnvSanitizeResult } from './types';

/** Patterns that match env var NAMES likely containing secrets */
const BLOCKED_ENV_VAR_PATTERNS: RegExp[] = [
  /^.*API[_-]?KEY.*$/i,
  /^.*API[_-]?SECRET.*$/i,
  /^.*ACCESS[_-]?TOKEN.*$/i,
  /^.*AUTH[_-]?TOKEN.*$/i,
  /^.*SECRET[_-]?KEY.*$/i,
  /^.*PRIVATE[_-]?KEY.*$/i,
  /^.*CLIENT[_-]?SECRET.*$/i,
  /^.*ENCRYPTION[_-]?KEY.*$/i,
  /^.*SIGNING[_-]?KEY.*$/i,
  /^.*DATABASE[_-]?URL.*$/i,
  /^.*DATABASE[_-]?PASSWORD.*$/i,
  /^.*DB[_-]?PASSWORD.*$/i,
  /^.*REDIS[_-]?URL.*$/i,
  /^.*REDIS[_-]?PASSWORD.*$/i,
  /^.*CONNECTION[_-]?STRING.*$/i,
  /^.*WEBHOOK[_-]?SECRET.*$/i,
  /^.*JWT[_-]?SECRET.*$/i,
  /^.*SESSION[_-]?SECRET.*$/i,
  /^.*PASSPHRASE.*$/i,
];

/** Patterns that match env var NAMES safe to keep */
const ALLOWED_ENV_VAR_PATTERNS: RegExp[] = [
  /^LANG$/i,
  /^LANGUAGE$/i,
  /^LC_[A-Z_]+$/i,
  /^PATH$/i,
  /^HOME$/i,
  /^USER$/i,
  /^SHELL$/i,
  /^TERM$/i,
  /^NODE_ENV$/i,
];

/**
 * Check if an env var value looks suspicious (embedded credentials).
 * Returns a warning string if suspicious, null otherwise.
 */
function validateEnvVarValue(name: string, value: string): string | null {
  if (value.includes('\0')) {
    return `${name}: contains null byte`;
  }
  if (value.length > 32768) {
    return `${name}: value exceeds 32KB (${value.length} chars)`;
  }
  // Detect base64-encoded strings that look like credentials (long random strings)
  if (/^[A-Za-z0-9+/=]{40,}$/.test(value) && !ALLOWED_ENV_VAR_PATTERNS.some(p => p.test(name))) {
    return `${name}: looks like base64-encoded credential`;
  }
  return null;
}

export interface SanitizeEnvOptions {
  /** Extra patterns to block (in addition to defaults) */
  extraBlockedPatterns?: RegExp[];
  /** Extra patterns to allow (in addition to defaults) */
  extraAllowedPatterns?: RegExp[];
  /** If true, only pass explicitly allowed vars (deny-by-default) */
  strictMode?: boolean;
}

/**
 * Sanitize environment variables for container injection.
 *
 * In normal mode: blocks vars matching BLOCKED patterns, passes everything else.
 * In strict mode: only passes vars matching ALLOWED patterns.
 */
export function sanitizeEnvVars(
  envVars: Record<string, string>,
  options: SanitizeEnvOptions = {},
): EnvSanitizeResult {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const allowed: Record<string, string> = {};

  const blockPatterns = [...BLOCKED_ENV_VAR_PATTERNS, ...(options.extraBlockedPatterns ?? [])];
  const allowPatterns = [...ALLOWED_ENV_VAR_PATTERNS, ...(options.extraAllowedPatterns ?? [])];

  for (const [name, value] of Object.entries(envVars)) {
    // Always block if matches a blocked pattern
    if (blockPatterns.some(p => p.test(name))) {
      blocked.push(name);
      continue;
    }

    // In strict mode, only allow explicitly allowed patterns
    if (options.strictMode && !allowPatterns.some(p => p.test(name))) {
      blocked.push(name);
      continue;
    }

    // Check value for suspicious content
    const valueWarning = validateEnvVarValue(name, value);
    if (valueWarning) {
      warnings.push(valueWarning);
      blocked.push(name);
      continue;
    }

    allowed[name] = value;
  }

  return { allowed, blocked, warnings };
}

/**
 * Convert sanitized env to Docker-compatible format: ["KEY=VALUE", ...]
 */
export function envToDockerFormat(env: Record<string, string>): string[] {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}
