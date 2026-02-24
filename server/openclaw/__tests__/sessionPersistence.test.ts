import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../sessions/persistence';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SessionStore', () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sessions-test-'));
    store = new SessionStore(tempDir);
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('should save and load a session', async () => {
    const session = {
      key: 'agent:default:main:user1' as const,
      agentId: 'default',
      userId: 'user1',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      transcript: [{ role: 'user', content: 'hello' }],
      metadata: {},
    };
    await store.save(session);
    const loaded = await store.load('default', 'agent:default:main:user1');
    expect(loaded).not.toBeNull();
    expect(loaded!.userId).toBe('user1');
    expect(loaded!.transcript).toHaveLength(1);
  });

  it('should return null for non-existent session', async () => {
    const loaded = await store.load('default', 'agent:default:main:nope');
    expect(loaded).toBeNull();
  });

  it('should list sessions for agent', async () => {
    await store.save({
      key: 'agent:default:main:u1' as const,
      agentId: 'default', userId: 'u1',
      createdAt: Date.now(), lastActiveAt: Date.now(),
      transcript: [], metadata: {},
    });
    await store.save({
      key: 'agent:default:main:u2' as const,
      agentId: 'default', userId: 'u2',
      createdAt: Date.now(), lastActiveAt: Date.now(),
      transcript: [], metadata: {},
    });
    const sessions = await store.listForAgent('default');
    expect(sessions).toHaveLength(2);
  });
});
