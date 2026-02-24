import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverPlugins } from '../plugins/pluginFsLoader';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('discoverPlugins', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'plugins-test-'));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('should discover plugin directories', () => {
    const pluginDir = join(tempDir, 'my-plugin');
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, 'index.js'), 'module.exports = { id: "my-plugin" }');

    const discovered = discoverPlugins(tempDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].id).toBe('my-plugin');
    expect(discovered[0].entryPoint).toContain('index.js');
  });

  it('should return empty for empty directory', () => {
    expect(discoverPlugins(tempDir)).toHaveLength(0);
  });

  it('should return empty for non-existent directory', () => {
    expect(discoverPlugins('/tmp/nonexistent-plugins-12345')).toHaveLength(0);
  });

  it('should skip directories without entry point', () => {
    const pluginDir = join(tempDir, 'no-entry');
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, 'readme.md'), 'no code here');

    expect(discoverPlugins(tempDir)).toHaveLength(0);
  });
});
