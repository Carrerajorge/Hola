/**
 * @file pipelineRunner.ts
 * @description Six-stage AI request pipeline for the ILIAGPT × OpenClaw fusion bridge.
 *
 * Implements the canonical request lifecycle:
 *
 *   intake → classify → plan → execute → verify → deliver
 *
 * Each stage is independently configurable, observable, and replaceable. The
 * runner supports middleware hooks, retries, timeouts, and emits granular
 * lifecycle events for telemetry.
 *
 * @module pipelineRunner
 */

import { EventEmitter } from 'node:events';
import { Logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

export type StageName = 'intake' | 'classify' | 'plan' | 'execute' | 'verify' | 'deliver';

export const STAGE_ORDER: StageName[] = ['intake', 'classify', 'plan', 'execute', 'verify', 'deliver'];

// ---------------------------------------------------------------------------
// Context & payload types
// ---------------------------------------------------------------------------

/**
 * The mutable context object that flows through every stage.
 * Stages read and write properties on this object.
 */
export interface PipelineContext {
  /** Unique run identifier. */
  runId: string;
  /** Raw incoming request (populated by intake). */
  rawInput: unknown;
  /** Canonical request representation (populated by intake). */
  request?: NormalisedRequest;
  /** Classification result (populated by classify). */
  classification?: Classification;
  /** Execution plan (populated by plan). */
  plan?: ExecutionPlan;
  /** Raw execution output (populated by execute). */
  executionOutput?: unknown;
  /** Verification result (populated by verify). */
  verification?: VerificationResult;
  /** Final deliverable (populated by deliver). */
  deliverable?: Deliverable;
  /** Arbitrary stage-specific scratch space. */
  metadata: Record<string, unknown>;
  /** Wall-clock timestamps for each stage entry. */
  stageTimings: Partial<Record<StageName, { startMs: number; endMs?: number }>>;
  /** Whether a stage has requested early termination. */
  aborted: boolean;
  /** Reason for abort (if aborted). */
  abortReason?: string;
}

export interface NormalisedRequest {
  id: string;
  sessionId: string;
  userId?: string;
  channel: string;
  text: string;
  attachments: unknown[];
  locale: string;
  timestamp: Date;
}

export interface Classification {
  intent: string;
  confidence: number;
  category: string;
  subCategory?: string;
  tags: string[];
  requiresTools: boolean;
  sensitive: boolean;
}

export interface ExecutionPlan {
  steps: PlanStep[];
  estimatedTokens: number;
  selectedModel: string;
  systemPrompt: string;
  temperature: number;
}

export interface PlanStep {
  id: string;
  type: 'llm' | 'tool' | 'retrieval' | 'conditional';
  description: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  dependsOn?: string[];
}

export interface VerificationResult {
  passed: boolean;
  score: number; // 0-1
  issues: string[];
  suggestions: string[];
}

export interface Deliverable {
  text: string;
  format: 'text' | 'markdown' | 'json' | 'html';
  metadata: Record<string, unknown>;
  sources?: string[];
}

// ---------------------------------------------------------------------------
// Stage handler & middleware types
// ---------------------------------------------------------------------------

export type StageHandler = (ctx: PipelineContext) => Promise<void>;
export type StageMiddleware = (ctx: PipelineContext, next: () => Promise<void>) => Promise<void>;

export interface StageConfig {
  /** Custom handler replacing the default stub. */
  handler?: StageHandler;
  /** Ordered middleware wrappers (outermost first). */
  middleware?: StageMiddleware[];
  /** Per-stage timeout in milliseconds. 0 = no timeout. Default: 30 000. */
  timeoutMs?: number;
  /** Number of automatic retries on transient error. Default: 0. */
  retries?: number;
  /** Whether to skip this stage entirely. Default: false. */
  skip?: boolean;
}

export interface PipelineRunnerOptions {
  /** Per-stage configuration, keyed by stage name. */
  stages?: Partial<Record<StageName, StageConfig>>;
  /** Global timeout for the entire pipeline run. 0 = no timeout. Default: 120 000. */
  globalTimeoutMs?: number;
  /** Whether to continue to subsequent stages after a non-fatal error. Default: false. */
  continueOnError?: boolean;
}

// ---------------------------------------------------------------------------
// PipelineRunner
// ---------------------------------------------------------------------------

/**
 * Orchestrates the six-stage AI request pipeline.
 *
 * @example
 * ```typescript
 * const runner = new PipelineRunner({
 *   stages: {
 *     intake:   { handler: myIntakeHandler },
 *     classify: { handler: myClassifier, timeoutMs: 5_000 },
 *     execute:  { handler: myLLMExecutor, retries: 2, timeoutMs: 60_000 },
 *   },
 * });
 *
 * const result = await runner.run({ message: 'Hello!' });
 * console.log(result.deliverable?.text);
 * ```
 */
export class PipelineRunner extends EventEmitter {
  private readonly logger: Logger;
  private readonly stageConfigs: Record<StageName, Required<StageConfig>>;
  private readonly globalTimeoutMs: number;
  private readonly continueOnError: boolean;

  constructor(options: PipelineRunnerOptions = {}) {
    super();
    this.logger = new Logger('PipelineRunner');
    this.globalTimeoutMs = options.globalTimeoutMs ?? 120_000;
    this.continueOnError = options.continueOnError ?? false;

    // Build per-stage configs with defaults
    this.stageConfigs = {} as Record<StageName, Required<StageConfig>>;
    for (const stage of STAGE_ORDER) {
      const userConfig = options.stages?.[stage] ?? {};
      this.stageConfigs[stage] = {
        handler: userConfig.handler ?? defaultStageHandlers[stage],
        middleware: userConfig.middleware ?? [],
        timeoutMs: userConfig.timeoutMs ?? 30_000,
        retries: userConfig.retries ?? 0,
        skip: userConfig.skip ?? false,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Execute the full pipeline for the given raw input.
   *
   * @param rawInput   Arbitrary payload (channel message, REST body, etc.).
   * @param overrides  Optional per-run metadata to seed into ctx.metadata.
   * @returns The completed PipelineContext (check ctx.aborted for failures).
   */
  async run(rawInput: unknown, overrides: Record<string, unknown> = {}): Promise<PipelineContext> {
    const ctx: PipelineContext = {
      runId: generateRunId(),
      rawInput,
      metadata: { ...overrides },
      stageTimings: {},
      aborted: false,
    };

    this.logger.info(`Pipeline run ${ctx.runId} started`);
    this.emit('run:start', { runId: ctx.runId });

    const pipelineStart = Date.now();

    try {
      await withOptionalTimeout(
        this._runAllStages(ctx),
        this.globalTimeoutMs,
        `Pipeline run ${ctx.runId} exceeded global timeout (${this.globalTimeoutMs}ms)`,
      );
    } catch (err) {
      ctx.aborted = true;
      ctx.abortReason = (err as Error).message;
      this.logger.error(`Pipeline run ${ctx.runId} failed: ${ctx.abortReason}`);
      this.emit('run:error', { runId: ctx.runId, error: err });
    }

    const durationMs = Date.now() - pipelineStart;
    this.logger.info(
      `Pipeline run ${ctx.runId} ${ctx.aborted ? 'ABORTED' : 'completed'} in ${durationMs}ms`,
    );
    this.emit('run:end', { runId: ctx.runId, durationMs, aborted: ctx.aborted });

    return ctx;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async _runAllStages(ctx: PipelineContext): Promise<void> {
    for (const stageName of STAGE_ORDER) {
      if (ctx.aborted) break;

      const config = this.stageConfigs[stageName];
      if (config.skip) {
        this.logger.debug(`Stage [${stageName}] skipped`);
        this.emit('stage:skip', { runId: ctx.runId, stage: stageName });
        continue;
      }

      await this._runStage(ctx, stageName, config);
    }
  }

  private async _runStage(
    ctx: PipelineContext,
    stageName: StageName,
    config: Required<StageConfig>,
  ): Promise<void> {
    ctx.stageTimings[stageName] = { startMs: Date.now() };
    this.emit('stage:start', { runId: ctx.runId, stage: stageName });
    this.logger.debug(`Stage [${stageName}] starting`);

    let attempt = 0;
    const maxAttempts = config.retries + 1;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        await withOptionalTimeout(
          this._applyMiddleware(ctx, config),
          config.timeoutMs,
          `Stage [${stageName}] timed out after ${config.timeoutMs}ms`,
        );

        ctx.stageTimings[stageName]!.endMs = Date.now();
        const durationMs = ctx.stageTimings[stageName]!.endMs - ctx.stageTimings[stageName]!.startMs;
        this.logger.debug(`Stage [${stageName}] completed in ${durationMs}ms`);
        this.emit('stage:end', { runId: ctx.runId, stage: stageName, durationMs });
        return; // Success – exit retry loop
      } catch (err) {
        if (attempt < maxAttempts) {
          this.logger.warn(
            `Stage [${stageName}] attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message} – retrying`,
          );
          this.emit('stage:retry', { runId: ctx.runId, stage: stageName, attempt });
        } else {
          this.logger.error(
            `Stage [${stageName}] failed after ${maxAttempts} attempt(s): ${(err as Error).message}`,
          );
          this.emit('stage:error', { runId: ctx.runId, stage: stageName, error: err });

          if (this.continueOnError) {
            this.logger.warn(`Stage [${stageName}] error ignored (continueOnError=true)`);
          } else {
            ctx.aborted = true;
            ctx.abortReason = `Stage [${stageName}] failed: ${(err as Error).message}`;
          }
        }
      }
    }
  }

  /**
   * Compose middleware around the stage handler and execute the chain.
   * Middleware is applied in declaration order (outermost first).
   */
  private async _applyMiddleware(
    ctx: PipelineContext,
    config: Required<StageConfig>,
  ): Promise<void> {
    const chain = [...config.middleware].reverse();
    let fn: () => Promise<void> = () => config.handler(ctx);

    for (const mw of chain) {
      const next = fn;
      fn = () => mw(ctx, next);
    }

    await fn();
  }
}

// ---------------------------------------------------------------------------
// Default stage handlers (no-op stubs)
// ---------------------------------------------------------------------------

const defaultStageHandlers: Record<StageName, StageHandler> = {
  async intake(ctx) {
    // Stub: normalise rawInput into ctx.request
    ctx.request = {
      id: ctx.runId,
      sessionId: (ctx.metadata.sessionId as string) ?? 'unknown',
      userId: ctx.metadata.userId as string | undefined,
      channel: (ctx.metadata.channel as string) ?? 'api',
      text: typeof ctx.rawInput === 'string' ? ctx.rawInput : JSON.stringify(ctx.rawInput),
      attachments: [],
      locale: 'en',
      timestamp: new Date(),
    };
  },

  async classify(ctx) {
    // Stub: emit a generic classification
    ctx.classification = {
      intent: 'general-query',
      confidence: 1.0,
      category: 'general',
      tags: [],
      requiresTools: false,
      sensitive: false,
    };
  },

  async plan(ctx) {
    // Stub: single-step LLM plan
    ctx.plan = {
      steps: [{ id: 'step-1', type: 'llm', description: 'Generate response' }],
      estimatedTokens: 500,
      selectedModel: 'gpt-4o',
      systemPrompt: 'You are a helpful assistant.',
      temperature: 0.7,
    };
  },

  async execute(ctx) {
    // Stub: echo the request text
    ctx.executionOutput = ctx.request?.text ?? '';
  },

  async verify(ctx) {
    // Stub: always passes
    ctx.verification = {
      passed: true,
      score: 1.0,
      issues: [],
      suggestions: [],
    };
  },

  async deliver(ctx) {
    // Stub: wrap executionOutput as a text deliverable
    ctx.deliverable = {
      text: String(ctx.executionOutput ?? ''),
      format: 'text',
      metadata: {},
    };
  },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

let runCounter = 0;
function generateRunId(): string {
  return `run-${Date.now()}-${++runCounter}`;
}

/**
 * Wrap a promise with an optional millisecond timeout.
 * If timeoutMs is 0 or negative, the promise runs unbounded.
 */
function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
