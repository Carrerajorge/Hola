import { z } from 'zod';
import type { ToolDefinition, ToolContext, ToolResult } from '../../agent/toolRegistry';

export function createDemoTools(): ToolDefinition[] {
    const demoActionTool: ToolDefinition = {
        name: 'openclaw_demo_action',
        description: 'A demo tool that takes a string and returns a customized greeting. Used to demonstrate OpenClaw feature introductions.',
        inputSchema: z.object({
            name: z.string().describe('Name to greet'),
            uppercase: z.boolean().optional().describe('Whether to uppercase the greeting'),
        }),
        execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
            try {
                let greeting = `Hello, ${input.name}! Welcome to OpenClaw.`;
                if (input.uppercase) {
                    greeting = greeting.toUpperCase();
                }
                return { success: true, output: greeting };
            } catch (err: any) {
                return {
                    success: false,
                    output: null,
                    error: { code: 'DEMO_ACTION_ERROR', message: err.message, retryable: false },
                };
            }
        },
    };

    return [demoActionTool];
}
