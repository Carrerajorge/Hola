/**
 * RAGRetriever - Hybrid BM25 + Vector Search for Conversation Memory
 * Combines lexical (BM25) and semantic (Vector) search for optimal retrieval
 */

import { BM25Engine, VectorStore, Utils, BM25Stats, VectorStats } from './searchEngines';

export type DocumentType = 'message' | 'artifact' | 'image' | 'fact';

export interface IndexedMessage {
  messageId: string;
  content: string;
  role: string;
  metadata?: Record<string, unknown>;
}

export interface IndexedArtifact {
  artifactId: string;
  extractedText?: string;
  chunks?: Array<{ text: string; chunkId?: string }>;
  metadata?: Record<string, unknown>;
}

export interface IndexedImage {
  imageId: string;
  prompt: string;
  visionDescription?: string;
  metadata?: Record<string, unknown>;
}

export interface IndexedMemoryFact {
  factId: string;
  content: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  hybridAlpha?: number;
  /**
   * Fusion strategy for hybrid retrieval.
   * - "linear": alpha*vector + (1-alpha)*bm25 (normalized)
   * - "rrf": Reciprocal Rank Fusion (rank-based, more robust across score scales)
   */
  fusion?: "linear" | "rrf";
  /**
   * RRF constant (higher = flatter). Typical values: 50-100.
   */
  rrfK?: number;
  filterTypes?: DocumentType[];
  /**
   * Optional reranking pass after hybrid retrieval.
   * "heuristic" uses token overlap + entity connectivity.
   */
  rerank?: "none" | "heuristic";
  /**
   * Optional graph-style expansion/boost based on shared entity keys between hits.
   * This is a lightweight GraphRAG-style heuristic (no external graph DB).
   */
  graphExpand?: boolean;
  graphBoost?: number;
}

export interface SearchResult {
  id: string;
  score: number;
  type: DocumentType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RAGStats {
  bm25Stats: BM25Stats;
  vectorStats: VectorStats;
  threadId: string;
}

interface DocumentRecord {
  id: string;
  type: DocumentType;
  content: string;
  metadata?: Record<string, unknown>;
}

export class RAGRetriever {
  private threadId: string;
  private bm25Engine: BM25Engine;
  private vectorStore: VectorStore;
  private documentRegistry: Map<string, DocumentRecord>;
  private entityIndex: Map<string, Set<string>>;
  private entityNeighbors: Map<string, Map<string, number>>;

  constructor(threadId: string, vectorDimension: number = 384) {
    this.threadId = threadId;
    this.bm25Engine = new BM25Engine();
    this.vectorStore = new VectorStore(vectorDimension);
    this.documentRegistry = new Map();
    this.entityIndex = new Map();
    this.entityNeighbors = new Map();
  }

  private extractEntityKeys(text: string, metadata?: Record<string, unknown>): string[] {
    const keys = new Set<string>();
    const src = (text || "").slice(0, 12000);

    // URLs
    for (const match of src.matchAll(/\bhttps?:\/\/[^\s\]\)]+/gi)) {
      keys.add(match[0].toLowerCase());
    }

    // Citations like [doc:FILE ...]
    for (const match of src.matchAll(/\[doc:[^\]\n]+\]/gi)) {
      keys.add(match[0].toLowerCase());
    }

    // ISO dates
    for (const match of src.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
      keys.add(match[0]);
    }

    // File-ish tokens
    for (const match of src.matchAll(/\b[\w.-]+\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|json|png|jpe?g|webp)\b/gi)) {
      keys.add(match[0].toLowerCase());
    }

    // Lightweight "named entities": sequences of Capitalized words (2-4 words)
    for (const match of src.matchAll(/\b([A-Z][a-zA-Z]{2,})(\s+[A-Z][a-zA-Z]{2,}){1,3}\b/g)) {
      const candidate = match[0].trim();
      if (candidate.length >= 6 && candidate.length <= 60) {
        keys.add(candidate.toLowerCase());
      }
    }

    // Selected metadata keys (stable identifiers)
    if (metadata) {
      for (const k of ["artifactId", "imageId", "factId", "fileName", "checksum"]) {
        const v = metadata[k];
        if (typeof v === "string" && v.trim()) keys.add(`${k}:${v}`.toLowerCase());
      }
    }

    // Filter noisy keys
    return [...keys].filter(k => k.length >= 4 && k.length <= 180);
  }

  private indexEntityKeys(docId: string, entityKeys: string[]): void {
    for (const key of entityKeys) {
      let set = this.entityIndex.get(key);
      if (!set) {
        set = new Set();
        this.entityIndex.set(key, set);
      }
      set.add(docId);
    }
  }

  private indexEntityNeighbors(entityKeys: string[]): void {
    // Co-occurrence graph between entity keys for lightweight GraphRAG expansion.
    // Bound the pair count to avoid O(n^2) blow-ups on noisy docs.
    const keys = [...new Set(entityKeys)].slice(0, 20);
    if (keys.length < 2) return;

    for (let i = 0; i < keys.length; i++) {
      const a = keys[i];
      let adj = this.entityNeighbors.get(a);
      if (!adj) {
        adj = new Map();
        this.entityNeighbors.set(a, adj);
      }

      for (let j = 0; j < keys.length; j++) {
        if (i === j) continue;
        const b = keys[j];
        adj.set(b, (adj.get(b) || 0) + 1);
      }
    }
  }

  private removeEntityKeys(docId: string, entityKeys: string[]): void {
    for (const key of entityKeys) {
      const set = this.entityIndex.get(key);
      if (!set) continue;
      set.delete(docId);
      if (set.size === 0) this.entityIndex.delete(key);
    }
  }

  indexMessage(message: IndexedMessage): void {
    if (!message.content) return;

    const docId = `msg_${message.messageId}`;
    const metadata: Record<string, unknown> = {
      ...message.metadata,
      type: 'message' as DocumentType,
      messageId: message.messageId,
      role: message.role
    };

    const entityKeys = this.extractEntityKeys(message.content, metadata);
    metadata.entityKeys = entityKeys;

    this.bm25Engine.addDocument(docId, message.content, metadata);
    this.vectorStore.addDocument(docId, message.content, undefined, metadata);
    this.documentRegistry.set(docId, {
      id: docId,
      type: 'message',
      content: message.content,
      metadata
    });

    if (entityKeys.length > 0) this.indexEntityKeys(docId, entityKeys);
    if (entityKeys.length > 0) this.indexEntityNeighbors(entityKeys);
  }

  indexArtifact(artifact: IndexedArtifact): void {
    const baseMetadata = {
      ...artifact.metadata,
      type: 'artifact' as DocumentType,
      artifactId: artifact.artifactId
    };

    if (artifact.chunks && artifact.chunks.length > 0) {
      for (let i = 0; i < artifact.chunks.length; i++) {
        const chunk = artifact.chunks[i];
        if (!chunk.text) continue;

        const chunkId = chunk.chunkId || `chunk_${i}`;
        const docId = `artifact_${artifact.artifactId}_${chunkId}`;
        const chunkMetadata = {
          ...baseMetadata,
          chunkId,
          chunkIndex: i
        };

        const entityKeys = this.extractEntityKeys(chunk.text, chunkMetadata);
        (chunkMetadata as any).entityKeys = entityKeys;

        this.bm25Engine.addDocument(docId, chunk.text, chunkMetadata);
        this.vectorStore.addDocument(docId, chunk.text, undefined, chunkMetadata);
        this.documentRegistry.set(docId, {
          id: docId,
          type: 'artifact',
          content: chunk.text,
          metadata: chunkMetadata
        });

        if (entityKeys.length > 0) this.indexEntityKeys(docId, entityKeys);
        if (entityKeys.length > 0) this.indexEntityNeighbors(entityKeys);
      }
    }

    if (artifact.extractedText) {
      const docId = `artifact_${artifact.artifactId}_full`;
      const entityKeys = this.extractEntityKeys(artifact.extractedText, baseMetadata);
      (baseMetadata as any).entityKeys = entityKeys;

      this.bm25Engine.addDocument(docId, artifact.extractedText, baseMetadata);
      this.vectorStore.addDocument(docId, artifact.extractedText, undefined, baseMetadata);
      this.documentRegistry.set(docId, {
        id: docId,
        type: 'artifact',
        content: artifact.extractedText,
        metadata: baseMetadata
      });

      if (entityKeys.length > 0) this.indexEntityKeys(docId, entityKeys);
      if (entityKeys.length > 0) this.indexEntityNeighbors(entityKeys);
    }
  }

  indexImage(image: IndexedImage): void {
    const text = [image.prompt, image.visionDescription].filter(Boolean).join(' ').trim();
    if (!text) return;

    const docId = `img_${image.imageId}`;
    const metadata: Record<string, unknown> = {
      ...image.metadata,
      type: 'image' as DocumentType,
      imageId: image.imageId,
      prompt: image.prompt,
      visionDescription: image.visionDescription
    };

    const entityKeys = this.extractEntityKeys(text, metadata);
    metadata.entityKeys = entityKeys;

    this.bm25Engine.addDocument(docId, text, metadata);
    this.vectorStore.addDocument(docId, text, undefined, metadata);
    this.documentRegistry.set(docId, {
      id: docId,
      type: 'image',
      content: text,
      metadata
    });

    if (entityKeys.length > 0) this.indexEntityKeys(docId, entityKeys);
    if (entityKeys.length > 0) this.indexEntityNeighbors(entityKeys);
  }

  indexMemoryFact(fact: IndexedMemoryFact): void {
    if (!fact.content) return;

    const docId = `fact_${fact.factId}`;
    const metadata: Record<string, unknown> = {
      ...fact.metadata,
      type: 'fact' as DocumentType,
      factId: fact.factId,
      factType: fact.type
    };

    const entityKeys = this.extractEntityKeys(fact.content, metadata);
    metadata.entityKeys = entityKeys;

    this.bm25Engine.addDocument(docId, fact.content, metadata);
    this.vectorStore.addDocument(docId, fact.content, undefined, metadata);
    this.documentRegistry.set(docId, {
      id: docId,
      type: 'fact',
      content: fact.content,
      metadata
    });

    if (entityKeys.length > 0) this.indexEntityKeys(docId, entityKeys);
    if (entityKeys.length > 0) this.indexEntityNeighbors(entityKeys);
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const {
      topK = 10,
      minScore = 0,
      hybridAlpha = 0.5,
      fusion = "linear",
      rrfK = 60,
      filterTypes,
      rerank = "none",
      graphExpand = false,
      graphBoost = 0.12
    } = options;

    if (!query.trim()) return [];

    const bm25Results = this.bm25Engine.search(query, topK * 3);
    const vectorResults = this.vectorStore.searchByText(query, topK * 3, 0);

    const scoreMap = new Map<
      string,
      {
        bm25Score: number;
        vectorScore: number;
        bm25Rank?: number;
        vectorRank?: number;
        document: DocumentRecord;
      }
    >();

    const maxBM25Score = bm25Results.length > 0 ? Math.max(...bm25Results.map(r => r.score)) : 1;

    for (let i = 0; i < bm25Results.length; i++) {
      const result = bm25Results[i];
      const doc = this.documentRegistry.get(result.id);
      if (!doc) continue;
      if (filterTypes && filterTypes.length > 0 && !filterTypes.includes(doc.type)) continue;

      const normalizedBM25 = maxBM25Score > 0 ? result.score / maxBM25Score : 0;
      scoreMap.set(result.id, {
        bm25Score: normalizedBM25,
        vectorScore: 0,
        bm25Rank: i + 1,
        document: doc
      });
    }

    for (let i = 0; i < vectorResults.length; i++) {
      const result = vectorResults[i];
      const doc = this.documentRegistry.get(result.id);
      if (!doc) continue;
      if (filterTypes && filterTypes.length > 0 && !filterTypes.includes(doc.type)) continue;

      const existing = scoreMap.get(result.id);
      if (existing) {
        existing.vectorScore = result.score;
        existing.vectorRank = i + 1;
      } else {
        scoreMap.set(result.id, {
          bm25Score: 0,
          vectorScore: result.score,
          vectorRank: i + 1,
          document: doc
        });
      }
    }

    let results: SearchResult[] = [];

    for (const [id, scores] of scoreMap) {
      const finalScore =
        fusion === "rrf"
          ? (hybridAlpha * (scores.vectorRank ? 1 / (rrfK + scores.vectorRank) : 0)) +
            ((1 - hybridAlpha) * (scores.bm25Rank ? 1 / (rrfK + scores.bm25Rank) : 0))
          : hybridAlpha * scores.vectorScore + (1 - hybridAlpha) * scores.bm25Score;

      if (finalScore < minScore) continue;

      results.push({
        id,
        score: finalScore,
        type: scores.document.type,
        content: scores.document.content,
        metadata: scores.document.metadata
      });
    }

    results.sort((a, b) => b.score - a.score);

    // Lightweight GraphRAG-style boost/expansion based on shared entity keys among top hits.
    if (graphExpand && results.length > 0) {
      const anchors = results.slice(0, Math.min(3, results.length));
      const anchorKeyWeights = new Map<string, number>();

      for (const a of anchors) {
        const keys = (a.metadata as any)?.entityKeys as string[] | undefined;
        if (!keys) continue;
        for (const k of keys) {
          anchorKeyWeights.set(k, (anchorKeyWeights.get(k) || 0) + 1);
        }
      }

      const boostById = new Map<string, { weight: number; keys: Set<string> }>();

      const accumulate = (docId: string, key: string) => {
        const weight = anchorKeyWeights.get(key) || 0;
        if (weight <= 0) return;
        const existing = boostById.get(docId);
        if (!existing) {
          boostById.set(docId, { weight, keys: new Set([key]) });
        } else {
          existing.weight += weight;
          existing.keys.add(key);
        }
      };

      // Consider related docs via entity index (subgraph expansion).
      for (const [key, weight] of anchorKeyWeights) {
        const docIds = this.entityIndex.get(key);
        if (!docIds) continue;
        // Skip overly-common keys (noise)
        if (docIds.size > 30) continue;
        for (const docId of docIds) {
          accumulate(docId, key);
        }
      }

      // Expand one hop further using entity co-occurrence neighbors.
      // This helps when info is connected across docs by related entity mentions.
      const neighborKeyWeights = new Map<string, number>();
      for (const [key, weight] of anchorKeyWeights) {
        const neighbors = this.entityNeighbors.get(key);
        if (!neighbors) continue;
        for (const [nKey, nCount] of neighbors) {
          // De-prioritize very common neighbor edges.
          neighborKeyWeights.set(nKey, (neighborKeyWeights.get(nKey) || 0) + Math.min(2, nCount) * weight);
        }
      }

      const topNeighborKeys = [...neighborKeyWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k]) => k);

      for (const nKey of topNeighborKeys) {
        const docIds = this.entityIndex.get(nKey);
        if (!docIds) continue;
        if (docIds.size > 30) continue;
        // Use a small implied weight for neighbor expansion.
        anchorKeyWeights.set(nKey, (anchorKeyWeights.get(nKey) || 0) + 1);
        for (const docId of docIds) {
          accumulate(docId, nKey);
        }
      }

      const existing = new Set(results.map(r => r.id));
      const expanded: SearchResult[] = [];

      for (const [docId, info] of boostById) {
        const doc = this.documentRegistry.get(docId);
        if (!doc) continue;
        if (filterTypes && filterTypes.length > 0 && !filterTypes.includes(doc.type)) continue;

        const boost = graphBoost * Math.min(1, info.weight / 3);
        if (existing.has(docId)) {
          const r = results.find(x => x.id === docId);
          if (r) r.score += boost;
          continue;
        }

        expanded.push({
          id: docId,
          score: boost,
          type: doc.type,
          content: doc.content,
          metadata: {
            ...(doc.metadata || {}),
            _graph: {
              sharedKeys: [...info.keys].slice(0, 8),
              weight: info.weight,
            },
          },
        });
      }

      // Re-apply minScore after boosting/expansion.
      results = [...results, ...expanded].filter(r => r.score >= minScore);
      results.sort((a, b) => b.score - a.score);
    }

    if (rerank === "heuristic" && results.length > 1) {
      const qTokens = new Set(Utils.tokenize(query));
      const qEntity = new Set(this.extractEntityKeys(query));

      const overlap = (text: string): number => {
        if (qTokens.size === 0) return 0;
        const t = new Set(Utils.tokenize(text));
        let hit = 0;
        for (const tok of qTokens) if (t.has(tok)) hit++;
        return hit / qTokens.size;
      };

      const entityOverlap = (metadata?: Record<string, unknown>): number => {
        if (qEntity.size === 0) return 0;
        const keys = (metadata as any)?.entityKeys as string[] | undefined;
        if (!keys || keys.length === 0) return 0;
        let hit = 0;
        for (const k of keys) if (qEntity.has(String(k).toLowerCase())) hit++;
        return hit / Math.max(3, qEntity.size);
      };

      results.sort((a, b) => {
        const aScore = a.score + overlap(a.content) * 0.15 + entityOverlap(a.metadata) * 0.12;
        const bScore = b.score + overlap(b.content) * 0.15 + entityOverlap(b.metadata) * 0.12;
        return bScore - aScore;
      });
    }

    return results.slice(0, topK);
  }

  removeDocument(id: string): void {
    const doc = this.documentRegistry.get(id);
    const entityKeys = (doc?.metadata as any)?.entityKeys as string[] | undefined;
    if (entityKeys && entityKeys.length > 0) {
      this.removeEntityKeys(id, entityKeys);
    }
    this.bm25Engine.removeDocument(id);
    this.vectorStore.removeDocument(id);
    this.documentRegistry.delete(id);
  }

  clear(): void {
    this.bm25Engine.clear();
    this.vectorStore.clear();
    this.documentRegistry.clear();
    this.entityIndex.clear();
    this.entityNeighbors.clear();
  }

  getStats(): RAGStats {
    return {
      bm25Stats: this.bm25Engine.getStats(),
      vectorStats: this.vectorStore.getStats(),
      threadId: this.threadId
    };
  }
}
