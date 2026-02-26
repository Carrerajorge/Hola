import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectMime, detectMimeFromBytes, detectMimeFromExtension, getMediaKind } from '../media/mime';
import { validateFetchUrl } from '../media/fetch';
import { MediaStore } from '../media/store';
import type { MediaInfo } from '../media/types';

// ── MIME Detection ──────────────────────────────────────────────────────

describe('detectMimeFromBytes', () => {
  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    expect(detectMimeFromBytes(buf)).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
    expect(detectMimeFromBytes(buf)).toBe('image/png');
  });

  it('detects GIF from magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(detectMimeFromBytes(buf)).toBe('image/gif');
  });

  it('detects PDF from magic bytes', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x00, 0x00, 0x00, 0x00]);
    expect(detectMimeFromBytes(buf)).toBe('application/pdf');
  });

  it('detects MP3 (ID3 tag)', () => {
    const buf = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(detectMimeFromBytes(buf)).toBe('audio/mpeg');
  });

  it('returns null for unknown bytes', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B]);
    expect(detectMimeFromBytes(buf)).toBeNull();
  });

  it('returns null for buffer too small', () => {
    expect(detectMimeFromBytes(Buffer.from([0xFF]))).toBeNull();
  });
});

describe('detectMimeFromExtension', () => {
  it('detects common image extensions', () => {
    expect(detectMimeFromExtension('photo.jpg')).toBe('image/jpeg');
    expect(detectMimeFromExtension('image.png')).toBe('image/png');
    expect(detectMimeFromExtension('anim.gif')).toBe('image/gif');
    expect(detectMimeFromExtension('pic.webp')).toBe('image/webp');
  });

  it('detects audio extensions', () => {
    expect(detectMimeFromExtension('song.mp3')).toBe('audio/mpeg');
    expect(detectMimeFromExtension('audio.wav')).toBe('audio/wav');
  });

  it('detects video extensions', () => {
    expect(detectMimeFromExtension('clip.mp4')).toBe('video/mp4');
    expect(detectMimeFromExtension('movie.mov')).toBe('video/quicktime');
  });

  it('detects document extensions', () => {
    expect(detectMimeFromExtension('doc.pdf')).toBe('application/pdf');
    expect(detectMimeFromExtension('notes.md')).toBe('text/markdown');
  });

  it('returns null for unknown extensions', () => {
    expect(detectMimeFromExtension('file.xyz')).toBeNull();
  });

  it('handles case insensitivity via lowercase', () => {
    expect(detectMimeFromExtension('IMAGE.JPG')).toBe('image/jpeg');
  });
});

describe('detectMime (priority chain)', () => {
  it('prefers magic bytes over extension', () => {
    const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
    // File says .png but bytes say JPEG
    expect(detectMime({ buffer: jpegBytes, filename: 'image.png' })).toBe('image/jpeg');
  });

  it('falls back to extension when no bytes', () => {
    expect(detectMime({ filename: 'doc.pdf' })).toBe('application/pdf');
  });

  it('falls back to content-type when no bytes or extension', () => {
    expect(detectMime({ contentType: 'image/svg+xml; charset=utf-8' })).toBe('image/svg+xml');
  });

  it('returns octet-stream as last resort', () => {
    expect(detectMime({})).toBe('application/octet-stream');
  });
});

describe('getMediaKind', () => {
  it('maps MIME types to kinds', () => {
    expect(getMediaKind('image/jpeg')).toBe('image');
    expect(getMediaKind('audio/mpeg')).toBe('audio');
    expect(getMediaKind('video/mp4')).toBe('video');
    expect(getMediaKind('application/pdf')).toBe('document');
    expect(getMediaKind('application/octet-stream')).toBe('unknown');
  });
});

// ── SSRF Protection (fetch URL validation) ──────────────────────────────

describe('validateFetchUrl', () => {
  it('allows HTTPS URLs', () => {
    const url = validateFetchUrl('https://example.com/image.png');
    expect(url.hostname).toBe('example.com');
  });

  it('allows HTTP URLs', () => {
    const url = validateFetchUrl('http://example.com/image.png');
    expect(url.protocol).toBe('http:');
  });

  it('blocks file:// protocol', () => {
    expect(() => validateFetchUrl('file:///etc/passwd')).toThrow('Blocked protocol');
  });

  it('blocks data: protocol', () => {
    expect(() => validateFetchUrl('data:text/plain;base64,SGVsbG8=')).toThrow('Blocked protocol');
  });

  it('blocks ftp: protocol', () => {
    expect(() => validateFetchUrl('ftp://evil.com/file')).toThrow('Blocked protocol');
  });

  it('blocks localhost', () => {
    expect(() => validateFetchUrl('http://localhost/api/secret')).toThrow('Blocked host');
  });

  it('blocks 127.0.0.1', () => {
    expect(() => validateFetchUrl('http://127.0.0.1/admin')).toThrow('Blocked host');
  });

  it('blocks 10.x.x.x (class A private)', () => {
    expect(() => validateFetchUrl('http://10.0.0.1/internal')).toThrow('Blocked host');
  });

  it('blocks 172.16.x.x (class B private)', () => {
    expect(() => validateFetchUrl('http://172.16.0.1/internal')).toThrow('Blocked host');
  });

  it('blocks 192.168.x.x (class C private)', () => {
    expect(() => validateFetchUrl('http://192.168.1.1/router')).toThrow('Blocked host');
  });

  it('blocks AWS metadata endpoint', () => {
    expect(() => validateFetchUrl('http://169.254.169.254/latest/meta-data/')).toThrow('Blocked host');
  });

  it('blocks GCP metadata endpoint', () => {
    expect(() => validateFetchUrl('http://metadata.google.internal/')).toThrow('Blocked host');
  });

  it('allows private IPs when explicitly enabled', () => {
    const url = validateFetchUrl('http://192.168.1.1/', { allowPrivateIps: true });
    expect(url.hostname).toBe('192.168.1.1');
  });

  it('throws on invalid URLs', () => {
    expect(() => validateFetchUrl('not-a-url')).toThrow('Invalid URL');
  });
});

// ── MediaStore ──────────────────────────────────────────────────────────

describe('MediaStore', () => {
  let store: MediaStore;

  beforeEach(() => {
    store = new MediaStore(60); // 60 min TTL
  });

  afterEach(() => {
    store.destroy();
  });

  const mockInfo: MediaInfo = {
    mimeType: 'image/jpeg',
    extension: '.jpg',
    kind: 'image',
    size: 100,
  };

  it('stores and retrieves media', () => {
    const data = Buffer.from('test image data');
    const id = store.store(data, mockInfo);

    const entry = store.get(id);
    expect(entry).not.toBeNull();
    expect(entry!.data.toString()).toBe('test image data');
    expect(entry!.info.mimeType).toBe('image/jpeg');
  });

  it('returns null for non-existent ID', () => {
    expect(store.get('non-existent')).toBeNull();
  });

  it('returns null for expired entries', () => {
    // Create store with 0-minute TTL (instant expiry)
    const shortStore = new MediaStore(0);
    const id = shortStore.store(Buffer.from('data'), mockInfo);

    // Force expiry by waiting
    expect(shortStore.get(id)).toBeNull();
    shortStore.destroy();
  });

  it('tracks size correctly', () => {
    store.store(Buffer.from('abc'), mockInfo);
    store.store(Buffer.from('defgh'), mockInfo);
    expect(store.size).toBe(2);
    expect(store.totalBytes).toBe(8); // 3 + 5
  });

  it('has() checks existence', () => {
    const id = store.store(Buffer.from('data'), mockInfo);
    expect(store.has(id)).toBe(true);
    expect(store.has('nope')).toBe(false);
  });

  it('delete() removes entry', () => {
    const id = store.store(Buffer.from('data'), mockInfo);
    expect(store.delete(id)).toBe(true);
    expect(store.has(id)).toBe(false);
  });

  it('cleanup() removes expired entries', () => {
    const shortStore = new MediaStore(0); // instant expiry
    shortStore.store(Buffer.from('a'), mockInfo);
    shortStore.store(Buffer.from('b'), mockInfo);

    const cleaned = shortStore.cleanup();
    expect(cleaned).toBe(2);
    expect(shortStore.size).toBe(0);
    shortStore.destroy();
  });

  it('destroy() clears everything', () => {
    store.store(Buffer.from('data'), mockInfo);
    store.destroy();
    expect(store.size).toBe(0);
  });
});
