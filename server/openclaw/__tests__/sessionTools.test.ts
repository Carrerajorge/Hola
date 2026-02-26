import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../events', () => ({
  openclawEventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

// Raise concurrent limit for tests
process.env.OPENCLAW_MAX_CONCURRENT_SUBAGENTS = '50';

vi.mock('../../services/agentRunner', () => ({
  AgentRunner: class MockAgentRunner {
    on = vi.fn();
    cancel = vi.fn();
    run = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        success: true, result: 'done', state: { status: 'completed', history: [], toolsUsed: [] }, run_id: 'r',
      }), 100)),
    );
  },
}));

vi.mock('../persistence/statePersistence', () => ({
  getStatePersistence: vi.fn().mockReturnValue({
    saveRun: vi.fn().mockResolvedValue(undefined),
    getRun: vi.fn().mockResolvedValue(null),
    listRuns: vi.fn().mockResolvedValue([]),
    updateRunStatus: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../plugins/hookSystem', () => ({
  hookSystem: { dispatch: vi.fn().mockResolvedValue(undefined), register: vi.fn(), clear: vi.fn() },
}));

vi.mock('../../lib/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createSession,
  getSession,
  listSessions,
  addMessageToSession,
  createSessionTools,
  _clearAllSessions,
} from '../tools/sessionTools';

describe('Session Tools', () => {
  beforeEach(() => {
    _clearAllSessions();
  });

  it('creates a session with a unique key', () => {
    const session = createSession('user-1');
    expect(session.key).toMatch(/^session_/);
    expect(session.userId).toBe('user-1');
    expect(session.status).toBe('active');
  });

  it('retrieves a session by key', () => {
    const created = createSession('user-1');
    const retrieved = getSession(created.key);
    expect(retrieved).toBeDefined();
    expect(retrieved!.key).toBe(created.key);
  });

  it('lists sessions for a user', () => {
    createSession('user-a');
    createSession('user-a');
    createSession('user-b');

    const userA = listSessions('user-a');
    expect(userA.length).toBe(2);
    expect(userA.every(s => s.userId === 'user-a')).toBe(true);
  });

  it('filters sessions by status', () => {
    const s1 = createSession('user-x');
    createSession('user-x');

    // Manually set one to archived
    s1.status = 'archived';

    const active = listSessions('user-x', { status: 'active' });
    expect(active.length).toBe(1);

    const archived = listSessions('user-x', { status: 'archived' });
    expect(archived.length).toBe(1);
  });

  it('adds messages to a session', () => {
    const session = createSession('user-msg');
    addMessageToSession(session.key, 'user', 'Hello');
    addMessageToSession(session.key, 'assistant', 'Hi there');

    const updated = getSession(session.key)!;
    expect(updated.messageCount).toBe(2);
    expect(updated.history.length).toBe(2);
    expect(updated.history[0].role).toBe('user');
    expect(updated.history[1].content).toBe('Hi there');
  });

  it('caps history at 200 messages', () => {
    const session = createSession('user-cap');
    for (let i = 0; i < 210; i++) {
      addMessageToSession(session.key, 'user', `Message ${i}`);
    }
    const updated = getSession(session.key)!;
    expect(updated.history.length).toBe(200);
    expect(updated.messageCount).toBe(210);
  });

  it('returns false when adding to non-existent session', () => {
    expect(addMessageToSession('nonexistent', 'user', 'test')).toBe(false);
  });

  describe('Tool Definitions', () => {
    const tools = createSessionTools();

    it('creates 4 session tools', () => {
      expect(tools.length).toBe(4);
      const names = tools.map(t => t.name);
      expect(names).toContain('openclaw_sessions_list');
      expect(names).toContain('openclaw_sessions_spawn');
      expect(names).toContain('openclaw_sessions_send');
      expect(names).toContain('openclaw_sessions_history');
    });

    it('list tool returns user sessions', async () => {
      createSession('user-tool');
      createSession('user-tool');

      const listTool = tools.find(t => t.name === 'openclaw_sessions_list')!;
      const result = await listTool.execute({}, { userId: 'user-tool', chatId: '', runId: '' } as any);
      expect(result.success).toBe(true);
      expect((result.output as any[]).length).toBe(2);
    });

    it('send tool delivers to existing session', async () => {
      const session = createSession('user-send');
      const sendTool = tools.find(t => t.name === 'openclaw_sessions_send')!;

      const result = await sendTool.execute(
        { sessionKey: session.key, message: 'Hello agent' },
        { userId: 'user-send', chatId: '', runId: '' } as any,
      );

      expect(result.success).toBe(true);
      expect(getSession(session.key)!.messageCount).toBe(1);
    });

    it('send tool rejects messages to other users sessions', async () => {
      const session = createSession('other-user');
      const sendTool = tools.find(t => t.name === 'openclaw_sessions_send')!;

      const result = await sendTool.execute(
        { sessionKey: session.key, message: 'Sneaky' },
        { userId: 'attacker', chatId: '', runId: '' } as any,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('history tool returns session messages', async () => {
      const session = createSession('user-hist');
      addMessageToSession(session.key, 'user', 'First');
      addMessageToSession(session.key, 'assistant', 'Second');

      const histTool = tools.find(t => t.name === 'openclaw_sessions_history')!;
      const result = await histTool.execute(
        { sessionKey: session.key },
        { userId: 'user-hist', chatId: '', runId: '' } as any,
      );

      expect(result.success).toBe(true);
      expect((result.output as any).messages.length).toBe(2);
    });
  });
});
