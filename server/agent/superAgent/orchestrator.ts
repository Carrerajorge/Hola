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

  async execute(prompt: string): Promise<ExecutionState> {
    try {
      this.startHeartbeat();
      
      let contract = parsePromptToContract(prompt);
      
      if (this.config.enforceContract) {
        const validation = validateContract(contract);
        if (!validation.valid) {
          contract = repairContract(contract);
        }
      }
      
      this.emitSSE("contract", contract);
      
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
      
      this.emitSSE("plan", {
        steps: contract.plan,
        requirements: contract.requirements,
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
      await this.executeSignalsPhase();
      await this.executeDeepPhase();
    }
    
    if (requirements.must_create.length > 0) {
      await this.executeCreatePhase();
    }
    
    await this.executeVerifyPhase();
    
    if (this.state.phase !== "error") {
      await this.executeFinalizePhase();
    }
  }

  private async executeSignalsPhase(): Promise<void> {
    if (!this.state) return;
    
    this.state.phase = "signals";
    this.emitSSE("progress", { phase: "signals", status: "starting" });
    
    const researchDecision = shouldResearch(this.state.contract.original_prompt);
    const queries = researchDecision.searchQueries.length > 0
      ? researchDecision.searchQueries
      : [this.extractSearchTopic(this.state.contract.original_prompt)];
    
    const targetCount = this.state.contract.requirements.min_sources || 100;
    
    this.emitSSE("tool_call", {
      id: "tc_signals",
      tool: "search_web_parallel",
      input: { queries, target: targetCount },
    });
    
    const result = await collectSignals(
      queries,
      targetCount,
      (progress: SignalsProgress) => {
        this.emitSSE("progress", {
          phase: "signals",
          ...progress,
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
    
    for (const docType of this.state.contract.requirements.must_create) {
      this.emitSSE("tool_call", {
        id: `tc_create_${docType}`,
        tool: `create_${docType}`,
        input: {},
      });
      
      try {
        if (docType === "xlsx") {
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

  private buildXlsxSpec(): XlsxSpec {
    const sources = this.state?.sources || [];
    const deepSources = this.state?.deep_sources || [];
    
    return {
      title: this.state?.contract.original_prompt.substring(0, 50) || "Research",
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
          headers: ["#", "Title", "Domain", "Score", "URL"],
          data: sources.slice(0, 100).map((s, i) => [
            (i + 1).toString(),
            s.title.substring(0, 80),
            s.domain,
            s.score.toFixed(2),
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
    const stopWords = new Set([
      "dame", "give", "quiero", "want", "necesito", "need", "crea", "create",
      "genera", "generate", "busca", "search", "investiga", "research",
      "información", "information", "sobre", "about", "con", "with",
      "me", "un", "una", "el", "la", "los", "las", "de", "del", "y", "and",
      "fuentes", "sources", "referencias", "mínimo", "minimum", "favor", "por"
    ]);
    
    const cleaned = prompt
      .replace(/\s*\d+\s*(fuentes?|sources?|referencias?).*$/i, "")
      .replace(/^(dame|give me|quiero|want|necesito|need|crea|create|genera|generate|busca|search|investiga|research)\s+/i, "")
      .replace(/\s+(información|information)\s+(sobre|about|de|del)\s+/gi, " ")
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
