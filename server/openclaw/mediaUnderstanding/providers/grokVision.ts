/**
 * Grok Vision provider — wraps our existing grokVisionService.
 */

import type { MediaUnderstandingProvider, MediaUnderstandingRequest, MediaUnderstandingResult, MediaCapability } from '../types';
import { Logger } from '../../../lib/logger';

export class GrokVisionProvider implements MediaUnderstandingProvider {
  name = 'grok-vision';
  capabilities: MediaCapability[] = ['describe-image'];

  async isAvailable(): Promise<boolean> {
    try {
      const { getLLMProviderKey } = await import('../../../services/secretManager');
      const key = await getLLMProviderKey('xai');
      return !!key;
    } catch {
      return false;
    }
  }

  async process(request: MediaUnderstandingRequest): Promise<MediaUnderstandingResult> {
    const start = Date.now();
    try {
      const { describeImage } = await import('../../../services/grokVisionService');
      const base64 = request.data.toString('base64');
      const dataUrl = `data:${request.mimeType};base64,${base64}`;

      const description = await describeImage(dataUrl, request.options?.prompt);
      return {
        text: description,
        provider: this.name,
        capability: request.capability,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      Logger.error(`[MediaUnderstanding:GrokVision] Error: ${(err as Error).message}`);
      throw err;
    }
  }
}
