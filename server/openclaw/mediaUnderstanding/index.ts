/**
 * Media Understanding Module — re-exports + initialization.
 *
 * Multi-provider AI pipeline for image description, audio transcription,
 * and video understanding.
 */

import type { OpenClawConfig } from '../config';
import { Logger } from '../../lib/logger';

export type {
  MediaCapability,
  MediaUnderstandingRequest,
  MediaUnderstandingResult,
  MediaUnderstandingProvider,
  ProviderStatus,
} from './types';

export { GrokVisionProvider } from './providers/grokVision';
export { GeminiVisionProvider } from './providers/geminiVision';
export { WhisperProvider } from './providers/whisper';
export { OcrProvider } from './providers/ocrProvider';

export { resolveProvider, getProviderStatuses } from './resolver';
export { runCapability, isCapabilityAvailable } from './runner';

/**
 * Initialize the media understanding module.
 * Called from index.ts when mediaUnderstanding.enabled=true.
 */
export function initMediaUnderstanding(config: OpenClawConfig): void {
  Logger.info(
    `[OpenClaw:MediaUnderstanding] Initialized — ` +
    `whisperModel=${config.mediaUnderstanding.whisperModel}, ` +
    `geminiVideoModel=${config.mediaUnderstanding.geminiVideoModel}`,
  );
}
