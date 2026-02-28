export type StepType =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "run_command_allowlisted"
  | "upload_artifact"
  | "download_artifact";

export interface PlanStep {
  id: string;
  type: StepType;
  args: Record<string, unknown>;
  retries?: number;
  confirm?: boolean;
  name?: string;
}

export interface Plan {
  runId: string;
  workspace?: string;
  user?: string;
  metadata?: Record<string, unknown>;
  steps: PlanStep[];
}

export interface AllowlistConfig {
  commands: string[];
  dangerous: string[];
}

export type StepStatus = "ok" | "error" | "dry-run" | "cached";

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface StoredStepResult {
  result: StepResult;
  updatedAt: string;
}

export interface RunResults {
  steps: Record<string, StoredStepResult>;
}

export interface CliOptions {
  planPath: string;
  workspace: string;
  stream: boolean;
  dryRun: boolean;
  autoConfirm: boolean;
  logPath?: string;
  allowlistPath?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  runIdOverride?: string;
  otelEndpoint?: string;
}

export interface RunContext {
  plan: Plan;
  workspace: string;
  stream: boolean;
  dryRun: boolean;
  autoConfirm: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  allowlistPath?: string;
  logger: AuditLogger;
  telemetry: Telemetry;
}

export interface StreamEvent {
  type: "step_started" | "step_result" | "run_started" | "run_finished";
  runId: string;
  stepId?: string;
  payload?: unknown;
  timestamp: string;
}

export interface AuditLogger {
  info: (payload: Record<string, unknown>) => void;
  error: (payload: Record<string, unknown>) => void;
}

export interface Telemetry {
  startSpan: (name: string, attributes?: Record<string, unknown>) => SpanHandle;
  shutdown: () => Promise<void>;
}

export interface SpanHandle {
  end: (attributes?: Record<string, unknown>) => void;
  fail: (error: Error | string, attributes?: Record<string, unknown>) => void;
}
