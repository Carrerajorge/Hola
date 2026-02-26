/**
 * Media Understanding tools — image description, audio transcription, video description.
 * Registers 3 new tools backed by the multi-provider media understanding pipeline.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../../agent/toolRegistry';

export function createMediaUnderstandingTools(): ToolDefinition[] {
  return [
    {
      name: 'openclaw_describe_image',
      description:
        'Describe the contents of an image using AI vision. Supports JPEG, PNG, WebP, GIF. ' +
        'Automatically selects the best available provider (Grok Vision, Gemini).',
      inputSchema: z.object({
        imageBase64: z.string().min(1).describe('Base64-encoded image data'),
        mimeType: z.string().optional().default('image/jpeg').describe('MIME type of the image (e.g. image/jpeg, image/png)'),
        prompt: z.string().optional().describe('Optional prompt to guide the description'),
        language: z.string().optional().describe('Preferred language for the description'),
      }),
      execute: async (params: any) => {
        const { runCapability } = await import('../mediaUnderstanding/index');

        const data = Buffer.from(params.imageBase64, 'base64');
        const result = await runCapability({
          capability: 'describe-image',
          data,
          mimeType: params.mimeType || 'image/jpeg',
          options: {
            prompt: params.prompt,
            language: params.language,
          },
        });

        return {
          description: result.text,
          provider: result.provider,
          durationMs: result.durationMs,
          confidence: result.confidence,
        };
      },
    },
    {
      name: 'openclaw_transcribe_audio',
      description:
        'Transcribe audio to text using AI speech recognition (Whisper). ' +
        'Supports MP3, WAV, OGG, FLAC, WebM, M4A.',
      inputSchema: z.object({
        audioBase64: z.string().min(1).describe('Base64-encoded audio data'),
        mimeType: z.string().optional().default('audio/mpeg').describe('MIME type of the audio (e.g. audio/mpeg, audio/wav)'),
        language: z.string().optional().describe('ISO-639-1 language code (e.g. en, es, fr)'),
        prompt: z.string().optional().describe('Optional prompt to guide transcription (e.g. domain-specific terms)'),
      }),
      execute: async (params: any) => {
        const { runCapability } = await import('../mediaUnderstanding/index');

        const data = Buffer.from(params.audioBase64, 'base64');
        const result = await runCapability({
          capability: 'transcribe-audio',
          data,
          mimeType: params.mimeType || 'audio/mpeg',
          options: {
            language: params.language,
            prompt: params.prompt,
          },
        });

        return {
          transcription: result.text,
          provider: result.provider,
          durationMs: result.durationMs,
        };
      },
    },
    {
      name: 'openclaw_describe_video',
      description:
        'Describe the contents of a video using AI vision (Gemini). ' +
        'Supports MP4, WebM, MOV, AVI.',
      inputSchema: z.object({
        videoBase64: z.string().min(1).describe('Base64-encoded video data'),
        mimeType: z.string().optional().default('video/mp4').describe('MIME type of the video (e.g. video/mp4, video/webm)'),
        prompt: z.string().optional().describe('Optional prompt to guide the description'),
        language: z.string().optional().describe('Preferred language for the description'),
      }),
      execute: async (params: any) => {
        const { runCapability } = await import('../mediaUnderstanding/index');

        const data = Buffer.from(params.videoBase64, 'base64');
        const result = await runCapability({
          capability: 'describe-video',
          data,
          mimeType: params.mimeType || 'video/mp4',
          options: {
            prompt: params.prompt,
            language: params.language,
          },
        });

        return {
          description: result.text,
          provider: result.provider,
          durationMs: result.durationMs,
          confidence: result.confidence,
        };
      },
    },
  ];
}
