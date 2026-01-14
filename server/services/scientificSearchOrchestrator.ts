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

export class ScientificSearchOrchestrator extends EventEmitter {
  private articles: ScientificArticle[] = [];
  private sourceStats: Map<string, { count: number; status: "success" | "error" | "timeout" }> = new Map();

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<ScientificSearchResult> {
    const startTime = Date.now();
    const maxResults = options.maxResults || 50;
    const sources = options.sources || ["all"];
    
    this.articles = [];
    this.sourceStats.clear();

    this.emitProgress({
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
          pubmedService.search(query, maxResults, (event) => this.handleSourceProgress(event))
        );
      } else if (source === "scielo") {
        searchPromises.push(
          scieloService.search(query, maxResults, (event) => this.handleSourceProgress(event))
        );
      }
    }

    const results = await Promise.allSettled(searchPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const source = useSources[i];
      
      if (result.status === "fulfilled") {
        this.articles.push(...result.value);
        this.sourceStats.set(source, { 
          count: result.value.length, 
          status: "success" 
        });
      } else {
        this.sourceStats.set(source, { 
          count: 0, 
          status: "error" 
        });
      }
    }

    const uniqueArticles = this.deduplicateArticles(this.articles);
    
    let filteredArticles = this.applyFilters(uniqueArticles, options);
    
    filteredArticles = this.sortByRelevance(filteredArticles);
    
    filteredArticles = filteredArticles.slice(0, maxResults);

    const searchDuration = Date.now() - startTime;

    this.emitProgress({
      type: "complete",
      source: "Orquestador",
      articlesFound: filteredArticles.length,
      totalArticles: filteredArticles.length,
      message: `✅ Búsqueda completada: ${filteredArticles.length} artículos científicos encontrados`,
      timestamp: Date.now(),
    });

    return {
      query,
      totalResults: filteredArticles.length,
      articles: filteredArticles,
      sources: Array.from(this.sourceStats.entries()).map(([name, stats]) => ({
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

  private handleSourceProgress(event: SearchProgressEvent): void {
    this.emitProgress(event);
    
    if (event.type === "filtering" || event.type === "found") {
      const totalSoFar = Array.from(this.sourceStats.values())
        .reduce((sum, s) => sum + s.count, 0) + event.articlesFound;
      
      this.emitProgress({
        type: "filtering",
        source: "Total",
        articlesFound: totalSoFar,
        totalArticles: totalSoFar,
        message: `📚 Total acumulado: ${totalSoFar} artículos encontrados`,
        timestamp: Date.now(),
      });
    }
  }

  private deduplicateArticles(articles: ScientificArticle[]): ScientificArticle[] {
    const seen = new Map<string, ScientificArticle>();
    
    for (const article of articles) {
      const key = article.doi || 
                  article.pmid || 
                  article.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 100);
      
      if (!seen.has(key)) {
        seen.set(key, article);
      } else {
        const existing = seen.get(key)!;
        if (this.hasMoreData(article, existing)) {
          seen.set(key, this.mergeArticles(existing, article));
        }
      }
    }
    
    return Array.from(seen.values());
  }

  private hasMoreData(a: ScientificArticle, b: ScientificArticle): boolean {
    const scoreA = (a.abstract ? 1 : 0) + (a.doi ? 1 : 0) + (a.citationCount ? 1 : 0);
    const scoreB = (b.abstract ? 1 : 0) + (b.doi ? 1 : 0) + (b.citationCount ? 1 : 0);
    return scoreA > scoreB;
  }

  private mergeArticles(existing: ScientificArticle, newArticle: ScientificArticle): ScientificArticle {
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

  private applyFilters(articles: ScientificArticle[], options: SearchOptions): ScientificArticle[] {
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

  private sortByRelevance(articles: ScientificArticle[]): ScientificArticle[] {
    return articles.sort((a, b) => {
      const scoreA = this.calculateRelevanceScore(a);
      const scoreB = this.calculateRelevanceScore(b);
      return scoreB - scoreA;
    });
  }

  private calculateRelevanceScore(article: ScientificArticle): number {
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

  private emitProgress(event: SearchProgressEvent): void {
    this.emit("progress", event);
  }

  generateBibliography(articles: ScientificArticle[]): string {
    const citations = articles
      .map((article, index) => `${index + 1}. ${generateAPA7Citation(article)}`)
      .join("\n\n");
    
    return `## Referencias (APA 7ma Edición)\n\n${citations}`;
  }
}

export const scientificSearchOrchestrator = new ScientificSearchOrchestrator();
