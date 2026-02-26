import type { OpenClawPlugin, HookContext } from '../types';

export function createInternalHooks(): OpenClawPlugin {
  return {
    id: 'internal-hooks',
    version: '1.0.0',
    title: 'Internal Lifecycle Hooks',
    hooks: {
      session_start: async (ctx: HookContext) => {
        // Initialize workspace and session tracking
        console.debug(`[openclaw] Session started: ${ctx.sessionKey ?? 'unknown'}`);
      },

      before_tool_call: async (ctx: HookContext) => {
        // Log tool invocations for auditing
        console.debug(
          `[openclaw] Tool call: ${ctx.toolName ?? 'unknown'}`,
          ctx.toolInput ? JSON.stringify(ctx.toolInput).slice(0, 200) : '',
        );
      },

      after_tool_call: async (ctx: HookContext) => {
        // Track tool results for session memory
        // Could be extended to store in session transcript
      },

      agent_end: async (ctx: HookContext) => {
        // Persist session memory, cleanup
        console.debug(`[openclaw] Agent ended: ${ctx.runId ?? 'unknown'}`);
      },

      error: async (ctx: HookContext) => {
        console.error(
          `[openclaw] Error in session ${ctx.sessionKey ?? 'unknown'}:`,
          ctx.error?.message,
        );
      },
    },
  };
}
