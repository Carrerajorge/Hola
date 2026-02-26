/**
 * Media Understanding types.
 * Ported from upstream OpenClaw v2026.2.24: src/media-understanding/types.ts
 */

export type MediaCapability = 'describe-image' | 'transcribe-audio' | 'describe-video' | 'ocr';

export interface MediaUnderstandingRequest {
  capability: MediaCapability;
  data: Buffer;
  mimeType: string;
  options?: {
    language?: string;
    prompt?: string;
    maxTokens?: number;
  };
}

export interface MediaUnderstandingResult {
  text: string;
  provider: string;
  capability: MediaCapability;
  durationMs: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface MediaUnderstandingProvider {
  name: string;
  capabilities: MediaCapability[];
  isAvailable(): Promise<boolean>;
  process(request: MediaUnderstandingRequest): Promise<MediaUnderstandingResult>;
}

export interface ProviderStatus {
  name: string;
  available: boolean;
  capabilities: MediaCapability[];
  error?: string;
}
