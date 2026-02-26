/**
 * Media Handling Module — re-exports + initialization.
 *
 * Provides: MIME detection, image processing, media storage with TTL, safe URL fetching.
 */

import type { OpenClawConfig } from '../config';
import { MediaStore } from './store';
import { Logger } from '../../lib/logger';

export { detectMime, detectMimeFromBytes, detectMimeFromExtension, getMediaKind } from './mime';
export { resizeImage, convertHeicToJpeg, stripExif, getImageDimensions } from './imageOps';
export { MediaStore } from './store';
export { fetchMedia, validateFetchUrl } from './fetch';

export type {
  MediaKind,
  MediaInfo,
  MediaStoreEntry,
  FetchOptions,
  ImageProcessOptions,
} from './types';

export { MIME_TO_KIND, EXTENSION_TO_MIME } from './types';

/** Module singleton */
let _store: MediaStore | null = null;

export function getMediaStore(): MediaStore | null {
  return _store;
}

/**
 * Initialize the media module.
 * Called from index.ts when media.enabled=true.
 */
export function initMedia(config: OpenClawConfig): void {
  _store = new MediaStore(config.media.storeTtlMinutes);
  Logger.info(
    `[OpenClaw:Media] Initialized — ` +
    `maxFileSize=${config.media.maxFileSizeMb}MB, ` +
    `storeTTL=${config.media.storeTtlMinutes}min, ` +
    `ssrfBlock=${config.media.ssrfBlockPrivateIps}`,
  );
}
