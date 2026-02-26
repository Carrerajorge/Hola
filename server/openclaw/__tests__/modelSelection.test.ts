import { describe, it, expect } from 'vitest';
import { parseModelRef, resolveModelAlias, normalizeModelRef } from '../modelFallback/selection';

describe('parseModelRef', () => {
  it('should parse provider/model format', () => {
    const ref = parseModelRef('openai/gpt-4o');
    expect(ref.provider).toBe('openai');
    expect(ref.model).toBe('gpt-4o');
  });
  it('should default provider to auto for bare model name', () => {
    const ref = parseModelRef('gpt-4o');
    expect(ref.provider).toBe('auto');
    expect(ref.model).toBe('gpt-4o');
  });
});

describe('resolveModelAlias', () => {
  it('should resolve "best" to most capable model', () => {
    const ref = resolveModelAlias('best');
    expect(ref.provider).toBeDefined();
    expect(ref.model).toBeDefined();
  });
  it('should resolve "fast" to cheapest model', () => {
    const ref = resolveModelAlias('fast');
    expect(ref).toBeDefined();
  });
  it('should pass through non-alias models', () => {
    const ref = resolveModelAlias('openai/gpt-4o');
    expect(ref.provider).toBe('openai');
    expect(ref.model).toBe('gpt-4o');
  });
});

describe('normalizeModelRef', () => {
  it('should normalize claude model names', () => {
    const ref = normalizeModelRef('opus-4.6');
    expect(ref.model).toBe('claude-opus-4-6');
  });
  it('should normalize gemini model names', () => {
    const ref = normalizeModelRef('gemini-2.5-pro');
    expect(ref.model).toContain('gemini');
  });
});
