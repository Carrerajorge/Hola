// AgentOS UI-Plane Type Definitions

export type RunStatus =
  | "pending"
  | "planning"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export type EventKind =
  | "plan_created"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "evidence_collected"
  | "budget_update"
  | "plan_revised"
  | "mission_complete"
  | "error";

export interface RunState {
  runId: string;
  missionId: string;
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  currentStepId: string | null;
  dag: DAGState;
  budget: BudgetSnapshot;
  timeline: TimelineEvent[];
  error?: string;
}

export interface TimelineEvent {
  id: string;
  kind: EventKind;
  timestamp: number;
  stepId?: string;
  title: string;
  detail?: string;
  evidence?: EvidenceCard[];
  metadata?: Record<string, unknown>;
}

export interface DAGNode {
  id: string;
  label: string;
  status: NodeStatus;
  type: "action" | "decision" | "parallel" | "checkpoint";
  toolName?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  retryCount: number;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface DAGEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  conditional?: boolean;
  animated?: boolean;
}

export interface DAGState {
  nodes: DAGNode[];
  edges: DAGEdge[];
  revision: number;
}

export interface StreamMessage<T = unknown> {
  id: string;
  event: EventKind;
  timestamp: number;
  runId: string;
  payload: T;
  sequence: number;
}

export interface EvidenceCard {
  id: string;
  claim: string;
  confidence: number;
  sources: EvidenceSource[];
  provenance: ProvenanceChain;
  createdAt: number;
}

export interface EvidenceSource {
  type: "url" | "document" | "api" | "tool_output" | "model_reasoning";
  uri: string;
  title: string;
  snippet?: string;
  retrievedAt: number;
}

export interface ProvenanceChain {
  stepId: string;
  toolName: string;
  modelId: string;
  inputHash: string;
  outputHash: string;
  parentIds: string[];
}

export interface SREMetric {
  name: string;
  value: number;
  unit: string;
  threshold?: number;
  trend: "up" | "down" | "stable";
  history: MetricDatapoint[];
}

export interface MetricDatapoint {
  timestamp: number;
  value: number;
}

export interface BudgetSnapshot {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
  totalCostUsd: number;
  spentCostUsd: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  modelCalls: number;
  modelBreakdown: ModelUsage[];
}

export interface ModelUsage {
  modelId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface ReplayState {
  isReplaying: boolean;
  replaySpeed: number;
  currentIndex: number;
  totalEvents: number;
  isPaused: boolean;
  startTimestamp: number;
  currentTimestamp: number;
}

export interface PlanDiff {
  revision: number;
  addedNodes: DAGNode[];
  removedNodeIds: string[];
  updatedNodes: Partial<DAGNode>[];
  addedEdges: DAGEdge[];
  removedEdgeIds: string[];
}
