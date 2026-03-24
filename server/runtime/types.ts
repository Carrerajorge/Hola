export type RuntimeHealthStatus = "healthy" | "degraded" | "down";
export type ExecutionMode = "chat" | "objective" | "tool" | "system";
export type RuntimeEngine =
  | "openclaw-native"
  | "sandbox-agent"
  | "legacy-multi-agent"
  | "tool-execution"
  | "memory-service"
  | "schedule-runner";

export type PermissionProfile =
  | "read-only"
  | "rag"
  | "tool-safe"
  | "tool-system"
  | "messaging"
  | "filesystem-write"
  | "shell"
  | "scheduler"
  | "admin";

export interface RuntimeHealth {
  engine: RuntimeEngine;
  status: RuntimeHealthStatus;
  details?: Record<string, unknown>;
  checkedAt: string;
}

export interface UnifiedExecutionContext {
  userId?: string;
  chatId?: string;
  sessionId?: string;
  conversationId?: string;
  traceId?: string;
  requestId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedExecutionRequest {
  mode: ExecutionMode;
  objective?: string;
  prompt?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  context?: unknown;
  toolHints?: string[];
  enableTools?: boolean;
  timeoutMs?: number;
  provider?: string;
  model?: string;
  permissionProfile?: PermissionProfile;
  executionContext?: UnifiedExecutionContext;
}

export interface UnifiedExecutionResult {
  engine: RuntimeEngine;
  success: boolean;
  outputText?: string;
  data?: unknown;
  error?: string;
  sessionId?: string;
  sessionKey?: string;
  executionId?: string;
  metrics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UnifiedPlanRequest {
  objective: string;
  complexity?: number;
  executionContext?: UnifiedExecutionContext;
}

export interface UnifiedPlanResult {
  engine: RuntimeEngine;
  objective: string;
  complexity: number;
  subtasks: Array<Record<string, unknown>>;
  plan: Record<string, unknown>;
}

export interface UnifiedSubagentRequest {
  objective: string;
  parentRunId?: string;
  planHint?: string[];
  executionContext?: UnifiedExecutionContext;
  executionProfile?: Record<string, unknown>;
}

export interface UnifiedSubagentRun {
  id: string;
  engine: RuntimeEngine;
  objective: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedSubagentQuery {
  userId?: string;
  parentRunId?: string;
  status?: UnifiedSubagentRun["status"];
  limit?: number;
}

export interface UnifiedToolDefinition {
  name: string;
  displayName?: string;
  description?: string;
  category?: string;
  engine: RuntimeEngine;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  capabilities?: string[];
  permissionProfile?: PermissionProfile;
  supportsIdempotency?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UnifiedToolOptions {
  timeout?: number;
  maxRetries?: number;
  skipCache?: boolean;
  userId?: string;
  conversationId?: string;
  traceId?: string;
  requestId?: string;
  runId?: string;
  idempotencyKey?: string;
  permissionProfile?: PermissionProfile;
}

export interface UnifiedToolResult {
  engine: RuntimeEngine;
  success: boolean;
  executionId?: string;
  data?: unknown;
  error?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

export interface UnifiedMemoryRecord {
  id: string;
  type: string;
  content: string;
  importance?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedScheduleDefinition {
  id: string;
  kind: "once" | "daily" | "weekly" | "cron" | "systemEvent" | "agentTurn";
  prompt?: string;
  runAt?: string;
  nextRunAt?: string | null;
  timeZone?: string;
  timeOfDay?: string;
  daysOfWeek?: number[];
  isActive: boolean;
  metadata?: Record<string, unknown>;
}
