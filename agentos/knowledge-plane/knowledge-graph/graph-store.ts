/**
 * AgentOS Knowledge-Plane — Knowledge Graph Store
 *
 * In-memory knowledge graph supporting:
 *  - Node and edge CRUD with typed properties
 *  - Cypher-like pattern queries (MATCH (a)-[r]->(b) style)
 *  - Entity linking (fuzzy label match)
 *  - Graph-enhanced retrieval (expand query with neighbours)
 */

import { KnowledgeGraphNode, KnowledgeGraphEdge, Chunk } from "../types";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[GRAPH][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[GRAPH][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[GRAPH][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

export interface CypherPattern {
  /** Source entity type (or "*" for any). */
  sourceType: string;
  /** Relation (or "*" for any). */
  relation: string;
  /** Target entity type (or "*" for any). */
  targetType: string;
  /** Optional property filters on the source. */
  sourceFilters?: Record<string, unknown>;
}

export interface GraphQueryResult {
  source: KnowledgeGraphNode;
  edge: KnowledgeGraphEdge;
  target: KnowledgeGraphNode;
}

export interface EntityLinkResult {
  node: KnowledgeGraphNode;
  score: number;
}

// ---------------------------------------------------------------------------
// Graph Store
// ---------------------------------------------------------------------------

export class GraphStore {
  private nodes = new Map<string, KnowledgeGraphNode>();
  private edges = new Map<string, KnowledgeGraphEdge>();
  /** Adjacency list: nodeId -> outgoing edge ids */
  private outgoing = new Map<string, Set<string>>();
  /** Reverse adjacency: nodeId -> incoming edge ids */
  private incoming = new Map<string, Set<string>>();

  constructor() {
    log.info("GraphStore initialised");
  }

  // ---- Node CRUD ---------------------------------------------------------

  addNode(node: KnowledgeGraphNode): void {
    if (this.nodes.has(node.id)) {
      log.warn("Overwriting existing node", { id: node.id });
    }
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, new Set());
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, new Set());
  }

  getNode(id: string): KnowledgeGraphNode | undefined {
    return this.nodes.get(id);
  }

  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    // Remove associated edges
    for (const edgeId of this.outgoing.get(id) ?? []) this.edges.delete(edgeId);
    for (const edgeId of this.incoming.get(id) ?? []) this.edges.delete(edgeId);
    this.outgoing.delete(id);
    this.incoming.delete(id);
    this.nodes.delete(id);
    return true;
  }

  // ---- Edge CRUD ---------------------------------------------------------

  addEdge(edge: KnowledgeGraphEdge): void {
    if (!this.nodes.has(edge.sourceId) || !this.nodes.has(edge.targetId)) {
      log.error("Cannot add edge — missing endpoint node", { edge: edge.id });
      return;
    }
    this.edges.set(edge.id, edge);
    this.outgoing.get(edge.sourceId)!.add(edge.id);
    this.incoming.get(edge.targetId)!.add(edge.id);
  }

  getEdge(id: string): KnowledgeGraphEdge | undefined {
    return this.edges.get(id);
  }

  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;
    this.outgoing.get(edge.sourceId)?.delete(id);
    this.incoming.get(edge.targetId)?.delete(id);
    this.edges.delete(id);
    return true;
  }

  // ---- Cypher-like pattern query -----------------------------------------

  query(pattern: CypherPattern): GraphQueryResult[] {
    const results: GraphQueryResult[] = [];

    for (const edge of this.edges.values()) {
      if (pattern.relation !== "*" && edge.relation !== pattern.relation) continue;

      const src = this.nodes.get(edge.sourceId);
      const tgt = this.nodes.get(edge.targetId);
      if (!src || !tgt) continue;

      if (pattern.sourceType !== "*" && src.entityType !== pattern.sourceType) continue;
      if (pattern.targetType !== "*" && tgt.entityType !== pattern.targetType) continue;

      if (pattern.sourceFilters && !this.matchesFilters(src, pattern.sourceFilters)) continue;

      results.push({ source: src, edge, target: tgt });
    }

    log.info("Pattern query executed", { pattern, matches: results.length });
    return results;
  }

  // ---- Entity linking (fuzzy label match) --------------------------------

  linkEntity(label: string, topK = 5): EntityLinkResult[] {
    const normalised = label.toLowerCase().trim();
    const scored: EntityLinkResult[] = [];

    for (const node of this.nodes.values()) {
      const score = this.fuzzyScore(normalised, node.label.toLowerCase());
      if (score > 0) {
        scored.push({ node, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  // ---- Graph-enhanced retrieval ------------------------------------------

  /**
   * Given a set of chunk IDs, find all graph nodes linked to those chunks,
   * then expand one hop to collect neighbouring chunk IDs.
   * Returns extra chunk IDs that should be included in retrieval.
   */
  expandFromChunks(chunkIds: string[], maxExpansion = 20): string[] {
    const seedNodes = new Set<string>();
    for (const node of this.nodes.values()) {
      for (const cid of node.linkedChunkIds) {
        if (chunkIds.includes(cid)) {
          seedNodes.add(node.id);
        }
      }
    }

    const expandedChunks = new Set<string>();
    for (const nodeId of seedNodes) {
      // Outgoing neighbours
      for (const edgeId of this.outgoing.get(nodeId) ?? []) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        const neighbour = this.nodes.get(edge.targetId);
        if (neighbour) {
          for (const cid of neighbour.linkedChunkIds) expandedChunks.add(cid);
        }
      }
      // Incoming neighbours
      for (const edgeId of this.incoming.get(nodeId) ?? []) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        const neighbour = this.nodes.get(edge.sourceId);
        if (neighbour) {
          for (const cid of neighbour.linkedChunkIds) expandedChunks.add(cid);
        }
      }
    }

    // Remove seeds and cap
    for (const cid of chunkIds) expandedChunks.delete(cid);
    const result = [...expandedChunks].slice(0, maxExpansion);
    log.info("Graph expansion", { seeds: chunkIds.length, expanded: result.length });
    return result;
  }

  // ---- Stats -------------------------------------------------------------

  stats(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.size };
  }

  // ---- Private helpers ---------------------------------------------------

  private matchesFilters(node: KnowledgeGraphNode, filters: Record<string, unknown>): boolean {
    for (const [key, val] of Object.entries(filters)) {
      if (node.properties[key] !== val) return false;
    }
    return true;
  }

  /** Simple bigram overlap score for fuzzy matching. */
  private fuzzyScore(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

    const bigramsA = new Set<string>();
    for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));

    let intersection = 0;
    const bigramCountB = b.length - 1;
    for (let i = 0; i < b.length - 1; i++) {
      if (bigramsA.has(b.slice(i, i + 2))) intersection++;
    }

    return (2 * intersection) / (bigramsA.size + bigramCountB);
  }
}
