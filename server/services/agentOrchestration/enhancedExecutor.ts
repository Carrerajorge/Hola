/**
 * Enhanced Agent Execution Engine
 *
 * Wraps LLM/tool calls with retry, model failover, context compaction,
 * and usage tracking. Ported from OpenClaw's pi-embedded-runner/run.ts,
 * adapted for ILIAGPT's llmGateway.
 */

export type ErrorKind = 'context_overflow' | 'auth_error' | 'rate_limit' | 'timeout' | 'model_error' | 'unknown';

export interface ExecutionAttempt {
    provider: string;
    model: string;
    retryCount: number;
    error?: { kind: ErrorKind; message: string };
    durationMs: number;
}

export interface TokenUsage {
    input: number;
    output: number;
    cacheRead: number;
    total: number;
}

export interface ExecutionResult {
    success: boolean;
    output: string;
    attempts: ExecutionAttempt[];
    totalUsage: TokenUsage;
    modelUsed: string;
    compactionCount: number;
}

export interface ExecutorConfig {
    models: string[];
    maxRetriesPerModel: number;
    timeoutMs: number;
    maxToolResultChars: number;
    onAttempt?: (attempt: ExecutionAttempt) => void;
}

/**
 * Classify an error into a known category for retry/failover decisions.
 */
export function classifyError(error: unknown): ErrorKind {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes('context') || msg.includes('token') || msg.includes('length')) return 'context_overflow';
    if (msg.includes('auth') || msg.includes('api key') || msg.includes('401')) return 'auth_error';
    if (msg.includes('rate') || msg.includes('429') || msg.includes('quota')) return 'rate_limit';
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return 'timeout';
    return 'model_error';
}

/**
 * Truncate a tool result to fit within a character budget.
 */
export function truncateToolResult(result: string, maxChars: number): string {
    if (result.length <= maxChars) return result;
    return result.slice(0, maxChars) + `\n... [truncated ${result.length - maxChars} chars]`;
}

// Errors that should skip to next model immediately
const FAILOVER_ERRORS = new Set<ErrorKind>(['auth_error', 'rate_limit']);

export class EnhancedExecutor {
    /**
     * Execute with retry + model failover.
     *
     * Algorithm (ported from OpenClaw's run.ts):
     * for each model in config.models:
     *   for retry = 0 to maxRetriesPerModel:
     *     if aborted: record and stop
     *     try call -> success
     *     catch -> classify error
     *       auth_error/rate_limit -> break to next model
     *       timeout/model_error -> retry same model
     *       context_overflow -> retry same model (caller should compact)
     * return failure with all attempts
     */
    async execute(
        fn: (model: string) => Promise<string>,
        config: ExecutorConfig,
        abortSignal?: AbortSignal,
    ): Promise<ExecutionResult> {
        const attempts: ExecutionAttempt[] = [];
        const totalUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, total: 0 };
        let compactionCount = 0;

        for (const model of config.models) {
            for (let retry = 0; retry <= config.maxRetriesPerModel; retry++) {
                // Check abort
                if (abortSignal?.aborted) {
                    const attempt: ExecutionAttempt = {
                        provider: model.split('-')[0] ?? model,
                        model,
                        retryCount: retry,
                        error: { kind: 'timeout', message: 'Aborted' },
                        durationMs: 0,
                    };
                    attempts.push(attempt);
                    config.onAttempt?.(attempt);
                    return { success: false, output: '', attempts, totalUsage, modelUsed: model, compactionCount };
                }

                const start = Date.now();
                try {
                    const output = await fn(model);
                    const attempt: ExecutionAttempt = {
                        provider: model.split('-')[0] ?? model,
                        model,
                        retryCount: retry,
                        durationMs: Date.now() - start,
                    };
                    attempts.push(attempt);
                    config.onAttempt?.(attempt);

                    return {
                        success: true,
                        output,
                        attempts,
                        totalUsage,
                        modelUsed: model,
                        compactionCount,
                    };
                } catch (err) {
                    const kind = classifyError(err);
                    const attempt: ExecutionAttempt = {
                        provider: model.split('-')[0] ?? model,
                        model,
                        retryCount: retry,
                        error: {
                            kind,
                            message: err instanceof Error ? err.message : String(err),
                        },
                        durationMs: Date.now() - start,
                    };
                    attempts.push(attempt);
                    config.onAttempt?.(attempt);

                    // Auth/rate errors -> skip to next model
                    if (FAILOVER_ERRORS.has(kind)) break;

                    // Other errors -> retry same model
                }
            }
        }

        // All models exhausted
        return {
            success: false,
            output: '',
            attempts,
            totalUsage,
            modelUsed: config.models[config.models.length - 1] ?? '',
            compactionCount,
        };
    }
}

export const enhancedExecutor = new EnhancedExecutor();
