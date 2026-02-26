import { describe, it, expect, vi } from 'vitest';
import { runWithModelFallback } from '../modelFallback/fallback';

describe('runWithModelFallback', () => {
  it('should succeed on first attempt', async () => {
    const result = await runWithModelFallback({
      candidates: [{ provider: 'openai', model: 'gpt-4o' }],
      execute: async (ref) => `result-from-${ref.provider}`,
      cooldownMs: 60000,
    });
    expect(result.result).toBe('result-from-openai');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].error).toBeUndefined();
  });

  it('should fallback on first failure', async () => {
    let callCount = 0;
    const result = await runWithModelFallback({
      candidates: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'google', model: 'gemini-2.0-flash' },
      ],
      execute: async (ref) => {
        callCount++;
        if (callCount === 1) throw new Error('rate limited');
        return `result-from-${ref.provider}`;
      },
      cooldownMs: 60000,
    });
    expect(result.result).toBe('result-from-google');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].error).toBeDefined();
  });

  it('should throw when all candidates fail', async () => {
    await expect(
      runWithModelFallback({
        candidates: [{ provider: 'openai', model: 'gpt-4o' }],
        execute: async () => { throw new Error('fail'); },
        cooldownMs: 60000,
      })
    ).rejects.toThrow('All model candidates failed');
  });
});
