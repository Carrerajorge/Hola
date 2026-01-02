import { z } from "zod";
import { RunStatusSchema, StepStatusSchema } from "./stateMachine";

export const ToolCapabilitySchema = z.enum([
  "requires_network",
  "produces_artifacts",
  "reads_files",
  "writes_files",
  "executes_code",
  "accesses_external_api",
  "long_running",
  "high_risk"
]);
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const UserPlanSchema = z.enum(["free", "pro", "admin"]);
export type UserPlan = z.infer<typeof UserPlanSchema>;

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["file", "image", "document", "chart", "data", "preview", "link"]),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  url: z.string().url().optional(),
  data: z.any().optional(),
  size: z.number().int().positive().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ToolInputSchema = z.object({
  toolName: z.string().min(1),
  params: z.record(z.any()),
  idempotencyKey: z.string().optional(),
});
export type ToolInput = z.infer<typeof ToolInputSchema>;

export const ToolOutputSchema = z.object({
  success: z.boolean(),
  artifacts: z.array(ArtifactSchema).default([]),
  previews: z.array(z.object({
    type: z.enum(["text", "html", "markdown", "image", "chart"]),
    content: z.any(),
    title: z.string().optional(),
  })).default([]),
  logs: z.array(z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
    timestamp: z.date(),
    data: z.any().optional(),
  })).default([]),
  metrics: z.object({
    durationMs: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative().optional(),
    apiCalls: z.number().int().nonnegative().optional(),
    bytesProcessed: z.number().int().nonnegative().optional(),
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().default(false),
    details: z.any().optional(),
  }).optional(),
  rawOutput: z.any().optional(),
});
export type ToolOutput = z.infer<typeof ToolOutputSchema>;

export const ToolCallSchema = z.object({
  id: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  input: ToolInputSchema,
  output: ToolOutputSchema.optional(),
  status: StepStatusSchema,
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const PlanStepSchema = z.object({
  index: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  description: z.string().min(1),
  input: z.record(z.any()),
  expectedOutput: z.string(),
  dependencies: z.array(z.number().int().nonnegative()).default([]),
  optional: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const AgentPlanSchema = z.object({
  objective: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1).max(10),
  estimatedTimeMs: z.number().int().positive(),
  reasoning: z.string().optional(),
  createdAt: z.date(),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const StepSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  description: z.string(),
  status: StepStatusSchema,
  input: z.record(z.any()),
  output: ToolOutputSchema.optional(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const RunSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string(),
  messageId: z.string().optional(),
  userId: z.string(),
  status: RunStatusSchema,
  plan: AgentPlanSchema.optional(),
  steps: z.array(StepSchema).default([]),
  artifacts: z.array(ArtifactSchema).default([]),
  summary: z.string().optional(),
  error: z.string().optional(),
  correlationId: z.string().uuid(),
  idempotencyKey: z.string().optional(),
  currentStepIndex: z.number().int().nonnegative().default(0),
  totalSteps: z.number().int().nonnegative().default(0),
  completedSteps: z.number().int().nonnegative().default(0),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.any()).optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const AgentEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative().optional(),
  correlationId: z.string().uuid(),
  eventType: z.enum([
    "run_created",
    "run_started",
    "run_completed",
    "run_failed",
    "run_cancelled",
    "run_paused",
    "run_resumed",
    "plan_generated",
    "step_started",
    "step_completed",
    "step_failed",
    "step_retried",
    "step_skipped",
    "tool_called",
    "tool_completed",
    "tool_failed",
    "artifact_created",
    "error_occurred",
    "warning_logged"
  ]),
  payload: z.record(z.any()),
  timestamp: z.date(),
  metadata: z.record(z.any()).optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const CreateRunRequestSchema = z.object({
  chatId: z.string().min(1),
  messageId: z.string().optional(),
  message: z.string().min(1),
  attachments: z.array(z.any()).optional(),
  idempotencyKey: z.string().optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const RunResponseSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string(),
  status: RunStatusSchema,
  plan: AgentPlanSchema.optional(),
  steps: z.array(z.object({
    stepIndex: z.number(),
    toolName: z.string(),
    description: z.string().optional(),
    status: StepStatusSchema,
    output: z.any().optional(),
    error: z.string().optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })),
  artifacts: z.array(z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    url: z.string().optional(),
  })),
  summary: z.string().optional(),
  error: z.string().optional(),
  currentStepIndex: z.number(),
  totalSteps: z.number(),
  completedSteps: z.number(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type RunResponse = z.infer<typeof RunResponseSchema>;

export function validateRun(data: unknown): Run {
  return RunSchema.parse(data);
}

export function validateStep(data: unknown): Step {
  return StepSchema.parse(data);
}

export function validateToolCall(data: unknown): ToolCall {
  return ToolCallSchema.parse(data);
}

export function validateArtifact(data: unknown): Artifact {
  return ArtifactSchema.parse(data);
}

export function validateAgentEvent(data: unknown): AgentEvent {
  return AgentEventSchema.parse(data);
}

export function safeValidateRun(data: unknown): { success: true; data: Run } | { success: false; error: z.ZodError } {
  const result = RunSchema.safeParse(data);
  return result.success 
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}
