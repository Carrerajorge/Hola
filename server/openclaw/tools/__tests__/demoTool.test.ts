import { describe, it, expect } from 'vitest';
import { createDemoTools } from '../demoTool';

describe('demoTool', () => {
    const tools = createDemoTools();
    const demoTool = tools.find(t => t.name === 'openclaw_demo_action')!;

    it('should return a basic greeting', async () => {
        const result = await demoTool.execute({ name: 'Ilia' }, {} as any);
        expect(result.success).toBe(true);
        expect(result.output).toBe('Hello, Ilia! Welcome to OpenClaw.');
    });

    it('should return an uppercase greeting', async () => {
        const result = await demoTool.execute({ name: 'Ilia', uppercase: true }, {} as any);
        expect(result.success).toBe(true);
        expect(result.output).toBe('HELLO, ILIA! WELCOME TO OPENCLAW.');
    });
});
