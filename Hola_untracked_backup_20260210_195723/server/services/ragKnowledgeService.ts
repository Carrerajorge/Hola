/**
 * RAG & Knowledge Management Service
 * Capabilities 851-900: Chunking, embeddings, search, knowledge graph, evaluation
 */

import crypto from "crypto";

// ============================================================
// Interfaces & Types
// ============================================================

interface Chunk {
  id: string;
  text: string;
  metadata: {
    source: string;
    chunkIndex: number;
    startChar: number;
    endChar: number;
    [key: string]: any;
  };
  embedding?: number[];
}

interface VectorEntry {
  id: string;
  vector: number[];
  text: string;
  metadata: Record<string, any>;
}

interface KGNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, any>;
}

interface KGEdge {
  source: string;
  target: string;
  relation: string;
  properties?: Record<string, any>;
}

// ============================================================
// Module-level state
// ============================================================

const vectorStore: VectorEntry[] = [];

const knowledgeGraph: { nodes: Map<string, KGNode>; edges: KGEdge[] } = {
  nodes: new Map(),
  edges: [],
};

const EMBEDDING_DIM = 128;

// ============================================================
// Utility helpers
// ============================================================

function uid(): string {
  return crypto.randomUUID();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Deterministic hash of a string to an integer.
 */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0; // unsigned
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Build a term-frequency map from tokens.
 */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

/**
 * Inverse document frequency across a set of documents.
 */
function inverseDocumentFrequency(
  docs: string[][],
): Map<string, number> {
  const df = new Map<string, number>();
  for (const tokens of docs) {
    const unique = new Set(tokens);
    for (const t of unique) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  const N = docs.length;
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }
  return idf;
}

// ============================================================
// 1. Document Chunking (851-853)
// ============================================================

/**
 * Split text into fixed-size chunks with optional overlap.
 */
export function chunkByFixedSize(
  text: string,
  chunkSize: number,
  overlap: number = 0,
): Chunk[] {
  const chunks: Chunk[] = [];
  const step = Math.max(1, chunkSize - overlap);
  let idx = 0;
  let chunkIndex = 0;

  while (idx < text.length) {
    const end = Math.min(idx + chunkSize, text.length);
    const slice = text.slice(idx, end);
    chunks.push({
      id: uid(),
      text: slice,
      metadata: {
        source: "fixed_size",
        chunkIndex,
        startChar: idx,
        endChar: end,
        chunkSize,
        overlap,
      },
    });
    chunkIndex++;
    idx += step;
    if (end === text.length) break;
  }
  return chunks;
}

/**
 * Split by paragraphs/sections, keeping semantic units together.
 */
export function chunkBySemantic(
  text: string,
  maxChunkSize: number = 1000,
): Chunk[] {
  const chunks: Chunk[] = [];
  // Split on double newlines, markdown headings, or horizontal rules
  const sections = text.split(/(?:\r?\n){2,}|(?=^#{1,6}\s)/m);
  let currentChunkText = "";
  let currentStart = 0;
  let chunkIndex = 0;
  let cursor = 0;

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) {
      cursor += section.length;
      continue;
    }

    const sectionStart = text.indexOf(trimmed, cursor);
    const sectionEnd = sectionStart + trimmed.length;

    if (
      currentChunkText.length > 0 &&
      currentChunkText.length + trimmed.length + 2 > maxChunkSize
    ) {
      // Flush current chunk
      chunks.push({
        id: uid(),
        text: currentChunkText.trim(),
        metadata: {
          source: "semantic",
          chunkIndex,
          startChar: currentStart,
          endChar: currentStart + currentChunkText.trim().length,
        },
      });
      chunkIndex++;
      currentChunkText = trimmed;
      currentStart = sectionStart;
    } else {
      if (currentChunkText.length === 0) {
        currentStart = sectionStart;
      }
      currentChunkText += (currentChunkText ? "\n\n" : "") + trimmed;
    }
    cursor = sectionEnd;
  }

  if (currentChunkText.trim().length > 0) {
    chunks.push({
      id: uid(),
      text: currentChunkText.trim(),
      metadata: {
        source: "semantic",
        chunkIndex,
        startChar: currentStart,
        endChar: currentStart + currentChunkText.trim().length,
      },
    });
  }

  return chunks;
}

/**
 * Recursive character text splitter - tries separators in order.
 */
export function chunkByRecursive(
  text: string,
  separators: string[] = ["\n\n", "\n", ". ", " "],
  maxChunkSize: number = 1000,
): Chunk[] {
  const allChunks: Chunk[] = [];

  function splitRecursive(
    txt: string,
    sepIdx: number,
    globalOffset: number,
  ): void {
    if (txt.length <= maxChunkSize || sepIdx >= separators.length) {
      allChunks.push({
        id: uid(),
        text: txt,
        metadata: {
          source: "recursive",
          chunkIndex: allChunks.length,
          startChar: globalOffset,
          endChar: globalOffset + txt.length,
          separator: sepIdx < separators.length ? separators[sepIdx] : "none",
        },
      });
      return;
    }

    const sep = separators[sepIdx];
    const parts = txt.split(sep);

    let current = "";
    let currentOffset = globalOffset;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const candidate =
        current.length > 0 ? current + sep + part : part;

      if (candidate.length > maxChunkSize && current.length > 0) {
        // Flush current
        if (current.length <= maxChunkSize) {
          allChunks.push({
            id: uid(),
            text: current,
            metadata: {
              source: "recursive",
              chunkIndex: allChunks.length,
              startChar: currentOffset,
              endChar: currentOffset + current.length,
              separator: sep,
            },
          });
        } else {
          splitRecursive(current, sepIdx + 1, currentOffset);
        }
        currentOffset += current.length + sep.length;
        current = part;
      } else {
        current = candidate;
      }
    }

    if (current.length > 0) {
      if (current.length <= maxChunkSize) {
        allChunks.push({
          id: uid(),
          text: current,
          metadata: {
            source: "recursive",
            chunkIndex: allChunks.length,
            startChar: currentOffset,
            endChar: currentOffset + current.length,
            separator: sep,
          },
        });
      } else {
        splitRecursive(current, sepIdx + 1, currentOffset);
      }
    }
  }

  splitRecursive(text, 0, 0);
  return allChunks;
}

// ============================================================
// 2. Embedding & Vector Store (854-860)
// ============================================================

/**
 * Generate a simple bag-of-words embedding hashed to fixed dimensions.
 * Each word is hashed to a bucket, weighted by term frequency.
 */
export function generateSimpleEmbedding(text: string): number[] {
  const tokens = tokenize(text);
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);

  const tf = termFrequency(tokens);
  for (const [word, count] of tf) {
    const bucket = hashStr(word) % EMBEDDING_DIM;
    // Use a secondary hash to decide sign for approximate orthogonality
    const sign = hashStr(word + "_sign") % 2 === 0 ? 1 : -1;
    vec[bucket] += sign * count;
  }

  // L2 normalize
  let mag = 0;
  for (const v of vec) mag += v * v;
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= mag;
  }

  return vec;
}

/**
 * Add entries to the in-memory vector store.
 */
export function addToVectorStore(
  entries: Array<{ text: string; metadata?: Record<string, any> }>,
): { added: number; ids: string[] } {
  const ids: string[] = [];
  for (const entry of entries) {
    const id = uid();
    const vector = generateSimpleEmbedding(entry.text);
    vectorStore.push({
      id,
      vector,
      text: entry.text,
      metadata: entry.metadata ?? {},
    });
    ids.push(id);
  }
  return { added: ids.length, ids };
}

/**
 * Search the vector store using cosine similarity.
 */
export function searchVectorStore(
  query: string,
  topK: number = 5,
  filter?: Record<string, any>,
): Array<VectorEntry & { score: number }> {
  const queryVec = generateSimpleEmbedding(query);

  let candidates = vectorStore;
  if (filter) {
    candidates = candidates.filter((entry) => {
      for (const [key, val] of Object.entries(filter)) {
        if (entry.metadata[key] !== val) return false;
      }
      return true;
    });
  }

  const scored = candidates.map((entry) => ({
    ...entry,
    score: cosineSimilarity(queryVec, entry.vector),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Delete entries from the vector store by IDs.
 */
export function deleteFromVectorStore(ids: string[]): number {
  const idSet = new Set(ids);
  let removed = 0;
  for (let i = vectorStore.length - 1; i >= 0; i--) {
    if (idSet.has(vectorStore[i].id)) {
      vectorStore.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

/**
 * Get stats about the vector store.
 */
export function getVectorStoreStats(): {
  totalEntries: number;
  dimensions: number;
  memoryUsageMB: number;
} {
  // Rough memory estimate: each entry has a vector of EMBEDDING_DIM floats (8 bytes each)
  // plus text and metadata overhead
  let textBytes = 0;
  for (const entry of vectorStore) {
    textBytes += entry.text.length * 2; // approximate UTF-16
  }
  const vectorBytes = vectorStore.length * EMBEDDING_DIM * 8;
  const totalBytes = vectorBytes + textBytes;

  return {
    totalEntries: vectorStore.length,
    dimensions: EMBEDDING_DIM,
    memoryUsageMB: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
  };
}

// ============================================================
// 3. Search (861-870)
// ============================================================

/**
 * Keyword-based BM25-like scoring.
 */
function keywordScore(
  queryTokens: string[],
  docTokens: string[],
): number {
  const tf = termFrequency(docTokens);
  const docLen = docTokens.length;
  const avgDocLen = 100; // assumed average
  const k1 = 1.2;
  const b = 0.75;

  let score = 0;
  for (const qt of queryTokens) {
    const freq = tf.get(qt) ?? 0;
    if (freq > 0) {
      const numerator = freq * (k1 + 1);
      const denominator = freq + k1 * (1 - b + b * (docLen / avgDocLen));
      score += numerator / denominator;
    }
  }
  return score;
}

/**
 * Hybrid search combining vector similarity and keyword matching.
 */
export function hybridSearch(
  query: string,
  options?: {
    vectorWeight?: number;
    keywordWeight?: number;
    topK?: number;
    filter?: Record<string, any>;
  },
): Array<{
  id: string;
  text: string;
  score: number;
  matchType: "vector" | "keyword" | "hybrid";
  metadata: Record<string, any>;
}> {
  const vectorWeight = options?.vectorWeight ?? 0.6;
  const kw = options?.keywordWeight ?? 1 - vectorWeight;
  const topK = options?.topK ?? 10;

  const queryVec = generateSimpleEmbedding(query);
  const queryTokens = tokenize(query);

  let candidates = vectorStore;
  if (options?.filter) {
    candidates = candidates.filter((entry) => {
      for (const [key, val] of Object.entries(options.filter!)) {
        if (entry.metadata[key] !== val) return false;
      }
      return true;
    });
  }

  const results = candidates.map((entry) => {
    const vecScore = cosineSimilarity(queryVec, entry.vector);
    const kwScore = keywordScore(queryTokens, tokenize(entry.text));

    // Normalize keyword score to 0-1 range approximately
    const maxKwScore = queryTokens.length * 2;
    const normKwScore = maxKwScore > 0 ? Math.min(kwScore / maxKwScore, 1) : 0;

    const combinedScore = vectorWeight * vecScore + kw * normKwScore;

    let matchType: "vector" | "keyword" | "hybrid" = "hybrid";
    if (vecScore > 0.5 && normKwScore < 0.1) matchType = "vector";
    else if (normKwScore > 0.3 && vecScore < 0.2) matchType = "keyword";

    return {
      id: entry.id,
      text: entry.text,
      score: Math.round(combinedScore * 10000) / 10000,
      matchType,
      metadata: entry.metadata,
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Full text search over a set of documents.
 */
export function fullTextSearch(
  query: string,
  documents: Array<{
    id: string;
    text: string;
    metadata?: Record<string, any>;
  }>,
  options?: { caseSensitive?: boolean; wholeWord?: boolean },
): Array<{ id: string; text: string; score: number; highlights: string[] }> {
  const caseSensitive = options?.caseSensitive ?? false;
  const wholeWord = options?.wholeWord ?? false;

  const queryTerms = caseSensitive
    ? query.split(/\s+/).filter(Boolean)
    : query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

  const results: Array<{
    id: string;
    text: string;
    score: number;
    highlights: string[];
  }> = [];

  for (const doc of documents) {
    const originalText = doc.text;
    let matchCount = 0;
    const highlights: string[] = [];

    for (const term of queryTerms) {
      const pattern = wholeWord ? `\\b${escapeRegex(term)}\\b` : escapeRegex(term);
      const flags = caseSensitive ? "g" : "gi";
      const regex = new RegExp(pattern, flags);
      const matches = originalText.match(regex);

      if (matches) {
        matchCount += matches.length;
        // Generate highlight snippets - context around each match
        let match: RegExpExecArray | null;
        const highlightRegex = new RegExp(pattern, flags);
        while ((match = highlightRegex.exec(originalText)) !== null) {
          const start = Math.max(0, match.index - 40);
          const end = Math.min(originalText.length, match.index + match[0].length + 40);
          const snippet = (start > 0 ? "..." : "") +
            originalText.slice(start, end) +
            (end < originalText.length ? "..." : "");
          highlights.push(snippet);
          if (highlights.length >= 3) break; // cap at 3 highlights per term
        }
      }
    }

    if (matchCount > 0) {
      // Score based on term frequency and coverage
      const termsCovered = queryTerms.filter((term) => {
        const pattern = wholeWord ? `\\b${escapeRegex(term)}\\b` : escapeRegex(term);
        return new RegExp(pattern, caseSensitive ? "" : "i").test(doc.text);
      }).length;

      const coverageScore = termsCovered / queryTerms.length;
      const densityScore = matchCount / Math.max(doc.text.split(/\s+/).length, 1);

      results.push({
        id: doc.id,
        text: doc.text,
        score: Math.round((coverageScore * 0.7 + Math.min(densityScore * 10, 1) * 0.3) * 10000) / 10000,
        highlights: [...new Set(highlights)].slice(0, 5),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Faceted search that returns results plus facet counts.
 */
export function facetedSearch(
  query: string,
  facets: string[],
): {
  results: Array<{ id: string; text: string; score: number }>;
  facetCounts: Record<string, Record<string, number>>;
} {
  const queryVec = generateSimpleEmbedding(query);

  const scored = vectorStore.map((entry) => ({
    id: entry.id,
    text: entry.text,
    score: cosineSimilarity(queryVec, entry.vector),
    metadata: entry.metadata,
  }));

  scored.sort((a, b) => b.score - a.score);

  // Build facet counts from metadata of results with score > 0
  const relevant = scored.filter((s) => s.score > 0);
  const facetCounts: Record<string, Record<string, number>> = {};

  for (const facet of facets) {
    facetCounts[facet] = {};
    for (const item of relevant) {
      const val = item.metadata[facet];
      if (val !== undefined && val !== null) {
        const key = String(val);
        facetCounts[facet][key] = (facetCounts[facet][key] ?? 0) + 1;
      }
    }
  }

  return {
    results: scored.slice(0, 20).map(({ id, text, score }) => ({
      id,
      text,
      score: Math.round(score * 10000) / 10000,
    })),
    facetCounts,
  };
}

/**
 * Expand a query with synonyms and related terms.
 */
export function expandQuery(query: string): {
  expanded: string;
  addedTerms: string[];
  synonyms: Record<string, string[]>;
} {
  const synonymMap: Record<string, string[]> = {
    fast: ["quick", "rapid", "speedy"],
    quick: ["fast", "rapid", "speedy"],
    big: ["large", "huge", "enormous"],
    large: ["big", "huge", "enormous"],
    small: ["tiny", "little", "compact"],
    good: ["great", "excellent", "fine"],
    bad: ["poor", "terrible", "awful"],
    create: ["make", "build", "generate"],
    delete: ["remove", "erase", "destroy"],
    find: ["search", "locate", "discover"],
    search: ["find", "look for", "query"],
    error: ["bug", "issue", "problem", "fault"],
    bug: ["error", "issue", "defect"],
    fix: ["repair", "resolve", "patch"],
    update: ["modify", "change", "revise"],
    show: ["display", "present", "render"],
    hide: ["conceal", "remove", "mask"],
    start: ["begin", "launch", "initiate"],
    stop: ["end", "halt", "terminate"],
    data: ["information", "records", "dataset"],
    user: ["person", "account", "member"],
    file: ["document", "record"],
    api: ["endpoint", "interface", "service"],
    test: ["verify", "check", "validate"],
    deploy: ["release", "publish", "ship"],
    config: ["configuration", "settings", "options"],
    database: ["db", "datastore", "storage"],
  };

  const tokens = tokenize(query);
  const addedTerms: string[] = [];
  const foundSynonyms: Record<string, string[]> = {};

  for (const token of tokens) {
    if (synonymMap[token]) {
      foundSynonyms[token] = synonymMap[token];
      for (const syn of synonymMap[token]) {
        if (!tokens.includes(syn) && !addedTerms.includes(syn)) {
          addedTerms.push(syn);
        }
      }
    }
  }

  const expanded = [...tokens, ...addedTerms].join(" ");
  return { expanded, addedTerms, synonyms: foundSynonyms };
}

/**
 * Decompose a complex query into simpler sub-queries.
 */
export function decomposeQuery(query: string): {
  subQueries: string[];
  strategy: "parallel" | "sequential";
  reasoning: string;
} {
  const lower = query.toLowerCase();
  const subQueries: string[] = [];

  // Detect conjunctions and split
  const andParts = query.split(/\s+(?:and|&|,\s*and)\s+/i);
  if (andParts.length > 1) {
    for (const part of andParts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) subQueries.push(trimmed);
    }
    return {
      subQueries,
      strategy: "parallel",
      reasoning: "Query contains conjunctions ('and') indicating multiple independent information needs.",
    };
  }

  // Detect comparisons
  const compareMatch = lower.match(/compare\s+(.+?)\s+(?:with|vs\.?|versus|to|against)\s+(.+)/i);
  if (compareMatch) {
    subQueries.push(`What is ${compareMatch[1]}?`);
    subQueries.push(`What is ${compareMatch[2]}?`);
    subQueries.push(`Differences between ${compareMatch[1]} and ${compareMatch[2]}`);
    return {
      subQueries,
      strategy: "parallel",
      reasoning: "Comparison query decomposed into individual lookups and a comparison sub-query.",
    };
  }

  // Detect multi-step questions (how to... then...)
  const stepMatch = query.split(/\s+(?:then|after that|next|and then|afterwards)\s+/i);
  if (stepMatch.length > 1) {
    for (const step of stepMatch) {
      const trimmed = step.trim();
      if (trimmed.length > 0) subQueries.push(trimmed);
    }
    return {
      subQueries,
      strategy: "sequential",
      reasoning: "Query involves sequential steps that should be resolved in order.",
    };
  }

  // Detect questions with multiple question marks
  const questions = query.split(/\?/).filter((q) => q.trim().length > 0);
  if (questions.length > 1) {
    for (const q of questions) {
      subQueries.push(q.trim() + "?");
    }
    return {
      subQueries,
      strategy: "parallel",
      reasoning: "Multiple distinct questions detected in the query.",
    };
  }

  // Cannot decompose further
  return {
    subQueries: [query],
    strategy: "parallel",
    reasoning: "Query is already atomic and does not need decomposition.",
  };
}

/**
 * Re-rank results using keyword overlap and positional scoring.
 */
export function rerank(
  query: string,
  results: Array<{ id: string; text: string; score: number }>,
): Array<{ id: string; text: string; score: number; rerankScore: number }> {
  const queryTokens = tokenize(query);
  const querySet = new Set(queryTokens);

  return results
    .map((result) => {
      const docTokens = tokenize(result.text);
      const docLen = docTokens.length;

      // Exact match bonus
      let exactMatchCount = 0;
      for (const qt of queryTokens) {
        for (const dt of docTokens) {
          if (dt === qt) exactMatchCount++;
        }
      }

      // Coverage: what fraction of query terms appear in doc
      const coveredTerms = new Set(docTokens.filter((t) => querySet.has(t)));
      const coverage = queryTokens.length > 0 ? coveredTerms.size / querySet.size : 0;

      // Positional score: terms appearing earlier in doc get higher score
      let positionScore = 0;
      for (let i = 0; i < Math.min(docTokens.length, 50); i++) {
        if (querySet.has(docTokens[i])) {
          positionScore += 1 - i / 50;
        }
      }
      positionScore = docLen > 0 ? positionScore / Math.min(docLen, 50) : 0;

      // Density: how close together are query terms in the doc
      const queryPositions: number[] = [];
      for (let i = 0; i < docTokens.length; i++) {
        if (querySet.has(docTokens[i])) queryPositions.push(i);
      }
      let densityScore = 0;
      if (queryPositions.length >= 2) {
        const span = queryPositions[queryPositions.length - 1] - queryPositions[0] + 1;
        densityScore = queryPositions.length / span;
      } else if (queryPositions.length === 1) {
        densityScore = 0.5;
      }

      // Combined re-rank score
      const rerankScore =
        coverage * 0.35 +
        (exactMatchCount / Math.max(queryTokens.length, 1)) * 0.25 +
        positionScore * 0.2 +
        densityScore * 0.2;

      return {
        ...result,
        rerankScore: Math.round(rerankScore * 10000) / 10000,
      };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

/**
 * Maximum Marginal Relevance for diversity in results.
 */
export function maxMarginalRelevance(
  query: string,
  results: Array<{ id: string; text: string; vector: number[] }>,
  lambda: number = 0.5,
  topK: number = 5,
): Array<{ id: string; text: string; score: number }> {
  const queryVec = generateSimpleEmbedding(query);
  const selected: Array<{ id: string; text: string; score: number }> = [];
  const remaining = [...results];

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = cosineSimilarity(queryVec, remaining[i].vector);

      // Max similarity to already selected documents
      let maxSim = 0;
      for (const sel of selected) {
        const selEntry = results.find((r) => r.id === sel.id);
        if (selEntry) {
          const sim = cosineSimilarity(remaining[i].vector, selEntry.vector);
          maxSim = Math.max(maxSim, sim);
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const chosen = remaining.splice(bestIdx, 1)[0];
      selected.push({
        id: chosen.id,
        text: chosen.text,
        score: Math.round(bestMMR * 10000) / 10000,
      });
    } else {
      break;
    }
  }

  return selected;
}

// ============================================================
// 4. Knowledge Graph (871-880)
// ============================================================

/**
 * Add a node to the knowledge graph.
 */
export function addNode(
  label: string,
  type: string,
  properties?: Record<string, any>,
): KGNode {
  const id = uid();
  const node: KGNode = {
    id,
    label,
    type,
    properties: properties ?? {},
  };
  knowledgeGraph.nodes.set(id, node);
  return node;
}

/**
 * Add an edge between two nodes.
 */
export function addEdge(
  sourceId: string,
  targetId: string,
  relation: string,
  properties?: Record<string, any>,
): KGEdge | null {
  if (!knowledgeGraph.nodes.has(sourceId) || !knowledgeGraph.nodes.has(targetId)) {
    return null;
  }
  const edge: KGEdge = {
    source: sourceId,
    target: targetId,
    relation,
    properties: properties ?? {},
  };
  knowledgeGraph.edges.push(edge);
  return edge;
}

/**
 * Get a node by ID.
 */
export function getNode(id: string): KGNode | null {
  return knowledgeGraph.nodes.get(id) ?? null;
}

/**
 * Find nodes matching a query.
 */
export function findNodes(query: {
  type?: string;
  label?: string;
  properties?: Record<string, any>;
}): KGNode[] {
  const results: KGNode[] = [];
  for (const node of knowledgeGraph.nodes.values()) {
    if (query.type && node.type !== query.type) continue;
    if (query.label && !node.label.toLowerCase().includes(query.label.toLowerCase())) continue;
    if (query.properties) {
      let match = true;
      for (const [key, val] of Object.entries(query.properties)) {
        if (node.properties[key] !== val) {
          match = false;
          break;
        }
      }
      if (!match) continue;
    }
    results.push(node);
  }
  return results;
}

/**
 * Get neighbors of a node, optionally filtering by relation and depth.
 */
export function getNeighbors(
  nodeId: string,
  relation?: string,
  depth: number = 1,
): Array<{ node: KGNode; relation: string; distance: number }> {
  const results: Array<{ node: KGNode; relation: string; distance: number }> = [];
  const visited = new Set<string>();
  visited.add(nodeId);

  let frontier = [nodeId];
  for (let d = 1; d <= depth; d++) {
    const nextFrontier: string[] = [];
    for (const current of frontier) {
      for (const edge of knowledgeGraph.edges) {
        let neighborId: string | null = null;
        let edgeRelation = edge.relation;

        if (edge.source === current) neighborId = edge.target;
        else if (edge.target === current) neighborId = edge.source;

        if (neighborId && !visited.has(neighborId)) {
          if (relation && edgeRelation !== relation) continue;
          visited.add(neighborId);
          const neighborNode = knowledgeGraph.nodes.get(neighborId);
          if (neighborNode) {
            results.push({ node: neighborNode, relation: edgeRelation, distance: d });
            nextFrontier.push(neighborId);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  return results;
}

/**
 * Get statistics about the knowledge graph.
 */
export function getGraphStats(): {
  nodes: number;
  edges: number;
  nodeTypes: Record<string, number>;
  relationTypes: Record<string, number>;
} {
  const nodeTypes: Record<string, number> = {};
  for (const node of knowledgeGraph.nodes.values()) {
    nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
  }

  const relationTypes: Record<string, number> = {};
  for (const edge of knowledgeGraph.edges) {
    relationTypes[edge.relation] = (relationTypes[edge.relation] ?? 0) + 1;
  }

  return {
    nodes: knowledgeGraph.nodes.size,
    edges: knowledgeGraph.edges.length,
    nodeTypes,
    relationTypes,
  };
}

/**
 * Export the entire knowledge graph.
 */
export function exportGraph(): { nodes: KGNode[]; edges: KGEdge[] } {
  return {
    nodes: Array.from(knowledgeGraph.nodes.values()),
    edges: [...knowledgeGraph.edges],
  };
}

/**
 * Extract named entities from text using regex patterns.
 */
export function extractEntities(
  text: string,
): Array<{ text: string; type: string; start: number; end: number }> {
  const entities: Array<{ text: string; type: string; start: number; end: number }> = [];

  const patterns: Array<{ type: string; regex: RegExp }> = [
    // EMAIL
    { type: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
    // URL
    { type: "URL", regex: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g },
    // DATE patterns
    { type: "DATE", regex: /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g },
    { type: "DATE", regex: /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g },
    { type: "DATE", regex: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi },
    { type: "DATE", regex: /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi },
    // NUMBER (with optional decimal and negative)
    { type: "NUMBER", regex: /\b-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g },
    // MONEY
    { type: "NUMBER", regex: /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g },
    // ORGANIZATION (common patterns: Inc, Corp, Ltd, LLC, etc.)
    { type: "ORGANIZATION", regex: /\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC|Company|Co\.?|Group|Foundation|Association|Institute|University|Technologies|Systems|Solutions|Enterprises)\b/g },
    // PERSON (Title + Capitalized names)
    { type: "PERSON", regex: /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Sir|Dame)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g },
    // PERSON (Two or three consecutive capitalized words, likely a name — must not start a sentence)
    { type: "PERSON", regex: /(?<=[,;]\s|and\s|with\s|by\s|from\s|to\s)[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g },
    // LOCATION (common location indicators)
    { type: "LOCATION", regex: /\b(?:City of|State of|Republic of|Kingdom of|Province of)\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g },
    { type: "LOCATION", regex: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\b/g }, // City, STATE
    { type: "LOCATION", regex: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g }, // City, Country
  ];

  const seen = new Set<string>();

  for (const { type, regex } of patterns) {
    let match: RegExpExecArray | null;
    // Reset regex state
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      const key = `${match.index}:${match[0].length}:${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({
          text: match[0],
          type,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }

  // Sort by position
  entities.sort((a, b) => a.start - b.start);

  // Remove overlapping entities (keep longer/earlier)
  const filtered: Array<{ text: string; type: string; start: number; end: number }> = [];
  for (const entity of entities) {
    const overlaps = filtered.some(
      (existing) => entity.start < existing.end && entity.end > existing.start,
    );
    if (!overlaps) {
      filtered.push(entity);
    }
  }

  return filtered;
}

/**
 * Simple relation extraction based on sentence structure.
 */
export function extractRelations(
  text: string,
  entities: Array<{ text: string; type: string }>,
): Array<{ subject: string; predicate: string; object: string }> {
  const relations: Array<{ subject: string; predicate: string; object: string }> = [];

  // Split text into sentences
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);

  // Common relation verbs
  const relationVerbs = [
    "is", "are", "was", "were", "has", "have", "had",
    "works at", "works for", "works with",
    "lives in", "located in", "based in",
    "founded", "created", "built", "developed", "invented",
    "manages", "leads", "runs", "owns", "acquired",
    "belongs to", "part of", "member of",
    "reported to", "reports to",
    "married to", "related to",
    "born in", "died in",
    "wrote", "authored", "published",
    "includes", "contains", "consists of",
    "supports", "enables", "provides",
    "uses", "depends on", "requires",
    "employs", "hired", "fired",
    "visited", "traveled to", "moved to",
  ];

  const entityTexts = entities.map((e) => e.text);

  for (const sentence of sentences) {
    // For each pair of entities in the same sentence
    const presentEntities = entityTexts.filter((et) =>
      sentence.toLowerCase().includes(et.toLowerCase()),
    );

    for (let i = 0; i < presentEntities.length; i++) {
      for (let j = i + 1; j < presentEntities.length; j++) {
        const e1 = presentEntities[i];
        const e2 = presentEntities[j];

        const idx1 = sentence.toLowerCase().indexOf(e1.toLowerCase());
        const idx2 = sentence.toLowerCase().indexOf(e2.toLowerCase());

        if (idx1 < 0 || idx2 < 0) continue;

        const [first, second] = idx1 < idx2 ? [e1, e2] : [e2, e1];
        const [firstIdx, secondIdx] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];

        // Extract text between entities
        const between = sentence.slice(firstIdx + first.length, secondIdx).trim().toLowerCase();

        // Find matching relation verb
        for (const verb of relationVerbs) {
          if (between.includes(verb)) {
            relations.push({
              subject: first,
              predicate: verb,
              object: second,
            });
            break; // One relation per entity pair per sentence
          }
        }
      }
    }
  }

  return relations;
}

/**
 * Build a knowledge graph from raw text.
 */
export function buildKnowledgeGraphFromText(
  text: string,
): { nodes: KGNode[]; edges: KGEdge[] } {
  const entities = extractEntities(text);
  const relations = extractRelations(text, entities);

  const nodeMap = new Map<string, KGNode>();
  const addedNodes: KGNode[] = [];
  const addedEdges: KGEdge[] = [];

  // Create nodes for each unique entity
  for (const entity of entities) {
    const key = entity.text.toLowerCase();
    if (!nodeMap.has(key)) {
      const node = addNode(entity.text, entity.type, {
        extractedFrom: text.slice(
          Math.max(0, entity.start - 20),
          Math.min(text.length, entity.end + 20),
        ),
      });
      nodeMap.set(key, node);
      addedNodes.push(node);
    }
  }

  // Create edges from relations
  for (const rel of relations) {
    const subjectNode = nodeMap.get(rel.subject.toLowerCase());
    const objectNode = nodeMap.get(rel.object.toLowerCase());
    if (subjectNode && objectNode) {
      const edge = addEdge(subjectNode.id, objectNode.id, rel.predicate, {
        confidence: 0.7,
      });
      if (edge) addedEdges.push(edge);
    }
  }

  return { nodes: addedNodes, edges: addedEdges };
}

// ============================================================
// 5. Evaluation (881-890)
// ============================================================

/**
 * Evaluate retrieval quality with precision, recall, F1, AP, and NDCG.
 */
export function evaluateRetrievalRelevance(
  query: string,
  retrievedDocs: string[],
  relevantDocs: string[],
): {
  precision: number;
  recall: number;
  f1: number;
  averagePrecision: number;
  ndcg: number;
} {
  const relevantSet = new Set(relevantDocs);
  const retrieved = retrievedDocs;

  // Precision & Recall
  let truePositives = 0;
  for (const doc of retrieved) {
    if (relevantSet.has(doc)) truePositives++;
  }

  const precision = retrieved.length > 0 ? truePositives / retrieved.length : 0;
  const recall = relevantDocs.length > 0 ? truePositives / relevantDocs.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Average Precision
  let sumPrecision = 0;
  let relevantSoFar = 0;
  for (let i = 0; i < retrieved.length; i++) {
    if (relevantSet.has(retrieved[i])) {
      relevantSoFar++;
      sumPrecision += relevantSoFar / (i + 1);
    }
  }
  const averagePrecision = relevantDocs.length > 0 ? sumPrecision / relevantDocs.length : 0;

  // NDCG (Normalized Discounted Cumulative Gain)
  // Relevance is binary: 1 if relevant, 0 if not
  let dcg = 0;
  for (let i = 0; i < retrieved.length; i++) {
    const rel = relevantSet.has(retrieved[i]) ? 1 : 0;
    dcg += rel / Math.log2(i + 2); // i+2 because position is 1-indexed, log2(1) = 0
  }

  // Ideal DCG: all relevant docs come first
  let idcg = 0;
  const idealLength = Math.min(relevantDocs.length, retrieved.length);
  for (let i = 0; i < idealLength; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  const ndcg = idcg > 0 ? dcg / idcg : 0;

  return {
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1: Math.round(f1 * 10000) / 10000,
    averagePrecision: Math.round(averagePrecision * 10000) / 10000,
    ndcg: Math.round(ndcg * 10000) / 10000,
  };
}

/**
 * Evaluate how relevant an answer is to a question.
 */
export function evaluateAnswerRelevance(
  question: string,
  answer: string,
): {
  relevanceScore: number;
  keyTermsCovered: string[];
  keyTermsMissed: string[];
} {
  // Extract key terms from the question (non-stop-words)
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "must", "need",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
    "they", "them", "their", "this", "that", "these", "those",
    "what", "which", "who", "whom", "whose", "where", "when", "why", "how",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "about",
    "not", "no", "nor", "but", "or", "and", "if", "then", "so", "than",
    "too", "very", "just", "also", "only", "both", "each", "every",
    "all", "any", "few", "more", "most", "some", "such",
  ]);

  const questionTokens = tokenize(question);
  const keyTerms = questionTokens.filter((t) => !stopWords.has(t) && t.length > 2);
  const answerTokens = new Set(tokenize(answer));

  const covered: string[] = [];
  const missed: string[] = [];

  for (const term of keyTerms) {
    if (answerTokens.has(term)) {
      covered.push(term);
    } else {
      // Check for partial matches (stemming approximation)
      let found = false;
      for (const at of answerTokens) {
        if (at.startsWith(term.slice(0, Math.max(3, term.length - 2))) ||
            term.startsWith(at.slice(0, Math.max(3, at.length - 2)))) {
          covered.push(term);
          found = true;
          break;
        }
      }
      if (!found) missed.push(term);
    }
  }

  // Uniquify
  const uniqueCovered = [...new Set(covered)];
  const uniqueMissed = [...new Set(missed)];

  // Score based on coverage
  const termCoverage = keyTerms.length > 0
    ? uniqueCovered.length / new Set(keyTerms).size
    : 0;

  // Length appropriateness (answers that are too short or way too long are penalized)
  const answerWords = answer.split(/\s+/).length;
  const questionWords = question.split(/\s+/).length;
  const lengthRatio = answerWords / Math.max(questionWords, 1);
  const lengthScore = lengthRatio < 0.5 ? lengthRatio * 2 : lengthRatio > 20 ? 0.8 : 1.0;

  const relevanceScore = Math.min(1, termCoverage * 0.8 + lengthScore * 0.2);

  return {
    relevanceScore: Math.round(relevanceScore * 10000) / 10000,
    keyTermsCovered: uniqueCovered,
    keyTermsMissed: uniqueMissed,
  };
}

/**
 * Evaluate how precisely contexts support the answer.
 */
export function evaluateContextPrecision(
  question: string,
  contexts: string[],
  answer: string,
): {
  precision: number;
  usefulContexts: number[];
  redundantContexts: number[];
} {
  const questionTokens = tokenize(question);
  const answerTokens = new Set(tokenize(answer));
  const questionSet = new Set(questionTokens);

  const usefulContexts: number[] = [];
  const redundantContexts: number[] = [];

  for (let i = 0; i < contexts.length; i++) {
    const contextTokens = new Set(tokenize(contexts[i]));

    // A context is useful if it has significant overlap with both the question and the answer
    let questionOverlap = 0;
    for (const qt of questionSet) {
      if (contextTokens.has(qt)) questionOverlap++;
    }

    let answerOverlap = 0;
    for (const at of answerTokens) {
      if (contextTokens.has(at)) answerOverlap++;
    }

    const questionRelevance = questionSet.size > 0 ? questionOverlap / questionSet.size : 0;
    const answerSupport = answerTokens.size > 0 ? answerOverlap / answerTokens.size : 0;

    const usefulness = questionRelevance * 0.4 + answerSupport * 0.6;

    if (usefulness > 0.15) {
      usefulContexts.push(i);
    } else {
      redundantContexts.push(i);
    }
  }

  const precision = contexts.length > 0 ? usefulContexts.length / contexts.length : 0;

  return {
    precision: Math.round(precision * 10000) / 10000,
    usefulContexts,
    redundantContexts,
  };
}

/**
 * Evaluate faithfulness of an answer to its source contexts.
 */
export function evaluateFaithfulness(
  answer: string,
  contexts: string[],
): {
  faithfulnessScore: number;
  supportedClaims: string[];
  unsupportedClaims: string[];
} {
  // Split answer into claims (sentences)
  const claims = answer
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10); // Skip very short fragments

  const allContextText = contexts.join(" ").toLowerCase();
  const contextTokens = new Set(tokenize(allContextText));

  const supportedClaims: string[] = [];
  const unsupportedClaims: string[] = [];

  for (const claim of claims) {
    const claimTokens = tokenize(claim);
    const stopWords = new Set([
      "a", "an", "the", "is", "are", "was", "were", "be", "been",
      "have", "has", "had", "do", "does", "did", "will", "would",
      "i", "me", "my", "we", "you", "he", "she", "it", "they",
      "in", "on", "at", "to", "for", "of", "with", "by", "from",
      "not", "no", "but", "or", "and", "if", "so", "than",
      "this", "that", "these", "those",
    ]);

    const contentTokens = claimTokens.filter((t) => !stopWords.has(t) && t.length > 2);
    if (contentTokens.length === 0) continue;

    let supported = 0;
    for (const token of contentTokens) {
      if (contextTokens.has(token)) supported++;
    }

    const supportRatio = supported / contentTokens.length;

    if (supportRatio >= 0.5) {
      supportedClaims.push(claim);
    } else {
      unsupportedClaims.push(claim);
    }
  }

  const totalClaims = supportedClaims.length + unsupportedClaims.length;
  const faithfulnessScore = totalClaims > 0
    ? supportedClaims.length / totalClaims
    : 0;

  return {
    faithfulnessScore: Math.round(faithfulnessScore * 10000) / 10000,
    supportedClaims,
    unsupportedClaims,
  };
}

// ============================================================
// 6. Content Management (891-900)
// ============================================================

/**
 * Detect duplicate documents using Jaccard similarity on shingle sets.
 */
export function detectDuplicates(
  documents: Array<{ id: string; text: string }>,
): Array<{ id1: string; id2: string; similarity: number }> {
  const SHINGLE_SIZE = 3;

  // Build shingle sets for each document
  function getShingles(text: string): Set<string> {
    const tokens = tokenize(text);
    const shingles = new Set<string>();
    for (let i = 0; i <= tokens.length - SHINGLE_SIZE; i++) {
      shingles.add(tokens.slice(i, i + SHINGLE_SIZE).join(" "));
    }
    return shingles;
  }

  function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  const shinglSets = documents.map((doc) => ({
    id: doc.id,
    shingles: getShingles(doc.text),
  }));

  const duplicates: Array<{ id1: string; id2: string; similarity: number }> = [];

  for (let i = 0; i < shinglSets.length; i++) {
    for (let j = i + 1; j < shinglSets.length; j++) {
      const sim = jaccardSimilarity(shinglSets[i].shingles, shinglSets[j].shingles);
      if (sim > 0.3) {
        duplicates.push({
          id1: shinglSets[i].id,
          id2: shinglSets[j].id,
          similarity: Math.round(sim * 10000) / 10000,
        });
      }
    }
  }

  duplicates.sort((a, b) => b.similarity - a.similarity);
  return duplicates;
}

/**
 * Simple k-means-like clustering on TF vectors.
 */
export function clusterDocuments(
  documents: Array<{ id: string; text: string }>,
  numClusters: number = 3,
): Array<{ clusterId: number; documents: string[]; centroidTerms: string[] }> {
  if (documents.length === 0) return [];

  const k = Math.min(numClusters, documents.length);

  // Build TF-IDF vectors
  const allTokens = documents.map((d) => tokenize(d.text));
  const idf = inverseDocumentFrequency(allTokens);

  // Build vocabulary (top 200 terms by document frequency)
  const vocabEntries = Array.from(idf.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200);
  const vocab = vocabEntries.map(([term]) => term);
  const vocabIndex = new Map(vocab.map((t, i) => [t, i]));

  // Create TF-IDF vectors
  const vectors = allTokens.map((tokens) => {
    const tf = termFrequency(tokens);
    const vec = new Array<number>(vocab.length).fill(0);
    for (const [term, freq] of tf) {
      const idx = vocabIndex.get(term);
      if (idx !== undefined) {
        vec[idx] = freq * (idf.get(term) ?? 1);
      }
    }
    // Normalize
    let mag = 0;
    for (const v of vec) mag += v * v;
    mag = Math.sqrt(mag);
    if (mag > 0) for (let i = 0; i < vec.length; i++) vec[i] /= mag;
    return vec;
  });

  // Initialize centroids (pick k evenly spaced docs)
  const step = Math.max(1, Math.floor(documents.length / k));
  let centroids = Array.from({ length: k }, (_, i) => [...vectors[Math.min(i * step, vectors.length - 1)]]);

  // K-means iterations
  let assignments = new Array<number>(documents.length).fill(0);
  const MAX_ITER = 20;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Assign each document to nearest centroid
    const newAssignments = vectors.map((vec) => {
      let bestCluster = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = cosineSimilarity(vec, centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      return bestCluster;
    });

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;

    if (!changed) break;

    // Recompute centroids
    centroids = Array.from({ length: k }, () => new Array<number>(vocab.length).fill(0));
    const counts = new Array<number>(k).fill(0);

    for (let i = 0; i < documents.length; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < vocab.length; j++) {
        centroids[c][j] += vectors[i][j];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let j = 0; j < vocab.length; j++) {
          centroids[c][j] /= counts[c];
        }
      }
    }
  }

  // Build result
  const clusters: Array<{ clusterId: number; documents: string[]; centroidTerms: string[] }> = [];

  for (let c = 0; c < k; c++) {
    const clusterDocs: string[] = [];
    for (let i = 0; i < documents.length; i++) {
      if (assignments[i] === c) clusterDocs.push(documents[i].id);
    }

    // Top terms for centroid
    const centroidWithIndex = centroids[c].map((val, idx) => ({ val, idx }));
    centroidWithIndex.sort((a, b) => b.val - a.val);
    const topTerms = centroidWithIndex.slice(0, 5).map((item) => vocab[item.idx]).filter(Boolean);

    if (clusterDocs.length > 0) {
      clusters.push({
        clusterId: c,
        documents: clusterDocs,
        centroidTerms: topTerms,
      });
    }
  }

  return clusters;
}

/**
 * Detect whether a document is stale.
 */
export function detectStaleness(
  document: { text: string; createdAt: Date; lastModified: Date },
  maxAgeDays: number = 90,
): {
  stale: boolean;
  ageInDays: number;
  recommendation: string;
} {
  const now = new Date();
  const ageMs = now.getTime() - document.lastModified.getTime();
  const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  // Check for temporal indicators in text
  const yearRegex = /\b(20\d{2})\b/g;
  const currentYear = now.getFullYear();
  let hasOldYearReference = false;
  let match: RegExpExecArray | null;

  while ((match = yearRegex.exec(document.text)) !== null) {
    const year = parseInt(match[1], 10);
    if (year < currentYear - 1) {
      hasOldYearReference = true;
      break;
    }
  }

  // Check for "latest", "current", "recent" (time-sensitive language)
  const timeSensitiveTerms = /\b(latest|current|recent|now|today|this year|this month|upcoming|new)\b/i;
  const hasTimeSensitiveLanguage = timeSensitiveTerms.test(document.text);

  const stale = ageInDays > maxAgeDays;
  let recommendation: string;

  if (!stale && !hasOldYearReference && !hasTimeSensitiveLanguage) {
    recommendation = "Document is current. No action needed.";
  } else if (stale && hasTimeSensitiveLanguage) {
    recommendation = `Document is ${ageInDays} days old and contains time-sensitive language. High priority review and update recommended.`;
  } else if (stale && hasOldYearReference) {
    recommendation = `Document is ${ageInDays} days old and references outdated years. Review and update year references.`;
  } else if (stale) {
    recommendation = `Document is ${ageInDays} days old (exceeds ${maxAgeDays}-day threshold). Review for accuracy.`;
  } else if (hasOldYearReference) {
    recommendation = "Document references older years. Verify that year references are still accurate.";
  } else {
    recommendation = "Document contains time-sensitive language. Monitor for freshness.";
  }

  return { stale, ageInDays, recommendation };
}

/**
 * Generate a formatted citation in APA, MLA, or Chicago style.
 */
export function generateCitation(
  source: { title: string; author: string; date: string; url?: string },
  style: "apa" | "mla" | "chicago" = "apa",
): string {
  const { title, author, date, url } = source;

  // Parse date
  let year = "";
  let fullDate = "";
  const dateObj = new Date(date);
  if (!isNaN(dateObj.getTime())) {
    year = dateObj.getFullYear().toString();
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    fullDate = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${year}`;
  } else {
    year = date;
    fullDate = date;
  }

  switch (style) {
    case "apa": {
      // Author, A. A. (Year). Title. URL
      let citation = `${author}. (${year}). ${title}.`;
      if (url) citation += ` Retrieved from ${url}`;
      return citation;
    }
    case "mla": {
      // Author. "Title." Web. Date.
      let citation = `${author}. "${title}."`;
      if (url) citation += ` Web. ${fullDate}. <${url}>`;
      else citation += ` ${fullDate}.`;
      return citation;
    }
    case "chicago": {
      // Author. "Title." Last modified Date. URL.
      let citation = `${author}. "${title}."`;
      if (fullDate) citation += ` Last modified ${fullDate}.`;
      if (url) citation += ` ${url}.`;
      return citation;
    }
    default:
      return `${author}. (${year}). ${title}.`;
  }
}
