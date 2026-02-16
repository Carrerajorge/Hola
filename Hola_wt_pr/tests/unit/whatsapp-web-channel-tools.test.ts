import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../../server/agent/toolRegistry';

describe('toolRegistry WhatsApp channel gating', () => {
  it('blocks non-allowlisted tools for whatsapp_web channel', async () => {
    const ctx: any = { userId: 'u', chatId: 'c', runId: 'r', channel: 'whatsapp_web' };

    const res1 = await toolRegistry.execute('file', { operation: 'list', path: '.' }, ctx);
    expect(res1.success).toBe(false);
    expect(res1.error?.code).toBe('ACCESS_DENIED');

    const res2 = await toolRegistry.execute('write_file', { path: '/tmp/x', content: 'hi' }, ctx);
    expect(res2.success).toBe(false);
    expect(res2.error?.code).toBe('ACCESS_DENIED');
  });
});

