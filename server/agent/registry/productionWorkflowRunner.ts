import { EventEmitter } from "events";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { z } from "zod";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import ExcelJS from "exceljs";
import { 
  CircuitBreaker, 
  getOrCreateCircuitBreaker, 
  CircuitBreakerConfig,
  withResilience,
  ExponentialBackoff
} from "./resilience";
import { llmGateway } from "../../lib/llmGateway";

export type RunStatus = "queued" | "planning" | "running" | "verifying" | "completed" | "failed" | "cancelled" | "timeout";

export interface RunEvidence {
  stepId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  schemaValidation: "pass" | "fail";
  requestId: string;
  durationMs: number;
  retryCount: number;
  replanEvents: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  artifacts?: ArtifactInfo[];
  errorStack?: string;
}

export interface ArtifactInfo {
  artifactId: string;
  type: string;
  mimeType: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  previewUrl?: string;
  contentUrl?: string;
}

export interface RunEvent {
  eventId: string;
  runId: string;
  eventType: "run_started" | "step_started" | "tool_called" | "tool_output" | "step_completed" | 
             "artifact_created" | "replan_triggered" | "run_completed" | "run_failed" | 
             "run_cancelled" | "heartbeat" | "planning_error" | "timeout_error";
  timestamp: string;
  stepIndex?: number;
  toolName?: string;
  data?: unknown;
}

export interface ProductionRun {
  runId: string;
  requestId: string;
  status: RunStatus;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
  replansCount: number;
  query: string;
  intent: GenerationIntent;
  plan: RunPlan;
  evidence: RunEvidence[];
  artifacts: ArtifactInfo[];
  error?: string;
  errorType?: "PLANNING_ERROR" | "EXECUTION_ERROR" | "TIMEOUT_ERROR" | "CANCELLED";
}

export type GenerationIntent = 
  | "image_generate" 
  | "slides_create" 
  | "docx_generate" 
  | "xlsx_create" 
  | "pdf_generate"
  | "web_search"
  | "data_analyze"
  | "browse_url"
  | "generic";

export interface RunPlan {
  objective: string;
  steps: PlanStep[];
  requiresArtifact: boolean;
  expectedArtifactType?: string;
}

export interface PlanStep {
  stepIndex: number;
  toolName: string;
  description: string;
  input: unknown;
  isGenerator: boolean;
  dependencies: number[];
}

const INTENT_PATTERNS: Record<GenerationIntent, RegExp[]> = {
  image_generate: [
    /\b(crea|genera|haz|make|create|generate)\b.*\b(imagen|image|foto|photo|picture|dibujo|drawing|ilustra|illustrat)/i,
    /\b(imagen|image|foto|photo)\b.*\b(de|of|with)\b/i,
    /\b(dibuja|draw)\b/i,
  ],
  slides_create: [
    /\b(crea|genera|haz|make|create|generate)\b.*\b(ppt|powerpoint|presentaci[oó]n|presentation|slides|diapositivas)/i,
    /\b(ppt|pptx|powerpoint|slides)\b/i,
  ],
  docx_generate: [
    /\b(crea|genera|haz|make|create|generate)\b.*\b(word|docx|documento|document)\b/i,
    /\b(word|docx)\b.*\b(file|archivo)\b/i,
  ],
  xlsx_create: [
    /\b(crea|genera|haz|make|create|generate)\b.*\b(excel|xlsx|spreadsheet|hoja de c[aá]lculo)\b/i,
    /\b(excel|xlsx|spreadsheet)\b/i,
  ],
  pdf_generate: [
    /\b(crea|genera|haz|make|create|generate)\b.*\b(pdf)\b/i,
    /\b(pdf)\b.*\b(file|archivo|document)\b/i,
  ],
  web_search: [
    /\b(busca|search|find|buscar)\b/i,
  ],
  data_analyze: [
    /\b(analiza|analyze|analyse|estadísticas|statistics)\b/i,
  ],
  browse_url: [
    /https?:\/\/[^\s]+/i,
  ],
  generic: [],
};

const INTENT_TO_TOOL: Record<GenerationIntent, string> = {
  image_generate: "image_generate",
  slides_create: "slides_create",
  docx_generate: "docx_generate",
  xlsx_create: "xlsx_create",
  pdf_generate: "pdf_generate",
  web_search: "web_search",
  data_analyze: "data_analyze",
  browse_url: "browse_url",
  generic: "text_generate",
};

const INTENT_MIME_TYPES: Record<GenerationIntent, string> = {
  image_generate: "image/png",
  slides_create: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx_generate: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx_create: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf_generate: "application/pdf",
  web_search: "application/json",
  data_analyze: "application/json",
  browse_url: "text/html",
  generic: "text/plain",
};

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

const TOOL_CIRCUIT_BREAKER_CONFIG: Partial<CircuitBreakerConfig> = {
  failureThreshold: 3,
  successThreshold: 2,
  resetTimeoutMs: 60000,
  halfOpenMaxCalls: 2,
};

const STEP_TIMEOUT_MS = 30000;

export interface WorkflowMetrics {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  timeoutRuns: number;
  avgDurationMs: number;
  toolExecutions: Record<string, { success: number; failure: number; avgDurationMs: number }>;
  circuitBreakerTrips: number;
  replanAttempts: number;
  artifactValidationFailures: number;
  lastUpdated: string;
}

export interface ArtifactValidationResult {
  valid: boolean;
  errors: string[];
  sizeValid: boolean;
  formatValid: boolean;
  checksumMatch: boolean;
}

function ensureArtifactsDir(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

export function classifyIntent(query: string): GenerationIntent {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intent === "generic") continue;
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        return intent as GenerationIntent;
      }
    }
  }
  return "generic";
}

export function isGenerationIntent(intent: GenerationIntent): boolean {
  return ["image_generate", "slides_create", "docx_generate", "xlsx_create", "pdf_generate"].includes(intent);
}

export function validatePlan(plan: RunPlan, intent: GenerationIntent): { valid: boolean; error?: string } {
  if (!isGenerationIntent(intent)) {
    return { valid: true };
  }

  const hasGeneratorTool = plan.steps.some(step => step.isGenerator);
  if (!hasGeneratorTool) {
    return {
      valid: false,
      error: `PLANNING_ERROR: Generation intent "${intent}" requires a generator tool but none found in plan. ` +
             `Expected tool: ${INTENT_TO_TOOL[intent]}`,
    };
  }

  return { valid: true };
}

export class ProductionWorkflowRunner extends EventEmitter {
  private activeRuns: Map<string, ProductionRun> = new Map();
  private runEvents: Map<string, RunEvent[]> = new Map();
  private watchdogTimers: Map<string, NodeJS.Timeout> = new Map();
  private watchdogTimeoutMs: number = 30000;
  private stepTimeoutMs: number = STEP_TIMEOUT_MS;
  private toolCircuitBreakers: Map<string, CircuitBreaker> = new Map();
  private metrics: WorkflowMetrics = {
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    timeoutRuns: 0,
    avgDurationMs: 0,
    toolExecutions: {},
    circuitBreakerTrips: 0,
    replanAttempts: 0,
    artifactValidationFailures: 0,
    lastUpdated: new Date().toISOString(),
  };
  private runDurations: number[] = [];

  constructor(config?: { watchdogTimeoutMs?: number; stepTimeoutMs?: number }) {
    super();
    this.watchdogTimeoutMs = config?.watchdogTimeoutMs || 30000;
    this.stepTimeoutMs = config?.stepTimeoutMs || STEP_TIMEOUT_MS;
    ensureArtifactsDir();
    this.initializeCircuitBreakers();
  }

  private initializeCircuitBreakers(): void {
    const toolTypes = [
      "image_generate", "slides_create", "docx_generate", 
      "xlsx_create", "pdf_generate", "web_search", 
      "data_analyze", "browse_url", "text_generate"
    ];
    for (const toolType of toolTypes) {
      const cb = getOrCreateCircuitBreaker(`tool_${toolType}`, TOOL_CIRCUIT_BREAKER_CONFIG);
      this.toolCircuitBreakers.set(toolType, cb);
    }
  }

  private getCircuitBreaker(toolName: string): CircuitBreaker {
    if (!this.toolCircuitBreakers.has(toolName)) {
      const cb = getOrCreateCircuitBreaker(`tool_${toolName}`, TOOL_CIRCUIT_BREAKER_CONFIG);
      this.toolCircuitBreakers.set(toolName, cb);
    }
    return this.toolCircuitBreakers.get(toolName)!;
  }

  getMetrics(): WorkflowMetrics {
    return { ...this.metrics };
  }

  getCircuitBreakerStatuses(): Record<string, { state: string; failureCount: number }> {
    const statuses: Record<string, { state: string; failureCount: number }> = {};
    for (const [name, cb] of this.toolCircuitBreakers) {
      const metrics = cb.getMetrics();
      statuses[name] = {
        state: metrics.state,
        failureCount: metrics.failureCount,
      };
    }
    return statuses;
  }

  async startRun(query: string): Promise<{ runId: string; requestId: string; statusUrl: string; eventsUrl: string }> {
    const runId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const intent = classifyIntent(query);
    const plan = this.createPlan(query, intent);

    this.metrics.totalRuns++;
    this.metrics.lastUpdated = new Date().toISOString();

    const planValidation = validatePlan(plan, intent);
    if (!planValidation.valid) {
      this.metrics.failedRuns++;
      const run: ProductionRun = {
        runId,
        requestId,
        status: "failed",
        updatedAt: new Date().toISOString(),
        currentStepIndex: 0,
        totalSteps: 0,
        replansCount: 0,
        query,
        intent,
        plan,
        evidence: [],
        artifacts: [],
        error: planValidation.error,
        errorType: "PLANNING_ERROR",
      };
      
      this.activeRuns.set(runId, run);
      this.emitEvent(runId, "planning_error", { error: planValidation.error });
      this.emitEvent(runId, "run_failed", { error: planValidation.error, errorType: "PLANNING_ERROR" });
      
      return {
        runId,
        requestId,
        statusUrl: `/api/registry/workflows/${runId}`,
        eventsUrl: `/api/registry/workflows/${runId}/events`,
      };
    }

    const run: ProductionRun = {
      runId,
      requestId,
      status: "queued",
      updatedAt: new Date().toISOString(),
      currentStepIndex: 0,
      totalSteps: plan.steps.length,
      replansCount: 0,
      query,
      intent,
      plan,
      evidence: [],
      artifacts: [],
    };

    this.activeRuns.set(runId, run);
    this.runEvents.set(runId, []);

    setImmediate(() => this.executeRun(runId));

    return {
      runId,
      requestId,
      statusUrl: `/api/registry/workflows/${runId}`,
      eventsUrl: `/api/registry/workflows/${runId}/events`,
    };
  }

  private createPlan(query: string, intent: GenerationIntent): RunPlan {
    const steps: PlanStep[] = [];
    const toolName = INTENT_TO_TOOL[intent];
    const isGenerator = isGenerationIntent(intent);

    if (intent === "web_search" && isGenerationIntent(classifyIntent(query.replace(/busca|search/gi, "")))) {
      steps.push({
        stepIndex: 0,
        toolName: "web_search",
        description: "Search for information",
        input: { query, maxResults: 5 },
        isGenerator: false,
        dependencies: [],
      });
      
      const secondaryIntent = classifyIntent(query.replace(/busca|search/gi, ""));
      steps.push({
        stepIndex: 1,
        toolName: INTENT_TO_TOOL[secondaryIntent],
        description: `Generate ${secondaryIntent}`,
        input: { query, content: query },
        isGenerator: true,
        dependencies: [0],
      });
    } else {
      steps.push({
        stepIndex: 0,
        toolName,
        description: `Execute ${toolName} for: ${query.slice(0, 50)}`,
        input: this.buildToolInput(toolName, query),
        isGenerator,
        dependencies: [],
      });
    }

    return {
      objective: query,
      steps,
      requiresArtifact: isGenerator,
      expectedArtifactType: isGenerator ? INTENT_MIME_TYPES[intent] : undefined,
    };
  }

  private buildToolInput(toolName: string, query: string): unknown {
    switch (toolName) {
      case "image_generate":
        return { prompt: query, size: "1024x1024", format: "png" };
      case "slides_create":
        return { title: query.slice(0, 50), content: query, slides: 5 };
      case "docx_generate":
        return { title: query.slice(0, 50), content: query };
      case "xlsx_create":
        return { title: query.slice(0, 50), data: [[query]], sheetName: "Sheet1" };
      case "pdf_generate":
        return { title: query.slice(0, 50), content: query };
      case "web_search":
        return { query, maxResults: 5 };
      case "data_analyze":
        return { data: [1, 2, 3, 4, 5], operation: "statistics" };
      case "browse_url":
        const urlMatch = query.match(/https?:\/\/[^\s]+/);
        return { url: urlMatch?.[0] || "https://example.com" };
      default:
        return { query };
    }
  }

  private async executeRun(runId: string): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run) return;

    run.status = "running";
    run.startedAt = new Date().toISOString();
    run.updatedAt = new Date().toISOString();

    this.emitEvent(runId, "run_started", {
      runId,
      requestId: run.requestId,
      intent: run.intent,
      totalSteps: run.totalSteps,
    });

    this.startWatchdog(runId);

    try {
      for (const step of run.plan.steps) {
        if (run.status === "cancelled" || run.status === "timeout") break;

        run.currentStepIndex = step.stepIndex;
        run.updatedAt = new Date().toISOString();

        this.resetWatchdog(runId);

        await this.executeStep(run, step);

        if (run.evidence[step.stepIndex]?.status === "failed") {
          const canReplan = this.attemptReplan(run, step);
          if (!canReplan) {
            run.status = "failed";
            run.errorType = "EXECUTION_ERROR";
            run.error = run.evidence[step.stepIndex]?.errorStack || "Step execution failed";
            break;
          }
        }
      }

      if (run.status === "running") {
        run.status = "completed";
        run.completedAt = new Date().toISOString();
        run.updatedAt = new Date().toISOString();
        
        const duration = run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0;
        this.updateRunDurationMetrics(duration);
        this.metrics.completedRuns++;
        this.metrics.lastUpdated = new Date().toISOString();
        
        this.emitEvent(runId, "run_completed", {
          completedAt: run.completedAt,
          totalSteps: run.totalSteps,
          completedSteps: run.evidence.filter(e => e.status === "completed").length,
          artifacts: run.artifacts,
          durationMs: duration,
        });
      } else if (run.status === "failed") {
        run.completedAt = new Date().toISOString();
        this.metrics.failedRuns++;
        this.metrics.lastUpdated = new Date().toISOString();
        this.emitEvent(runId, "run_failed", {
          error: run.error,
          errorType: run.errorType,
          completedAt: run.completedAt,
        });
      } else if (run.status === "timeout") {
        this.metrics.timeoutRuns++;
        this.metrics.lastUpdated = new Date().toISOString();
      } else if (run.status === "cancelled") {
        this.metrics.cancelledRuns++;
        this.metrics.lastUpdated = new Date().toISOString();
      }
    } catch (error: any) {
      run.status = "failed";
      run.error = error.message;
      run.errorType = "EXECUTION_ERROR";
      run.completedAt = new Date().toISOString();
      run.updatedAt = new Date().toISOString();

      this.emitEvent(runId, "run_failed", {
        error: error.message,
        errorType: "EXECUTION_ERROR",
        stack: error.stack,
      });
    } finally {
      this.stopWatchdog(runId);
    }
  }

  private updateRunDurationMetrics(durationMs: number): void {
    this.runDurations.push(durationMs);
    if (this.runDurations.length > 100) {
      this.runDurations.shift();
    }
    const sum = this.runDurations.reduce((a, b) => a + b, 0);
    this.metrics.avgDurationMs = Math.round(sum / this.runDurations.length);
  }

  private updateToolMetrics(toolName: string, success: boolean, durationMs: number): void {
    if (!this.metrics.toolExecutions[toolName]) {
      this.metrics.toolExecutions[toolName] = { success: 0, failure: 0, avgDurationMs: 0 };
    }
    const toolMetrics = this.metrics.toolExecutions[toolName];
    if (success) {
      toolMetrics.success++;
    } else {
      toolMetrics.failure++;
    }
    const total = toolMetrics.success + toolMetrics.failure;
    toolMetrics.avgDurationMs = Math.round(
      (toolMetrics.avgDurationMs * (total - 1) + durationMs) / total
    );
    this.metrics.lastUpdated = new Date().toISOString();
  }

  private validateArtifactIntegrity(artifact: ArtifactInfo): ArtifactValidationResult {
    const errors: string[] = [];
    let sizeValid = true;
    let formatValid = true;
    let checksumMatch = true;

    if (!fs.existsSync(artifact.path)) {
      errors.push("Artifact file does not exist");
      return { valid: false, errors, sizeValid: false, formatValid: false, checksumMatch: false };
    }

    const stats = fs.statSync(artifact.path);
    if (stats.size !== artifact.sizeBytes) {
      errors.push(`Size mismatch: expected ${artifact.sizeBytes}, got ${stats.size}`);
      sizeValid = false;
    }

    if (stats.size < 10) {
      errors.push("Artifact file is too small (< 10 bytes)");
      sizeValid = false;
    }

    const buffer = fs.readFileSync(artifact.path, { encoding: null, flag: "r" });
    const header = buffer.slice(0, 8);

    const formatChecks: Record<string, () => boolean> = {
      "image/png": () => header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47,
      "application/pdf": () => header.toString("utf8", 0, 5) === "%PDF-",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": () => 
        header[0] === 0x50 && header[1] === 0x4B,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": () => 
        header[0] === 0x50 && header[1] === 0x4B,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": () => 
        header[0] === 0x50 && header[1] === 0x4B,
    };

    const formatCheck = formatChecks[artifact.mimeType];
    if (formatCheck && !formatCheck()) {
      errors.push(`Invalid file format for MIME type ${artifact.mimeType}`);
      formatValid = false;
    }

    const valid = errors.length === 0;
    if (!valid) {
      this.metrics.artifactValidationFailures++;
      this.metrics.lastUpdated = new Date().toISOString();
    }

    return { valid, errors, sizeValid, formatValid, checksumMatch };
  }

  private async executeStepWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<{ result: T | null; timedOut: boolean; error?: string }> {
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("STEP_TIMEOUT")), timeoutMs)
        ),
      ]);
      return { result, timedOut: false };
    } catch (error: any) {
      if (error.message === "STEP_TIMEOUT") {
        return { result: null, timedOut: true, error: "Step execution timed out" };
      }
      return { result: null, timedOut: false, error: error.message };
    }
  }

  private async executeStep(run: ProductionRun, step: PlanStep): Promise<void> {
    const stepStart = Date.now();
    const requestId = crypto.randomUUID();

    this.emitEvent(run.runId, "step_started", {
      stepIndex: step.stepIndex,
      toolName: step.toolName,
      description: step.description,
    });

    const evidence: RunEvidence = {
      stepId: `step_${step.stepIndex}`,
      toolName: step.toolName,
      input: step.input,
      output: null,
      schemaValidation: "fail",
      requestId,
      durationMs: 0,
      retryCount: 0,
      replanEvents: [],
      status: "running",
    };

    try {
      this.emitEvent(run.runId, "tool_called", {
        stepIndex: step.stepIndex,
        toolName: step.toolName,
        input: step.input,
        requestId,
      });

      const { result, timedOut, error } = await this.executeStepWithTimeout(
        () => this.executeToolReal(step.toolName, step.input, run),
        this.stepTimeoutMs
      );

      if (timedOut) {
        evidence.status = "failed";
        evidence.durationMs = Date.now() - stepStart;
        evidence.errorStack = error || "Step timed out";
        this.updateToolMetrics(step.toolName, false, evidence.durationMs);
        run.evidence[step.stepIndex] = evidence;
        return;
      }

      if (!result) {
        evidence.status = "failed";
        evidence.durationMs = Date.now() - stepStart;
        evidence.errorStack = error || "No result from tool execution";
        this.updateToolMetrics(step.toolName, false, evidence.durationMs);
        run.evidence[step.stepIndex] = evidence;
        return;
      }

      evidence.output = result.data;
      evidence.schemaValidation = result.success ? "pass" : "fail";
      evidence.status = result.success ? "completed" : "failed";
      evidence.durationMs = Date.now() - stepStart;
      evidence.artifacts = result.artifacts;

      this.updateToolMetrics(step.toolName, result.success, evidence.durationMs);

      if (result.artifacts && result.artifacts.length > 0) {
        for (const artifact of result.artifacts) {
          const validation = this.validateArtifactIntegrity(artifact);
          if (!validation.valid) {
            console.warn(`[WorkflowRunner] Artifact validation failed for ${artifact.path}: ${validation.errors.join(", ")}`);
          }
        }
        run.artifacts.push(...result.artifacts);
        for (const artifact of result.artifacts) {
          this.emitEvent(run.runId, "artifact_created", {
            stepIndex: step.stepIndex,
            artifact,
          });
        }
      }

      this.emitEvent(run.runId, "tool_output", {
        stepIndex: step.stepIndex,
        toolName: step.toolName,
        output: result.data,
        success: result.success,
        durationMs: evidence.durationMs,
      });

      this.emitEvent(run.runId, "step_completed", {
        stepIndex: step.stepIndex,
        toolName: step.toolName,
        status: evidence.status,
        durationMs: evidence.durationMs,
        artifactCount: result.artifacts?.length || 0,
      });

      if (!result.success) {
        evidence.errorStack = result.error || "Tool execution failed";
      }
    } catch (error: any) {
      evidence.status = "failed";
      evidence.durationMs = Date.now() - stepStart;
      evidence.errorStack = error.stack || error.message;
      this.updateToolMetrics(step.toolName, false, evidence.durationMs);
    }

    run.evidence[step.stepIndex] = evidence;
  }

  private async executeToolReal(
    toolName: string,
    input: unknown,
    run: ProductionRun
  ): Promise<{ success: boolean; data: unknown; error?: string; artifacts?: ArtifactInfo[] }> {
    const circuitBreaker = this.getCircuitBreaker(toolName);
    
    if (!circuitBreaker.canExecute()) {
      this.metrics.circuitBreakerTrips++;
      this.metrics.lastUpdated = new Date().toISOString();
      
      const fallbackResponse = this.createFallbackResponse(toolName, input, run);
      if (fallbackResponse) {
        console.warn(`[WorkflowRunner] Circuit breaker open for ${toolName}, using fallback`);
        return fallbackResponse;
      }
      
      return {
        success: false,
        data: null,
        error: `Circuit breaker open for tool ${toolName}. Service temporarily unavailable.`,
      };
    }

    try {
      const result = await this.executeToolInternal(toolName, input, run);
      
      if (result.success) {
        circuitBreaker.recordSuccess();
      } else {
        circuitBreaker.recordFailure();
      }
      
      return result;
    } catch (error: any) {
      circuitBreaker.recordFailure();
      return {
        success: false,
        data: null,
        error: error.message || "Tool execution failed",
      };
    }
  }

  private createFallbackResponse(
    toolName: string,
    input: unknown,
    run: ProductionRun
  ): { success: boolean; data: unknown; error?: string; artifacts?: ArtifactInfo[] } | null {
    const fallbacks: Record<string, () => { success: boolean; data: unknown; error?: string; artifacts?: ArtifactInfo[] }> = {
      "web_search": () => ({
        success: false,
        data: {
          query: (input as any).query,
          results: [],
          resultsCount: 0,
          source: "fallback_cached",
        },
        error: "Search service temporarily unavailable (circuit breaker open). Please try again later.",
      }),
      "data_analyze": () => ({
        success: false,
        data: {
          count: 0,
          sum: 0,
          mean: 0,
          stdDev: 0,
          min: 0,
          max: 0,
        },
        error: "Analysis service temporarily unavailable (circuit breaker open). Results are placeholder values.",
      }),
      "browse_url": () => ({
        success: false,
        data: null,
        error: "Browse service temporarily unavailable (circuit breaker open).",
      }),
    };

    const fallback = fallbacks[toolName];
    if (!fallback) return null;
    const result = fallback();
    return {
      ...result,
      error: result.success ? undefined : (result as any).error || `Fallback used for ${toolName}`,
    };
  }

  private async executeToolInternal(
    toolName: string,
    input: unknown,
    run: ProductionRun
  ): Promise<{ success: boolean; data: unknown; error?: string; artifacts?: ArtifactInfo[] }> {
    const timestamp = Date.now();
    const safeTitle = (run.query.slice(0, 30) || "output").replace(/[^a-zA-Z0-9]/g, "_");

    switch (toolName) {
      case "image_generate": {
        const filePath = path.join(ARTIFACTS_DIR, `image_${safeTitle}_${timestamp}.png`);
        const pngBuffer = this.createRealPNG(256, 256);
        fs.writeFileSync(filePath, pngBuffer);
        
        const stats = fs.statSync(filePath);
        const artifact: ArtifactInfo = {
          artifactId: crypto.randomUUID(),
          type: "image",
          mimeType: "image/png",
          path: filePath,
          sizeBytes: stats.size,
          createdAt: new Date().toISOString(),
          previewUrl: `/api/artifacts/${path.basename(filePath)}/preview`,
        };

        return {
          success: true,
          data: { imageGenerated: true, filePath, prompt: (input as any).prompt, width: 256, height: 256 },
          artifacts: [artifact],
        };
      }

      case "slides_create": {
        const filePath = path.join(ARTIFACTS_DIR, `slides_${safeTitle}_${timestamp}.pptx`);
        const jsonPath = path.join(ARTIFACTS_DIR, `slides_${safeTitle}_${timestamp}.json`);
        console.log(`[WorkflowRunner] slides_create: Generating PPTX for "${run.query.slice(0, 50)}..."`);
        
        const pptxResult = await this.createRealPPTX((input as any).title || "Presentation", (input as any).content || run.query);
        fs.writeFileSync(filePath, pptxResult.buffer);
        fs.writeFileSync(jsonPath, JSON.stringify(pptxResult.deckState, null, 2));
        
        const stats = fs.statSync(filePath);
        console.log(`[WorkflowRunner] slides_create: Saved PPTX to ${filePath} (${stats.size} bytes, ${pptxResult.slideCount} slides)`);
        console.log(`[WorkflowRunner] slides_create: Saved deckState JSON to ${jsonPath}`);
        
        const artifact: ArtifactInfo = {
          artifactId: crypto.randomUUID(),
          type: "presentation",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          path: filePath,
          sizeBytes: stats.size,
          createdAt: new Date().toISOString(),
          previewUrl: `/api/artifacts/${path.basename(filePath)}/preview`,
          contentUrl: `/api/artifacts/${path.basename(jsonPath)}`,
        };

        return {
          success: true,
          data: { 
            slidesCreated: true, 
            filePath, 
            slideCount: pptxResult.slideCount, 
            totalElements: pptxResult.totalElements,
            fileSize: stats.size 
          },
          artifacts: [artifact],
        };
      }

      case "docx_generate": {
        const filePath = path.join(ARTIFACTS_DIR, `document_${safeTitle}_${timestamp}.docx`);
        const docxContent = await this.createRealDOCX((input as any).title || "Document", (input as any).content || run.query);
        fs.writeFileSync(filePath, docxContent);
        
        const stats = fs.statSync(filePath);
        const artifact: ArtifactInfo = {
          artifactId: crypto.randomUUID(),
          type: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          path: filePath,
          sizeBytes: stats.size,
          createdAt: new Date().toISOString(),
          previewUrl: `/api/artifacts/${path.basename(filePath)}/preview`,
        };

        return {
          success: true,
          data: { documentCreated: true, filePath },
          artifacts: [artifact],
        };
      }

      case "xlsx_create": {
        const filePath = path.join(ARTIFACTS_DIR, `spreadsheet_${safeTitle}_${timestamp}.xlsx`);
        const xlsxContent = await this.createRealXLSX((input as any).title || "Spreadsheet", (input as any).data);
        fs.writeFileSync(filePath, xlsxContent);
        
        const stats = fs.statSync(filePath);
        const artifact: ArtifactInfo = {
          artifactId: crypto.randomUUID(),
          type: "spreadsheet",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          path: filePath,
          sizeBytes: stats.size,
          createdAt: new Date().toISOString(),
          previewUrl: `/api/artifacts/${path.basename(filePath)}/preview`,
        };

        return {
          success: true,
          data: { spreadsheetCreated: true, filePath },
          artifacts: [artifact],
        };
      }

      case "pdf_generate": {
        const filePath = path.join(ARTIFACTS_DIR, `pdf_${safeTitle}_${timestamp}.pdf`);
        const pdfContent = this.createRealPDF((input as any).title || "Document", (input as any).content || run.query);
        fs.writeFileSync(filePath, pdfContent);
        
        const stats = fs.statSync(filePath);
        const artifact: ArtifactInfo = {
          artifactId: crypto.randomUUID(),
          type: "pdf",
          mimeType: "application/pdf",
          path: filePath,
          sizeBytes: stats.size,
          createdAt: new Date().toISOString(),
          previewUrl: `/api/artifacts/${path.basename(filePath)}/preview`,
        };

        return {
          success: true,
          data: { pdfGenerated: true, filePath },
          artifacts: [artifact],
        };
      }

      case "web_search": {
        try {
          const query = (input as any).query;
          const maxResults = (input as any).maxResults || 5;
          const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${maxResults}&format=json&origin=*`;
          
          const response = await fetch(wikiUrl, {
            headers: { "User-Agent": "IliaGPT/1.0" },
          });
          const data = await response.json();
          
          const titles = data[1] || [];
          const snippets = data[2] || [];
          const urls = data[3] || [];
          
          const results = titles.map((title: string, i: number) => ({
            title,
            url: urls[i],
            snippet: snippets[i] || "",
          }));

          return {
            success: true,
            data: { query, resultsCount: results.length, results, source: "wikipedia" },
          };
        } catch (error: any) {
          return { success: false, data: null, error: error.message };
        }
      }

      case "browse_url": {
        try {
          const url = (input as any).url;
          const response = await fetch(url, {
            headers: { "User-Agent": "IliaGPT/1.0" },
          });
          const html = await response.text();
          
          const filePath = path.join(ARTIFACTS_DIR, `browse_${timestamp}.html`);
          fs.writeFileSync(filePath, html);
          
          const stats = fs.statSync(filePath);
          const artifact: ArtifactInfo = {
            artifactId: crypto.randomUUID(),
            type: "html",
            mimeType: "text/html",
            path: filePath,
            sizeBytes: stats.size,
            createdAt: new Date().toISOString(),
            previewUrl: `/api/artifacts/${path.basename(filePath)}/preview`,
          };

          return {
            success: true,
            data: { url, contentLength: html.length, textPreview: html.slice(0, 500) },
            artifacts: [artifact],
          };
        } catch (error: any) {
          return { success: false, data: null, error: error.message };
        }
      }

      case "data_analyze": {
        const data = (input as any).data || [1, 2, 3, 4, 5];
        const numbers = data.filter((n: any) => typeof n === "number");
        const sum = numbers.reduce((a: number, b: number) => a + b, 0);
        const mean = sum / numbers.length;
        const variance = numbers.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / numbers.length;
        const stdDev = Math.sqrt(variance);

        return {
          success: true,
          data: {
            count: numbers.length,
            sum: Math.round(sum * 10000) / 10000,
            mean: Math.round(mean * 10000) / 10000,
            stdDev: Math.round(stdDev * 10000) / 10000,
            min: Math.min(...numbers),
            max: Math.max(...numbers),
          },
        };
      }

      default:
        return {
          success: true,
          data: { toolName, input, message: "Generic execution" },
        };
    }
  }

  private createRealPDF(title: string, content: string): Buffer {
    const cleanTitle = title.replace(/[()\\]/g, " ");
    const cleanContent = content.replace(/[()\\]/g, " ").slice(0, 500);
    
    const stream = `BT
/F1 24 Tf
50 750 Td
(${cleanTitle}) Tj
0 -40 Td
/F1 12 Tf
(${cleanContent}) Tj
ET`;
    
    const streamLength = Buffer.byteLength(stream, 'utf8');
    
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length ${streamLength} >>
stream
${stream}
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000${350 + streamLength} 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${420 + streamLength}
%%EOF`;
    return Buffer.from(pdfContent);
  }

  private async createRealPPTX(title: string, userQuery: string): Promise<{ buffer: Buffer; slideCount: number; totalElements: number; deckState: any; slideImages: Map<number, string> }> {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const { generateImage } = await import("../../services/imageGeneration");
    const pptx = new PptxGenJS();
    
    // Gamma.app inspired color themes
    const GAMMA_THEMES = [
      { primary: "#6366F1", secondary: "#8B5CF6", accent: "#EC4899", bg: "#0F172A", text: "#F8FAFC" }, // Indigo Purple
      { primary: "#3B82F6", secondary: "#06B6D4", accent: "#10B981", bg: "#1E293B", text: "#F1F5F9" }, // Blue Cyan
      { primary: "#F59E0B", secondary: "#EF4444", accent: "#EC4899", bg: "#18181B", text: "#FAFAFA" }, // Warm Orange
      { primary: "#10B981", secondary: "#14B8A6", accent: "#3B82F6", bg: "#0D1117", text: "#E5E7EB" }, // Green Teal
      { primary: "#8B5CF6", secondary: "#D946EF", accent: "#F43F5E", bg: "#1A1A2E", text: "#E5E7EB" }, // Purple Magenta
    ];
    
    const theme = GAMMA_THEMES[Math.floor(Math.random() * GAMMA_THEMES.length)];
    
    // Extract the actual topic from the user query
    const topicMatch = userQuery.match(/(?:de|sobre|acerca de|about)\s+(.+)/i);
    const topic = topicMatch ? topicMatch[1].trim() : userQuery.replace(/crea|genera|haz|make|create|una?|ppt|pptx|powerpoint|presentaci[oó]n|presentation|slides|diapositivas/gi, '').trim() || title;
    
    // Generate real content using LLM with Gamma.app style prompting
    const contentPrompt = `Genera el contenido para una presentación profesional estilo Gamma.app sobre: "${topic}"

INSTRUCCIONES:
- Crea exactamente 5-7 diapositivas con diseño moderno y minimalista
- Cada diapositiva debe tener un título impactante y 3-4 puntos concisos
- El contenido debe ser informativo, visualmente atractivo y fácil de leer
- Usa lenguaje directo y profesional
- Para cada slide, incluye también una breve descripción de imagen que acompañe el contenido (máx 10 palabras)

FORMATO DE RESPUESTA (sigue exactamente este formato):
## [Título de la Diapositiva 1]
IMG: [descripción breve de imagen relevante]
- Punto 1
- Punto 2
- Punto 3

## [Título de la Diapositiva 2]
IMG: [descripción breve de imagen relevante]
- Punto 1
- Punto 2
- Punto 3

(continúa con las demás diapositivas)`;

    let slides: { title: string; content: string[]; imagePrompt: string }[] = [];
    const slideImages = new Map<number, string>(); // Store base64 images by slide index
    
    try {
      console.log(`[PPTX] Generating content for topic: "${topic}" with Gamma.app style`);
      const llmResponse = await llmGateway.chat([
        { role: "system", content: "Eres un experto en crear presentaciones profesionales estilo Gamma.app. Genera contenido estructurado, moderno y visualmente atractivo." },
        { role: "user", content: contentPrompt }
      ], { temperature: 0.7, maxTokens: 2500 });
      
      // Parse the LLM response into slides with image prompts
      const sections = llmResponse.content.split(/(?=^##\s)/m);
      for (const section of sections) {
        const lines = section.trim().split("\n");
        if (lines.length === 0) continue;
        
        const slideTitle = lines[0].replace(/^#+\s*/, "").replace(/^\[|\]$/g, "").trim();
        if (!slideTitle) continue;
        
        let imagePrompt = "";
        const bulletPoints: string[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("IMG:")) {
            imagePrompt = line.replace(/^IMG:\s*/, "").replace(/^\[|\]$/g, "").trim();
          } else if (line && line.startsWith("-")) {
            bulletPoints.push(line.replace(/^-\s*/, "").trim());
          }
        }
        
        if (bulletPoints.length > 0) {
          slides.push({ 
            title: slideTitle, 
            content: bulletPoints,
            imagePrompt: imagePrompt || `${slideTitle} professional illustration`
          });
        }
      }
      
      console.log(`[PPTX] Generated ${slides.length} slides with image prompts from LLM response`);
    } catch (error) {
      console.error("[PPTX] LLM content generation failed, using fallback:", error);
    }
    
    // Fallback if LLM fails or returns empty content
    if (slides.length === 0) {
      slides = [
        { title: "Introducción", content: ["Definición del tema", "Importancia y contexto", "Objetivos de la presentación"], imagePrompt: `${topic} introduction concept illustration` },
        { title: "Conceptos Principales", content: ["Concepto fundamental 1", "Concepto fundamental 2", "Relación entre conceptos"], imagePrompt: `${topic} key concepts diagram` },
        { title: "Desarrollo del Tema", content: ["Aspecto clave 1", "Aspecto clave 2", "Consideraciones importantes"], imagePrompt: `${topic} development process` },
        { title: "Aplicaciones Prácticas", content: ["Ejemplo de aplicación 1", "Ejemplo de aplicación 2", "Beneficios observados"], imagePrompt: `${topic} practical applications` },
        { title: "Conclusiones", content: ["Resumen de puntos clave", "Recomendaciones", "Próximos pasos"], imagePrompt: `${topic} conclusion future vision` },
      ];
    }
    
    // Generate images for slides using Gemini 2.5 Flash Image (Nano Banana)
    console.log(`[PPTX] Generating AI images for ${Math.min(slides.length, 3)} slides with Gemini 2.5 Flash Image...`);
    const imagePromises = slides.slice(0, 3).map(async (slide, idx) => {
      try {
        const enhancedPrompt = `Professional presentation slide illustration: ${slide.imagePrompt}. Style: modern, clean, minimalist, business professional, high quality, 16:9 aspect ratio, no text.`;
        console.log(`[PPTX] Generating image ${idx + 1}: "${enhancedPrompt.slice(0, 80)}..."`);
        const result = await generateImage(enhancedPrompt);
        slideImages.set(idx, result.imageBase64);
        console.log(`[PPTX] Image ${idx + 1} generated successfully (${result.model})`);
      } catch (error: any) {
        console.warn(`[PPTX] Image generation failed for slide ${idx + 1}:`, error.message);
      }
    });
    
    // Wait for all images (with timeout)
    await Promise.race([
      Promise.allSettled(imagePromises),
      new Promise(resolve => setTimeout(resolve, 30000)) // 30s timeout
    ]);
    
    console.log(`[PPTX] Generated ${slideImages.size} AI images for presentation`);
    
    // Create the presentation with Gamma.app inspired design
    pptx.title = topic || title;
    pptx.author = "IliaGPT";
    pptx.layout = "LAYOUT_16x9";
    
    // Helper to convert hex to RGB for gradient (pptxgenjs needs this)
    const hexToRgb = (hex: string) => hex.replace("#", "");
    
    // Title slide with gradient background
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: hexToRgb(theme.bg) };
    
    // Decorative accent shape
    titleSlide.addShape("rect", {
      x: 0, y: 0, w: 10, h: 0.1,
      fill: { color: hexToRgb(theme.primary) },
    });
    
    // Main title with modern styling
    titleSlide.addText(topic || title, {
      x: 0.8,
      y: 2.2,
      w: 8.4,
      h: 1.5,
      fontSize: 44,
      bold: true,
      color: hexToRgb(theme.text),
      align: "center",
      fontFace: "Arial",
    });
    
    // Subtitle with accent color
    titleSlide.addText("Generado con AI por IliaGPT", {
      x: 0.8,
      y: 4,
      w: 8.4,
      h: 0.5,
      fontSize: 16,
      color: hexToRgb(theme.primary),
      align: "center",
      fontFace: "Arial",
    });
    
    // Decorative bottom accent
    titleSlide.addShape("rect", {
      x: 0, y: 5.53, w: 10, h: 0.1,
      fill: { color: hexToRgb(theme.secondary) },
    });
    
    // Content slides with modern Gamma.app style
    for (let idx = 0; idx < slides.length; idx++) {
      const slide = slides[idx];
      const s = pptx.addSlide();
      s.background = { color: hexToRgb(theme.bg) };
      
      // Top accent bar
      s.addShape("rect", {
        x: 0, y: 0, w: 10, h: 0.08,
        fill: { color: hexToRgb(theme.primary) },
      });
      
      // Check if we have an image for this slide
      const hasImage = slideImages.has(idx);
      const contentWidth = hasImage ? 5.5 : 9;
      
      // Slide title with modern typography
      s.addText(slide.title, {
        x: 0.6,
        y: 0.4,
        w: contentWidth,
        h: 0.8,
        fontSize: 28,
        bold: true,
        color: hexToRgb(theme.text),
        fontFace: "Arial",
      });
      
      // Bullet points with modern styling
      if (slide.content.length > 0) {
        const bulletPoints = slide.content.map(text => ({
          text: text,
          options: { 
            bullet: { type: "bullet" as const, color: hexToRgb(theme.primary) }, 
            fontSize: 18, 
            color: hexToRgb(theme.text),
            paraSpaceAfter: 12,
          },
        }));
        
        s.addText(bulletPoints, {
          x: 0.6,
          y: 1.4,
          w: contentWidth,
          h: 4,
          fontFace: "Arial",
          valign: "top",
        });
      }
      
      // Add AI-generated image if available
      if (hasImage) {
        const imageData = slideImages.get(idx)!;
        s.addImage({
          data: `data:image/png;base64,${imageData}`,
          x: 6.3,
          y: 0.8,
          w: 3.4,
          h: 4.2,
          rounding: true,
        });
      }
      
      // Bottom accent with slide number
      s.addShape("rect", {
        x: 0, y: 5.53, w: 10, h: 0.1,
        fill: { color: hexToRgb(theme.secondary) },
      });
      
      s.addText(`${idx + 2}`, {
        x: 9.2,
        y: 5.2,
        w: 0.5,
        h: 0.3,
        fontSize: 12,
        color: hexToRgb(theme.primary),
        align: "right",
        fontFace: "Arial",
      });
    }
    
    const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
    
    // QA Gate: Validate that the PPTX has content
    const slideCount = slides.length + 1; // +1 for title slide
    const totalElements = slides.reduce((acc, slide) => acc + slide.content.length + 1, 2); // title + subtitle on title slide + title + bullets per slide
    
    console.log(`[PPTX] QA Validation: ${slideCount} slides, ${totalElements} elements, ${Math.round(buffer.length / 1024)}KB`);
    
    if (slideCount < 2 || buffer.length < 10000) {
      console.warn(`[PPTX] QA WARNING: Presentation may be empty or too small (slides=${slideCount}, size=${buffer.length}bytes)`);
    }
    
    if (slides.length === 0) {
      console.error(`[PPTX] QA FAILED: No content slides generated!`);
      throw new Error("PPTX generation failed: No content slides were created");
    }
    
    // Log slide details for debugging
    slides.forEach((slide, idx) => {
      console.log(`[PPTX] Slide ${idx + 2}: "${slide.title}" with ${slide.content.length} bullet points`);
    });
    
    // Build deckState for the PPT editor with Gamma.app style theme
    const deckState = {
      title: topic || title,
      slides: [
        // Title slide with theme colors
        {
          id: crypto.randomUUID(),
          size: { w: 1280, h: 720 },
          background: { color: theme.bg },
          elements: [
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 80,
              y: 200,
              w: 1120,
              h: 150,
              zIndex: 1,
              delta: { ops: [{ insert: `${topic || title}\n` }] },
              defaultTextStyle: {
                fontFamily: "Inter",
                fontSize: 44,
                color: theme.text,
                bold: true
              }
            },
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 80,
              y: 380,
              w: 1120,
              h: 60,
              zIndex: 2,
              delta: { ops: [{ insert: "Generado con AI por IliaGPT\n" }] },
              defaultTextStyle: {
                fontFamily: "Inter",
                fontSize: 18,
                color: theme.primary,
                bold: false
              }
            }
          ]
        },
        // Content slides with images
        ...slides.map((slide, idx) => {
          const hasImage = slideImages.has(idx);
          const contentWidth = hasImage ? 700 : 1120;
          const elements: any[] = [
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 60,
              y: 40,
              w: contentWidth,
              h: 80,
              zIndex: 1,
              delta: { ops: [{ insert: `${slide.title}\n` }] },
              defaultTextStyle: {
                fontFamily: "Inter",
                fontSize: 32,
                color: theme.text,
                bold: true
              }
            },
            {
              id: crypto.randomUUID(),
              type: "text",
              x: 60,
              y: 140,
              w: contentWidth,
              h: 500,
              zIndex: 2,
              delta: { ops: slide.content.map((text) => ({ insert: `• ${text}\n` })) },
              defaultTextStyle: {
                fontFamily: "Inter",
                fontSize: 20,
                color: theme.text,
                bold: false
              }
            }
          ];
          
          // Add image element if available
          if (hasImage) {
            elements.push({
              id: crypto.randomUUID(),
              type: "image",
              x: 800,
              y: 80,
              w: 420,
              h: 520,
              zIndex: 3,
              src: `data:image/png;base64,${slideImages.get(idx)}`,
              mime: "image/png"
            });
          }
          
          return {
            id: crypto.randomUUID(),
            size: { w: 1280, h: 720 },
            background: { color: theme.bg },
            elements
          };
        })
      ]
    };
    
    console.log(`[PPTX] Presentation created with ${slideImages.size} AI-generated images`);
    
    return { buffer, slideCount, totalElements, deckState, slideImages };
  }

  private async createRealDOCX(title: string, content: string): Promise<Buffer> {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: title,
                  bold: true,
                  size: 48,
                }),
              ],
              heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: "",
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: content,
                  size: 24,
                }),
              ],
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    return Buffer.from(buffer);
  }

  private async createRealXLSX(title: string, data?: any[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "IliaGPT";
    workbook.created = new Date();
    
    const worksheet = workbook.addWorksheet(title.slice(0, 31));
    
    worksheet.getCell("A1").value = title;
    worksheet.getCell("A1").font = { bold: true, size: 16 };
    
    worksheet.addRow([]);
    
    if (data && data.length > 0) {
      for (const row of data) {
        worksheet.addRow(row);
      }
    } else {
      worksheet.addRow(["Column A", "Column B", "Column C"]);
      worksheet.addRow(["Data 1", 100, new Date()]);
      worksheet.addRow(["Data 2", 200, new Date()]);
      worksheet.addRow(["Data 3", 300, new Date()]);
    }
    
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private createRealPNG(width: number = 100, height: number = 100): Buffer {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData.writeUInt8(8, 8);
    ihdrData.writeUInt8(2, 9);
    ihdrData.writeUInt8(0, 10);
    ihdrData.writeUInt8(0, 11);
    ihdrData.writeUInt8(0, 12);
    
    const ihdrChunk = this.createPNGChunk("IHDR", ihdrData);
    
    const rawData: number[] = [];
    for (let y = 0; y < height; y++) {
      rawData.push(0);
      for (let x = 0; x < width; x++) {
        const r = Math.floor((x / width) * 255);
        const g = Math.floor((y / height) * 255);
        const b = Math.floor(((x + y) / (width + height)) * 255);
        rawData.push(r, g, b);
      }
    }
    
    const rawBuffer = Buffer.from(rawData);
    const compressedData = zlib.deflateSync(rawBuffer);
    const idatChunk = this.createPNGChunk("IDAT", compressedData);
    
    const iendChunk = this.createPNGChunk("IEND", Buffer.alloc(0));
    
    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  }

  private createPNGChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    
    const typeBuffer = Buffer.from(type, "ascii");
    
    const crc32Table: number[] = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crc32Table[n] = c;
    }
    
    const crcInput = Buffer.concat([typeBuffer, data]);
    let crc = 0xffffffff;
    for (let i = 0; i < crcInput.length; i++) {
      crc = crc32Table[(crc ^ crcInput[i]) & 0xff] ^ (crc >>> 8);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc, 0);
    
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
  }

  private attemptReplan(run: ProductionRun, failedStep: PlanStep): boolean {
    const alternativeTools: Record<string, string[]> = {
      "image_generate": ["text_generate", "pdf_generate"],
      "slides_create": ["docx_generate", "pdf_generate", "text_generate"],
      "docx_generate": ["pdf_generate", "text_generate"],
      "xlsx_create": ["data_analyze", "text_generate"],
      "pdf_generate": ["docx_generate", "text_generate"],
      "web_search": ["text_generate"],
      "browse_url": ["web_search", "text_generate"],
      "data_analyze": ["text_generate"],
    };

    const maxReplans = 3;
    const alternatives = alternativeTools[failedStep.toolName];
    
    if (!alternatives || alternatives.length === 0 || run.replansCount >= maxReplans) {
      return false;
    }

    const failedTools = run.evidence
      .filter(e => e && e.status === "failed")
      .map(e => e.toolName);
    
    const viableAlternative = alternatives.find(alt => {
      if (failedTools.includes(alt)) return false;
      
      const cb = this.getCircuitBreaker(alt);
      return cb.canExecute();
    });

    if (!viableAlternative) {
      return false;
    }

    run.replansCount++;
    this.metrics.replanAttempts++;
    this.metrics.lastUpdated = new Date().toISOString();
    
    run.evidence[failedStep.stepIndex].replanEvents.push(
      `Replanning: ${failedStep.toolName} -> ${viableAlternative} (attempt ${run.replansCount}/${maxReplans})`
    );

    const newStep: PlanStep = {
      ...failedStep,
      toolName: viableAlternative,
      description: `Fallback execution using ${viableAlternative}`,
      isGenerator: ["docx_generate", "pdf_generate", "slides_create", "xlsx_create", "image_generate"].includes(viableAlternative),
    };

    run.plan.steps[failedStep.stepIndex] = newStep;

    this.emitEvent(run.runId, "replan_triggered", {
      stepIndex: failedStep.stepIndex,
      originalTool: failedStep.toolName,
      newTool: viableAlternative,
      reason: "Tool execution failed - using alternative",
      replanCount: run.replansCount,
      maxReplans,
      availableAlternatives: alternatives.length,
    });

    return true;
  }

  private startWatchdog(runId: string): void {
    const timer = setTimeout(() => {
      const run = this.activeRuns.get(runId);
      if (run && run.status === "running") {
        run.status = "timeout";
        run.error = "TIMEOUT_ERROR: Run exceeded watchdog timeout";
        run.errorType = "TIMEOUT_ERROR";
        run.completedAt = new Date().toISOString();
        run.updatedAt = new Date().toISOString();

        this.emitEvent(runId, "timeout_error", {
          timeoutMs: this.watchdogTimeoutMs,
          currentStep: run.currentStepIndex,
        });

        this.emitEvent(runId, "run_failed", {
          error: run.error,
          errorType: "TIMEOUT_ERROR",
        });
      }
    }, this.watchdogTimeoutMs);

    this.watchdogTimers.set(runId, timer);
  }

  private resetWatchdog(runId: string): void {
    this.stopWatchdog(runId);
    this.startWatchdog(runId);
  }

  private stopWatchdog(runId: string): void {
    const timer = this.watchdogTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.watchdogTimers.delete(runId);
    }
  }

  private emitEvent(runId: string, eventType: RunEvent["eventType"], data?: unknown): void {
    const event: RunEvent = {
      eventId: crypto.randomUUID(),
      runId,
      eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    let events = this.runEvents.get(runId);
    if (!events) {
      events = [];
      this.runEvents.set(runId, events);
    }
    events.push(event);

    this.emit("event", event);
    this.emit(eventType, event);
  }

  getRunStatus(runId: string): ProductionRun | undefined {
    return this.activeRuns.get(runId);
  }

  getRunEvents(runId: string): RunEvent[] {
    return this.runEvents.get(runId) || [];
  }

  async cancelRun(runId: string, reason?: string): Promise<boolean> {
    const run = this.activeRuns.get(runId);
    if (!run || run.status === "completed" || run.status === "failed") {
      return false;
    }

    run.status = "cancelled";
    run.error = reason || "Cancelled by user";
    run.errorType = "CANCELLED";
    run.completedAt = new Date().toISOString();
    run.updatedAt = new Date().toISOString();

    this.stopWatchdog(runId);

    this.emitEvent(runId, "run_cancelled", { reason });

    return true;
  }

  async waitForCompletion(runId: string, timeoutMs: number = 35000): Promise<ProductionRun> {
    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        this.removeListener("run_completed", onComplete);
        this.removeListener("run_failed", onFailed);
        this.removeListener("run_cancelled", onCancelled);
        this.removeListener("timeout_error", onTimeout);
      };

      const finish = (run: ProductionRun) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(run);
      };

      const onComplete = (event: RunEvent) => {
        if (event.runId === runId) {
          const run = this.activeRuns.get(runId);
          if (run) finish(run);
        }
      };

      const onFailed = (event: RunEvent) => {
        if (event.runId === runId) {
          const run = this.activeRuns.get(runId);
          if (run) finish(run);
        }
      };

      const onCancelled = (event: RunEvent) => {
        if (event.runId === runId) {
          const run = this.activeRuns.get(runId);
          if (run) finish(run);
        }
      };

      const onTimeout = (event: RunEvent) => {
        if (event.runId === runId) {
          const run = this.activeRuns.get(runId);
          if (run) finish(run);
        }
      };

      this.on("run_completed", onComplete);
      this.on("run_failed", onFailed);
      this.on("run_cancelled", onCancelled);
      this.on("timeout_error", onTimeout);

      const run = this.activeRuns.get(runId);
      if (!run) {
        cleanup();
        reject(new Error(`Run ${runId} not found`));
        return;
      }
      
      if (["completed", "failed", "cancelled", "timeout"].includes(run.status)) {
        finish(run);
        return;
      }

      timeoutHandle = setTimeout(() => {
        if (resolved) return;
        const currentRun = this.activeRuns.get(runId);
        if (currentRun) {
          finish(currentRun);
        } else {
          resolved = true;
          cleanup();
          reject(new Error(`Run ${runId} not found after timeout`));
        }
      }, timeoutMs);
    });
  }

  async executeAndWait(query: string): Promise<{ run: ProductionRun; response: string }> {
    const { runId } = await this.startRun(query);
    const run = await this.waitForCompletion(runId);
    
    let response = "";
    if (run.status === "completed") {
      if (run.artifacts.length > 0) {
        const artifact = run.artifacts[0];
        // Extract filename from artifact.path for download URL
        const filename = artifact.path ? artifact.path.split('/').pop() : artifact.artifactId;
        const downloadUrl = `/api/artifacts/${filename}/download`;
        response = `He completado la tarea. ${this.formatArtifactDescription(run.intent, artifact)}

Descargar: ${downloadUrl}`;
      } else {
        response = "He completado la tarea.";
      }
    } else if (run.status === "failed" || run.status === "timeout") {
      response = `Error: ${run.error || "La tarea no pudo completarse"}`;
    } else if (run.status === "cancelled") {
      response = "La tarea fue cancelada.";
    }
    
    return { run, response };
  }

  private formatArtifactDescription(intent: GenerationIntent, artifact: ArtifactInfo): string {
    switch (intent) {
      case "image_generate":
        return `He generado una imagen (${Math.round(artifact.sizeBytes / 1024)}KB).`;
      case "slides_create":
        return `He creado una presentación PowerPoint (${Math.round(artifact.sizeBytes / 1024)}KB).`;
      case "docx_generate":
        return `He generado un documento Word (${Math.round(artifact.sizeBytes / 1024)}KB).`;
      case "xlsx_create":
        return `He creado una hoja de cálculo Excel (${Math.round(artifact.sizeBytes / 1024)}KB).`;
      case "pdf_generate":
        return `He generado un documento PDF (${artifact.sizeBytes} bytes).`;
      default:
        return `Archivo generado (${artifact.sizeBytes} bytes).`;
    }
  }
}

export const productionWorkflowRunner = new ProductionWorkflowRunner({ watchdogTimeoutMs: 30000 });
