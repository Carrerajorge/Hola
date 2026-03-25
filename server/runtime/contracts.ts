import type {
  RuntimeHealth,
  UnifiedExecutionRequest,
  UnifiedExecutionResult,
  UnifiedPlanRequest,
  UnifiedPlanResult,
  UnifiedSubagentQuery,
  UnifiedSubagentRequest,
  UnifiedSubagentRun,
  UnifiedToolDefinition,
  UnifiedToolOptions,
  UnifiedToolResult,
  UnifiedMemoryRecord,
  UnifiedScheduleDefinition,
} from "./types";

export interface AgentRuntime {
  health(): Promise<RuntimeHealth>;
  execute(request: UnifiedExecutionRequest): Promise<UnifiedExecutionResult>;
  plan(request: UnifiedPlanRequest): Promise<UnifiedPlanResult>;
  spawnSubagent(request: UnifiedSubagentRequest): Promise<UnifiedSubagentRun>;
  listSubagents(query?: UnifiedSubagentQuery): Promise<UnifiedSubagentRun[]>;
  getSubagent?(runId: string, userId?: string): Promise<UnifiedSubagentRun | null>;
  cancelSubagent(runId: string, userId?: string): Promise<boolean>;
}

export interface ToolRuntime {
  health(): Promise<RuntimeHealth>;
  listTools(query?: { category?: string; refresh?: boolean }): Promise<UnifiedToolDefinition[]>;
  getTool(name: string): Promise<UnifiedToolDefinition | null>;
  execute(name: string, input: Record<string, unknown>, options?: UnifiedToolOptions): Promise<UnifiedToolResult>;
}

export interface MemoryRuntime {
  health(): Promise<RuntimeHealth>;
  store(userId: string, type: string, content: string, options?: Record<string, unknown>): Promise<string>;
  recall(userId: string, options?: Record<string, unknown>): Promise<UnifiedMemoryRecord[]>;
  getContext(userId: string): Promise<string>;
}

export interface ScheduleRuntime {
  health(): Promise<RuntimeHealth>;
  list(userId: string, options?: Record<string, unknown>): Promise<UnifiedScheduleDefinition[]>;
  create(userId: string, input: Record<string, unknown>): Promise<UnifiedScheduleDefinition>;
  cancel(userId: string, scheduleId: string): Promise<boolean>;
  runNow?(userId: string, scheduleId: string): Promise<boolean>;
}
