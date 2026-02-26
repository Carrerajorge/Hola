/**
 * Hook/Lifecycle System
 *
 * Event-driven lifecycle hooks for agent execution. Ported from
 * OpenClaw's hook system (hooks/types.ts, plugins/hook-runner-global.ts),
 * adapted for ILIAGPT's architecture.
 */

export type HookEvent =
    | 'before_route'
    | 'before_agent_start'
    | 'before_tool_call'
    | 'after_tool_call'
    | 'after_agent_complete';

export interface HookContext {
    event: HookEvent;
    agentId: string;
    sessionKey: string;
    userId: string;
    data: Record<string, unknown>;
}

export interface HookResult {
    modified: boolean;
    overrides?: Record<string, unknown>;
    abort?: boolean;
    abortReason?: string;
}

export type HookHandler = (context: HookContext) => Promise<HookResult>;

export interface RegisteredHook {
    id: string;
    name: string;
    event: HookEvent;
    priority: number;
    handler: HookHandler;
    enabled: boolean;
}

export class HookSystem {
    private hooks: Map<string, RegisteredHook> = new Map();

    register(hook: RegisteredHook): void {
        this.hooks.set(hook.id, hook);
    }

    unregister(hookId: string): void {
        this.hooks.delete(hookId);
    }

    getHooksForEvent(event: HookEvent): RegisteredHook[] {
        return [...this.hooks.values()]
            .filter(h => h.event === event && h.enabled)
            .sort((a, b) => a.priority - b.priority);
    }

    async emit(context: HookContext): Promise<HookResult> {
        const hooks = this.getHooksForEvent(context.event);
        let mergedOverrides: Record<string, unknown> = {};
        let anyModified = false;

        for (const hook of hooks) {
            const result = await hook.handler(context);

            if (result.abort) {
                return {
                    modified: anyModified,
                    overrides: Object.keys(mergedOverrides).length > 0 ? mergedOverrides : undefined,
                    abort: true,
                    abortReason: result.abortReason,
                };
            }

            if (result.modified && result.overrides) {
                mergedOverrides = { ...mergedOverrides, ...result.overrides };
                anyModified = true;
            }
        }

        return {
            modified: anyModified,
            overrides: Object.keys(mergedOverrides).length > 0 ? mergedOverrides : undefined,
        };
    }

    clear(): void {
        this.hooks.clear();
    }
}

export const hookSystem = new HookSystem();
