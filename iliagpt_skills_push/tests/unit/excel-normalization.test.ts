import { describe, it, expect } from 'vitest';

// We test the production pipeline normalization indirectly by importing the class via a lightweight require
// and calling the private method through bracket access (JS runtime allows it).
// This keeps the fix tightly scoped to the production Excel crash.

import { ProductionPipeline } from '../../server/agent/production/productionPipeline';

function makePipeline(): any {
  const workOrder: any = {
    id: 'wo_test',
    topic: 'Test topic',
    deliverables: [],
    budget: { timeoutMinutes: 1, maxSearchQueries: 5 },
    constraints: { maxSlides: 10 },
    metadata: {},
    tone: 'neutral',
    citationStyle: 'apa',
    sourcePolicy: 'web',
  };
  return new ProductionPipeline(workOrder);
}

describe('ProductionPipeline.normalizeExcelData', () => {
  it('never returns null/undefined (null input)', () => {
    const p = makePipeline();
    const out = p['normalizeExcelData'](null, [], { fixedSchema: 'articles_v1' });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(Array.isArray(out[0])).toBe(true);
  });

  it('sanitizes 2D arrays by replacing null cells', () => {
    const p = makePipeline();
    const out = p['normalizeExcelData']([["A", null], [null, 2]], [], {});
    expect(out).toEqual([["A", ""], ["", 2]]);
  });

  it('coerces array-of-objects into header+rows', () => {
    const p = makePipeline();
    const out = p['normalizeExcelData']([{ a: 1, b: 2 }, { a: 3, c: 4 }], [], {});
    expect(out[0]).toContain('a');
    expect(out[0]).toContain('b');
    expect(out[0]).toContain('c');
    expect(out.length).toBe(3);
  });

  it('builds fixed articles schema from sources when requested', () => {
    const p = makePipeline();
    const out = p['normalizeExcelData']([], [{ title: 'Paper 1', url: 'https://x', year: 2024 }], { fixedSchema: 'articles_v1' });
    expect(out[0]).toEqual(['Título', 'Autores', 'Año', 'Revista/Conferencia', 'DOI', 'URL', 'Resumen', 'Cita']);
    expect(out.length).toBe(2);
    expect(out[1][0]).toBe('Paper 1');
    expect(out[1][5]).toBe('https://x');
  });
});
