import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceManager } from '../workspace/manager';
import { loadBootstrapFiles } from '../workspace/bootstrap';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('WorkspaceManager', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'ws-test-'));
  });
  afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

  it('should ensure workspace directory exists', () => {
    const mgr = new WorkspaceManager(baseDir);
    const wsDir = mgr.ensureWorkspace('agent1');
    expect(existsSync(wsDir)).toBe(true);
  });

  it('should return consistent path for same agent', () => {
    const mgr = new WorkspaceManager(baseDir);
    const dir1 = mgr.ensureWorkspace('agent1');
    const dir2 = mgr.ensureWorkspace('agent1');
    expect(dir1).toBe(dir2);
  });

  it('should list workspaces', () => {
    const mgr = new WorkspaceManager(baseDir);
    mgr.ensureWorkspace('a1');
    mgr.ensureWorkspace('a2');
    expect(mgr.listWorkspaces()).toContain('a1');
    expect(mgr.listWorkspaces()).toContain('a2');
  });
});

describe('loadBootstrapFiles', () => {
  let wsDir: string;

  beforeEach(() => {
    wsDir = mkdtempSync(join(tmpdir(), 'bootstrap-test-'));
  });
  afterEach(() => rmSync(wsDir, { recursive: true, force: true }));

  it('should load existing bootstrap files', () => {
    writeFileSync(join(wsDir, 'SOUL.md'), 'You are a helpful assistant.');
    const files = loadBootstrapFiles(wsDir);
    const soul = files.find(f => f.name === 'SOUL.md');
    expect(soul).toBeDefined();
    expect(soul!.content).toBe('You are a helpful assistant.');
    expect(soul!.missing).toBe(false);
  });

  it('should mark missing files', () => {
    const files = loadBootstrapFiles(wsDir);
    expect(files.every(f => f.missing)).toBe(true);
    expect(files.every(f => f.content === null)).toBe(true);
  });
});
