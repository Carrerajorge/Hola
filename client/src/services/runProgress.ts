import { apiFetch } from "@/lib/apiClient";

const API_BASE = "/api/agent";

export interface RunStep {
  stepIndex: number;
  toolName: string;
  description?: string | null;
  status: string;
  output?: any;
  error?: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ToolArtifact {
  type?: string;
  name?: string;
  url?: string;
  metadata?: Record<string, any>;
}

export interface RunResponse {
  id: string;
  status: string;
  executionProfile?: "standard" | "marathon_12h" | "marathon_24h";
  plan?: any;
  summary?: string | null;
  error?: string | null;
  steps: RunStep[];
  artifacts: ToolArtifact[];
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  currentStepIndex?: number;
  totalSteps?: number;
  completedSteps?: number;
  runtimeBudgetMs?: number;
  runtimeRemainingMs?: number;
}

export interface RunEventFrame {
  id: string;
  runId: string;
  stepIndex?: number | null;
  eventType: string;
  payload: Record<string, any>;
  metadata?: Record<string, any> | null;
  timestamp: string | number;
}

export interface RunEventsPage {
  runId: string;
  page: number;
  limit: number;
  order: "asc" | "desc";
  total: number;
  events: RunEventFrame[];
}

export async function fetchRun(runId: string): Promise<RunResponse> {
  const response = await apiFetch(`${API_BASE}/runs/${runId}`);
  if (!response.ok) {
    throw new Error(`Failed to load run ${runId}`);
  }
  return response.json();
}

export async function fetchRunEvents(
  runId: string,
  options: { limit?: number; page?: number; order?: "asc" | "desc" } = {}
): Promise<RunEventsPage> {
  const query = new URLSearchParams();
  if (options.limit) query.set("limit", String(options.limit));
  if (options.page) query.set("page", String(options.page));
  if (options.order) query.set("order", options.order);
  const response = await apiFetch(`${API_BASE}/runs/${runId}/events?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load events for run ${runId}`);
  }
  return response.json();
}

export async function postRunAction(runId: string, action: "cancel" | "retry" | "resume"): Promise<void> {
  const response = await apiFetch(`${API_BASE}/runs/${runId}/${action}`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body?.error as string) || `Failed to ${action} run`);
  }
}

export function createRunEventSource(runId: string): EventSource {
  return new EventSource(`${API_BASE}/runs/${runId}/stream`, { withCredentials: true });
}
