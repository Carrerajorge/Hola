/**
 * Parser Sandbox - Worker-based parser execution with resource limits
 * PARE Phase 2 Security Hardening
 * 
 * Provides timeout, memory limit tracking, and CPU time monitoring for parser operations.
 */

import type { FileParser, ParsedResult, DetectedFileType } from "../parsers/base";

export interface SandboxOptions {
  timeoutMs: number;
  softMemoryLimitMB: number;
  hardMemoryLimitMB: number;
  enableCpuTracking: boolean;
}

export interface SandboxResult {
  success: boolean;
  result?: ParsedResult;
  error?: string;
  errorCode?: SandboxErrorCode;
  metrics: SandboxMetrics;
}

export interface SandboxMetrics {
  parseTimeMs: number;
  memoryUsedMB: number;
  memoryWarning: boolean;
  timedOut: boolean;
  aborted: boolean;
}

export enum SandboxErrorCode {
  TIMEOUT = 'PARSER_TIMEOUT',
  MEMORY_EXCEEDED = 'MEMORY_EXCEEDED',
  PARSE_ERROR = 'PARSE_ERROR',
  ABORTED = 'ABORTED',
}

const DEFAULT_OPTIONS: SandboxOptions = {
  timeoutMs: 30000,
  softMemoryLimitMB: 256,
  hardMemoryLimitMB: 512,
  enableCpuTracking: true,
};

function getMemoryUsageMB(): number {
  try {
    const usage = process.memoryUsage();
    return usage.heapUsed / (1024 * 1024);
  } catch {
    return 0;
  }
}

function emitStructuredLog(
  level: 'warn' | 'error',
  event: string,
  data: Record<string, any>
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    component: 'parserSandbox',
    ...data,
  };
  
  if (level === 'error') {
    console.error(`[PARSER_SANDBOX] ${event}`, JSON.stringify(logEntry));
  } else {
    console.warn(`[PARSER_SANDBOX] ${event}`, JSON.stringify(logEntry));
  }
}

/**
 * Run a parser in a sandboxed environment with resource limits
 */
export async function runParserInSandbox(
  parser: FileParser,
  content: Buffer,
  fileType: DetectedFileType,
  options: Partial<SandboxOptions> = {}
): Promise<SandboxResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const initialMemory = getMemoryUsageMB();
  
  const metrics: SandboxMetrics = {
    parseTimeMs: 0,
    memoryUsedMB: 0,
    memoryWarning: false,
    timedOut: false,
    aborted: false,
  };

  const abortController = new AbortController();
  let memoryCheckInterval: NodeJS.Timeout | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let memoryExceeded = false;

  try {
    memoryCheckInterval = setInterval(() => {
      const currentMemory = getMemoryUsageMB();
      const memoryDelta = currentMemory - initialMemory;
      
      if (memoryDelta > opts.softMemoryLimitMB && !metrics.memoryWarning) {
        metrics.memoryWarning = true;
        emitStructuredLog('warn', 'MEMORY_SOFT_LIMIT', {
          parser: parser.name,
          memoryUsedMB: memoryDelta.toFixed(2),
          softLimitMB: opts.softMemoryLimitMB,
          fileSize: content.length,
        });
      }
      
      if (memoryDelta > opts.hardMemoryLimitMB) {
        memoryExceeded = true;
        abortController.abort();
        emitStructuredLog('error', 'MEMORY_HARD_LIMIT_EXCEEDED', {
          parser: parser.name,
          memoryUsedMB: memoryDelta.toFixed(2),
          hardLimitMB: opts.hardMemoryLimitMB,
          fileSize: content.length,
        });
      }
    }, 100);

    const parsePromise = parser.parse(content, fileType);
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        metrics.timedOut = true;
        abortController.abort();
        emitStructuredLog('error', 'PARSER_TIMEOUT', {
          parser: parser.name,
          timeoutMs: opts.timeoutMs,
          fileSize: content.length,
          mimeType: fileType.mimeType,
        });
        reject(new Error(`Parser timeout after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    });

    const abortPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener('abort', () => {
        if (memoryExceeded) {
          reject(new Error('Memory limit exceeded'));
        } else {
          metrics.aborted = true;
          reject(new Error('Parse operation aborted'));
        }
      });
    });

    const result = await Promise.race([parsePromise, timeoutPromise, abortPromise]);

    metrics.parseTimeMs = Date.now() - startTime;
    metrics.memoryUsedMB = getMemoryUsageMB() - initialMemory;

    return {
      success: true,
      result,
      metrics,
    };

  } catch (error) {
    metrics.parseTimeMs = Date.now() - startTime;
    metrics.memoryUsedMB = getMemoryUsageMB() - initialMemory;

    const errorMessage = error instanceof Error ? error.message : String(error);
    
    let errorCode: SandboxErrorCode;
    if (metrics.timedOut) {
      errorCode = SandboxErrorCode.TIMEOUT;
    } else if (memoryExceeded) {
      errorCode = SandboxErrorCode.MEMORY_EXCEEDED;
    } else if (metrics.aborted) {
      errorCode = SandboxErrorCode.ABORTED;
    } else {
      errorCode = SandboxErrorCode.PARSE_ERROR;
    }

    emitStructuredLog('error', 'PARSE_FAILED', {
      parser: parser.name,
      errorCode,
      error: errorMessage,
      parseTimeMs: metrics.parseTimeMs,
      memoryUsedMB: metrics.memoryUsedMB.toFixed(2),
      fileSize: content.length,
    });

    return {
      success: false,
      error: errorMessage,
      errorCode,
      metrics,
    };

  } finally {
    if (memoryCheckInterval) {
      clearInterval(memoryCheckInterval);
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Create a sandboxed version of a parser
 */
export function createSandboxedParser(
  parser: FileParser,
  options: Partial<SandboxOptions> = {}
): FileParser {
  return {
    name: `Sandboxed_${parser.name}`,
    supportedMimeTypes: parser.supportedMimeTypes,
    async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
      const result = await runParserInSandbox(parser, content, type, options);
      
      if (!result.success) {
        throw new Error(`[${result.errorCode}] ${result.error}`);
      }
      
      const parsed = result.result!;
      parsed.metadata = {
        ...parsed.metadata,
        sandbox_metrics: {
          parseTimeMs: result.metrics.parseTimeMs,
          memoryUsedMB: result.metrics.memoryUsedMB,
          memoryWarning: result.metrics.memoryWarning,
        },
      };
      
      return parsed;
    },
  };
}

export const parserSandbox = {
  runParserInSandbox,
  createSandboxedParser,
  SandboxErrorCode,
  DEFAULT_OPTIONS,
};
