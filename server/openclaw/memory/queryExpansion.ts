/**
 * Multi-lingual query expansion for FTS.
 * Ported from upstream OpenClaw v2026.2.24: src/memory/query-expansion.ts
 *
 * Adapted: PostgreSQL `plainto_tsquery()` instead of SQLite FTS5 syntax.
 * Kept: Multi-lingual stopword sets, CJK tokenization, keyword extraction.
 */

// ── Stop words (most impactful languages from upstream) ─────────────────

const STOP_WORDS_EN = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'and', 'but', 'or', 'if',
  'while', 'about', 'up', 'down', 'just', 'also', 'this', 'that', 'these',
  'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what',
]);

const STOP_WORDS_ES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del',
  'al', 'en', 'con', 'por', 'para', 'es', 'son', 'fue', 'ser', 'estar',
  'como', 'pero', 'si', 'no', 'que', 'y', 'o', 'su', 'se', 'lo',
  'más', 'ya', 'muy', 'todo', 'esta', 'este', 'estos', 'estas',
]);

const STOP_WORDS_PT = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'com', 'por', 'para', 'é', 'são',
  'foi', 'ser', 'estar', 'como', 'mas', 'se', 'não', 'que', 'e', 'ou',
]);

const STOP_WORDS_AR = new Set([
  'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هو', 'هي', 'هم', 'هن',
  'أن', 'لا', 'ما', 'هذا', 'هذه', 'ذلك', 'تلك', 'كان', 'كانت',
  'يكون', 'لم', 'لن', 'قد', 'و', 'أو', 'ثم', 'بل',
]);

// All stop words merged for universal matching
const ALL_STOP_WORDS = new Set([
  ...STOP_WORDS_EN, ...STOP_WORDS_ES, ...STOP_WORDS_PT, ...STOP_WORDS_AR,
]);

// ── CJK detection ───────────────────────────────────────────────────────

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF]/;
const KOREAN_RANGE = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const JAPANESE_KANA = /[\u3040-\u309F\u30A0-\u30FF]/;

function isCJK(char: string): boolean {
  return CJK_RANGE.test(char) || KOREAN_RANGE.test(char) || JAPANESE_KANA.test(char);
}

/** Strip common Korean trailing particles (upstream's stripKoreanTrailingParticle) */
function stripKoreanParticle(token: string): string {
  const particles = ['은', '는', '이', '가', '을', '를', '에', '에서', '으로', '로', '와', '과', '의', '도', '만', '까지'];
  for (const p of particles) {
    if (token.endsWith(p) && token.length > p.length) {
      return token.slice(0, -p.length);
    }
  }
  return token;
}

/**
 * Tokenize CJK text into character bigrams.
 * For Chinese/Japanese, bigrams capture meaningful units better than words.
 */
function tokenizeCJK(text: string): string[] {
  const tokens: string[] = [];
  const chars = [...text].filter(c => isCJK(c));

  for (let i = 0; i < chars.length; i++) {
    tokens.push(chars[i]);
    if (i + 1 < chars.length) {
      tokens.push(chars[i] + chars[i + 1]); // bigram
    }
  }

  return tokens;
}

/**
 * Extract meaningful keywords from a query string.
 * Removes stop words, handles CJK tokenization, strips Korean particles.
 */
export function extractKeywords(query: string): string[] {
  if (!query.trim()) return [];

  const words: string[] = [];

  // Split on whitespace and punctuation, keeping CJK characters
  const tokens = query
    .toLowerCase()
    .split(/[\s,;:!?."'()\[\]{}<>]+/)
    .filter(Boolean);

  for (const token of tokens) {
    // Check if contains CJK
    if ([...token].some(isCJK)) {
      // For Korean, try stripping particles first
      if (KOREAN_RANGE.test(token)) {
        const stripped = stripKoreanParticle(token);
        if (stripped.length > 0) words.push(stripped);
      }
      // Generate CJK bigrams
      words.push(...tokenizeCJK(token));
    } else {
      // Latin/Arabic script: filter stopwords
      const clean = token.replace(/[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F]/g, '');
      if (clean.length >= 2 && !ALL_STOP_WORDS.has(clean)) {
        words.push(clean);
      }
    }
  }

  // Deduplicate while preserving order
  return [...new Set(words)];
}

/**
 * Build a PostgreSQL tsquery from extracted keywords.
 * Joins keywords with `&` (AND) for tighter matching.
 *
 * Upstream used SQLite FTS5 syntax ("keyword1 keyword2") — we adapt to PostgreSQL.
 */
export function buildTsQuery(keywords: string[]): string {
  if (keywords.length === 0) return '';

  // Filter out CJK tokens (PostgreSQL FTS doesn't handle them well)
  const ftsKeywords = keywords.filter(k => /^[a-zA-Z0-9]+$/.test(k));

  if (ftsKeywords.length === 0) return '';

  // Join with & for AND semantics; each keyword uses prefix matching (:*)
  return ftsKeywords.map(k => `${k}:*`).join(' & ');
}

/**
 * Expand a raw query into keywords + PostgreSQL tsquery.
 */
export function expandQueryForFts(query: string): {
  original: string;
  keywords: string[];
  tsQuery: string;
} {
  const keywords = extractKeywords(query);
  return {
    original: query,
    keywords,
    tsQuery: buildTsQuery(keywords),
  };
}
