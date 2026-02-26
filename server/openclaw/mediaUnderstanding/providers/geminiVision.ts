/**
 * Gemini Vision provider — image + video understanding via @google/genai.
 * Ported from upstream OpenClaw v2026.2.24: src/media-understanding/providers/google/
 */

import type { MediaUnderstandingProvider, MediaUnderstandingRequest, MediaUnderstandingResult, MediaCapability } from '../types';
import { Logger } from '../../../lib/logger';

export class GeminiVisionProvider implements MediaUnderstandingProvider {
  name = 'gemini-vision';
  capabilities: MediaCapability[] = ['describe-image', 'describe-video'];
  private model: string;

  constructor(model?: string) {
    this.model = model ?? 'gemini-2.0-flash';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { getLLMProviderKey } = await import('../../../services/secretManager');
      const key = await getLLMProviderKey('google');
      return !!key;
    } catch {
      return false;
    }
  }

  async process(request: MediaUnderstandingRequest): Promise<MediaUnderstandingResult> {
    const start = Date.now();
    try {
      const { getLLMProviderKey } = await import('../../../services/secretManager');
      const apiKey = await getLLMProviderKey('google');
      if (!apiKey) throw new Error('Google API key not configured');

      const { GoogleGenAI } = await import('@google/genai');
      const genai = new GoogleGenAI({ apiKey });

      const base64Data = request.data.toString('base64');
      const prompt = request.options?.prompt ?? 'Describe this content in detail.';

      const response = await genai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: request.mimeType, data: base64Data } },
              { text: prompt },
            ],
          },
        ],
      });

      const text = response.text ?? '';

      return {
        text,
        provider: this.name,
        capability: request.capability,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      Logger.error(`[MediaUnderstanding:GeminiVision] Error: ${(err as Error).message}`);
      throw err;
    }
  }
}
