/**
 * Image processing operations.
 * Ported from upstream OpenClaw v2026.2.24: src/media/image-ops.ts
 *
 * Provides resize, format conversion, and dimension extraction.
 * Uses sharp when available, graceful degradation otherwise.
 */

import type { ImageProcessOptions, MediaInfo } from './types';
import { Logger } from '../../lib/logger';

let sharpModule: any = null;
let sharpChecked = false;

async function getSharp(): Promise<any | null> {
  if (sharpChecked) return sharpModule;
  sharpChecked = true;
  try {
    sharpModule = (await import('sharp')).default;
    return sharpModule;
  } catch {
    Logger.warn('[Media:ImageOps] sharp not available — image processing disabled');
    return null;
  }
}

/**
 * Get image dimensions without full decode.
 */
export async function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  try {
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height };
    }
  } catch (err) {
    Logger.warn(`[Media:ImageOps] Failed to get dimensions: ${(err as Error).message}`);
  }
  return null;
}

/**
 * Resize an image, maintaining aspect ratio.
 * Returns the processed buffer or null if sharp unavailable.
 */
export async function resizeImage(
  buffer: Buffer,
  options: ImageProcessOptions = {},
): Promise<Buffer | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  try {
    let pipeline = sharp(buffer);

    const maxWidth = options.maxWidth ?? 2048;
    const maxHeight = options.maxHeight ?? 2048;

    pipeline = pipeline.resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    const format = options.format ?? 'jpeg';
    const quality = options.quality ?? 85;

    switch (format) {
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality });
        break;
      case 'png':
        pipeline = pipeline.png({ quality });
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality });
        break;
    }

    return await pipeline.toBuffer();
  } catch (err) {
    Logger.warn(`[Media:ImageOps] Resize failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Convert HEIC/HEIF to JPEG (common on iOS devices).
 */
export async function convertHeicToJpeg(buffer: Buffer, quality = 85): Promise<Buffer | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  try {
    return await sharp(buffer).jpeg({ quality }).toBuffer();
  } catch (err) {
    Logger.warn(`[Media:ImageOps] HEIC conversion failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Strip EXIF data for privacy (location, camera info, etc).
 */
export async function stripExif(buffer: Buffer): Promise<Buffer | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  try {
    return await sharp(buffer).rotate().toBuffer(); // .rotate() without args applies EXIF rotation then strips
  } catch (err) {
    Logger.warn(`[Media:ImageOps] EXIF strip failed: ${(err as Error).message}`);
    return null;
  }
}
