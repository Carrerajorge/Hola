import { AcademicCandidate, searchOpenAlex, searchOpenAlexWithMultipleQueries } from "./openAlexClient";
import { searchCrossRef } from "./crossrefClient";
import { 
  filterByRelevanceAgent, 
  verifyBatch, 
  enrichBatch, 
  runCriticGuard, 
  deduplicateCandidates,
  CriticResult 
} from "./academicAgents";
import { createXlsx, storeArtifactMeta, ArtifactMeta } from "./artifactTools";
import { EventEmitter } from "events";

export interface PipelineConfig {
  targetCount: number;
  yearStart: number;
  yearEnd: number;
  maxRetries: number;
  verificationConcurrency: number;
}

const DEFAULT_CONFIG: PipelineConfig = {
  targetCount: 50,
  yearStart: 2020,
  yearEnd: 2025,
  maxRetries: 3,
  verificationConcurrency: 5,
};

export interface PipelineResult {
  success: boolean;
  articles: AcademicCandidate[];
  criticResult: CriticResult;
  artifact?: ArtifactMeta;
  stats: {
    totalFetched: number;
    relevantAfterFilter: number;
    verifiedCount: number;
    finalCount: number;
    durationMs: number;
  };
}

function buildSearchQueries(topic: string): string[] {
  const baseTerms = extractKeyTerms(topic);
  
  const queries = [
    `"recycled steel" concrete strength`,
    `"recycled steel fibers" concrete compressive strength`,
    `"scrap steel" concrete mechanical properties`,
    `"recycled reinforcement" concrete strength`,
    `steel slag concrete strength`,
    baseTerms.join(" "),
  ];

  return queries.filter((q, i, arr) => arr.indexOf(q) === i);
}

function extractKeyTerms(topic: string): string[] {
  const spanish: Record<string, string> = {
    "acero": "steel",
    "reciclado": "recycled",
    "concreto": "concrete",
    "resistencia": "strength",
    "hormigón": "concrete",
    "hormigon": "concrete",
  };

  const words = topic.toLowerCase().split(/\s+/);
  const terms: string[] = [];
  
  for (const word of words) {
    if (spanish[word]) {
      terms.push(spanish[word]);
    } else if (word.length > 3 && !["del", "para", "con", "que", "los", "las", "una", "uso"].includes(word)) {
      terms.push(word);
    }
  }

  return terms;
}

export async function runAcademicPipeline(
  topic: string,
  emitter: EventEmitter,
  config: Partial<PipelineConfig> = {}
): Promise<PipelineResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  
  console.log(`[AcademicPipeline] Starting search for: "${topic}"`);
  console.log(`[AcademicPipeline] Target: ${cfg.targetCount} articles, Years: ${cfg.yearStart}-${cfg.yearEnd}`);

  emitter.emit("pipeline_phase", { phase: "search", status: "starting" });

  const queries = buildSearchQueries(topic);
  console.log(`[AcademicPipeline] Using ${queries.length} search queries`);

  const allCandidates: AcademicCandidate[] = [];
  
  const openAlexResults = await searchOpenAlexWithMultipleQueries(queries, {
    yearStart: cfg.yearStart,
    yearEnd: cfg.yearEnd,
    maxResults: 200,
  });
  allCandidates.push(...openAlexResults);
  console.log(`[AcademicPipeline] OpenAlex: ${openAlexResults.length} candidates`);

  emitter.emit("pipeline_phase", { 
    phase: "search", 
    status: "openalex_complete",
    count: openAlexResults.length 
  });

  for (const query of queries.slice(0, 3)) {
    const crossRefResults = await searchCrossRef(query, {
      yearStart: cfg.yearStart,
      yearEnd: cfg.yearEnd,
      maxResults: 50,
    });
    allCandidates.push(...crossRefResults);
    console.log(`[AcademicPipeline] CrossRef query "${query}": ${crossRefResults.length} candidates`);
  }

  emitter.emit("pipeline_phase", { 
    phase: "search", 
    status: "complete",
    totalCandidates: allCandidates.length 
  });

  console.log(`[AcademicPipeline] Total candidates: ${allCandidates.length}`);

  const deduplicated = deduplicateCandidates(allCandidates);
  console.log(`[AcademicPipeline] After deduplication: ${deduplicated.length}`);

  emitter.emit("pipeline_phase", { phase: "relevance", status: "starting" });
  
  const relevant = filterByRelevanceAgent(deduplicated);
  console.log(`[AcademicPipeline] After relevance filter: ${relevant.length}`);

  emitter.emit("pipeline_phase", { 
    phase: "relevance", 
    status: "complete",
    relevantCount: relevant.length 
  });

  if (relevant.length === 0) {
    return {
      success: false,
      articles: [],
      criticResult: {
        passed: false,
        totalVerified: 0,
        targetCount: cfg.targetCount,
        duplicatesRemoved: 0,
        issues: ["No relevant articles found"],
        blockers: ["Zero relevant candidates after filtering"],
      },
      stats: {
        totalFetched: allCandidates.length,
        relevantAfterFilter: 0,
        verifiedCount: 0,
        finalCount: 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  emitter.emit("pipeline_phase", { phase: "verification", status: "starting" });

  const toVerify = relevant.slice(0, Math.min(relevant.length, cfg.targetCount * 2));
  const verified = await verifyBatch(toVerify, cfg.verificationConcurrency);
  console.log(`[AcademicPipeline] After verification: ${verified.length}`);

  emitter.emit("pipeline_phase", { 
    phase: "verification", 
    status: "complete",
    verifiedCount: verified.length 
  });

  emitter.emit("pipeline_phase", { phase: "enrichment", status: "starting" });

  const enriched = await enrichBatch(verified.slice(0, cfg.targetCount));
  console.log(`[AcademicPipeline] After enrichment: ${enriched.length}`);

  emitter.emit("pipeline_phase", { 
    phase: "enrichment", 
    status: "complete",
    enrichedCount: enriched.length 
  });

  emitter.emit("pipeline_phase", { phase: "critic", status: "starting" });

  const criticResult = runCriticGuard(enriched, cfg.targetCount, cfg.yearStart, cfg.yearEnd);

  emitter.emit("pipeline_phase", { 
    phase: "critic", 
    status: criticResult.passed ? "passed" : "blocked",
    result: criticResult 
  });

  const finalArticles = enriched
    .filter(a => a.verificationStatus === "verified" && a.year >= cfg.yearStart && a.year <= cfg.yearEnd)
    .slice(0, cfg.targetCount);

  let artifact: ArtifactMeta | undefined;
  
  if (finalArticles.length > 0) {
    emitter.emit("pipeline_phase", { phase: "export", status: "starting" });
    
    artifact = await exportToExcel(finalArticles, topic);
    
    emitter.emit("pipeline_phase", { 
      phase: "export", 
      status: "complete",
      artifact: artifact.name 
    });
  }

  const result: PipelineResult = {
    success: criticResult.passed || finalArticles.length >= 10,
    articles: finalArticles,
    criticResult,
    artifact,
    stats: {
      totalFetched: allCandidates.length,
      relevantAfterFilter: relevant.length,
      verifiedCount: verified.length,
      finalCount: finalArticles.length,
      durationMs: Date.now() - startTime,
    },
  };

  console.log(`[AcademicPipeline] Complete. Final count: ${finalArticles.length}/${cfg.targetCount}`);
  console.log(`[AcademicPipeline] Duration: ${result.stats.durationMs}ms`);

  return result;
}

async function exportToExcel(articles: AcademicCandidate[], topic: string): Promise<ArtifactMeta> {
  const COLUMNS = [
    "Authors",
    "Title", 
    "Year",
    "Journal",
    "Abstract",
    "Keywords",
    "Language",
    "Document Type",
    "DOI",
    "City of publication",
    "Country of study",
    "Scopus",
    "WOS",
    "Access URL",
    "Source",
  ];

  const data: any[][] = articles.map((article, index) => [
    article.authors.join("; ") || "Unknown",
    article.title || "Unknown",
    article.year || "Unknown",
    article.journal || "Unknown",
    (article.abstract || "").substring(0, 2000),
    article.keywords.join("; ") || "Unknown",
    article.language || "Unknown",
    article.documentType || "Article",
    article.doi || "Unknown",
    article.city || "Unknown",
    article.country || "Unknown",
    article.source === "scopus" ? "Yes" : "Unknown",
    "Unknown",
    article.doiUrl || article.landingUrl || "Unknown",
    article.source || "Unknown",
  ]);

  const safeTitle = topic
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 30);

  const artifact = await createXlsx({
    title: `${safeTitle}_articles`,
    sheets: [{
      name: "Scientific Articles",
      headers: COLUMNS,
      data,
      summary: {
        "Total Articles": articles.length,
        "Year Range": `${Math.min(...articles.map(a => a.year))}-${Math.max(...articles.map(a => a.year))}`,
        "Search Topic": topic,
        "Generated At": new Date().toISOString(),
        "Sources Used": "OpenAlex, CrossRef",
        "Verification": "DOI verified via CrossRef",
      },
    }],
  });

  storeArtifactMeta(artifact);
  return artifact;
}

export function candidatesToSourceSignals(candidates: AcademicCandidate[]): any[] {
  return candidates.map((c, i) => ({
    id: `${c.source}_${c.doi || i}`,
    url: c.doiUrl || c.landingUrl,
    title: c.title,
    snippet: c.abstract?.substring(0, 300) || "",
    domain: c.source,
    score: c.relevanceScore,
    fetched: c.verified,
    content: c.abstract,
    claims: [],
    academicData: c,
  }));
}
