/**
 * MIME type detection via magic bytes + extension fallback.
 * Ported from upstream OpenClaw v2026.2.24: src/media/mime.ts
 *
 * Priority: magic bytes → file extension → content-type header → application/octet-stream.
 * Uses built-in magic byte detection (no external dependency for basic types).
 */

import path from 'path';
import { EXTENSION_TO_MIME, MIME_TO_KIND, type MediaKind } from './types';

/** Magic byte signatures for common file types */
const MAGIC_SIGNATURES: Array<{ offset: number; bytes: number[]; mime: string }> = [
  // Images
  { offset: 0, bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
  { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mime: 'image/png' },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' }, // RIFF (needs further check)
  { offset: 0, bytes: [0x42, 0x4D], mime: 'image/bmp' },
  // Audio
  { offset: 0, bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' }, // ID3 tag
  { offset: 0, bytes: [0xFF, 0xFB], mime: 'audio/mpeg' }, // MP3 frame sync
  { offset: 0, bytes: [0xFF, 0xF3], mime: 'audio/mpeg' },
  { offset: 0, bytes: [0x66, 0x4C, 0x61, 0x43], mime: 'audio/flac' },
  // Video
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], mime: 'video/mp4' }, // ftyp box
  // Documents
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },
];

/**
 * Detect MIME type from magic bytes in a buffer.
 */
export function detectMimeFromBytes(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  for (const sig of MAGIC_SIGNATURES) {
    if (buffer.length < sig.offset + sig.bytes.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[sig.offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      // RIFF needs further check for WEBP
      if (sig.mime === 'image/webp') {
        const webp = buffer.slice(8, 12).toString('ascii');
        if (webp !== 'WEBP') continue;
      }
      // ftyp needs further check for specific video types
      if (sig.mime === 'video/mp4') {
        const brand = buffer.slice(8, 12).toString('ascii');
        if (brand.startsWith('qt')) return 'video/quicktime';
      }
      return sig.mime;
    }
  }

  return null;
}

/**
 * Detect MIME type from file extension.
 */
export function detectMimeFromExtension(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? null;
}

/**
 * Detect MIME type using priority chain:
 * 1. Magic bytes (if buffer provided)
 * 2. File extension
 * 3. Content-Type header
 * 4. Fallback to application/octet-stream
 */
export function detectMime(params: {
  buffer?: Buffer;
  filename?: string;
  contentType?: string;
}): string {
  // 1. Magic bytes (most reliable)
  if (params.buffer) {
    const fromBytes = detectMimeFromBytes(params.buffer);
    if (fromBytes) return fromBytes;
  }

  // 2. File extension
  if (params.filename) {
    const fromExt = detectMimeFromExtension(params.filename);
    if (fromExt) return fromExt;
  }

  // 3. Content-Type header (least reliable — servers lie)
  if (params.contentType) {
    const cleaned = params.contentType.split(';')[0].trim().toLowerCase();
    if (cleaned && cleaned !== 'application/octet-stream') {
      return cleaned;
    }
  }

  return 'application/octet-stream';
}

/**
 * Determine the media kind from a MIME type.
 */
export function getMediaKind(mimeType: string): MediaKind {
  return MIME_TO_KIND[mimeType] ?? 'unknown';
}
