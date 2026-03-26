import type { CodexExecutionProfile } from "@/services/codexRuntime";

export const CODEX_WORKSPACE_DRAFT_STORAGE_KEY = "iliagpt.codex.workspace.v1";
export const CODEX_RUN_RESUME_STORAGE_KEY = "iliagpt.codex.run-resume.v1";

type CodexWorkspaceView = "workspace" | "openclaw-ui";

export interface CodexWorkspaceDraftSnapshot {
  version: 1;
  draft: string;
  multiAgentEnabled: boolean;
  executionProfile: CodexExecutionProfile;
  maxSubagents: number;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  activeRepoBranch: string;
  activeView: CodexWorkspaceView;
}

export interface CodexRunResumeSnapshot {
  version: 1;
  runId: string;
  chatId: string | null;
  executionProfile: CodexExecutionProfile;
  status: string;
  summary: string;
  objective: string;
  lastEventTitle: string | null;
  updatedAt: number;
}

const VALID_EXECUTION_PROFILES = new Set<CodexExecutionProfile>([
  "standard",
  "marathon_12h",
  "marathon_24h",
]);

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJson(key: string): unknown {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function clampSubagentCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(Math.max(Math.round(parsed), 1), 4);
}

function normalizeExecutionProfile(value: unknown): CodexExecutionProfile {
  if (typeof value === "string" && VALID_EXECUTION_PROFILES.has(value as CodexExecutionProfile)) {
    return value as CodexExecutionProfile;
  }
  return "standard";
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function loadCodexWorkspaceDraft(): CodexWorkspaceDraftSnapshot | null {
  const payload = readJson(CODEX_WORKSPACE_DRAFT_STORAGE_KEY);
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  return {
    version: 1,
    draft: typeof record.draft === "string" ? record.draft : "",
    multiAgentEnabled: record.multiAgentEnabled !== false,
    executionProfile: normalizeExecutionProfile(record.executionProfile),
    maxSubagents: clampSubagentCount(record.maxSubagents),
    selectedProjectId: normalizeOptionalId(record.selectedProjectId),
    selectedSessionId: normalizeOptionalId(record.selectedSessionId),
    activeRepoBranch:
      typeof record.activeRepoBranch === "string" && record.activeRepoBranch.trim().length > 0
        ? record.activeRepoBranch.trim()
        : "main",
    activeView: record.activeView === "openclaw-ui" ? "openclaw-ui" : "workspace",
  };
}

export function persistCodexWorkspaceDraft(
  value: Omit<CodexWorkspaceDraftSnapshot, "version">,
): CodexWorkspaceDraftSnapshot {
  const snapshot: CodexWorkspaceDraftSnapshot = {
    version: 1,
    draft: value.draft,
    multiAgentEnabled: value.multiAgentEnabled,
    executionProfile: normalizeExecutionProfile(value.executionProfile),
    maxSubagents: clampSubagentCount(value.maxSubagents),
    selectedProjectId: normalizeOptionalId(value.selectedProjectId),
    selectedSessionId: normalizeOptionalId(value.selectedSessionId),
    activeRepoBranch: value.activeRepoBranch.trim() || "main",
    activeView: value.activeView === "openclaw-ui" ? "openclaw-ui" : "workspace",
  };
  writeJson(CODEX_WORKSPACE_DRAFT_STORAGE_KEY, snapshot);
  return snapshot;
}

export function clearCodexWorkspaceDraft(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(CODEX_WORKSPACE_DRAFT_STORAGE_KEY);
}

export function loadCodexRunResume(): CodexRunResumeSnapshot | null {
  const payload = readJson(CODEX_RUN_RESUME_STORAGE_KEY);
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const runId = normalizeOptionalId(record.runId);
  if (!runId) return null;

  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
    ? Math.round(record.updatedAt)
    : Date.now();

  return {
    version: 1,
    runId,
    chatId: normalizeOptionalId(record.chatId),
    executionProfile: normalizeExecutionProfile(record.executionProfile),
    status: typeof record.status === "string" && record.status.trim().length > 0 ? record.status.trim() : "running",
    summary: typeof record.summary === "string" ? record.summary : "",
    objective: typeof record.objective === "string" ? record.objective : "",
    lastEventTitle: typeof record.lastEventTitle === "string" && record.lastEventTitle.trim().length > 0
      ? record.lastEventTitle.trim()
      : null,
    updatedAt,
  };
}

export function persistCodexRunResume(
  value: Omit<CodexRunResumeSnapshot, "version">,
): CodexRunResumeSnapshot {
  const snapshot: CodexRunResumeSnapshot = {
    version: 1,
    runId: value.runId.trim(),
    chatId: normalizeOptionalId(value.chatId),
    executionProfile: normalizeExecutionProfile(value.executionProfile),
    status: value.status.trim() || "running",
    summary: value.summary,
    objective: value.objective,
    lastEventTitle: value.lastEventTitle?.trim() ? value.lastEventTitle.trim() : null,
    updatedAt: Math.round(value.updatedAt),
  };
  writeJson(CODEX_RUN_RESUME_STORAGE_KEY, snapshot);
  return snapshot;
}

export function clearCodexRunResume(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(CODEX_RUN_RESUME_STORAGE_KEY);
}
