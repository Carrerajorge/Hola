/**
 * Media Handling types.
 * Ported from upstream OpenClaw v2026.2.24: src/media/constants.ts
 */

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'unknown';

export interface MediaInfo {
  mimeType: string;
  extension: string;
  kind: MediaKind;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface MediaStoreEntry {
  id: string;
  data: Buffer;
  info: MediaInfo;
  createdAt: number;
  expiresAt: number;
}

export interface FetchOptions {
  maxSizeBytes?: number;
  timeout?: number;
  allowPrivateIps?: boolean;
  headers?: Record<string, string>;
}

export interface ImageProcessOptions {
  maxWidth?: number;
  maxHeight?: number;
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
}

export const MIME_TO_KIND: Record<string, MediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'image/tiff': 'image',
  'image/bmp': 'image',
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/flac': 'audio',
  'audio/aac': 'audio',
  'audio/webm': 'audio',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/ogg': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'application/pdf': 'document',
  'text/plain': 'document',
  'text/markdown': 'document',
  'text/html': 'document',
  'application/json': 'document',
};

export const EXTENSION_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
};
