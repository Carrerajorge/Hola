/**
 * Parallel Research Engine
 *
 * Orchestrates multi-source web research, browser automation,
 * data extraction, and synthesis into a unified research pipeline.
 *
 * Features:
 * - Parallel web search across multiple engines
 * - Browser automation for data extraction
 * - Multi-model synthesis (Gemini for research, Opus for analysis)
 * - Source credibility scoring
 * - Citation management
 * - Real-time progress streaming
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { agentEventBus } from "./eventBus";

// ============================================
// Types
// ============================================

export interface ResearchQuery {
  id?: string;
  topic: string;
  depth: "quick" | "moderate" | "deep" | "exhaustive";
  sources?: SourceType[];
  maxSources?: number;
  language?: string;
  timeRange?: "day" | "week" | "month" | "year" | "all";
  requireCitations?: boolean;
  userId: string;
  outputFormat?: "summary" | "report" | "raw_data" | "structured";
}

export type SourceType =
  | "web_search"
  | "academic"
  | "news"
  | "social_media"
  | "github"
  | "arxiv"
  | "wikipedia"
  | "youtube"
  | "reddit"
  | "custom_url";

export interface ResearchResult {
  id: string;
  query: ResearchQuery;
  sources: SourceResult[];
  synthesis: string;
  keyFindings: string[];
  citations: Citation[];
  confidence: number;
  totalSourcesConsulted: number;
  durationMs: number;
  modelsUsed: string[];
  metadata: Record<string, any>;
}

export interface SourceResult {
  id: string;
  type: SourceType;
  url?: string;
  title: string;
  content: string;
  snippet: string;
  relevanceScore: number;
  credibilityScore: number;
  timestamp?: Date;
  author?: string;
  metadata?: Record<string, any>;
}

export interface Citation {
  id: string;
  sourceId: string;
  text: string;
  url?: string;
  title: string;
  author?: string;
  date?: string;
  type: "web" | "academic" | "news" | "social";
}

export interface ResearchProgress {
  queryId: string;
  phase: "searching" | "extracting" | "analyzing" | "synthesizing" | "complete";
  sourcesFound: number;
  sourcesProcessed: number;
  currentSource?: string;
  estimatedTimeRemaining?: number;
}

// ============================================
// Depth Configuration
// ============================================

const DEPTH_CONFIG = {
  quick: { maxSources: 5, searchQueries: 1, synthesisModel: "grok-3", extractDepth: "snippet" },
  moderate: { maxSources: 15, searchQueries: 3, synthesisModel: "gemini-2.5-pro", extractDepth: "full" },
  deep: { maxSources: 30, searchQueries: 5, synthesisModel: "claude-opus-4-6", extractDepth: "full" },
  exhaustive: { maxSources: 50, searchQueries: 8, synthesisModel: "claude-opus-4-6", extractDepth: "deep" },
} as const;

// ============================================
// Parallel Research Engine
// ============================================

export class ParallelResearchEngine extends EventEmitter {
  private activeResearch: Map<string, { abort: AbortController; progress: ResearchProgress }> = new Map();

  constructor() {
    super();
  }

  /**
   * Execute a full research pipeline.
   */
  async research(query: ResearchQuery): Promise<ResearchResult> {
    const startTime = Date.now();
    const queryId = query.id || randomUUID();
    query.id = queryId;

    const abort = new AbortController();
    const progress: ResearchProgress = {
      queryId,
      phase: "searching",
      sourcesFound: 0,
      sourcesProcessed: 0,
    };
    this.activeResearch.set(queryId, { abort, progress });

    const depthConfig = DEPTH_CONFIG[query.depth];
    const modelsUsed: string[] = [];

    try {
      // Phase 1: Generate search queries
      this.updateProgress(queryId, { phase: "searching" });
      const searchQueries = await this.generateSearchQueries(query, depthConfig.searchQueries);

      // Phase 2: Execute parallel searches
      const sources = query.sources || ["web_search", "news"];
      const allSourceResults = await this.executeParallelSearch(
        searchQueries,
        sources,
        depthConfig.maxSources,
        queryId
      );

      progress.sourcesFound = allSourceResults.length;
      this.updateProgress(queryId, { sourcesFound: allSourceResults.length });

      // Phase 3: Extract and analyze content
      this.updateProgress(queryId, { phase: "extracting" });
      const enrichedSources = await this.enrichSources(allSourceResults, depthConfig.extractDepth, queryId);

      // Phase 4: Score and rank sources
      this.updateProgress(queryId, { phase: "analyzing" });
      const scoredSources = this.scoreSources(enrichedSources, query.topic);
      const topSources = scoredSources.slice(0, query.maxSources || depthConfig.maxSources);

      // Phase 5: Synthesize findings
      this.updateProgress(queryId, { phase: "synthesizing" });
      const { synthesis, keyFindings } = await this.synthesize(
        topSources,
        query,
        depthConfig.synthesisModel
      );
      modelsUsed.push(depthConfig.synthesisModel);

      // Phase 6: Generate citations
      const citations = this.generateCitations(topSources);

      // Complete
      this.updateProgress(queryId, { phase: "complete" });

      const result: ResearchResult = {
        id: queryId,
        query,
        sources: topSources,
        synthesis,
        keyFindings,
        citations,
        confidence: this.calculateConfidence(topSources),
        totalSourcesConsulted: allSourceResults.length,
        durationMs: Date.now() - startTime,
        modelsUsed,
        metadata: {
          searchQueries,
          depthConfig: query.depth,
          sourcesScored: scoredSources.length,
        },
      };

      this.emit("research_completed", result);
      return result;
    } catch (err: any) {
      this.emit("research_failed", { queryId, error: err.message });
      throw err;
    } finally {
      this.activeResearch.delete(queryId);
    }
  }

  /**
   * Generate diverse search queries from the main topic.
   */
  private async generateSearchQueries(query: ResearchQuery, count: number): Promise<string[]> {
    const queries = [query.topic];

    // Generate variations
    const variations = [
      `${query.topic} latest developments ${new Date().getFullYear()}`,
      `${query.topic} research findings`,
      `${query.topic} comparison analysis`,
      `${query.topic} expert opinion`,
      `${query.topic} case studies examples`,
      `${query.topic} challenges limitations`,
      `${query.topic} future trends predictions`,
      `${query.topic} best practices recommendations`,
    ];

    // Add language-specific queries
    if (query.language === "es" || /[áéíóúñ]/i.test(query.topic)) {
      variations.push(
        `${query.topic} últimas noticias`,
        `${query.topic} análisis profundo`,
        `${query.topic} tendencias actuales`,
      );
    }

    return queries.concat(variations.slice(0, count - 1));
  }

  /**
   * Execute parallel searches across multiple sources.
   */
  private async executeParallelSearch(
    queries: string[],
    sources: SourceType[],
    maxResults: number,
    queryId: string
  ): Promise<SourceResult[]> {
    const searchPromises: Promise<SourceResult[]>[] = [];

    for (const sourceType of sources) {
      for (const searchQuery of queries) {
        searchPromises.push(
          this.searchSource(sourceType, searchQuery, Math.ceil(maxResults / queries.length))
            .catch((err) => {
              console.warn(`[Research] Search failed for ${sourceType}: ${err.message}`);
              return [] as SourceResult[];
            })
        );
      }
    }

    const results = await Promise.all(searchPromises);
    const allResults = results.flat();

    // Deduplicate by URL
    const seen = new Set<string>();
    return allResults.filter((r) => {
      const key = r.url || r.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Search a specific source type.
   */
  private async searchSource(type: SourceType, query: string, maxResults: number): Promise<SourceResult[]> {
    try {
      const { toolRegistry } = await import("./toolRegistry");

      switch (type) {
        case "web_search": {
          const result = await toolRegistry.executeTool("web_search", { query, maxResults });
          return this.parseWebSearchResults(result, type);
        }

        case "academic": {
          const result = await toolRegistry.executeTool("web_search", { query: `${query} site:scholar.google.com OR site:arxiv.org OR site:pubmed.ncbi.nlm.nih.gov`, maxResults });
          return this.parseWebSearchResults(result, type);
        }

        case "news": {
          const result = await toolRegistry.executeTool("web_search", { query: `${query} latest news`, maxResults });
          return this.parseWebSearchResults(result, type);
        }

        case "github": {
          const result = await toolRegistry.executeTool("web_search", { query: `${query} site:github.com`, maxResults });
          return this.parseWebSearchResults(result, type);
        }

        case "arxiv": {
          const result = await toolRegistry.executeTool("web_search", { query: `${query} site:arxiv.org`, maxResults });
          return this.parseWebSearchResults(result, type);
        }

        case "wikipedia": {
          const result = await toolRegistry.executeTool("web_search", { query: `${query} site:wikipedia.org`, maxResults: Math.min(maxResults, 3) });
          return this.parseWebSearchResults(result, type);
        }

        case "reddit": {
          const result = await toolRegistry.executeTool("web_search", { query: `${query} site:reddit.com`, maxResults });
          return this.parseWebSearchResults(result, type);
        }

        case "youtube": {
          const result = await toolRegistry.executeTool("web_search", { query: `${query} site:youtube.com`, maxResults });
          return this.parseWebSearchResults(result, type);
        }

        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  /**
   * Parse raw search results into SourceResult format.
   */
  private parseWebSearchResults(raw: any, type: SourceType): SourceResult[] {
    if (!raw) return [];

    const items = raw.results || raw.items || raw.data || (Array.isArray(raw) ? raw : []);

    return items.map((item: any) => ({
      id: randomUUID(),
      type,
      url: item.url || item.link || item.href,
      title: item.title || item.name || "Untitled",
      content: item.content || item.body || item.description || "",
      snippet: (item.snippet || item.description || item.content || "").substring(0, 500),
      relevanceScore: 0,
      credibilityScore: 0,
      timestamp: item.date ? new Date(item.date) : undefined,
      author: item.author,
    }));
  }

  /**
   * Enrich sources with full content extraction.
   */
  private async enrichSources(
    sources: SourceResult[],
    depth: string,
    queryId: string
  ): Promise<SourceResult[]> {
    if (depth === "snippet") return sources;

    const enrichPromises = sources.map(async (source, index) => {
      this.updateProgress(queryId, { sourcesProcessed: index, currentSource: source.title });

      if (!source.url) return source;

      try {
        const { toolRegistry } = await import("./toolRegistry");
        const result = await toolRegistry.executeTool("browse_url", {
          url: source.url,
          extractText: true,
        });

        if (result?.content || result?.text) {
          source.content = (result.content || result.text || "").substring(0, 5000);
        }
      } catch {
        // Keep original snippet
      }

      return source;
    });

    return Promise.all(enrichPromises);
  }

  /**
   * Score and rank sources by relevance and credibility.
   */
  private scoreSources(sources: SourceResult[], topic: string): SourceResult[] {
    const topicWords = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

    for (const source of sources) {
      const contentLower = (source.content + " " + source.title).toLowerCase();

      // Relevance: keyword overlap
      let relevance = 0;
      for (const word of topicWords) {
        if (contentLower.includes(word)) relevance += 1 / topicWords.length;
      }
      source.relevanceScore = Math.min(1, relevance);

      // Credibility: domain trust
      const url = source.url || "";
      const trustedDomains = [
        "wikipedia.org", "arxiv.org", "github.com", "nature.com", "science.org",
        "ieee.org", "acm.org", "scholar.google", ".edu", ".gov", "bbc.com",
        "reuters.com", "nytimes.com", "who.int", "un.org",
      ];
      source.credibilityScore = trustedDomains.some((d) => url.includes(d)) ? 0.9 : 0.5;

      // Boost for content length (more content = likely more valuable)
      if (source.content.length > 1000) source.relevanceScore += 0.1;
      if (source.content.length > 3000) source.relevanceScore += 0.1;
    }

    // Sort by combined score
    return sources.sort((a, b) =>
      (b.relevanceScore * 0.7 + b.credibilityScore * 0.3) - (a.relevanceScore * 0.7 + a.credibilityScore * 0.3)
    );
  }

  /**
   * Synthesize findings using LLM.
   */
  private async synthesize(
    sources: SourceResult[],
    query: ResearchQuery,
    model: string
  ): Promise<{ synthesis: string; keyFindings: string[] }> {
    const { llmGateway } = await import("../lib/llmGateway");

    const sourcesSummary = sources
      .slice(0, 20)
      .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url || "N/A"}\nContent: ${s.content.substring(0, 1000)}`)
      .join("\n\n---\n\n");

    const isSpanish = query.language === "es" || /[áéíóúñ]/i.test(query.topic);

    const systemPrompt = isSpanish
      ? `Eres un investigador experto. Sintetiza la información de múltiples fuentes en un análisis completo y bien estructurado. Incluye hallazgos clave, tendencias, y conclusiones. Responde en español.`
      : `You are an expert researcher. Synthesize information from multiple sources into a comprehensive, well-structured analysis. Include key findings, trends, and conclusions.`;

    const userPrompt = isSpanish
      ? `Tema de investigación: "${query.topic}"\n\nFuentes encontradas (${sources.length}):\n\n${sourcesSummary}\n\nPor favor genera:\n1. Un resumen ejecutivo\n2. Hallazgos clave (lista)\n3. Análisis detallado\n4. Conclusiones y recomendaciones`
      : `Research topic: "${query.topic}"\n\nSources found (${sources.length}):\n\n${sourcesSummary}\n\nPlease generate:\n1. Executive summary\n2. Key findings (list)\n3. Detailed analysis\n4. Conclusions and recommendations`;

    try {
      const response = await llmGateway.chat(
        [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userPrompt },
        ],
        { model, temperature: 0.3, maxTokens: 4096 }
      );

      const synthesis = typeof response === "string" ? response : response?.content || "";

      // Extract key findings
      const keyFindings = this.extractKeyFindings(synthesis);

      return { synthesis, keyFindings };
    } catch (err) {
      console.error("[Research] Synthesis failed:", err);
      return {
        synthesis: sources.map((s) => `**${s.title}**: ${s.snippet}`).join("\n\n"),
        keyFindings: sources.slice(0, 5).map((s) => s.title),
      };
    }
  }

  /**
   * Extract key findings from synthesis text.
   */
  private extractKeyFindings(text: string): string[] {
    const findings: string[] = [];

    // Look for numbered lists or bullet points
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[\d]+[\.\)]\s+/.test(trimmed) || /^[-•*]\s+/.test(trimmed)) {
        const cleaned = trimmed.replace(/^[\d]+[\.\)]\s+|^[-•*]\s+/, "").trim();
        if (cleaned.length > 10 && cleaned.length < 500) {
          findings.push(cleaned);
        }
      }
    }

    return findings.slice(0, 10);
  }

  /**
   * Generate citations from sources.
   */
  private generateCitations(sources: SourceResult[]): Citation[] {
    return sources.map((source) => ({
      id: randomUUID(),
      sourceId: source.id,
      text: `${source.title}${source.author ? ` - ${source.author}` : ""}`,
      url: source.url,
      title: source.title,
      author: source.author,
      date: source.timestamp?.toISOString().split("T")[0],
      type: this.mapSourceToCitationType(source.type),
    }));
  }

  private mapSourceToCitationType(type: SourceType): Citation["type"] {
    switch (type) {
      case "academic":
      case "arxiv":
        return "academic";
      case "news":
        return "news";
      case "social_media":
      case "reddit":
      case "youtube":
        return "social";
      default:
        return "web";
    }
  }

  /**
   * Calculate overall confidence based on source quality.
   */
  private calculateConfidence(sources: SourceResult[]): number {
    if (sources.length === 0) return 0;
    const avgRelevance = sources.reduce((sum, s) => sum + s.relevanceScore, 0) / sources.length;
    const avgCredibility = sources.reduce((sum, s) => sum + s.credibilityScore, 0) / sources.length;
    const sourceCountFactor = Math.min(1, sources.length / 10);
    return (avgRelevance * 0.4 + avgCredibility * 0.3 + sourceCountFactor * 0.3);
  }

  /**
   * Update research progress.
   */
  private updateProgress(queryId: string, update: Partial<ResearchProgress>): void {
    const entry = this.activeResearch.get(queryId);
    if (!entry) return;

    Object.assign(entry.progress, update);
    this.emit("research_progress", entry.progress);
  }

  /**
   * Cancel an active research query.
   */
  cancelResearch(queryId: string): void {
    const entry = this.activeResearch.get(queryId);
    if (entry) {
      entry.abort.abort();
      this.activeResearch.delete(queryId);
      this.emit("research_cancelled", { queryId });
    }
  }

  /**
   * Get progress of active research.
   */
  getProgress(queryId: string): ResearchProgress | undefined {
    return this.activeResearch.get(queryId)?.progress;
  }
}

// Singleton
export const parallelResearchEngine = new ParallelResearchEngine();
