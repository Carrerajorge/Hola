/**
 * Production Routing Helpers
 *
 * Keep this module dependency-free so it can be unit-tested without
 * bootstrapping the whole server (DB, storage, etc).
 */

// Patterns that indicate user wants to SEARCH first, not just create a document
const SEARCH_FIRST_PATTERNS: RegExp[] = [
    // "buscame X articulos/papers"
    /buscame\s+\d+\s*(art[ií]culos?|papers?|estudios?|investigacion)/i,
    /buscarme\s+\d+\s*(art[ií]culos?|papers?|estudios?|investigacion)/i,
    /busca\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /buscar\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /encontrar\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /dame\s+\d+\s*(art[ií]culos?|papers?|estudios?|citas?)/i,
    /necesito\s+\d+\s*(art[ií]culos?|papers?|estudios?|referencias?)/i,

    // Singular: "buscarme un artículo/paper/estudio"
    /buscame\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /buscarme\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /busca\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /buscar\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /encuentra(?:me)?\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /dame\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /necesito\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,

    // "articulos cientificos de/sobre"
    /art[ií]culos?\s+cient[ií]ficos?\s+(de|sobre|en|d)\s*/i,
    /busca.*art[ií]culos?\s+cient[ií]ficos?/i,
    /buscame.*art[ií]culos?\s+cient[ií]ficos?/i,

    // Explicit search requests
    /buscar?\s*(art[ií]culos?\s+)?cient[ií]ficos?\s+sobre/i,
    /scholar\s+search/i,
    /google\s+scholar/i,
    /scopus/i,
    /pubmed/i,
    /scielo/i,
];

export function requiresSearchFirst(message: string): boolean {
    return SEARCH_FIRST_PATTERNS.some(pattern => pattern.test(message));
}

export function wantsArtifactOutput(message: string): boolean {
    // If user mentions any concrete output format/action, we should allow production pipeline.
    return (
        /\b(excel|xlsx|hoja\s+de\s+c[aá]lculo|spreadsheet)\b/i.test(message) ||
        /\b(pptx?|powerpoint|presentaci[oó]n|diapositivas|slides?)\b/i.test(message) ||
        /\b(word|docx|documento)\b/i.test(message) ||
        /\bpdf\b/i.test(message) ||
        /\b(exporta|exportar|genera|generar|crea|crear|haz|hacer|construye|prepara)\b/i.test(message) &&
        /(excel|xlsx|ppt|pptx|powerpoint|word|docx|pdf)/i.test(message)
    );
}

