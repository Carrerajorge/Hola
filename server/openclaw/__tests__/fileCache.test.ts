import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileCache } from '../workspace/fileCache';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileCache', () => {
  let tempDir: string;
  let cache: FileCache;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cache-test-'));
    cache = new FileCache();
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('should read and cache file', () => {
    const filePath = join(tempDir, 'test.txt');
    writeFileSync(filePath, 'hello');
    expect(cache.read(filePath)).toBe('hello');
    // Second read should use cache
    expect(cache.read(filePath)).toBe('hello');
  });

  it('should invalidate on mtime change', async () => {
    const filePath = join(tempDir, 'changing.txt');
    writeFileSync(filePath, 'v1');
    expect(cache.read(filePath)).toBe('v1');
    // Wait a tick for mtime to change
    await new Promise(r => setTimeout(r, 50));
    writeFileSync(filePath, 'v2');
    expect(cache.read(filePath)).toBe('v2');
  });

  it('should return null for missing files', () => {
    expect(cache.read(join(tempDir, 'nope.txt'))).toBeNull();
  });

  it('should clear all cached entries', () => {
    const filePath = join(tempDir, 'clear.txt');
    writeFileSync(filePath, 'data');
    cache.read(filePath);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
