import { describe, it, expect, vi } from 'vitest';

// Mock toolRegistry before importing rpcHandlers
vi.mock('../../agent/toolRegistry', () => {
  const tools = new Map();
  tools.set('openclaw_exec', {
    name: 'openclaw_exec',
    description: 'Execute shell commands',
  });
  tools.set('openclaw_read', {
    name: 'openclaw_read',
    description: 'Read files',
  });
  return {
    ToolRegistry: class {},
    toolRegistry: {
      register: vi.fn(),
      get: vi.fn((name: string) => tools.get(name)),
      list: vi.fn(() => Array.from(tools.values())),
      execute: vi.fn(async () => ({ success: true, output: 'mocked output' })),
    },
  };
});

import { handleRpc } from '../gateway/rpcHandlers';

describe('RPC Handlers', () => {
  it('handles health check', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r1', method: 'health' },
      { userId: 'test' },
    );
    expect(res.ok).toBe(true);
    expect(res.payload.status).toBe('ok');
  });

  it('handles tools.catalog', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r2', method: 'tools.catalog' },
      { userId: 'test' },
    );
    expect(res.ok).toBe(true);
    expect(res.payload).toHaveProperty('tools');
    expect(Array.isArray(res.payload.tools)).toBe(true);
  });

  it('handles tools.invoke', async () => {
    const res = await handleRpc(
      {
        type: 'req',
        id: 'r3',
        method: 'tools.invoke',
        params: { name: 'openclaw_exec', input: { command: 'echo hi' } },
      },
      { userId: 'test' },
    );
    expect(res.ok).toBe(true);
  });

  it('handles skills.list', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r4', method: 'skills.list' },
      { userId: 'test' },
    );
    expect(res.ok).toBe(true);
    expect(res.payload).toHaveProperty('skills');
  });

  it('returns error for unknown methods', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r5', method: 'nonexistent' },
      { userId: 'test' },
    );
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('METHOD_NOT_FOUND');
  });

  it('handles tools.invoke with missing params', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r6', method: 'tools.invoke', params: {} },
      { userId: 'test' },
    );
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_PARAMS');
  });
});
