/**
 * Safe URL fetching with SSRF protection.
 * Ported from upstream OpenClaw v2026.2.24: src/media/fetch.ts
 *
 * Blocks: private IPs, file://, data://, localhost.
 * Enforces size limits and timeouts.
 */

import { URL } from 'url';
import type { FetchOptions } from './types';
import { Logger } from '../../lib/logger';

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_TIMEOUT = 30_000; // 30 seconds

/** Private/reserved IP ranges that MUST be blocked */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                       // loopback
  /^10\./,                        // class A private
  /^172\.(1[6-9]|2\d|3[01])\./,  // class B private
  /^192\.168\./,                  // class C private
  /^169\.254\./,                  // link-local
  /^0\./,                         // current network
  /^::1$/,                        // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,            // IPv6 unique local
  /^fe80:/i,                      // IPv6 link-local
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',     // GCP metadata
  'instance-data',                // AWS metadata alias
]);

/**
 * Check if a hostname resolves to a blocked IP.
 * We check the hostname directly (DNS resolution would add latency + complexity).
 */
function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return true;
  if (BLOCKED_IP_PATTERNS.some(pattern => pattern.test(hostname))) return true;

  // Block AWS metadata endpoint
  if (hostname === '169.254.169.254') return true;

  return false;
}

/**
 * Validate a URL for safe fetching.
 * Throws on dangerous URLs.
 */
export function validateFetchUrl(urlStr: string, options?: { allowPrivateIps?: boolean }): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }

  // Block non-HTTP(S) protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked protocol: ${parsed.protocol} — only HTTP(S) allowed`);
  }

  // SSRF protection: block private IPs (unless explicitly allowed)
  if (!options?.allowPrivateIps && isBlockedHost(parsed.hostname)) {
    throw new Error(`Blocked host: ${parsed.hostname} — private/reserved IP addresses are not allowed`);
  }

  return parsed;
}

/**
 * Fetch media from a URL with SSRF protection and size limits.
 */
export async function fetchMedia(
  urlStr: string,
  options: FetchOptions = {},
): Promise<{ buffer: Buffer; contentType: string | null; url: string }> {
  const maxSize = options.maxSizeBytes ?? DEFAULT_MAX_SIZE;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  // Validate URL
  const url = validateFetchUrl(urlStr, { allowPrivateIps: options.allowPrivateIps });

  Logger.info(`[Media:Fetch] Fetching: ${url.origin}${url.pathname}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OpenClaw-Media/1.0',
        ...options.headers,
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check Content-Length before downloading
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxSize) {
      throw new Error(`File too large: ${contentLength} bytes (max: ${maxSize})`);
    }

    // Stream and enforce size limit
    const chunks: Buffer[] = [];
    let totalSize = 0;

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > maxSize) {
        reader.cancel();
        throw new Error(`Download exceeded size limit: ${totalSize} > ${maxSize} bytes`);
      }

      chunks.push(Buffer.from(value));
    }

    const buffer = Buffer.concat(chunks);
    const contentType = response.headers.get('content-type');

    return { buffer, contentType, url: url.toString() };
  } finally {
    clearTimeout(timeoutId);
  }
}
