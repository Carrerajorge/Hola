import { z } from "zod";

export const EventType = z.enum([
  "system.boot",
  "system.shutdown",
  "agent.thinking",
  "tool.call",
  "tool.result",
  "tool.error",
  "governance.decision", // Allowed/Blocked
  "memory.store",
  "memory.recall",
  "user.input",
  "model.response"
]);

export type AgentOSEventType = z.infer<typeof EventType>;

export interface AgentOSEvent {
  id: string;                // UUID v4
  type: AgentOSEventType;
  timestamp: number;
  actor: string;             // userId or agentId
  runId: string;             // Correlation ID for the session/task
  previousHash: string;      // Hash of the previous event (Tamper-evidence)
  payload: Record<string, any>;
  metadata: {
    riskLevel?: "low" | "medium" | "high" | "critical";
    component?: string;
    durationMs?: number;
    cost?: number;
  };
  hash: string;              // Hash of this event (id + prevHash + payload)
}
