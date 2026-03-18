import { getGlobalHookRunner } from "../../services/superIntelligence/plugins/hook-runner-global.js";

export type HookPoint = "before_tool_call" | "after_tool_call" | "agent_end";

export type HookContext = {
  runId?: string;
  userId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
};

export type HookHandler = (ctx: HookContext) => Promise<void> | void;

export class HookSystem {
  private hooks = new Map<HookPoint, HookHandler[]>();

  register(point: HookPoint, handler: HookHandler): void {
    const handlers = this.hooks.get(point) || [];
    handlers.push(handler);
    this.hooks.set(point, handlers);
  }

  unregister(point: HookPoint, handler: HookHandler): void {
    const handlers = this.hooks.get(point);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  }

  async dispatch(point: HookPoint, ctx: Partial<HookContext>): Promise<void> {
    const handlers = this.hooks.get(point) || [];
    for (const handler of handlers) {
      try {
        await handler(ctx);
      } catch (error: any) {
        console.error(`[OpenClaw:Hooks] ${point} handler error: ${error?.message || String(error)}`);
      }
    }

    const runner = getGlobalHookRunner();
    if (!runner?.hasHooks(point)) {
      return;
    }

    try {
      if (point === "before_tool_call") {
        await runner.runBeforeToolCall(
          {
            toolName: ctx.toolName || "unknown",
            params: ctx.toolInput || {},
          },
          {
            agentId: ctx.userId,
            sessionKey: ctx.runId,
            toolName: ctx.toolName || "unknown",
          },
        );
        return;
      }

      if (point === "after_tool_call") {
        await runner.runAfterToolCall(
          {
            toolName: ctx.toolName || "unknown",
            params: ctx.toolInput || {},
            result: ctx.toolResult,
          },
          {
            agentId: ctx.userId,
            sessionKey: ctx.runId,
            toolName: ctx.toolName || "unknown",
          },
        );
        return;
      }

      await runner.runAgentEnd(
        {
          messages: [],
          success: true,
        },
        {
          agentId: ctx.userId,
          sessionKey: ctx.runId,
        },
      );
    } catch (error: any) {
      console.error(`[OpenClaw:Hooks] ${point} bridge error: ${error?.message || String(error)}`);
    }
  }

  getRegisteredPoints(): HookPoint[] {
    return Array.from(this.hooks.keys());
  }

  getHandlerCount(point: HookPoint): number {
    return this.hooks.get(point)?.length ?? 0;
  }

  clear(): void {
    this.hooks.clear();
  }
}

export const hookSystem = new HookSystem();
