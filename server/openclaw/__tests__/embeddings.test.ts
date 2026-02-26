import { describe, it, expect, vi } from 'vitest';
import { createEmbeddingProvider, sanitizeAndNormalizeEmbedding } from '../memory/embeddings';

describe('sanitizeAndNormalizeEmbedding', () => {
  it('should normalize to unit vector', () => {
    const vec = sanitizeAndNormalizeEmbedding([3, 4]);
    expect(vec[0]).toBeCloseTo(0.6);
    expect(vec[1]).toBeCloseTo(0.8);
  });

  it('should replace NaN/Infinity with 0', () => {
    const vec = sanitizeAndNormalizeEmbedding([NaN, Infinity, 3, 4]);
    expect(vec[0]).toBe(0);
    expect(vec[1]).toBe(0);
  });

  it('should handle zero vector', () => {
    const vec = sanitizeAndNormalizeEmbedding([0, 0, 0]);
    expect(vec).toEqual([0, 0, 0]);
  });
});

describe('createEmbeddingProvider', () => {
  it('should create gemini provider when API key exists', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = await createEmbeddingProvider({
      provider: 'gemini',
      model: 'text-embedding-004',
    });
    expect(provider).not.toBeNull();
    expect(provider!.dimensions).toBeGreaterThan(0);
  });

  it('should return null when no API key available', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const provider = await createEmbeddingProvider({
      provider: 'gemini',
      model: 'text-embedding-004',
    });
    expect(provider).toBeNull();
  });
});
