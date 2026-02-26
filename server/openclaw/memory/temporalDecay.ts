/**
 * Temporal decay scoring.
 * Ported from upstream OpenClaw v2026.2.24: src/memory/temporal-decay.ts
 *
 * Applies exponential decay to search scores based on document age.
 * Formula: decayed_score = score * exp(-ln(2)/halfLifeDays * ageInDays)
 *
 * Evergreen memory files (MEMORY.md, topic files) do NOT decay.
 */

import type { MemorySearchResult, MemorySource } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATED_MEMORY_RE = /(?:^|\/)memory\/(\d{4})-(\d{2})-(\d{2})\.md$/;

export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number;
}

export const DEFAULT_TEMPORAL_DECAY: TemporalDecayConfig = {
  enabled: false,
  halfLifeDays: 14,
};

/**
 * Convert half-life in days to decay constant λ.
 * λ = ln(2) / halfLifeDays
 */
export function toDecayLambda(halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  return Math.LN2 / halfLifeDays;
}

/**
 * Calculate the temporal decay multiplier for a given age.
 * Returns a value in (0, 1] where 1 = no decay (age=0).
 */
export function calculateDecayMultiplier(ageInDays: number, halfLifeDays: number): number {
  const lambda = toDecayLambda(halfLifeDays);
  const clampedAge = Math.max(0, ageInDays);
  if (lambda <= 0 || !Number.isFinite(clampedAge)) return 1;
  return Math.exp(-lambda * clampedAge);
}

/**
 * Apply temporal decay to a score.
 */
export function applyDecayToScore(score: number, ageInDays: number, halfLifeDays: number): number {
  return score * calculateDecayMultiplier(ageInDays, halfLifeDays);
}

/**
 * Parse a date from a memory file path like "memory/2024-01-15.md".
 */
function parseMemoryDate(filePath: string): Date | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const match = DATED_MEMORY_RE.exec(normalized);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  // Validate the parsed date is correct (handles invalid months/days)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

/**
 * Check if a memory path is an "evergreen" file (should not decay).
 * Evergreen: MEMORY.md, memory.md, and non-dated topic files under memory/.
 */
function isEvergreenPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === 'MEMORY.md' || normalized === 'memory.md') return true;
  if (!normalized.startsWith('memory/')) return false;
  return !DATED_MEMORY_RE.test(normalized);
}

/**
 * Estimate age in days for a search result.
 *
 * Priority:
 * 1. Parse date from path (dated memory files)
 * 2. Use updatedAt timestamp from chunk metadata
 * 3. Return null if undeterminable (no decay applied)
 */
export function estimateAgeDays(
  result: { path: string; source: MemorySource },
  chunkUpdatedAt?: number,
  nowMs?: number,
): number | null {
  // Evergreen files don't decay
  if (result.source === 'memory' && isEvergreenPath(result.path)) {
    return null;
  }

  const now = nowMs ?? Date.now();

  // Try path-based date first
  const pathDate = parseMemoryDate(result.path);
  if (pathDate) {
    return Math.max(0, (now - pathDate.getTime()) / DAY_MS);
  }

  // Fall back to chunk metadata timestamp
  if (chunkUpdatedAt && Number.isFinite(chunkUpdatedAt)) {
    return Math.max(0, (now - chunkUpdatedAt) / DAY_MS);
  }

  return null;
}

/**
 * Apply temporal decay to an array of search results.
 */
export function applyTemporalDecay(
  results: MemorySearchResult[],
  config: TemporalDecayConfig,
  chunkTimestamps?: Map<string, number>,
  nowMs?: number,
): MemorySearchResult[] {
  if (!config.enabled) return [...results];

  return results.map(result => {
    const updatedAt = chunkTimestamps?.get(result.id);
    const ageDays = estimateAgeDays(result, updatedAt, nowMs);

    if (ageDays === null) return result; // no decay for evergreen/unknown

    const multiplier = calculateDecayMultiplier(ageDays, config.halfLifeDays);
    return {
      ...result,
      score: result.score * multiplier,
      scoreBreakdown: {
        ...result.scoreBreakdown,
        temporalMultiplier: multiplier,
      },
    };
  });
}
