/**
 * Provider resolver — auto-detects available providers.
 * Ported from upstream OpenClaw v2026.2.24: src/media-understanding/resolve.ts
 */

import type { MediaUnderstandingProvider, MediaCapability, ProviderStatus } from './types';
import { GrokVisionProvider } from './providers/grokVision';
import { GeminiVisionProvider } from './providers/geminiVision';
import { WhisperProvider } from './providers/whisper';
import { OcrProvider } from './providers/ocrProvider';
import { Logger } from '../../lib/logger';

/** Provider priority: first available wins */
const PROVIDER_PRIORITY: Record<MediaCapability, (() => MediaUnderstandingProvider)[]> = {
  'describe-image': [
    () => new GrokVisionProvider(),
    () => new GeminiVisionProvider(),
  ],
  'describe-video': [
    () => new GeminiVisionProvider(),
  ],
  'transcribe-audio': [
    () => new WhisperProvider(),
  ],
  'ocr': [
    () => new OcrProvider(),
    () => new GrokVisionProvider(), // Grok can do OCR via vision
  ],
};

/**
 * Resolve the best available provider for a capability.
 * Checks each provider in priority order, returns first available.
 */
export async function resolveProvider(capability: MediaCapability): Promise<MediaUnderstandingProvider | null> {
  const factories = PROVIDER_PRIORITY[capability] ?? [];

  for (const factory of factories) {
    const provider = factory();
    try {
      const available = await provider.isAvailable();
      if (available) {
        Logger.info(`[MediaUnderstanding:Resolver] Using ${provider.name} for ${capability}`);
        return provider;
      }
    } catch (err) {
      Logger.warn(`[MediaUnderstanding:Resolver] ${provider.name} availability check failed: ${(err as Error).message}`);
    }
  }

  Logger.warn(`[MediaUnderstanding:Resolver] No provider available for ${capability}`);
  return null;
}

/**
 * Get status of all providers (for debugging/admin).
 */
export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const allProviders = [
    new GrokVisionProvider(),
    new GeminiVisionProvider(),
    new WhisperProvider(),
    new OcrProvider(),
  ];

  return Promise.all(
    allProviders.map(async (provider) => {
      try {
        const available = await provider.isAvailable();
        return {
          name: provider.name,
          available,
          capabilities: provider.capabilities,
        };
      } catch (err) {
        return {
          name: provider.name,
          available: false,
          capabilities: provider.capabilities,
          error: (err as Error).message,
        };
      }
    }),
  );
}
