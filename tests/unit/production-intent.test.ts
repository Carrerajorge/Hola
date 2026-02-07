import { describe, it, expect } from 'vitest';
import { isProductionIntent } from '../../server/services/productionHandler';

describe('isProductionIntent (search-first guard)', () => {
  it('skips production for singular search request without artifact', () => {
    const intentResult: any = {
      intent: 'CREATE_DOCUMENT',
      confidence: 1,
      slots: { topic: 'x' },
      output_format: 'docx',
      normalized_text: 'x',
    };

    expect(
      isProductionIntent(intentResult, 'puedes buscarme un articulo de la gestion administrativa')
    ).toBe(false);
  });

  it('allows production when search-first includes an artifact request', () => {
    const intentResult: any = {
      intent: 'CREATE_SPREADSHEET',
      confidence: 1,
      slots: { topic: 'x' },
      output_format: 'xlsx',
      normalized_text: 'x',
    };

    expect(
      isProductionIntent(intentResult, 'buscame 10 articulos sobre gestion administrativa y exporta a excel')
    ).toBe(true);
  });
});
