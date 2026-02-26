/**
 * OpenAI Whisper provider — audio transcription.
 * Ported from upstream OpenClaw v2026.2.24: src/media-understanding/providers/openai/audio.ts
 */

import type { MediaUnderstandingProvider, MediaUnderstandingRequest, MediaUnderstandingResult, MediaCapability } from '../types';
import { Logger } from '../../../lib/logger';

export class WhisperProvider implements MediaUnderstandingProvider {
  name = 'whisper';
  capabilities: MediaCapability[] = ['transcribe-audio'];
  private model: string;

  constructor(model?: string) {
    this.model = model ?? 'whisper-1';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { getLLMProviderKey } = await import('../../../services/secretManager');
      const key = await getLLMProviderKey('openai');
      return !!key;
    } catch {
      return false;
    }
  }

  async process(request: MediaUnderstandingRequest): Promise<MediaUnderstandingResult> {
    const start = Date.now();
    try {
      const { getLLMProviderKey } = await import('../../../services/secretManager');
      const apiKey = await getLLMProviderKey('openai');
      if (!apiKey) throw new Error('OpenAI API key not configured');

      // Build multipart form data
      const blob = new Blob([request.data], { type: request.mimeType });
      const ext = mimeToExtension(request.mimeType);

      const formData = new FormData();
      formData.append('file', blob, `audio${ext}`);
      formData.append('model', this.model);

      if (request.options?.language) {
        formData.append('language', request.options.language);
      }
      if (request.options?.prompt) {
        formData.append('prompt', request.options.prompt);
      }

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Whisper API error ${response.status}: ${errorBody}`);
      }

      const result = await response.json() as { text: string };

      return {
        text: result.text,
        provider: this.name,
        capability: request.capability,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      Logger.error(`[MediaUnderstanding:Whisper] Error: ${(err as Error).message}`);
      throw err;
    }
  }
}

function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac',
    'audio/webm': '.webm',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
  };
  return map[mimeType] ?? '.mp3';
}
