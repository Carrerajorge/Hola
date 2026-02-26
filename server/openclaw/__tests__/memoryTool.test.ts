import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

vi.mock('../../lib/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createMemoryTool } from '../tools/memoryTool';

describe('Memory Tool', () => {
  const tool = createMemoryTool();
  const testDir = `/tmp/openclaw-memory-test-${Date.now()}`;
  const ctx = { userId: 'user-mem', chatId: 'chat-1', runId: 'run-1' };

  beforeEach(async () => {
    process.env.OPENCLAW_MEMORY_DIR = testDir;
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.OPENCLAW_MEMORY_DIR;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });

  it('saves and retrieves a memory', async () => {
    const saveResult = await tool.execute(
      { action: 'save', key: 'test/greeting', content: 'Hello World' },
      ctx as any,
    );
    expect(saveResult.success).toBe(true);
    expect((saveResult.output as any).key).toBe('test/greeting');

    const getResult = await tool.execute(
      { action: 'get', key: 'test/greeting' },
      ctx as any,
    );
    expect(getResult.success).toBe(true);
    expect((getResult.output as any).content).toBe('Hello World');
  });

  it('lists all memory keys', async () => {
    await tool.execute(
      { action: 'save', key: 'a', content: 'Memory A' },
      ctx as any,
    );
    await tool.execute(
      { action: 'save', key: 'b', content: 'Memory B' },
      ctx as any,
    );

    const listResult = await tool.execute({ action: 'list' }, ctx as any);
    expect(listResult.success).toBe(true);
    const keys = (listResult.output as any).keys;
    expect(keys).toContain('a');
    expect(keys).toContain('b');
  });

  it('searches memories by keyword', async () => {
    await tool.execute(
      { action: 'save', key: 'auth/login', content: 'Login uses JWT tokens with refresh rotation' },
      ctx as any,
    );
    await tool.execute(
      { action: 'save', key: 'auth/register', content: 'Registration requires email verification' },
      ctx as any,
    );
    await tool.execute(
      { action: 'save', key: 'data/schema', content: 'Database uses PostgreSQL with Drizzle ORM' },
      ctx as any,
    );

    const searchResult = await tool.execute(
      { action: 'search', query: 'JWT tokens' },
      ctx as any,
    );
    expect(searchResult.success).toBe(true);
    const results = searchResult.output as any[];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].key).toBe('auth/login');
  });

  it('deletes a memory', async () => {
    await tool.execute(
      { action: 'save', key: 'deleteme', content: 'Temporary' },
      ctx as any,
    );

    const deleteResult = await tool.execute(
      { action: 'delete', key: 'deleteme' },
      ctx as any,
    );
    expect(deleteResult.success).toBe(true);

    const getResult = await tool.execute(
      { action: 'get', key: 'deleteme' },
      ctx as any,
    );
    expect(getResult.success).toBe(false);
    expect(getResult.error?.code).toBe('NOT_FOUND');
  });

  it('fails when saving without key', async () => {
    const result = await tool.execute(
      { action: 'save', content: 'No key' },
      ctx as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_KEY');
  });

  it('fails when saving without content', async () => {
    const result = await tool.execute(
      { action: 'save', key: 'no-content' },
      ctx as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_CONTENT');
  });

  it('fails when getting non-existent memory', async () => {
    const result = await tool.execute(
      { action: 'get', key: 'nonexistent' },
      ctx as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('handles nested key paths', async () => {
    await tool.execute(
      { action: 'save', key: 'project/auth/oauth/google', content: 'Google OAuth config' },
      ctx as any,
    );

    const getResult = await tool.execute(
      { action: 'get', key: 'project/auth/oauth/google' },
      ctx as any,
    );
    expect(getResult.success).toBe(true);
    expect((getResult.output as any).content).toBe('Google OAuth config');
  });

  it('sanitizes keys to prevent path traversal', async () => {
    await tool.execute(
      { action: 'save', key: '../../etc/passwd', content: 'Sneaky' },
      ctx as any,
    );

    // The key should be sanitized
    const listResult = await tool.execute({ action: 'list' }, ctx as any);
    const keys = (listResult.output as any).keys as string[];
    // Should not contain path traversal
    for (const key of keys) {
      expect(key).not.toContain('..');
    }
  });

  it('isolates memory between users', async () => {
    await tool.execute(
      { action: 'save', key: 'secret', content: 'User A secret' },
      { userId: 'user-a', chatId: '', runId: '' } as any,
    );

    const result = await tool.execute(
      { action: 'get', key: 'secret' },
      { userId: 'user-b', chatId: '', runId: '' } as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });
});
