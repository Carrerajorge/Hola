import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  AgentContract,
  ExecutionState,
  ExecutionStateSchema,
  SourceSignal,
  SSEEvent,
  SSEEventType,
} from "./contracts";
import { parsePromptToContract, validateContract, repairContract } from "./contractRouter";
import { shouldResearch } from "./researchPolicy";
import { collectSignals, SignalsProgress } from "./signalsPipeline";
import { deepDiveSources, DeepDiveProgress, ExtractedContent } from "./deepDivePipeline";
import { createXlsx, createDocx, storeArtifactMeta, packCitations, XlsxSpec, DocxSpec } from "./artifactTools";
import { evaluateQualityGate, shouldRetry, formatGateReport } from "./qualityGate";
import { searchScopus, scopusArticlesToSourceSignals, isScopusConfigured, ScopusArticle } from "./scopusClient";
import { searchWos, WosArticle } from "./wosClient";
import { runAcademicPipeline, candidatesToSourceSignals, PipelineResult, PipelineConfig } from "./academicPipeline";

function isWosConfigured(): boolean {
  return !!process.env.WOS_API_KEY;
}

function wosArticlesToSourceSignals(articles: WosArticle[]): SourceSignal[] {
  return articles.map((article, index) => ({
    id: article.id || `wos-${index}`,
    url: article.wosUrl,
    title: article.title,
    snippet: article.abstract?.substring(0, 300) || "",
    source: "wos" as const,
    rank: index + 1,
    timestamp: Date.now(),
    metadata: {
      authors: article.authors,
      year: article.year,
      journal: article.journal,
      abstract: article.abstract,
      keywords: article.keywords,
      doi: article.doi,
      citations: article.citationCount,
      affiliations: article.affiliations,
      documentType: article.documentType,
      language: article.language,
    },
  }));
}

export interface OrchestratorConfig {
  maxIterations: number;
  emitHeartbeat: boolean;
  heartbeatIntervalMs: number;
  enforceContract: boolean;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxIterations: 3,
  emitHeartbeat: true,
  heartbeatIntervalMs: 5000,
  enforceContract: true,
};

export class SuperAgentOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private state: ExecutionState | null = null;
  private sessionId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private eventCounter: number = 0;
  private abortSignal?: AbortSignal;

  constructor(sessionId: string, config: Partial<OrchestratorConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private emitSSE(eventType: SSEEventType, data: unknown): void {
    const event: SSEEvent = {
      event_id: `${this.sessionId}_${++this.eventCounter}`,
      event_type: eventType,
      timestamp: Date.now(),
      data,
      session_id: this.sessionId,
    };
    
    this.emit("sse", event);
  }

  private startHeartbeat(): void {
    if (this.config.emitHeartbeat && !this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        this.emitSSE("heartbeat", {
          phase: this.state?.phase,
          sources_count: this.state?.sources_count,
          artifacts_count: this.state?.artifacts.length,
          iteration: this.state?.iteration,
        });
      }, this.config.heartbeatIntervalMs);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private checkAbort(): void {
    if (this.abortSignal?.aborted) {
      this.stopHeartbeat();
      throw new Error("Ejecución cancelada por el usuario");
    }
  }

  async execute(prompt: string, signal?: AbortSignal): Promise<ExecutionState> {
    this.abortSignal = signal;
    
    try {
      this.startHeartbeat();
      
      if (signal?.aborted) {
        throw new Error("Ejecución cancelada por el usuario");
      }
      
      let contract = parsePromptToContract(prompt);
      
      if (this.config.enforceContract) {
        const validation = validateContract(contract);
        if (!validation.valid) {
          contract = repairContract(contract);
        }
      }
      
      const isAcademicSearch = this.isScientificArticleRequest(prompt);
      const run_title = isAcademicSearch 
        ? "Búsqueda académica"
        : contract.intent === "create_docx" || contract.intent === "create_xlsx"
          ? `Creando ${contract.requirements?.must_create?.[0] || "documento"}`
          : "Procesando solicitud";

      this.emitSSE("contract", { 
        ...contract,
        run_title,
        target: contract.requirements?.min_sources || 50,
      });
      
      this.state = ExecutionStateSchema.parse({
        contract,
        phase: "planning",
        sources: [],
        sources_count: 0,
        deep_sources: [],
        artifacts: [],
        tool_results: [],
        iteration: 0,
        max_iterations: this.config.maxIterations,
        acceptance_results: [],
        started_at: Date.now(),
      });
      
      const yearRange = this.extractYearRange(prompt);
      this.emitSSE("plan", {
        run_title,
        target: contract.requirements?.min_sources || 50,
        steps: contract.plan,
        requirements: contract.requirements,
        rules: {
          yearStart: yearRange.start || 2020,
          yearEnd: yearRange.end || 2025,
          output: contract.requirements?.must_create?.[0] || "xlsx",
        },
      });
      
      await this.executePhases();
      
      return this.state;
      
    } catch (error: any) {
      if (this.state) {
        this.state.phase = "error";
        this.state.error = error.message;
      }
      
      this.emitSSE("error", {
        message: error.message,
        stack: error.stack,
        recoverable: false,
      });
      
      throw error;
      
    } finally {
      this.stopHeartbeat();
    }
  }

  private async executePhases(): Promise<void> {
    if (!this.state) return;

    const requirements = this.state.contract.requirements;
    const researchDecision = shouldResearch(this.state.contract.original_prompt);
    
    if (researchDecision.shouldResearch || requirements.min_sources > 0) {
      this.checkAbort();
      await this.executeSignalsPhase();
      this.checkAbort();
      await this.executeDeepPhase();
    }
    
    if (requirements.must_create.length > 0) {
      this.checkAbort();
      await this.executeCreatePhase();
    }
    
    this.checkAbort();
    await this.executeVerifyPhase();
    
    if (this.state.artifacts.length > 0 || this.state.sources.length > 0 || this.state.phase !== "error") {
      this.checkAbort();
      await this.executeFinalizePhase();
    }
  }

  private isScientificArticleRequest(prompt: string): boolean {
    const patterns = [
      /\b(artículos?|articulos?)\s*(científicos?|cientificos?|académicos?|academicos?)\b/i,
      /\b(papers?|publications?|research\s+articles?)\b/i,
      /\b(scopus|web\s*of\s*science|wos|pubmed|scholar)\b/i,
      /\b(revisión\s+sistemática|systematic\s+review)\b/i,
      /\b(literatura\s+científica|scientific\s+literature)\b/i,
    ];
    return patterns.some(p => p.test(prompt));
  }

  private extractYearRange(prompt: string): { start?: number; end?: number } {
    const match = prompt.match(/(?:del|from)\s+(\d{4})\s+(?:al|to|hasta)\s+(\d{4})/i);
    if (match) {
      return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
    }
    const singleYear = prompt.match(/\b(20\d{2})\b/);
    if (singleYear) {
      return { start: parseInt(singleYear[1], 10) - 2, end: parseInt(singleYear[1], 10) };
    }
    return {};
  }

  private async executeSignalsPhase(): Promise<void> {
    if (!this.state) return;
    
    this.state.phase = "signals";
    this.emitSSE("phase_started", { 
      phase: "signals", 
      status: "running",
      message: "Buscando artículos en bases de datos académicas…" 
    });
    this.emitSSE("progress", { phase: "signals", status: "starting" });
    
    const prompt = this.state.contract.original_prompt;
    const researchDecision = shouldResearch(prompt);
    const targetCount = this.state.contract.requirements.min_sources || 100;
    
    const isScientific = this.isScientificArticleRequest(prompt);
    const hasScopus = isScopusConfigured();
    const hasWos = isWosConfigured();
    
    if (isScientific) {
      if (hasScopus || hasWos) {
        await this.executeSignalsWithAcademicDatabases(prompt, targetCount, hasScopus, hasWos);
      } else {
        await this.executeSignalsWithOpenAlex(prompt, targetCount);
      }
    } else {
      await this.executeSignalsWithWebSearch(researchDecision, targetCount);
    }
  }

  private async executeSignalsWithOpenAlex(prompt: string, targetCount: number): Promise<void> {
    if (!this.state) return;
    
    const searchTopic = this.extractSearchTopic(prompt);
    const yearRange = this.extractYearRange(prompt);
    
    this.emitSSE("tool_call", {
      id: "tc_signals_openalex",
      tool: "academic_pipeline",
      input: { query: searchTopic, target: targetCount, yearRange },
    });

    this.emitSSE("progress", {
      phase: "signals",
      status: "multi_agent_pipeline",
      message: `Ejecutando pipeline multi-agente para: "${searchTopic}"`,
    });

    let pipelineResult: PipelineResult | null = null;

    try {
      const pipelineEmitter = new EventEmitter();
      let pipelineSearchCount = 0;
      
      pipelineEmitter.on("pipeline_phase", (data) => {
        this.emitSSE("progress", {
          phase: "signals",
          status: data.phase,
          ...data,
        });
        
        const candidateCount = data.count || data.totalCandidates || data.relevantCount || data.verifiedCount || data.enrichedCount || 0;
        
        if (data.phase === "search" && data.status !== "starting") {
          pipelineSearchCount++;
          this.emitSSE("search_progress", {
            provider: "OpenAlex",
            queries_current: pipelineSearchCount,
            queries_total: data.totalIterations || 4,
            pages_searched: data.pagesSearched || pipelineSearchCount,
            candidates_found: candidateCount,
          });
        } else if (data.phase === "verification" || data.phase === "enrichment") {
          this.emitSSE("search_progress", {
            provider: data.phase === "verification" ? "Verificación" : "Enriquecimiento",
            queries_current: pipelineSearchCount,
            queries_total: 4,
            candidates_found: candidateCount,
          });
        }
      });

      pipelineEmitter.on("search_progress", (data) => {
        this.emitSSE("search_progress", {
          provider: data.provider || "OpenAlex",
          queries_current: data.query_idx || pipelineSearchCount,
          queries_total: data.query_total || 3,
          pages_searched: data.page || 1,
          candidates_found: data.candidates_total || 0,
        });
      });

      pipelineEmitter.on("verify_progress", (data) => {
        this.emitSSE("verify_progress", {
          checked: data.checked || 0,
          ok: data.ok || 0,
          dead: data.dead || 0,
        });
      });

      pipelineEmitter.on("accepted_progress", (data) => {
        this.emitSSE("accepted_progress", {
          accepted: data.accepted || 0,
          target: data.target || targetCount,
        });
      });

      pipelineEmitter.on("filter_progress", (data) => {
        this.emitSSE("filter_progress", data);
      });

      pipelineEmitter.on("export_progress", (data) => {
        this.emitSSE("export_progress", data);
      });

      pipelineResult = await runAcademicPipeline(searchTopic, pipelineEmitter, {
        targetCount: Math.min(targetCount, 50),
        yearStart: yearRange.start || 2020,
        yearEnd: yearRange.end || 2025,
        maxSearchIterations: 4,
      });

    } catch (error: any) {
      console.error(`[OpenAlex Pipeline] Error: ${error.message}`);
      this.emitSSE("progress", {
        phase: "signals",
        status: "error",
        error: error.message,
      });
    }

    if (pipelineResult && pipelineResult.articles.length > 0) {
      const signals = candidatesToSourceSignals(pipelineResult.articles);
      for (const signal of signals) {
        this.emitSSE("source_signal", signal);
      }

      this.state.sources = signals;
      this.state.sources_count = signals.length;

      if (pipelineResult.artifact) {
        this.state.artifacts.push({
          id: pipelineResult.artifact.id,
          type: "xlsx",
          name: pipelineResult.artifact.name,
          path: pipelineResult.artifact.path,
          size: pipelineResult.artifact.size,
          download_url: pipelineResult.artifact.downloadUrl,
          created_at: Date.now(),
        });
        
        this.emitSSE("artifact", pipelineResult.artifact);
      }

      const successWithWarning = pipelineResult.articles.length > 0;
      
      this.emitSSE("tool_result", {
        tool_call_id: "tc_signals_openalex",
        success: successWithWarning,
        output: {
          collected: pipelineResult.stats.finalCount,
          target: targetCount,
          source: pipelineResult.stats.sourcesUsed.join("+"),
          verified: pipelineResult.stats.verifiedCount,
          duration_ms: pipelineResult.stats.durationMs,
          criticPassed: pipelineResult.criticResult.passed,
          warnings: pipelineResult.warnings,
        },
      });

      this.state.tool_results.push({
        tool_call_id: "tc_signals_openalex",
        success: true,
        output: { 
          collected: pipelineResult.stats.finalCount, 
          source: pipelineResult.stats.sourcesUsed.join("+"),
          verified: pipelineResult.stats.verifiedCount,
          warnings: pipelineResult.warnings,
        },
      });

    } else {
      console.log(`[OpenAlex Pipeline] No results, falling back to web search`);
      
      this.emitSSE("tool_result", {
        tool_call_id: "tc_signals_openalex",
        success: false,
        error: "No verified articles found from academic sources",
      });

      this.state.tool_results.push({
        tool_call_id: "tc_signals_openalex",
        success: false,
        output: { error: "No verified articles found" },
      });

      const researchDecision = shouldResearch(prompt);
      await this.executeSignalsWithWebSearch(researchDecision, targetCount);
    }
  }

  private async executeSignalsWithAcademicDatabases(
    prompt: string, 
    targetCount: number,
    useScopus: boolean,
    useWos: boolean
  ): Promise<void> {
    if (!this.state) return;
    
    const searchTopic = this.extractSearchTopic(prompt);
    const yearRange = this.extractYearRange(prompt);
    const sourcesPerDb = Math.ceil(targetCount / (useScopus && useWos ? 2 : 1));
    
    const sources: string[] = [];
    if (useScopus) sources.push("Scopus");
    if (useWos) sources.push("Web of Science");
    
    this.emitSSE("tool_call", {
      id: "tc_signals",
      tool: "search_academic_parallel",
      input: { query: searchTopic, target: targetCount, yearRange, sources },
    });

    this.emitSSE("progress", {
      phase: "signals",
      status: "searching_academic",
      message: `Buscando artículos científicos en ${sources.join(" y ")}: "${searchTopic}"`,
    });

    const allSignals: SourceSignal[] = [];
    let totalInDatabase = 0;
    let searchTime = 0;
    const errors: string[] = [];
    let queriesCurrent = 0;
    const queriesTotal = (useScopus ? 1 : 0) + (useWos ? 1 : 0);

    const searchPromises: Promise<void>[] = [];

    if (useScopus) {
      searchPromises.push(
        searchScopus(searchTopic, {
          maxResults: Math.min(sourcesPerDb, 100),
          startYear: yearRange.start,
          endYear: yearRange.end,
        })
        .then(result => {
          queriesCurrent++;
          const signals = scopusArticlesToSourceSignals(result.articles);
          for (const signal of signals) {
            this.emitSSE("source_signal", signal);
          }
          allSignals.push(...signals);
          totalInDatabase += result.totalResults;
          searchTime = Math.max(searchTime, result.searchTime);
          this.emitSSE("search_progress", {
            queries_current: queriesCurrent,
            queries_total: queriesTotal,
            pages_searched: queriesCurrent,
            candidates_found: allSignals.length,
          });
        })
        .catch(err => {
          console.error(`[Scopus] Error: ${err.message}`);
          errors.push(`Scopus: ${err.message}`);
        })
      );
    }

    if (useWos) {
      searchPromises.push(
        searchWos(searchTopic, {
          maxResults: Math.min(sourcesPerDb, 50),
          startYear: yearRange.start,
          endYear: yearRange.end,
        })
        .then(result => {
          queriesCurrent++;
          const signals = wosArticlesToSourceSignals(result.articles);
          for (const signal of signals) {
            this.emitSSE("source_signal", signal);
          }
          allSignals.push(...signals);
          totalInDatabase += result.totalResults;
          searchTime = Math.max(searchTime, result.searchTime);
          this.emitSSE("search_progress", {
            queries_current: queriesCurrent,
            queries_total: queriesTotal,
            pages_searched: queriesCurrent,
            candidates_found: allSignals.length,
          });
        })
        .catch(err => {
          console.error(`[WoS] Error: ${err.message}`);
          errors.push(`WoS: ${err.message}`);
        })
      );
    }

    await Promise.all(searchPromises);

    this.state.sources = allSignals;
    this.state.sources_count = allSignals.length;

    this.emitSSE("progress", {
      phase: "signals",
      status: "completed",
      collected: allSignals.length,
      target: targetCount,
      source: sources.join("+"),
    });

    this.emitSSE("tool_result", {
      tool_call_id: "tc_signals",
      success: allSignals.length > 0,
      output: {
        collected: allSignals.length,
        target: targetCount,
        source: sources.join("+"),
        total_in_database: totalInDatabase,
        duration_ms: searchTime,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    this.state.tool_results.push({
      tool_call_id: "tc_signals",
      success: allSignals.length > 0,
      output: { collected: allSignals.length, source: sources.join("+") },
    });

    if (allSignals.length < targetCount) {
      console.log(`[AcademicDatabases] Only found ${allSignals.length}/${targetCount} from Scopus/WoS, falling back to OpenAlex pipeline`);
      await this.executeSignalsWithOpenAlex(prompt, targetCount);
    }
  }

  private async executeSignalsWithScopus(prompt: string, targetCount: number): Promise<void> {
    if (!this.state) return;
    
    const searchTopic = this.extractSearchTopic(prompt);
    const yearRange = this.extractYearRange(prompt);
    
    this.emitSSE("tool_call", {
      id: "tc_signals",
      tool: "search_scopus",
      input: { query: searchTopic, target: targetCount, yearRange },
    });

    this.emitSSE("progress", {
      phase: "signals",
      status: "searching_scopus",
      message: `Buscando artículos científicos en Scopus: "${searchTopic}"`,
    });

    try {
      const result = await searchScopus(searchTopic, {
        maxResults: Math.min(targetCount, 100),
        startYear: yearRange.start,
        endYear: yearRange.end,
      });

      const signals = scopusArticlesToSourceSignals(result.articles);
      
      for (const signal of signals) {
        this.emitSSE("source_signal", signal);
      }

      this.state.sources = signals;
      this.state.sources_count = signals.length;

      this.emitSSE("progress", {
        phase: "signals",
        status: "completed",
        collected: signals.length,
        target: targetCount,
        source: "scopus",
      });

      this.emitSSE("tool_result", {
        tool_call_id: "tc_signals",
        success: signals.length > 0,
        output: {
          collected: signals.length,
          target: targetCount,
          source: "scopus",
          total_in_database: result.totalResults,
          duration_ms: result.searchTime,
        },
      });

      this.state.tool_results.push({
        tool_call_id: "tc_signals",
        success: signals.length > 0,
        output: { collected: signals.length, source: "scopus" },
      });

    } catch (error: any) {
      console.error(`[Scopus] Error: ${error.message}`);
      this.emitSSE("progress", {
        phase: "signals",
        status: "scopus_error",
        message: `Error en Scopus: ${error.message}. Usando búsqueda web alternativa.`,
      });
      
      const researchDecision = shouldResearch(prompt);
      await this.executeSignalsWithWebSearch(researchDecision, targetCount);
    }
  }

  private async executeSignalsWithWebSearch(researchDecision: any, targetCount: number): Promise<void> {
    if (!this.state) return;
    
    const queries = researchDecision.searchQueries.length > 0
      ? researchDecision.searchQueries
      : [this.extractSearchTopic(this.state.contract.original_prompt)];
    
    this.emitSSE("tool_call", {
      id: "tc_signals",
      tool: "search_web_parallel",
      input: { queries, target: targetCount },
    });
    
    let queriesCurrent = 0;
    const queriesTotal = queries.length;
    
    const result = await collectSignals(
      queries,
      targetCount,
      (progress: SignalsProgress) => {
        queriesCurrent = progress.queriesExecuted || queriesCurrent;
        this.emitSSE("progress", {
          phase: "signals",
          ...progress,
        });
        this.emitSSE("search_progress", {
          queries_current: queriesCurrent,
          queries_total: queriesTotal,
          pages_searched: progress.pagesSearched || queriesCurrent,
          candidates_found: progress.collected || 0,
        });
      },
      (signal: SourceSignal) => {
        this.emitSSE("source_signal", signal);
      }
    );
    
    this.state.sources = result.signals;
    this.state.sources_count = result.totalCollected;
    
    this.emitSSE("tool_result", {
      tool_call_id: "tc_signals",
      success: result.totalCollected > 0,
      output: {
        collected: result.totalCollected,
        target: targetCount,
        queries_executed: result.queriesExecuted,
        duration_ms: result.durationMs,
      },
    });
    
    this.state.tool_results.push({
      tool_call_id: "tc_signals",
      success: result.totalCollected > 0,
      output: { collected: result.totalCollected },
    });
  }

  private async executeDeepPhase(): Promise<void> {
    if (!this.state || this.state.sources.length === 0) return;
    
    this.state.phase = "deep";
    this.emitSSE("phase_started", { 
      phase: "verification", 
      status: "running",
      message: "Verificando DOIs y enlaces de artículos…" 
    });
    this.emitSSE("progress", { phase: "deep", status: "starting" });
    
    const topSources = [...this.state.sources]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    
    this.emitSSE("tool_call", {
      id: "tc_deep",
      tool: "fetch_url_parallel",
      input: { urls: topSources.map(s => s.url) },
    });
    
    const result = await deepDiveSources(
      topSources,
      20,
      (progress: DeepDiveProgress) => {
        this.emitSSE("progress", {
          phase: "deep",
          ...progress,
        });
      },
      (content: ExtractedContent) => {
        this.emitSSE("source_deep", {
          source_id: content.sourceId,
          url: content.url,
          claims_count: content.claims.length,
          word_count: content.wordCount,
        });
      }
    );
    
    for (const extracted of result.sources.filter(s => s.success)) {
      const sourceIdx = this.state.sources.findIndex(s => s.id === extracted.sourceId);
      if (sourceIdx >= 0) {
        this.state.sources[sourceIdx].fetched = true;
        this.state.sources[sourceIdx].content = extracted.content;
        this.state.sources[sourceIdx].claims = extracted.claims;
        this.state.deep_sources.push(this.state.sources[sourceIdx]);
      }
    }
    
    this.emitSSE("tool_result", {
      tool_call_id: "tc_deep",
      success: result.totalSuccess > 0,
      output: {
        fetched: result.totalFetched,
        success: result.totalSuccess,
        duration_ms: result.durationMs,
      },
    });
    
    this.state.tool_results.push({
      tool_call_id: "tc_deep",
      success: result.totalSuccess > 0,
      output: { success: result.totalSuccess },
    });
  }

  private async executeCreatePhase(): Promise<void> {
    if (!this.state) return;
    
    this.state.phase = "creating";
    
    // Notify frontend that we're starting document generation
    this.emitSSE("phase_started", { 
      phase: "export", 
      status: "running",
      message: "Generando documentos…" 
    });
    this.emitSSE("progress", { 
      phase: "export", 
      status: "starting",
      message: "Generando documentos...",
      documents_total: this.state.contract.requirements.must_create.length,
    });
    
    for (const docType of this.state.contract.requirements.must_create) {
      this.emitSSE("tool_call", {
        id: `tc_create_${docType}`,
        tool: `create_${docType}`,
        input: {},
      });
      
      try {
        if (docType === "xlsx") {
          this.emitSSE("progress", { 
            phase: "export", 
            status: "generating",
            message: `Generando Excel con ${this.state.sources.filter(s => s.verified === true).length} artículos...`,
            document_type: "xlsx",
          });
          this.emitSSE("artifact_generating", {
            artifact_type: "xlsx",
            filename: "articles.xlsx",
          });
          const spec = this.buildXlsxSpec();
          const artifact = await createXlsx(spec);
          storeArtifactMeta(artifact);
          
          this.state.artifacts.push({
            id: artifact.id,
            type: "xlsx",
            name: artifact.name,
            download_url: artifact.downloadUrl,
          });
          
          this.emitSSE("artifact", artifact);
          this.emitSSE("progress", { 
            phase: "export", 
            status: "completed",
            message: `Excel generado: ${artifact.name}`,
            document_type: "xlsx",
            artifact_id: artifact.id,
          });
          this.emitSSE("tool_result", {
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id, download_url: artifact.downloadUrl },
          });
          
          this.state.tool_results.push({
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id },
          });
          
        } else if (docType === "docx") {
          this.emitSSE("progress", { 
            phase: "export", 
            status: "generating",
            message: "Generando documento Word...",
            document_type: "docx",
          });
          this.emitSSE("artifact_generating", {
            artifact_type: "docx",
            filename: "document.docx",
          });
          const spec = this.buildDocxSpec();
          const artifact = await createDocx(spec);
          storeArtifactMeta(artifact);
          
          this.state.artifacts.push({
            id: artifact.id,
            type: "docx",
            name: artifact.name,
            download_url: artifact.downloadUrl,
          });
          
          this.emitSSE("artifact", artifact);
          this.emitSSE("progress", { 
            phase: "export", 
            status: "completed",
            message: `Word generado: ${artifact.name}`,
            document_type: "docx",
            artifact_id: artifact.id,
          });
          this.emitSSE("tool_result", {
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id, download_url: artifact.downloadUrl },
          });
          
          this.state.tool_results.push({
            tool_call_id: `tc_create_${docType}`,
            success: true,
            output: { artifact_id: artifact.id },
          });
        }
      } catch (error: any) {
        this.emitSSE("tool_result", {
          tool_call_id: `tc_create_${docType}`,
          success: false,
          error: error.message,
        });
        
        this.state.tool_results.push({
          tool_call_id: `tc_create_${docType}`,
          success: false,
          output: null,
          error: error.message,
        });
      }
    }
  }

  private extractRequestedColumns(prompt: string): string[] | null {
    const orderByMatch = prompt.match(/(?:ordenado\s+por|ordered\s+by|columns?:?|columnas?:?)\s+(.+?)(?:\s*$|\.\s)/i);
    if (orderByMatch) {
      const columnsStr = orderByMatch[1];
      const columns = columnsStr
        .split(/\s+/)
        .map(c => c.trim())
        .filter(c => c.length > 0 && !["por", "by", "y", "and", "en", "in"].includes(c.toLowerCase()));
      if (columns.length >= 3) return columns;
    }
    return null;
  }

  private hasScopusData(sources: SourceSignal[]): boolean {
    return sources.some(s => (s as any).scopusData);
  }

  private buildXlsxSpec(): XlsxSpec {
    const sources = this.state?.sources || [];
    const deepSources = this.state?.deep_sources || [];
    const prompt = this.state?.contract.original_prompt || "";
    
    if (this.hasScopusData(sources)) {
      return this.buildScopusXlsxSpec(sources, prompt);
    }
    
    const requestedColumns = this.extractRequestedColumns(prompt);
    
    if (requestedColumns && requestedColumns.length > 0) {
      const dataRows = sources.slice(0, 100).map((s, i) => {
        return requestedColumns.map(col => {
          const colLower = col.toLowerCase();
          if (colLower === "title" || colLower === "titulo" || colLower === "título") return s.title;
          if (colLower === "authors" || colLower === "autores" || colLower === "author") return this.extractAuthors(s);
          if (colLower === "year" || colLower === "año") return this.extractYear(s);
          if (colLower === "journal" || colLower === "revista") return s.domain;
          if (colLower === "abstract" || colLower === "resumen") return s.snippet || s.content?.substring(0, 300) || "";
          if (colLower === "keywords" || colLower === "palabras") return "";
          if (colLower === "language" || colLower === "idioma") return "Spanish/English";
          if (colLower === "document" || colLower === "type" || colLower === "tipo") return "Article";
          if (colLower === "doi") return this.extractDOI(s);
          if (colLower === "city" || colLower === "ciudad") return "";
          if (colLower === "country" || colLower === "pais" || colLower === "país") return "";
          if (colLower === "scopus") return s.url.includes("scopus") ? "Yes" : "";
          if (colLower === "wos" || colLower === "webofscience") return s.url.includes("webofscience") ? "Yes" : "";
          if (colLower === "url" || colLower === "link") return s.url;
          if (colLower === "#" || colLower === "no" || colLower === "número") return (i + 1).toString();
          return "";
        });
      });
      
      return {
        title: this.extractResearchTitle(prompt),
        sheets: [
          {
            name: "Articles",
            headers: requestedColumns,
            data: dataRows,
            summary: {
              "Total Articles Found": sources.length,
              "Generated At": new Date().toISOString(),
              "Search Query": prompt.substring(0, 100),
            },
          },
        ],
      };
    }
    
    return {
      title: this.extractResearchTitle(prompt),
      sheets: [
        {
          name: "Summary",
          headers: ["Metric", "Value"],
          data: [
            ["Total Sources", sources.length.toString()],
            ["Deep Analyzed", deepSources.length.toString()],
            ["Claims Extracted", deepSources.reduce((acc, s) => acc + (s.claims?.length || 0), 0).toString()],
            ["Generated At", new Date().toISOString()],
          ],
        },
        {
          name: "Sources",
          headers: ["#", "Title", "Authors", "Year", "Journal/Source", "Abstract", "DOI", "URL"],
          data: sources.slice(0, 100).map((s, i) => [
            (i + 1).toString(),
            s.title,
            this.extractAuthors(s),
            this.extractYear(s),
            s.domain,
            s.snippet || "",
            this.extractDOI(s),
            s.url,
          ]),
        },
        {
          name: "Claims",
          headers: ["Source", "Claim"],
          data: deepSources.flatMap(s => 
            (s.claims || []).map(claim => [s.title.substring(0, 50), claim])
          ),
        },
      ],
    };
  }

  private buildScopusXlsxSpec(sources: SourceSignal[], prompt: string): XlsxSpec {
    const requestedColumns = this.extractRequestedColumns(prompt);
    const defaultColumns = ["#", "Authors", "Title", "Year", "Journal", "Abstract", "Keywords", "Language", "Document Type", "DOI", "Citations", "Affiliations", "Scopus URL"];
    const columns = requestedColumns && requestedColumns.length > 0 ? requestedColumns : defaultColumns;
    
    const dataRows = sources.slice(0, 100).map((s, i) => {
      const scopusData = (s as any).scopusData as ScopusArticle | undefined;
      
      return columns.map(col => {
        const colLower = col.toLowerCase();
        
        if (colLower === "#" || colLower === "no" || colLower === "número") return (i + 1).toString();
        if (colLower === "title" || colLower === "titulo" || colLower === "título") return scopusData?.title || s.title;
        if (colLower === "authors" || colLower === "autores" || colLower === "author") return scopusData?.authors?.join("; ") || "";
        if (colLower === "year" || colLower === "año") return scopusData?.year || "";
        if (colLower === "journal" || colLower === "revista") return scopusData?.journal || s.domain;
        if (colLower === "abstract" || colLower === "resumen") return scopusData?.abstract || s.snippet || "";
        if (colLower === "keywords" || colLower === "palabras") return scopusData?.keywords?.join("; ") || "";
        if (colLower === "language" || colLower === "idioma") return scopusData?.language || "";
        if (colLower === "document" || colLower === "type" || colLower === "tipo") return scopusData?.documentType || "Article";
        if (colLower === "doi") return scopusData?.doi || "";
        if (colLower === "citations" || colLower === "citas" || colLower === "citedby") return scopusData?.citationCount?.toString() || "";
        if (colLower === "affiliations" || colLower === "afiliaciones" || colLower === "affiliation") return scopusData?.affiliations?.join("; ") || "";
        if (colLower === "city" || colLower === "ciudad") return this.extractCityFromAffiliations(scopusData?.affiliations);
        if (colLower === "country" || colLower === "pais" || colLower === "país") return this.extractCountryFromAffiliations(scopusData?.affiliations);
        if (colLower === "scopus") return scopusData ? "Yes" : "";
        if (colLower === "wos" || colLower === "webofscience") return "";
        if (colLower === "url" || colLower === "link" || colLower.includes("scopus")) return scopusData?.url || s.url;
        return "";
      });
    });
    
    return {
      title: this.extractResearchTitle(prompt),
      sheets: [
        {
          name: "Scientific Articles",
          headers: columns,
          data: dataRows,
          summary: {
            "Total Articles": sources.length,
            "Source": "Scopus Database",
            "Generated At": new Date().toISOString(),
            "Search Query": prompt.substring(0, 100),
          },
        },
      ],
    };
  }

  private extractCityFromAffiliations(affiliations?: string[]): string {
    if (!affiliations || affiliations.length === 0) return "";
    const cityPatterns = /,\s*([A-Z][a-zA-Z\s]+),\s*[A-Z]{2,}/;
    for (const aff of affiliations) {
      const match = aff.match(cityPatterns);
      if (match) return match[1].trim();
    }
    return "";
  }

  private extractCountryFromAffiliations(affiliations?: string[]): string {
    if (!affiliations || affiliations.length === 0) return "";
    const countries = ["USA", "United States", "UK", "United Kingdom", "China", "Germany", "France", "Spain", "Mexico", "Brazil", "India", "Japan", "Australia", "Canada", "Italy", "Netherlands", "South Korea", "Colombia", "Chile", "Argentina", "Peru"];
    for (const aff of affiliations) {
      for (const country of countries) {
        if (aff.toLowerCase().includes(country.toLowerCase())) return country;
      }
    }
    return "";
  }

  private extractResearchTitle(prompt: string): string {
    const match = prompt.match(/(?:sobre|about)\s+(.{10,60}?)(?:\s+(?:del|from|con|y|and)|$)/i);
    return match ? match[1].trim() : prompt.substring(0, 50);
  }

  private extractAuthors(source: SourceSignal): string {
    if (source.content) {
      const authorMatch = source.content.match(/(?:by|por|authors?|autores?)[:\s]+([A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)?(?:,?\s+(?:and|y|&)?\s*[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)?)*)/i);
      if (authorMatch) return authorMatch[1].substring(0, 100);
    }
    return "";
  }

  private extractYear(source: SourceSignal): string {
    const yearMatch = source.title.match(/\b(20\d{2})\b/) || 
                      source.url.match(/\b(20\d{2})\b/) ||
                      (source.snippet && source.snippet.match(/\b(20\d{2})\b/));
    return yearMatch ? yearMatch[1] : "";
  }

  private extractDOI(source: SourceSignal): string {
    const doiMatch = source.url.match(/10\.\d{4,}\/[^\s]+/) ||
                     (source.content && source.content.match(/10\.\d{4,}\/[^\s]+/));
    return doiMatch ? doiMatch[0] : "";
  }

  private buildDocxSpec(): DocxSpec {
    const sources = this.state?.sources || [];
    const deepSources = this.state?.deep_sources || [];
    const citationsPack = packCitations(
      sources.slice(0, 20).map(s => ({
        id: s.id,
        url: s.url,
        title: s.title,
        snippet: s.snippet,
      })),
      deepSources.flatMap(s => (s.claims || []).map(c => ({ text: c, sourceIds: [s.id] })))
    );
    
    return {
      title: this.state?.contract.original_prompt.substring(0, 100) || "Research Report",
      sections: [
        {
          heading: "Executive Summary",
          level: 1,
          paragraphs: [
            `This report analyzes ${sources.length} sources to address the research question: "${this.state?.contract.original_prompt}"`,
            `Key findings are based on ${deepSources.length} deeply analyzed sources with ${deepSources.reduce((acc, s) => acc + (s.claims?.length || 0), 0)} extracted claims.`,
          ],
        },
        {
          heading: "Key Findings",
          level: 1,
          paragraphs: deepSources.slice(0, 5).flatMap(s => 
            (s.claims || []).slice(0, 2).map(c => `• ${c}`)
          ),
          citations: citationsPack.formatted.apa.slice(0, 5),
        },
        {
          heading: "Sources Overview",
          level: 1,
          paragraphs: [
            `A total of ${sources.length} sources were identified and analyzed.`,
          ],
          table: {
            headers: ["#", "Source", "Domain", "Relevance"],
            rows: sources.slice(0, 10).map((s, i) => [
              (i + 1).toString(),
              s.title.substring(0, 50),
              s.domain,
              `${(s.score * 100).toFixed(0)}%`,
            ]),
          },
        },
        {
          heading: "References",
          level: 1,
          paragraphs: citationsPack.formatted.apa.slice(0, 20),
        },
      ],
      metadata: {
        author: "IliaGPT Super Agent",
        subject: this.state?.contract.original_prompt,
      },
    };
  }

  private async executeVerifyPhase(): Promise<void> {
    if (!this.state) return;
    
    this.state.phase = "verifying";
    this.state.iteration++;
    
    this.emitSSE("tool_call", {
      id: "tc_quality_gate",
      tool: "quality_gate",
      input: { iteration: this.state.iteration },
    });
    
    const gateResult = evaluateQualityGate(this.state, this.state.contract.requirements);
    
    this.state.acceptance_results = gateResult.checks;
    
    this.emitSSE("verify", {
      passed: gateResult.passed,
      checks: gateResult.checks,
      blockers: gateResult.blockers,
      warnings: gateResult.warnings,
      report: formatGateReport(gateResult),
    });
    
    this.emitSSE("tool_result", {
      tool_call_id: "tc_quality_gate",
      success: gateResult.passed,
      output: gateResult,
    });
    
    if (!gateResult.passed) {
      const retryDecision = shouldRetry(gateResult, this.state);
      
      if (retryDecision.shouldRetry) {
        this.emitSSE("iterate", {
          iteration: this.state.iteration,
          max: this.state.max_iterations,
          strategy: retryDecision.strategy,
          actions: retryDecision.actions,
        });
        
        await this.executeRetryActions(retryDecision.actions);
        await this.executeVerifyPhase();
      }
    }
  }

  private async executeRetryActions(actions: string[]): Promise<void> {
    for (const action of actions) {
      if (action === "expand_search_queries") {
        await this.executeSignalsPhase();
      } else if (action.startsWith("retry_create_")) {
        const docType = action.replace("retry_create_", "") as "docx" | "xlsx";
        this.state!.contract.requirements.must_create = [docType];
        await this.executeCreatePhase();
      }
    }
  }

  private async executeFinalizePhase(): Promise<void> {
    if (!this.state) return;
    
    this.state.phase = "finalizing";
    
    const response = this.buildFinalResponse();
    this.state.final_response = response;
    this.state.phase = "completed";
    this.state.completed_at = Date.now();
    
    this.emitSSE("final", {
      response,
      sources_count: this.state.sources_count,
      artifacts: this.state.artifacts,
      duration_ms: this.state.completed_at - this.state.started_at,
      iterations: this.state.iteration,
    });
  }

  private buildFinalResponse(): string {
    if (!this.state) return "";
    
    const parts: string[] = [];
    
    parts.push(`## Research Complete\n`);
    parts.push(`Analyzed **${this.state.sources_count}** sources for your query.\n`);
    
    if (this.state.deep_sources.length > 0) {
      parts.push(`### Key Findings\n`);
      const claims = this.state.deep_sources
        .flatMap(s => s.claims || [])
        .slice(0, 10);
      
      for (const claim of claims) {
        parts.push(`- ${claim}\n`);
      }
    }
    
    if (this.state.artifacts.length > 0) {
      parts.push(`\n### Generated Documents\n`);
      for (const artifact of this.state.artifacts) {
        parts.push(`- 📄 **${artifact.name}** - [Download](${artifact.download_url})\n`);
      }
    }
    
    if (this.state.sources.length > 0) {
      parts.push(`\n### Top Sources\n`);
      const topSources = [...this.state.sources]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      
      for (const source of topSources) {
        parts.push(`- [${source.title}](${source.url}) (${source.domain})\n`);
      }
    }
    
    return parts.join("");
  }

  private extractSearchTopic(prompt: string): string {
    const aboutMatch = prompt.match(/(?:sobre|about|acerca\s+de)\s+(.+?)(?:\s+(?:del|from|en\s+excel|y\s+coloca|ordenado|con\s+\d+|\d{4}\s+al\s+\d{4}|$))/i);
    if (aboutMatch && aboutMatch[1]) {
      let topic = aboutMatch[1]
        .replace(/\s*\d+\s*(artículos?|articulos?|fuentes?|sources?|papers?).*$/i, "")
        .replace(/\s*(científicos?|cientificos?|académicos?)$/i, "")
        .trim();
      
      const yearMatch = prompt.match(/(?:del|from)\s+(\d{4})\s+(?:al|to|hasta)\s+(\d{4})/i);
      if (yearMatch && !topic.includes(yearMatch[1])) {
        topic = `${topic} ${yearMatch[1]}-${yearMatch[2]}`;
      }
      
      if (topic.length >= 10) {
        return topic.substring(0, 100);
      }
    }
    
    const stopWords = new Set([
      "dame", "give", "quiero", "want", "necesito", "need", "crea", "create",
      "genera", "generate", "busca", "search", "investiga", "research",
      "información", "information", "sobre", "about", "con", "with",
      "me", "un", "una", "el", "la", "los", "las", "de", "del", "y", "and",
      "fuentes", "sources", "referencias", "mínimo", "minimum", "favor", "por",
      "buscarme", "artículos", "articulos", "científicos", "cientificos",
      "papers", "excel", "word", "documento", "ordenado", "coloca", "colocalo",
      "tabla", "en"
    ]);
    
    const cleaned = prompt
      .replace(/\s*\d+\s*(artículos?|articulos?|fuentes?|sources?|referencias?|papers?).*$/i, "")
      .replace(/\s*(científicos?|cientificos?|académicos?|academicos?)/gi, "")
      .replace(/^(dame|give me|quiero|want|necesito|need|crea|create|genera|generate|busca|buscarme|search|investiga|research)\s+/i, "")
      .replace(/\s+(información|information)\s+(sobre|about|de|del)\s+/gi, " ")
      .replace(/\s+(del|from)\s+\d{4}\s+(al|to|hasta)\s+\d{4}/i, "")
      .replace(/\s+en\s+(excel|word|tabla|documento)/gi, "")
      .replace(/\s+ordenado\s+por.*$/i, "")
      .replace(/\s+y\s+coloca.*$/i, "")
      .trim();
    
    const words = cleaned.split(/\s+/).filter(word => {
      const lowerWord = word.toLowerCase().replace(/[.,!?:;]/g, "");
      return lowerWord.length > 2 && !stopWords.has(lowerWord);
    });
    
    if (words.length >= 2) {
      return words.join(" ").substring(0, 100);
    }
    
    return cleaned.substring(0, 100) || prompt.substring(0, 100);
  }

  getState(): ExecutionState | null {
    return this.state;
  }
}

export function createSuperAgent(sessionId: string, config?: Partial<OrchestratorConfig>): SuperAgentOrchestrator {
  return new SuperAgentOrchestrator(sessionId, config);
}
