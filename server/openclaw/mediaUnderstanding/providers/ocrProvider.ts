/**
 * OCR provider — wraps our existing ocrService.
 */

import type { MediaUnderstandingProvider, MediaUnderstandingRequest, MediaUnderstandingResult, MediaCapability } from '../types';
import { Logger } from '../../../lib/logger';

export class OcrProvider implements MediaUnderstandingProvider {
  name = 'ocr';
  capabilities: MediaCapability[] = ['ocr'];

  async isAvailable(): Promise<boolean> {
    try {
      const ocrModule = await import('../../../services/ocrService');
      return typeof ocrModule.extractTextFromImage === 'function';
    } catch {
      return false;
    }
  }

  async process(request: MediaUnderstandingRequest): Promise<MediaUnderstandingResult> {
    const start = Date.now();
    try {
      const { extractTextFromImage } = await import('../../../services/ocrService');
      const base64 = request.data.toString('base64');
      const text = await extractTextFromImage(base64);

      return {
        text: text ?? '',
        provider: this.name,
        capability: request.capability,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      Logger.error(`[MediaUnderstanding:OCR] Error: ${(err as Error).message}`);
      throw err;
    }
  }
}
