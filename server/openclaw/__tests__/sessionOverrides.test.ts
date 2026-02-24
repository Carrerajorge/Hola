import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../sessions/persistence';
import { applySessionOverride } from '../sessions/overrides';
import { compactSessions } from '../sessions/compaction';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PersistedSession } from '../types';

describe('applySessionOverride', () => {
  it('should set model override on session', () => {
    const session: PersistedSession = {
      key: 'agent:default:main:u1' as const,
      agentId: 'default', userId: 'u1',
      createdAt: Date.now(), lastActiveAt: Date.now(),
      transcript: [], metadata: {},
    };
    const updated = applySessionOverride(session, { modelOverride: 'gpt-4o' });
    expect(updated.modelOverride).toBe('gpt-4o');
  });

  it('should preserve existing data', () => {
    const session: PersistedSession = {
      key: 'agent:default:main:u1' as const,
      agentId: 'default', userId: 'u1',
      createdAt: 1000, lastActiveAt: 2000,
      transcript: [{ role: 'user', content: 'hi' }], metadata: { foo: 'bar' },
    };
    const updated = applySessionOverride(session, { modelOverride: 'gpt-4o' });
    expect(updated.createdAt).toBe(1000);
    expect(updated.transcript).toHaveLength(1);
    expect(updated.metadata.foo).toBe('bar');
  });
});

describe('compactSessions', () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'compact-test-'));
    store = new SessionStore(tempDir);
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('should remove sessions older than retention period', async () => {
    const oldTime = Date.now() - 60 * 86400000; // 60 days ago
    await store.save({
      key: 'agent:default:main:old' as const,
      agentId: 'default', userId: 'old',
      createdAt: oldTime, lastActiveAt: oldTime,
      transcript: [], metadata: {},
    });
    await store.save({
      key: 'agent:default:main:new' as const,
      agentId: 'default', userId: 'new',
      createdAt: Date.now(), lastActiveAt: Date.now(),
      transcript: [], metadata: {},
    });

    const removed = await compactSessions(store, 'default', 30);
    expect(removed).toBe(1);

    const remaining = await store.listForAgent('default');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe('new');
  });
});
