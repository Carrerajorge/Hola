import { describe, it, expect } from 'vitest';
import { ProductionPipeline } from '../../server/agent/production/productionPipeline';

// Access the private method via casting for unit verification.
describe('ProductionPipeline.inferDesiredSourcesCount', () => {
  it('extracts desired count from Spanish/English patterns and clamps to 50', () => {
    const p: any = new ProductionPipeline({
      id: 'x',
      createdAt: new Date(),
      userId: 'u',
      intent: 'report',
      topic: 'x',
      audience: 'general',
      deliverables: ['excel'],
      tone: 'formal',
      citationStyle: 'none',
      sourcePolicy: 'web',
      constraints: { language: 'es', corporateStyle: false },
      budget: { maxLLMCalls: 50, maxSearchQueries: 20, maxRetries: 3, timeoutMinutes: 10 },
      status: 'pending',
      currentStage: 0,
      totalStages: 10,
    } as any);

    expect(p.inferDesiredSourcesCount('Busca 50 artículos científicos sobre X')).toBe(50);
    expect(p.inferDesiredSourcesCount('find 42 papers about Y')).toBe(42);
    expect(p.inferDesiredSourcesCount('dame 500 fuentes')).toBe(50);
    expect(p.inferDesiredSourcesCount('sin numero')).toBe(null);
  });
});
