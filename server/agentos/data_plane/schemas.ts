import { z } from "zod";

export const AgentOSEventType = z.enum([
  "RUN_START",
  "RUN_COMPLETE",
  "RUN_FAILED",
  "STEP_START",
  "STEP_COMPLETE",
  "TOOL_CALL",
  "TOOL_RESULT",
  "ARTIFACT_CREATED",
  "DECISION_MADE",
  "POLICY_CHECK",
  "COST_WARNING",
  "SYSTEM_LOG"
]);

export type AgentOSEventType = z.infer<typeof AgentOSEventType>;

export const BaseEventSchema = z.object({
  id: z.string().uuid(),
  type: AgentOSEventType,
  runId: z.string(),
  stepId: z.string().optional(),
  timestamp: z.number(),
  agentId: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const RunStartEvent = BaseEventSchema.extend({
  type: z.literal("RUN_START"),
  payload: z.object({
    goal: z.string(),
    mode: z.enum(["SAFE", "SUPERVISED", "AUTOPILOT", "RESEARCH", "EMERGENCY-STOP"]),
    params: z.record(z.unknown()),
  }),
});

export const ToolCallEvent = BaseEventSchema.extend({
  type: z.literal("TOOL_CALL"),
  payload: z.object({
    toolName: z.string(),
    input: z.unknown(),
  }),
});

export const ToolResultEvent = BaseEventSchema.extend({
  type: z.literal("TOOL_RESULT"),
  payload: z.object({
    toolName: z.string(),
    output: z.unknown(),
    durationMs: z.number(),
    status: z.enum(["success", "error"]),
    error: z.string().optional(),
  }),
});

export type AgentOSEvent = 
  | z.infer<typeof RunStartEvent>
  | z.infer<typeof ToolCallEvent>
  | z.infer<typeof ToolResultEvent>
  | (z.infer<typeof BaseEventSchema> & { payload: unknown });
