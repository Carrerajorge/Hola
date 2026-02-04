import { describe, it, expect, beforeEach, vi } from 'vitest';
import { academicSearchFallback } from '../../server/integrations/academicSearch';

// Minimal fetch mocking without external libs.
function mockFetchOnce(json: any, ok = true, status = 200) {
  (globalThis as any).fetch = vi.fn(async () => {
    return {
      ok,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as any;
  });
}

describe('academicSearchFallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns normalized EvidenceSource[] from Semantic Scholar / Crossref responses', async () => {
    const ss = {
      data: [
        {
          title: 'Paper A',
          url: 'https://www.semanticscholar.org/paper/abc',
          year: 2023,
          venue: 'TestConf',
          authors: [{ name: 'Alice' }, { name: 'Bob' }],
          externalIds: { DOI: '10.1000/xyz123' },
          abstract: 'This is an abstract.',
        },
      ],
    };
    const cr = {
      message: {
        items: [
          {
            DOI: '10.1000/xyz123',
            title: ['Paper A'],
            URL: 'https://doi.org/10.1000/xyz123',
            author: [{ given: 'Alice', family: 'Smith' }],
            issued: { 'date-parts': [[2023, 1, 1]] },
            'container-title': ['TestConf'],
          },
        ],
      },
    };

    // fetch is called twice in parallel; implement a simple sequential mock.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ss, text: async () => JSON.stringify(ss) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => cr, text: async () => JSON.stringify(cr) });
    (globalThis as any).fetch = fetchMock;

    const out = await academicSearchFallback({ query: 'test', maxSources: 10 });
    expect(out.length).toBeGreaterThan(0);

    const first = out[0];
    expect(first.type).toBe('web');
    expect(first.title).toBeTruthy();
    expect(first.content).toContain('Título:');
    expect(first.reliability).toBeGreaterThan(0.5);
    expect(first.retrievedAt).toBeInstanceOf(Date);

    // De-dupe should collapse same DOI/title
    const keys = new Set(out.map(s => (s.url || s.title).toLowerCase()));
    expect(keys.size).toBe(out.length);
  });

  it('returns [] for empty query', async () => {
    mockFetchOnce({});
    const out = await academicSearchFallback({ query: '   ', maxSources: 10 });
    expect(out).toEqual([]);
  });
});
