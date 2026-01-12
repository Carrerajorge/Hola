import { AcademicCandidate, searchOpenAlex, searchOpenAlexWithMultipleQueries } from "./openAlexClient";
import { searchCrossRef } from "./crossrefClient";
import { searchSemanticScholarMultiple } from "./semanticScholarClient";
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
  maxSearchIterations: number;
}

const DEFAULT_CONFIG: PipelineConfig = {
  targetCount: 50,
  yearStart: 2020,
  yearEnd: 2025,
  maxRetries: 4,
  verificationConcurrency: 8,
  maxSearchIterations: 3,
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
    sourcesUsed: string[];
    failuresByReason: Record<string, number>;
  };
  warnings: string[];
}

const ALL_SEARCH_QUERIES = [
  `"recycled steel" concrete strength`,
  `"recycled steel fibers" concrete compressive strength`,
  `"scrap steel" concrete mechanical properties`,
  `"recycled reinforcement" concrete tensile strength`,
  `"steel fiber recycled" mortar strength`,
  `"recycled steel aggregate" concrete strength`,
  `"scrap metal" concrete flexural strength`,
  `"acero reciclado" resistencia concreto`,
  `steel fiber reinforced concrete mechanical`,
  `recycled steel bar concrete durability`,
  `steel slag concrete compressive`,
  `waste steel fiber concrete strength`,
  `"recycled steel" concrete "compressive strength"`,
  `"steel fibers" recycled concrete mechanical properties`,
  `"scrap steel" reinforced concrete strength`,
  `"recycled reinforcement bars" concrete performance`,
  `"steel fiber" sustainable concrete strength`,
  `"recycled aggregate" steel concrete strength`,
  `recycled steel wire concrete tensile`,
  `steel manufacturing waste concrete`,
  `industrial steel waste concrete reinforcement`,
  `recycled steel shavings concrete mix`,
  `post-consumer steel fiber concrete`,
  `steel mill byproduct concrete strength`,
];

function buildSearchQueries(topic: string, iteration: number = 0): string[] {
  const base = [...ALL_SEARCH_QUERIES];
  
  const topicTerms = extractKeyTerms(topic);
  if (topicTerms.length > 0) {
    base.push(topicTerms.join(" "));
  }
  
  return [...new Set(base)];
}

function extractKeyTerms(topic: string): string[] {
  const spanish: Record<string, string> = {
    "acero": "steel",
    "reciclado": "recycled",
    "concreto": "concrete",
    "resistencia": "strength",
    "hormigón": "concrete",
    "hormigon": "concrete",
    "fibra": "fiber",
    "fibras": "fibers",
    "chatarra": "scrap",
    "compresión": "compressive",
    "tracción": "tensile",
  };

  const words = topic.toLowerCase().split(/\s+/);
  const terms: string[] = [];
  
  for (const word of words) {
    const clean = word.replace(/[^\wáéíóúñü]/gi, "");
    if (spanish[clean]) {
      terms.push(spanish[clean]);
    } else if (clean.length > 3 && !["del", "para", "con", "que", "los", "las", "una", "uso", "the", "and", "for"].includes(clean)) {
      terms.push(clean);
    }
  }

  return terms;
}

export const doiCache = new Map<string, boolean>();

export async function runAcademicPipeline(
  topic: string,
  emitter: EventEmitter,
  config: Partial<PipelineConfig> = {}
): Promise<PipelineResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const warnings: string[] = [];
  const sourcesUsed: string[] = [];
  const failuresByReason: Record<string, number> = {};
  
  console.log(`[AcademicPipeline] Starting robust search for: "${topic}"`);
  console.log(`[AcademicPipeline] Target: ${cfg.targetCount} articles, Years: ${cfg.yearStart}-${cfg.yearEnd}`);

  let allCandidates: AcademicCandidate[] = [];
  let verifiedArticles: AcademicCandidate[] = [];
  let iteration = 0;

  while (verifiedArticles.length < cfg.targetCount && iteration < cfg.maxSearchIterations) {
    iteration++;
    console.log(`[AcademicPipeline] === ITERATION ${iteration}/${cfg.maxSearchIterations} ===`);
    
    emitter.emit("pipeline_phase", { 
      phase: "search", 
      status: "starting", 
      iteration,
      currentVerified: verifiedArticles.length 
    });

    const queries = buildSearchQueries(topic, iteration - 1);
    console.log(`[AcademicPipeline] Using ${queries.length} search queries`);

    try {
      console.log(`[AcademicPipeline] Searching OpenAlex...`);
      const openAlexResults = await searchOpenAlexWithMultipleQueries(queries, {
        yearStart: cfg.yearStart,
        yearEnd: cfg.yearEnd,
        maxResults: 200,
      });
      allCandidates.push(...openAlexResults);
      if (openAlexResults.length > 0) sourcesUsed.push("OpenAlex");
      console.log(`[AcademicPipeline] OpenAlex: ${openAlexResults.length} candidates`);
    } catch (error: any) {
      console.error(`[AcademicPipeline] OpenAlex error: ${error.message}`);
      warnings.push(`OpenAlex search failed: ${error.message}`);
      failuresByReason["openalex_error"] = (failuresByReason["openalex_error"] || 0) + 1;
    }

    emitter.emit("pipeline_phase", { 
      phase: "search", 
      status: "openalex_complete",
      count: allCandidates.length 
    });

    try {
      console.log(`[AcademicPipeline] Searching CrossRef...`);
      for (const query of queries.slice(0, 5)) {
        const crossRefResults = await searchCrossRef(query, {
          yearStart: cfg.yearStart,
          yearEnd: cfg.yearEnd,
          maxResults: 50,
        });
        allCandidates.push(...crossRefResults);
        if (crossRefResults.length > 0 && !sourcesUsed.includes("CrossRef")) {
          sourcesUsed.push("CrossRef");
        }
      }
    } catch (error: any) {
      console.error(`[AcademicPipeline] CrossRef error: ${error.message}`);
      warnings.push(`CrossRef search failed: ${error.message}`);
      failuresByReason["crossref_error"] = (failuresByReason["crossref_error"] || 0) + 1;
    }

    emitter.emit("pipeline_phase", { 
      phase: "search", 
      status: "crossref_complete",
      count: allCandidates.length 
    });

    try {
      console.log(`[AcademicPipeline] Searching Semantic Scholar...`);
      const s2Results = await searchSemanticScholarMultiple(queries.slice(0, 4), {
        yearStart: cfg.yearStart,
        yearEnd: cfg.yearEnd,
        maxResults: 100,
      });
      allCandidates.push(...s2Results);
      if (s2Results.length > 0) sourcesUsed.push("SemanticScholar");
      console.log(`[AcademicPipeline] Semantic Scholar: ${s2Results.length} candidates`);
    } catch (error: any) {
      console.error(`[AcademicPipeline] Semantic Scholar error: ${error.message}`);
      warnings.push(`Semantic Scholar search failed: ${error.message}`);
      failuresByReason["s2_error"] = (failuresByReason["s2_error"] || 0) + 1;
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
    
    failuresByReason["low_relevance"] = deduplicated.length - relevant.length;

    emitter.emit("pipeline_phase", { 
      phase: "relevance", 
      status: "complete",
      relevantCount: relevant.length 
    });

    if (relevant.length === 0) {
      warnings.push(`Iteration ${iteration}: No relevant articles found`);
      continue;
    }

    emitter.emit("pipeline_phase", { phase: "verification", status: "starting" });

    const unverified = relevant.filter(r => 
      !verifiedArticles.some(v => v.doi === r.doi || v.title.toLowerCase() === r.title.toLowerCase())
    );
    
    const toVerify = unverified.slice(0, Math.min(unverified.length, (cfg.targetCount - verifiedArticles.length) * 3));
    
    try {
      const newlyVerified = await verifyBatch(toVerify, cfg.verificationConcurrency, cfg.yearStart, cfg.yearEnd);
      verifiedArticles.push(...newlyVerified);
      console.log(`[AcademicPipeline] Newly verified: ${newlyVerified.length}, Total verified: ${verifiedArticles.length}`);
      
      failuresByReason["verification_failed"] = (failuresByReason["verification_failed"] || 0) + (toVerify.length - newlyVerified.length);
    } catch (error: any) {
      console.error(`[AcademicPipeline] Verification error: ${error.message}`);
      warnings.push(`Verification batch failed: ${error.message}`);
    }

    emitter.emit("pipeline_phase", { 
      phase: "verification", 
      status: "complete",
      verifiedCount: verifiedArticles.length 
    });

    if (verifiedArticles.length >= cfg.targetCount) {
      console.log(`[AcademicPipeline] Target reached: ${verifiedArticles.length}/${cfg.targetCount}`);
      break;
    }

    console.log(`[AcademicPipeline] Need more: ${verifiedArticles.length}/${cfg.targetCount}, continuing search...`);
  }

  verifiedArticles = deduplicateCandidates(verifiedArticles);

  emitter.emit("pipeline_phase", { phase: "enrichment", status: "starting" });

  let enriched: AcademicCandidate[] = [];
  try {
    enriched = await enrichBatch(verifiedArticles.slice(0, cfg.targetCount));
    console.log(`[AcademicPipeline] After enrichment: ${enriched.length}`);
  } catch (error: any) {
    console.error(`[AcademicPipeline] Enrichment error: ${error.message}`);
    enriched = verifiedArticles.slice(0, cfg.targetCount);
    warnings.push(`Enrichment failed, using original data: ${error.message}`);
  }

  emitter.emit("pipeline_phase", { 
    phase: "enrichment", 
    status: "complete",
    enrichedCount: enriched.length 
  });

  emitter.emit("pipeline_phase", { phase: "critic", status: "starting" });

  const criticResult = runCriticGuard(enriched, cfg.targetCount, cfg.yearStart, cfg.yearEnd);

  if (!criticResult.passed) {
    warnings.push(`CriticGuard: ${criticResult.blockers.join("; ")}`);
  }

  emitter.emit("pipeline_phase", { 
    phase: "critic", 
    status: criticResult.passed ? "passed" : "warning",
    result: criticResult 
  });

  const finalArticles = enriched
    .filter(a => a.verificationStatus === "verified" && a.year >= cfg.yearStart && a.year <= cfg.yearEnd)
    .slice(0, cfg.targetCount);

  emitter.emit("pipeline_phase", { phase: "export", status: "starting" });
  
  let artifact: ArtifactMeta | undefined;
  
  try {
    artifact = await exportToExcel(finalArticles, topic, warnings);
    console.log(`[AcademicPipeline] Excel generated: ${artifact.filename}`);
  } catch (error: any) {
    console.error(`[AcademicPipeline] Export error: ${error.message}`);
    warnings.push(`Export failed: ${error.message}`);
  }
  
  emitter.emit("pipeline_phase", { 
    phase: "export", 
    status: "complete",
    artifact: artifact?.name,
    finalCount: finalArticles.length
  });

  const stats = {
    totalFetched: allCandidates.length,
    relevantAfterFilter: verifiedArticles.length,
    verifiedCount: verifiedArticles.length,
    finalCount: finalArticles.length,
    durationMs: Date.now() - startTime,
    sourcesUsed: [...new Set(sourcesUsed)],
    failuresByReason,
  };

  console.log(`[AcademicPipeline] === SUMMARY ===`);
  console.log(`[AcademicPipeline] Total fetched: ${stats.totalFetched}`);
  console.log(`[AcademicPipeline] Verified: ${stats.verifiedCount}`);
  console.log(`[AcademicPipeline] Final count: ${stats.finalCount}/${cfg.targetCount}`);
  console.log(`[AcademicPipeline] Sources: ${stats.sourcesUsed.join(", ")}`);
  console.log(`[AcademicPipeline] Duration: ${stats.durationMs}ms`);
  if (warnings.length > 0) {
    console.log(`[AcademicPipeline] Warnings: ${warnings.join("; ")}`);
  }

  return {
    success: finalArticles.length >= 10,
    articles: finalArticles,
    criticResult,
    artifact,
    stats,
    warnings,
  };
}

async function exportToExcel(articles: AcademicCandidate[], topic: string, warnings: string[]): Promise<ArtifactMeta> {
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
    "Access_URL",
    "Source",
  ];

  const data: any[][] = articles.map((article) => {
    const authorsList = article.authors.length > 0 ? article.authors.join("; ") : "Unknown";
    const keywordsList = article.keywords.length > 0 ? article.keywords.join("; ") : "Unknown";
    const accessUrl = article.doi ? `https://doi.org/${article.doi}` : (article.landingUrl || "Unknown");
    const sourceLabel = article.source === "openalex" ? "OpenAlex" : 
                       article.source === "crossref" ? "CrossRef" : 
                       article.source === "semanticscholar" ? "Semantic Scholar" : 
                       article.source || "Unknown";
    
    return [
      authorsList,
      article.title || "Unknown",
      article.year > 0 ? article.year : "Unknown",
      article.journal || "Unknown",
      (article.abstract || "Unknown").substring(0, 2000),
      keywordsList,
      article.language || "English",
      article.documentType || "Article",
      article.doi || "Unknown",
      article.city || "Unknown",
      article.country || "Unknown",
      article.source === "scopus" ? "Yes" : "No",
      "No",
      accessUrl,
      sourceLabel,
    ];
  });

  const safeTitle = topic
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 30);

  const summary: Record<string, any> = {
    "Total Articles": articles.length,
    "Target": 50,
    "Year Range": `${Math.min(...articles.map(a => a.year || 2020))}-${Math.max(...articles.map(a => a.year || 2025))}`,
    "Search Topic": topic,
    "Generated At": new Date().toISOString(),
    "Sources Used": "OpenAlex, CrossRef, Semantic Scholar",
    "Verification": "DOI verified via CrossRef API",
  };

  if (warnings.length > 0) {
    summary["Warnings"] = warnings.slice(0, 5).join("; ");
  }

  const artifact = await createXlsx({
    title: `${safeTitle}_articles`,
    sheets: [{
      name: "Scientific Articles",
      headers: COLUMNS,
      data,
      summary,
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
