/**
 * Sandbox configuration hashing.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/sandbox/config-hash.ts
 *
 * Computes a stable SHA-256 hash of sandbox configuration for detecting
 * stale containers (config changed since container was created).
 */

import { createHash } from 'crypto';

/**
 * Recursively normalize a value for deterministic hashing:
 * - Sort object keys alphabetically
 * - Recurse into nested objects and arrays
 * - Stringify primitives
 */
function normalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }

  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = normalizeForHash((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return String(value);
}

/**
 * Compute a SHA-256 hash of a sandbox configuration.
 * The hash is stable across runs for the same logical config,
 * regardless of property insertion order.
 */
export function computeSandboxConfigHash(input: unknown): string {
  const normalized = normalizeForHash(input);
  const json = JSON.stringify(normalized);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Compare two config hashes to detect if sandbox needs recreation.
 */
export function isConfigStale(currentHash: string, containerHash: string): boolean {
  return currentHash !== containerHash;
}
