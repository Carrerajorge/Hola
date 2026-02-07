import { describe, it, expect } from 'vitest';
import { requiresSearchFirst, wantsArtifactOutput } from '../server/services/productionRouting';

describe("productionRouting", () => {
  it("detects 'buscarme un articulo' as search-first", () => {
    const msg = "puedes buscarme un articulo de la gestion administrativa";
    expect(requiresSearchFirst(msg)).toBe(true);
  });

  it("does not treat plain search as artifact output", () => {
    const msg = "puedes buscarme un articulo de la gestion administrativa";
    expect(wantsArtifactOutput(msg)).toBe(false);
  });

  it("allows production when search-first but artifact is requested", () => {
    const msg = "buscame 10 articulos cientificos sobre gestion administrativa y exporta a excel";
    expect(requiresSearchFirst(msg)).toBe(true);
    expect(wantsArtifactOutput(msg)).toBe(true);
  });

  it("detects presentation requests as artifact output", () => {
    const msg = "haz una presentacion ppt sobre gestion administrativa";
    expect(requiresSearchFirst(msg)).toBe(false);
    expect(wantsArtifactOutput(msg)).toBe(true);
  });
});
