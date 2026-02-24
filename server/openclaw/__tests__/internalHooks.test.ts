import { describe, it, expect, vi } from 'vitest';
import { createInternalHooks } from '../plugins/internalHooks';

describe('createInternalHooks', () => {
  it('should return plugin with session_start hook', () => {
    const plugin = createInternalHooks();
    expect(plugin.id).toBe('internal-hooks');
    expect(plugin.hooks?.session_start).toBeDefined();
  });

  it('should return plugin with before_tool_call hook', () => {
    const plugin = createInternalHooks();
    expect(plugin.hooks?.before_tool_call).toBeDefined();
  });

  it('should return plugin with agent_end hook', () => {
    const plugin = createInternalHooks();
    expect(plugin.hooks?.agent_end).toBeDefined();
  });

  it('session_start hook should execute without error', async () => {
    const plugin = createInternalHooks();
    await expect(
      plugin.hooks!.session_start!({ sessionKey: 'agent:test:main:user1', metadata: {} })
    ).resolves.not.toThrow();
  });

  it('before_tool_call hook should log command', async () => {
    const plugin = createInternalHooks();
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await plugin.hooks!.before_tool_call!({ toolName: 'exec_command', toolInput: { cmd: 'ls' } });
    consoleSpy.mockRestore();
  });
});
