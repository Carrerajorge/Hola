import { describe, it, expect, vi } from 'vitest';
import {
    classifyError,
    truncateToolResult,
    EnhancedExecutor,
} from '../enhancedExecutor';
import type { ExecutorConfig } from '../enhancedExecutor';

describe('classifyError', () => {
    it('classifies context overflow', () => {
        expect(classifyError(new Error('context length exceeded'))).toBe('context_overflow');
        expect(classifyError(new Error('maximum token limit'))).toBe('context_overflow');
    });

    it('classifies auth errors', () => {
        expect(classifyError(new Error('Invalid API key'))).toBe('auth_error');
        expect(classifyError(new Error('401 Unauthorized'))).toBe('auth_error');
    });

    it('classifies rate limits', () => {
        expect(classifyError(new Error('Rate limit exceeded'))).toBe('rate_limit');
        expect(classifyError(new Error('429 Too Many Requests'))).toBe('rate_limit');
        expect(classifyError(new Error('quota exceeded'))).toBe('rate_limit');
    });

    it('classifies timeouts', () => {
        expect(classifyError(new Error('Request timed out'))).toBe('timeout');
        expect(classifyError(new Error('ETIMEDOUT'))).toBe('timeout');
    });

    it('classifies unknown as model_error', () => {
        expect(classifyError(new Error('Something weird happened'))).toBe('model_error');
    });

    it('handles non-Error values', () => {
        expect(classifyError('rate limit')).toBe('rate_limit');
        expect(classifyError(42)).toBe('model_error');
    });
});

describe('truncateToolResult', () => {
    it('returns short result unchanged', () => {
        expect(truncateToolResult('hello', 100)).toBe('hello');
    });

    it('truncates long result', () => {
        const long = 'x'.repeat(200);
        const result = truncateToolResult(long, 50);
        expect(result.length).toBeLessThan(200);
        expect(result).toContain('[truncated');
    });
});

describe('EnhancedExecutor', () => {
    it('returns result on first successful attempt', async () => {
        const executor = new EnhancedExecutor();
        const config: ExecutorConfig = {
            models: ['grok-3'],
            maxRetriesPerModel: 3,
            timeoutMs: 5000,
            maxToolResultChars: 10000,
        };

        const result = await executor.execute(
            async (model) => `Response from ${model}`,
            config,
        );

        expect(result.success).toBe(true);
        expect(result.output).toBe('Response from grok-3');
        expect(result.modelUsed).toBe('grok-3');
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0].retryCount).toBe(0);
    });

    it('retries on transient error and succeeds', async () => {
        const executor = new EnhancedExecutor();
        let callCount = 0;

        const result = await executor.execute(
            async (model) => {
                callCount++;
                if (callCount < 3) throw new Error('timeout reached');
                return 'success';
            },
            { models: ['grok-3'], maxRetriesPerModel: 5, timeoutMs: 5000, maxToolResultChars: 10000 },
        );

        expect(result.success).toBe(true);
        expect(result.output).toBe('success');
        expect(result.attempts.length).toBeGreaterThanOrEqual(3);
    });

    it('fails over to next model after auth error', async () => {
        const executor = new EnhancedExecutor();

        const result = await executor.execute(
            async (model) => {
                if (model === 'grok-3') throw new Error('Invalid API key');
                return `Response from ${model}`;
            },
            { models: ['grok-3', 'gemini-2.0'], maxRetriesPerModel: 2, timeoutMs: 5000, maxToolResultChars: 10000 },
        );

        expect(result.success).toBe(true);
        expect(result.modelUsed).toBe('gemini-2.0');
    });

    it('fails over to next model after rate limit', async () => {
        const executor = new EnhancedExecutor();

        const result = await executor.execute(
            async (model) => {
                if (model === 'primary') throw new Error('429 rate limit');
                return 'ok';
            },
            { models: ['primary', 'fallback'], maxRetriesPerModel: 1, timeoutMs: 5000, maxToolResultChars: 10000 },
        );

        expect(result.success).toBe(true);
        expect(result.modelUsed).toBe('fallback');
    });

    it('returns failure when all models exhausted', async () => {
        const executor = new EnhancedExecutor();

        const result = await executor.execute(
            async () => { throw new Error('always fails'); },
            { models: ['m1', 'm2'], maxRetriesPerModel: 1, timeoutMs: 5000, maxToolResultChars: 10000 },
        );

        expect(result.success).toBe(false);
        expect(result.output).toBe('');
        expect(result.attempts.length).toBeGreaterThan(0);
    });

    it('calls onAttempt callback for each attempt', async () => {
        const executor = new EnhancedExecutor();
        const attempts: any[] = [];

        await executor.execute(
            async () => 'ok',
            {
                models: ['grok-3'],
                maxRetriesPerModel: 3,
                timeoutMs: 5000,
                maxToolResultChars: 10000,
                onAttempt: (a) => attempts.push(a),
            },
        );

        expect(attempts).toHaveLength(1);
        expect(attempts[0].model).toBe('grok-3');
    });

    it('respects abort signal', async () => {
        const executor = new EnhancedExecutor();
        const controller = new AbortController();
        controller.abort();

        const result = await executor.execute(
            async () => 'should not reach',
            { models: ['grok-3'], maxRetriesPerModel: 3, timeoutMs: 5000, maxToolResultChars: 10000 },
            controller.signal,
        );

        expect(result.success).toBe(false);
        expect(result.attempts.some(a => a.error?.kind === 'timeout')).toBe(true);
    });

    it('tracks usage across attempts', async () => {
        const executor = new EnhancedExecutor();

        const result = await executor.execute(
            async () => 'ok',
            { models: ['grok-3'], maxRetriesPerModel: 1, timeoutMs: 5000, maxToolResultChars: 10000 },
        );

        expect(result.totalUsage).toBeDefined();
        expect(result.totalUsage.total).toBe(0); // no real usage in mock
    });
});
