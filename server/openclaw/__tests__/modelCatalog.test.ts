import { describe, it, expect } from 'vitest';
import { getModelInfo, listModels } from '../modelFallback/catalog';

describe('getModelInfo', () => {
  it('should return info for known model', () => {
    const info = getModelInfo('claude-opus-4-6');
    expect(info).toBeDefined();
    expect(info!.contextWindow).toBeGreaterThan(0);
    expect(info!.provider).toBe('anthropic');
  });

  it('should return null for unknown model', () => {
    expect(getModelInfo('nonexistent-model')).toBeNull();
  });
});

describe('listModels', () => {
  it('should return all models', () => {
    const models = listModels();
    expect(models.length).toBeGreaterThan(5);
  });

  it('should filter by provider', () => {
    const models = listModels({ provider: 'anthropic' });
    expect(models.every(m => m.provider === 'anthropic')).toBe(true);
  });

  it('should filter by capability', () => {
    const models = listModels({ capability: 'vision' });
    expect(models.every(m => m.capabilities.includes('vision'))).toBe(true);
  });
});
