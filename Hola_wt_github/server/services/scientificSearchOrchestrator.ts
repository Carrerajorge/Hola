import { EventEmitter } from "events";
import { ScientificArticle, SearchProgressEvent, ScientificSearchResult, generateAPA7Citation } from "@shared/scientificArticleSchema";
import { pubmedService } from "./pubmedService";
import { scieloService } from "./scieloService";

interface SearchOptions {
  maxResults?: number;
  sources?: ("pubmed" | "scielo" | "all")[];
  yearFrom?: number;
  yearTo?: number;
  languages?: string[];
  openAccessOnly?: boolean;
  publicationTypes?: string[];
}

interface SearchContext {
  articles: ScientificArticle[];
  sourceStats: Map<string, { count: number; status: "success" | "error" | "timeout" }>;
  emitter: EventEmitter;
}

export function createScientificSearchOrchestrator() {
  async function search(
    query: string,
    options: SearchOptions = {},
    onProgress?: (event: SearchProgressEvent) => void
  ): Promise<ScientificSearchResult> {
    const startTime = Date.now();
    const maxResults = options.maxResults || 50;
    const sources = options.sources || ["all"];
    
    const ctx: SearchContext = {
      articles: [],
      sourceStats: new Map(),
      emitter: new EventEmitter(),
    };

    if (onProgress) {
      ctx.emitter.on("progress", onProgress);
    }

    emitProgress(ctx, {
      type: "searching",
      source: "Orquestador",
      articlesFound: 0,
      totalArticles: 0,
      message: "🔬 Iniciando búsqueda científica multi-fuente...",
      timestamp: Date.now(),
    });

    const searchPromises: Promise<ScientificArticle[]>[] = [];
    const useSources = sources.includes("all") 
      ? ["pubmed", "scielo"] 
      : sources;

    for (const source of useSources) {
      if (source === "pubmed") {
        searchPromises.push(
          pubmedService.search(query, maxResults, (event) => handleSourceProgress(ctx, event))
        );
      } else if (source === "scielo") {
        searchPromises.push(
          scieloService.search(query, maxResults, (event) => handleSourceProgress(ctx, event))
        );
      }
    }

    const results = await Promise.allSettled(searchPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const source = useSources[i];
      
      if (result.status === "fulfilled") {
        ctx.articles.push(...result.value);
        ctx.sourceStats.set(source, { 
          count: result.value.length, 
          status: "success" 
        });
      } else {
        ctx.sourceStats.set(source, { 
          count: 0, 
          status: "error" 
        });
      }
    }

    const uniqueArticles = deduplicateArticles(ctx.articles);
    
    let filteredArticles = applyFilters(uniqueArticles, options);
    
    filteredArticles = sortByRelevance(filteredArticles);
    
    filteredArticles = filteredArticles.slice(0, maxResults);

    const searchDuration = Date.now() - startTime;

    emitProgress(ctx, {
      type: "complete",
      source: "Orquestador",
      articlesFound: filteredArticles.length,
      totalArticles: filteredArticles.length,
      message: `✅ Búsqueda completada: ${filteredArticles.length} artículos científicos encontrados`,
      timestamp: Date.now(),
    });

    ctx.emitter.removeAllListeners();

    return {
      query,
      totalResults: filteredArticles.length,
      articles: filteredArticles,
      sources: Array.from(ctx.sourceStats.entries()).map(([name, stats]) => ({
        name,
        count: stats.count,
        status: stats.status,
      })),
      searchDuration,
      filters: {
        yearFrom: options.yearFrom,
        yearTo: options.yearTo,
        languages: options.languages,
        openAccessOnly: options.openAccessOnly,
        publicationTypes: options.publicationTypes,
      },
    };
  }

  function handleSourceProgress(ctx: SearchContext, event: SearchProgressEvent): void {
    emitProgress(ctx, event);
    
    if (event.type === "filtering" || event.type === "found") {
      const totalSoFar = Array.from(ctx.sourceStats.values())
        .reduce((sum, s) => sum + s.count, 0) + event.articlesFound;
      
      emitProgress(ctx, {
        type: "filtering",
        source: "Total",
        articlesFound: totalSoFar,
        totalArticles: totalSoFar,
        message: `📚 Total acumulado: ${totalSoFar} artículos encontrados`,
        timestamp: Date.now(),
      });
    }
  }

  function deduplicateArticles(articles: ScientificArticle[]): ScientificArticle[] {
    const seen = new Map<string, ScientificArticle>();
    
    for (const article of articles) {
      const key = article.doi || 
                  article.pmid || 
                  article.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 100);
      
      if (!seen.has(key)) {
        seen.set(key, article);
      } else {
        const existing = seen.get(key)!;
        if (hasMoreData(article, existing)) {
          seen.set(key, mergeArticles(existing, article));
        }
      }
    }
    
    return Array.from(seen.values());
  }

  function hasMoreData(a: ScientificArticle, b: ScientificArticle): boolean {
    const scoreA = (a.abstract ? 1 : 0) + (a.doi ? 1 : 0) + (a.citationCount ? 1 : 0);
    const scoreB = (b.abstract ? 1 : 0) + (b.doi ? 1 : 0) + (b.citationCount ? 1 : 0);
    return scoreA > scoreB;
  }

  function mergeArticles(existing: ScientificArticle, newArticle: ScientificArticle): ScientificArticle {
    return {
      ...existing,
      abstract: existing.abstract || newArticle.abstract,
      doi: existing.doi || newArticle.doi,
      pmid: existing.pmid || newArticle.pmid,
      citationCount: existing.citationCount || newArticle.citationCount,
      keywords: existing.keywords || newArticle.keywords,
      pdfUrl: existing.pdfUrl || newArticle.pdfUrl,
    };
  }

  function applyFilters(articles: ScientificArticle[], options: SearchOptions): ScientificArticle[] {
    return articles.filter(article => {
      if (options.yearFrom && article.year && article.year < options.yearFrom) {
        return false;
      }
      if (options.yearTo && article.year && article.year > options.yearTo) {
        return false;
      }
      if (options.openAccessOnly && !article.isOpenAccess) {
        return false;
      }
      if (options.languages && options.languages.length > 0) {
        const articleLang = article.language?.toLowerCase();
        if (articleLang && !options.languages.some(l => articleLang.startsWith(l.toLowerCase()))) {
          return false;
        }
      }
      if (options.publicationTypes && options.publicationTypes.length > 0) {
        if (article.publicationType && !options.publicationTypes.includes(article.publicationType)) {
          return false;
        }
      }
      return true;
    });
  }

  function sortByRelevance(articles: ScientificArticle[]): ScientificArticle[] {
    return articles.sort((a, b) => {
      const scoreA = calculateRelevanceScore(a);
      const scoreB = calculateRelevanceScore(b);
      return scoreB - scoreA;
    });
  }

  function calculateRelevanceScore(article: ScientificArticle): number {
    let score = 0;
    
    const currentYear = new Date().getFullYear();
    if (article.year) {
      const age = currentYear - article.year;
      score += Math.max(0, 10 - age);
    }
    
    if (article.citationCount) {
      score += Math.min(article.citationCount, 100) / 10;
    }
    
    if (article.abstract) score += 2;
    if (article.doi) score += 1;
    if (article.isOpenAccess) score += 1;
    
    const typeScores: Record<string, number> = {
      meta_analysis: 5,
      systematic_review: 4,
      randomized_controlled_trial: 3,
      clinical_trial: 2,
      review: 2,
    };
    score += typeScores[article.publicationType || ""] || 0;
    
    return score;
  }

  function emitProgress(ctx: SearchContext, event: SearchProgressEvent): void {
    ctx.emitter.emit("progress", event);
  }

  function generateBibliography(articles: ScientificArticle[]): string {
    const citations = articles
      .map((article, index) => `${index + 1}. ${generateAPA7Citation(article)}`)
      .join("\n\n");
    
    return `## Referencias (APA 7ma Edición)\n\n${citations}`;
  }

  return {
    search,
    generateBibliography,
  };
}

export const scientificSearchOrchestrator = createScientificSearchOrchestrator();
