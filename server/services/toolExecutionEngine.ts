import { EventEmitter } from 'events';
import crypto from 'crypto';
import { pythonToolsClient, PythonToolsClientError, type ToolInfo, type ToolExecuteResponse } from '../lib/pythonToolsClient';
import { ALL_TOOLS, getToolByName } from '../agent/langgraph/tools';
import { createServiceCircuitBreaker, type ServiceCircuitConfig, type ServiceCallResult, CircuitState } from '../lib/circuitBreaker';
import { createLogger } from '../lib/structuredLogger';

const logger = createLogger('tool-execution-engine');

export type ToolType = 'python' | 'typescript' | 'unknown';

export interface UnifiedToolInfo {
  name: string;
  description: string;
  type: ToolType;
  category: string;
  isAvailable: boolean;
  schema?: Record<string, any>;
  lastHealthCheck?: number;
}

export interface ExecutionProgress {
  executionId: string;
  toolName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  step: number;
  totalSteps: number;
  startedAt: number;
  updatedAt: number;
  duration?: number;
}

export interface ExecutionResult {
  executionId: string;
  toolName: string;
  toolType: ToolType;
  success: boolean;
  data?: any;
  error?: string;
  errorCode?: string;
  metrics: {
    startTime: number;
    endTime: number;
    durationMs: number;
    attempts: number;
    circuitState: CircuitState;
    fromCache?: boolean;
  };
}

export interface ExecutionHistoryEntry {
  executionId: string;
  toolName: string;
  toolType: ToolType;
  input: Record<string, any>;
  success: boolean;
  durationMs: number;
  timestamp: number;
  error?: string;
  userId?: string;
}

export interface ToolAnalytics {
  toolName: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDurationMs: number;
  successRate: number;
  lastExecutedAt?: number;
  circuitState: CircuitState;
}

export interface EngineAnalytics {
  totalExecutions: number;
  activeExecutions: number;
  pythonToolsAvailable: boolean;
  typescriptToolsCount: number;
  pythonToolsCount: number;
  cacheHitRate: number;
  toolAnalytics: Map<string, ToolAnalytics>;
}

export interface ExecutionOptions {
  timeout?: number;
  maxRetries?: number;
  userId?: string;
  skipCache?: boolean;
  onProgress?: (progress: ExecutionProgress) => void;
}

const CACHE_TTL_MS = 300000;
const HEALTH_CHECK_INTERVAL_MS = 60000;
const MAX_HISTORY_SIZE = 1000;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;

export class ToolExecutionEngine extends EventEmitter {
  private toolCache: Map<string, { tool: UnifiedToolInfo; cachedAt: number }> = new Map();
  private executionHistory: ExecutionHistoryEntry[] = [];
  private activeExecutions: Map<string, ExecutionProgress> = new Map();
  private toolAnalytics: Map<string, ToolAnalytics> = new Map();
  private circuitBreakers: Map<string, ReturnType<typeof createServiceCircuitBreaker>> = new Map();
  private pythonToolsHealthy: boolean = false;
  private lastHealthCheck: number = 0;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private initialized: boolean = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing Tool Execution Engine');
    await this.discoverAllTools();
    this.startHealthCheckLoop();
    this.initialized = true;
    logger.info('Tool Execution Engine initialized', {
      pythonToolsAvailable: this.pythonToolsHealthy,
      totalTools: this.toolCache.size,
    });
  }

  private startHealthCheckLoop(): void {
    setInterval(async () => {
      try {
        await this.checkPythonToolsHealth();
      } catch (error) {
        logger.warn('Python tools health check failed', { error });
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private async checkPythonToolsHealth(): Promise<boolean> {
    try {
      const health = await pythonToolsClient.health();
      this.pythonToolsHealthy = health.status === 'healthy';
      this.lastHealthCheck = Date.now();
      return this.pythonToolsHealthy;
    } catch {
      this.pythonToolsHealthy = false;
      this.lastHealthCheck = Date.now();
      return false;
    }
  }

  async discoverAllTools(): Promise<UnifiedToolInfo[]> {
    const tools: UnifiedToolInfo[] = [];

    for (const langTool of ALL_TOOLS) {
      const toolInfo: UnifiedToolInfo = {
        name: langTool.name,
        description: langTool.description,
        type: 'typescript',
        category: this.inferCategory(langTool.name),
        isAvailable: true,
        schema: langTool.schema ? JSON.parse(JSON.stringify(langTool.schema)) : undefined,
        lastHealthCheck: Date.now(),
      };
      tools.push(toolInfo);
      this.toolCache.set(`ts:${langTool.name}`, { tool: toolInfo, cachedAt: Date.now() });
    }

    try {
      await this.checkPythonToolsHealth();
      if (this.pythonToolsHealthy) {
        const pythonTools = await pythonToolsClient.listTools();
        for (const pyTool of pythonTools) {
          const toolInfo: UnifiedToolInfo = {
            name: pyTool.name,
            description: pyTool.description,
            type: 'python',
            category: pyTool.category || 'general',
            isAvailable: true,
            lastHealthCheck: Date.now(),
          };
          tools.push(toolInfo);
          this.toolCache.set(`py:${pyTool.name}`, { tool: toolInfo, cachedAt: Date.now() });
        }
      }
    } catch (error) {
      logger.warn('Failed to discover Python tools', { error });
    }

    return tools;
  }

  private inferCategory(toolName: string): string {
    const categoryMap: Record<string, string[]> = {
      document: ['document', 'file', 'pdf', 'docx', 'xlsx', 'slides'],
      search: ['search', 'browser', 'research', 'web'],
      code: ['python', 'shell', 'code', 'execute'],
      communication: ['message', 'email', 'clarify', 'explain', 'summarize'],
      data: ['data', 'database', 'query', 'transform'],
      memory: ['memory', 'store', 'retrieve', 'context', 'session'],
      reasoning: ['reason', 'reflect', 'verify', 'decide'],
      orchestration: ['orchestrate', 'workflow', 'plan', 'schedule'],
      generation: ['generate', 'image', 'diagram', 'chart'],
      security: ['security', 'encrypt', 'auth'],
    };

    const lowerName = toolName.toLowerCase();
    for (const [category, keywords] of Object.entries(categoryMap)) {
      if (keywords.some(kw => lowerName.includes(kw))) {
        return category;
      }
    }
    return 'general';
  }

  async listTools(options?: { type?: ToolType; category?: string; refresh?: boolean }): Promise<UnifiedToolInfo[]> {
    if (options?.refresh || this.toolCache.size === 0) {
      await this.discoverAllTools();
    }

    const tools: UnifiedToolInfo[] = [];
    const now = Date.now();

    for (const { tool, cachedAt } of this.toolCache.values()) {
      if (now - cachedAt > CACHE_TTL_MS) {
        continue;
      }
      if (options?.type && tool.type !== options.type) {
        continue;
      }
      if (options?.category && tool.category !== options.category) {
        continue;
      }
      tools.push(tool);
    }

    return tools;
  }

  async getTool(name: string): Promise<UnifiedToolInfo | null> {
    const tsCached = this.toolCache.get(`ts:${name}`);
    if (tsCached && Date.now() - tsCached.cachedAt < CACHE_TTL_MS) {
      this.cacheHits++;
      return tsCached.tool;
    }

    const pyCached = this.toolCache.get(`py:${name}`);
    if (pyCached && Date.now() - pyCached.cachedAt < CACHE_TTL_MS) {
      this.cacheHits++;
      return pyCached.tool;
    }

    this.cacheMisses++;

    const langTool = getToolByName(name);
    if (langTool) {
      const toolInfo: UnifiedToolInfo = {
        name: langTool.name,
        description: langTool.description,
        type: 'typescript',
        category: this.inferCategory(langTool.name),
        isAvailable: true,
        schema: langTool.schema ? JSON.parse(JSON.stringify(langTool.schema)) : undefined,
        lastHealthCheck: Date.now(),
      };
      this.toolCache.set(`ts:${name}`, { tool: toolInfo, cachedAt: Date.now() });
      return toolInfo;
    }

    if (this.pythonToolsHealthy) {
      try {
        const pyTool = await pythonToolsClient.getTool(name);
        const toolInfo: UnifiedToolInfo = {
          name: pyTool.name,
          description: pyTool.description,
          type: 'python',
          category: pyTool.category || 'general',
          isAvailable: true,
          lastHealthCheck: Date.now(),
        };
        this.toolCache.set(`py:${name}`, { tool: toolInfo, cachedAt: Date.now() });
        return toolInfo;
      } catch {
        // Tool not found in Python
      }
    }

    return null;
  }

  private getCircuitBreaker(toolName: string): ReturnType<typeof createServiceCircuitBreaker> {
    if (!this.circuitBreakers.has(toolName)) {
      const config: ServiceCircuitConfig = {
        name: `tool:${toolName}`,
        failureThreshold: 5,
        resetTimeout: 60000,
        timeout: DEFAULT_TIMEOUT_MS,
        retries: DEFAULT_MAX_RETRIES,
        retryDelay: 1000,
        onStateChange: (from, to) => {
          logger.info(`Circuit breaker state change for ${toolName}`, { from, to });
          this.emit('circuitStateChange', { toolName, from, to });
        },
      };
      this.circuitBreakers.set(toolName, createServiceCircuitBreaker(config));
    }
    return this.circuitBreakers.get(toolName)!;
  }

  async execute(
    toolName: string,
    input: Record<string, any>,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const executionId = crypto.randomUUID();
    const startTime = Date.now();
    const {
      timeout = DEFAULT_TIMEOUT_MS,
      maxRetries = DEFAULT_MAX_RETRIES,
      userId,
      onProgress,
    } = options;

    const progress: ExecutionProgress = {
      executionId,
      toolName,
      status: 'queued',
      progress: 0,
      message: 'Initializing...',
      step: 0,
      totalSteps: 3,
      startedAt: startTime,
      updatedAt: startTime,
    };

    this.activeExecutions.set(executionId, progress);
    this.emitProgress(progress, onProgress);

    try {
      const tool = await this.getTool(toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      progress.status = 'running';
      progress.step = 1;
      progress.message = `Executing ${tool.type} tool: ${toolName}`;
      progress.progress = 33;
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      const circuitBreaker = this.getCircuitBreaker(toolName);

      let result: ServiceCallResult<any>;

      if (tool.type === 'python') {
        result = await circuitBreaker.call(
          () => this.executePythonTool(toolName, input, timeout),
          `execute:${toolName}`
        );
      } else {
        result = await circuitBreaker.call(
          () => this.executeTypescriptTool(toolName, input, timeout),
          `execute:${toolName}`
        );
      }

      progress.step = 2;
      progress.progress = 66;
      progress.message = 'Processing result...';
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      const executionResult: ExecutionResult = {
        executionId,
        toolName,
        toolType: tool.type,
        success: result.success,
        data: result.data,
        error: result.error,
        errorCode: result.success ? undefined : 'EXECUTION_FAILED',
        metrics: {
          startTime,
          endTime,
          durationMs,
          attempts: result.retryCount ? result.retryCount + 1 : 1,
          circuitState: result.circuitState,
          fromCache: result.fromFallback,
        },
      };

      this.recordExecution(executionResult, input, userId);

      progress.step = 3;
      progress.progress = 100;
      progress.status = result.success ? 'completed' : 'failed';
      progress.message = result.success ? 'Completed successfully' : (result.error || 'Execution failed');
      progress.duration = durationMs;
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      this.activeExecutions.delete(executionId);
      return executionResult;

    } catch (error: any) {
      const endTime = Date.now();
      const durationMs = endTime - startTime;

      progress.status = 'failed';
      progress.message = error.message || 'Unknown error';
      progress.duration = durationMs;
      progress.updatedAt = Date.now();
      this.emitProgress(progress, onProgress);

      this.activeExecutions.delete(executionId);

      const errorResult: ExecutionResult = {
        executionId,
        toolName,
        toolType: 'unknown',
        success: false,
        error: error.message,
        errorCode: error.code || 'UNKNOWN_ERROR',
        metrics: {
          startTime,
          endTime,
          durationMs,
          attempts: 1,
          circuitState: CircuitState.CLOSED,
        },
      };

      this.recordExecution(errorResult, input, userId);
      return errorResult;
    }
  }

  private async executePythonTool(
    toolName: string,
    input: Record<string, any>,
    timeout: number
  ): Promise<any> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Python tool execution timed out after ${timeout}ms`)), timeout);
    });

    const executionPromise = pythonToolsClient.executeTool(toolName, input);

    const result = await Promise.race([executionPromise, timeoutPromise]);

    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error || 'Python tool execution failed');
    }
  }

  private async executeTypescriptTool(
    toolName: string,
    input: Record<string, any>,
    timeout: number
  ): Promise<any> {
    const tool = getToolByName(toolName);
    if (!tool) {
      throw new Error(`TypeScript tool '${toolName}' not found`);
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`TypeScript tool execution timed out after ${timeout}ms`)), timeout);
    });

    const executionPromise = tool.invoke(input);

    const result = await Promise.race([executionPromise, timeoutPromise]);

    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch {
        return { result };
      }
    }
    return result;
  }

  private emitProgress(progress: ExecutionProgress, callback?: (progress: ExecutionProgress) => void): void {
    this.emit('progress', progress);
    callback?.(progress);
  }

  private recordExecution(
    result: ExecutionResult,
    input: Record<string, any>,
    userId?: string
  ): void {
    const entry: ExecutionHistoryEntry = {
      executionId: result.executionId,
      toolName: result.toolName,
      toolType: result.toolType,
      input,
      success: result.success,
      durationMs: result.metrics.durationMs,
      timestamp: result.metrics.startTime,
      error: result.error,
      userId,
    };

    this.executionHistory.unshift(entry);
    if (this.executionHistory.length > MAX_HISTORY_SIZE) {
      this.executionHistory.pop();
    }

    this.updateToolAnalytics(result);
  }

  private updateToolAnalytics(result: ExecutionResult): void {
    const existing = this.toolAnalytics.get(result.toolName) || {
      toolName: result.toolName,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageDurationMs: 0,
      successRate: 0,
      circuitState: CircuitState.CLOSED,
    };

    const newTotal = existing.totalExecutions + 1;
    const newSuccessful = existing.successfulExecutions + (result.success ? 1 : 0);
    const newFailed = existing.failedExecutions + (result.success ? 0 : 1);

    const newAvgDuration = Math.round(
      (existing.averageDurationMs * existing.totalExecutions + result.metrics.durationMs) / newTotal
    );

    this.toolAnalytics.set(result.toolName, {
      toolName: result.toolName,
      totalExecutions: newTotal,
      successfulExecutions: newSuccessful,
      failedExecutions: newFailed,
      averageDurationMs: newAvgDuration,
      successRate: Math.round((newSuccessful / newTotal) * 100),
      lastExecutedAt: result.metrics.endTime,
      circuitState: result.metrics.circuitState,
    });
  }

  getExecutionHistory(options?: {
    toolName?: string;
    userId?: string;
    limit?: number;
    successOnly?: boolean;
  }): ExecutionHistoryEntry[] {
    let history = [...this.executionHistory];

    if (options?.toolName) {
      history = history.filter(e => e.toolName === options.toolName);
    }
    if (options?.userId) {
      history = history.filter(e => e.userId === options.userId);
    }
    if (options?.successOnly) {
      history = history.filter(e => e.success);
    }
    if (options?.limit) {
      history = history.slice(0, options.limit);
    }

    return history;
  }

  getToolAnalytics(toolName?: string): ToolAnalytics | ToolAnalytics[] | null {
    if (toolName) {
      return this.toolAnalytics.get(toolName) || null;
    }
    return Array.from(this.toolAnalytics.values());
  }

  getEngineAnalytics(): EngineAnalytics {
    const tsTools = ALL_TOOLS.length;
    let pyTools = 0;
    for (const { tool } of this.toolCache.values()) {
      if (tool.type === 'python') pyTools++;
    }

    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0
      ? Math.round((this.cacheHits / totalCacheRequests) * 100)
      : 0;

    return {
      totalExecutions: this.executionHistory.length,
      activeExecutions: this.activeExecutions.size,
      pythonToolsAvailable: this.pythonToolsHealthy,
      typescriptToolsCount: tsTools,
      pythonToolsCount: pyTools,
      cacheHitRate,
      toolAnalytics: this.toolAnalytics,
    };
  }

  getActiveExecutions(): ExecutionProgress[] {
    return Array.from(this.activeExecutions.values());
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return false;
    }

    execution.status = 'cancelled';
    execution.message = 'Cancelled by user';
    execution.updatedAt = Date.now();
    this.emit('progress', execution);
    this.activeExecutions.delete(executionId);
    return true;
  }

  getCircuitBreakerStatus(toolName: string): { state: CircuitState; stats: any } | null {
    const breaker = this.circuitBreakers.get(toolName);
    if (!breaker) {
      return null;
    }
    return {
      state: breaker.getState(),
      stats: breaker.getStats(),
    };
  }

  resetCircuitBreaker(toolName: string): void {
    const breaker = this.circuitBreakers.get(toolName);
    if (breaker) {
      breaker.reset();
      logger.info(`Circuit breaker reset for tool: ${toolName}`);
    }
  }

  clearCache(): void {
    this.toolCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    logger.info('Tool cache cleared');
  }

  async refreshTools(): Promise<UnifiedToolInfo[]> {
    this.clearCache();
    return this.discoverAllTools();
  }

  subscribeToProgress(callback: (progress: ExecutionProgress) => void): () => void {
    this.on('progress', callback);
    return () => this.off('progress', callback);
  }

  subscribeToCircuitChanges(
    callback: (event: { toolName: string; from: CircuitState; to: CircuitState }) => void
  ): () => void {
    this.on('circuitStateChange', callback);
    return () => this.off('circuitStateChange', callback);
  }
}

export const toolExecutionEngine = new ToolExecutionEngine();

export async function initializeToolExecutionEngine(): Promise<void> {
  await toolExecutionEngine.initialize();
}

export {
  type ToolType,
  type UnifiedToolInfo,
  type ExecutionProgress,
  type ExecutionResult,
  type ExecutionHistoryEntry,
  type ToolAnalytics,
  type EngineAnalytics,
  type ExecutionOptions,
};
