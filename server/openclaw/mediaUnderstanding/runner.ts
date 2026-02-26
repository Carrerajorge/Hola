/**
 * Media Understanding runner — orchestrates provider selection + fallback + timeout.
 * Ported from upstream OpenClaw v2026.2.24: src/media-understanding/runner.ts
 */

import type { MediaCapability, MediaUnderstandingRequest, MediaUnderstandingResult } from './types';
import { resolveProvider } from './resolver';
import { Logger } from '../../lib/logger';

const DEFAULT_TIMEOUT = 60_000; // 60 seconds

/**
 * Run a media understanding capability with automatic provider resolution.
 */
export async function runCapability(request: MediaUnderstandingRequest): Promise<MediaUnderstandingResult> {
  const provider = await resolveProvider(request.capability);
  if (!provider) {
    throw new Error(`No provider available for capability: ${request.capability}`);
  }

  // Wrap in timeout
  const timeout = request.options?.maxTokens ? DEFAULT_TIMEOUT * 2 : DEFAULT_TIMEOUT;

  const result = await Promise.race([
    provider.process(request),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms for ${request.capability}`)), timeout),
    ),
  ]);

  Logger.info(
    `[MediaUnderstanding:Runner] ${request.capability} via ${result.provider} — ` +
    `${result.durationMs}ms, ${result.text.length} chars`,
  );

  return result;
}

/**
 * Check if a capability has at least one available provider.
 */
export async function isCapabilityAvailable(capability: MediaCapability): Promise<boolean> {
  const provider = await resolveProvider(capability);
  return provider !== null;
}
