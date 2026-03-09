import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEventPayload } from "../openclaw/src/infra/agent-events.ts";
import { onAgentEvent } from "../openclaw/src/infra/agent-events.ts";
import { requestHeartbeatNow } from "../openclaw/src/infra/heartbeat-wake.ts";
import { onSessionTranscriptUpdate } from "../openclaw/src/sessions/transcript-events.ts";
import { loadSessionEntry } from "../openclaw/src/gateway/session-utils.ts";

export type OpenClawSessionRuntimeState =
  | "idle"
  | "active"
  | "error"
  | "interrupted"
  | "recovery-requested";

export type OpenClawSessionRuntimeRecord = {
  sessionKey: string;
  sessionId?: string;
  sessionFile?: string;
  storePath?: string;
  status: OpenClawSessionRuntimeState;
  activeRunIds: string[];
  pendingRecoveryRunIds: string[];
  lastRunId?: string;
  lastLifecyclePhase?: string | null;
  lastEventAtMs: number | null;
  lastStartedAtMs: number | null;
  lastEndedAtMs: number | null;
  lastTranscriptAtMs: number | null;
  lastTranscriptFile?: string;
  lastError?: string | null;
  eventCount: number;
  recoveryAttempts: number;
  recoveryRequestedAtMs: number | null;
  interruptedAtMs: number | null;
  recoveredAtMs: number | null;
  updatedAtMs: number;
};

type OpenClawSessionRuntimeStoreFile = {
  version: 1;
  updatedAt: string;
  sessions: OpenClawSessionRuntimeRecord[];
};

export type OpenClawSessionRuntimeStatus = {
  storePath: string;
  persistSessions: boolean;
  started: boolean;
  autoRecoverOnStart: boolean;
  totalSessions: number;
  activeSessions: number;
  interruptedSessions: number;
  recoveryRequestedSessions: number;
  errorSessions: number;
  lastEventAtMs: number | null;
  lastTranscriptAtMs: number | null;
  lastRecoveryAtMs: number | null;
};

type AgentEventSubscriber = (listener: (evt: AgentEventPayload) => void) => () => void;
type TranscriptUpdate = { sessionFile: string };
type TranscriptSubscriber = (listener: (update: TranscriptUpdate) => void) => () => void;

export type OpenClawSessionRuntimeOptions = {
  storePath?: string;
  persistSessions?: boolean;
  autoRecoverOnStart?: boolean;
  persistDelayMs?: number;
  nowMs?: () => number;
  loadSessionEntry?: typeof loadSessionEntry;
  requestHeartbeatNow?: typeof requestHeartbeatNow;
  subscribeToAgentEvents?: AgentEventSubscriber;
  subscribeToTranscriptUpdates?: TranscriptSubscriber;
};

type ListSessionOptions = {
  limit?: number;
  query?: string;
  status?: OpenClawSessionRuntimeState | "all";
};

const DEFAULT_PERSIST_DELAY_MS = 250;
const MAX_SESSION_RETENTION = 500;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeSessionKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSessionFilePath(value: string | undefined, storePath?: string): string | undefined {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return undefined;
  }
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  const baseDir = storePath ? path.dirname(path.resolve(storePath)) : process.cwd();
  return path.resolve(baseDir, trimmed);
}

function resolveSessionRuntimeStorePath(storePath?: string): string {
  if (typeof storePath === "string" && storePath.trim().length > 0) {
    return path.resolve(storePath.trim());
  }
  if (process.env.OPENCLAW_SESSION_RUNTIME_STORE_PATH?.trim()) {
    return path.resolve(process.env.OPENCLAW_SESSION_RUNTIME_STORE_PATH.trim());
  }
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "hola-openclaw", "session-runtime.json");
  }
  return path.resolve(process.cwd(), "output", "openclaw", "session-runtime.json");
}

function isSessionRuntimeState(value: unknown): value is OpenClawSessionRuntimeState {
  return (
    value === "idle" ||
    value === "active" ||
    value === "error" ||
    value === "interrupted" ||
    value === "recovery-requested"
  );
}

function createEmptySessionRecord(sessionKey: string, nowMs: number): OpenClawSessionRuntimeRecord {
  return {
    sessionKey,
    status: "idle",
    activeRunIds: [],
    pendingRecoveryRunIds: [],
    lastEventAtMs: null,
    lastStartedAtMs: null,
    lastEndedAtMs: null,
    lastTranscriptAtMs: null,
    lastError: null,
    eventCount: 0,
    recoveryAttempts: 0,
    recoveryRequestedAtMs: null,
    interruptedAtMs: null,
    recoveredAtMs: null,
    updatedAtMs: nowMs,
  };
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

export class OpenClawSessionRuntime {
  private readonly sessions = new Map<string, OpenClawSessionRuntimeRecord>();
  private readonly sessionKeyByFile = new Map<string, string>();
  private readonly storePath: string;
  private readonly persistSessions: boolean;
  private readonly autoRecoverOnStart: boolean;
  private readonly persistDelayMs: number;
  private readonly nowMs: () => number;
  private readonly loadSessionEntryImpl: typeof loadSessionEntry;
  private readonly requestHeartbeatNowImpl: typeof requestHeartbeatNow;
  private readonly subscribeToAgentEvents: AgentEventSubscriber;
  private readonly subscribeToTranscriptUpdates: TranscriptSubscriber;
  private started = false;
  private startupRecoveryApplied = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private unsubscribeAgentEvents: (() => void) | null = null;
  private unsubscribeTranscriptUpdates: (() => void) | null = null;

  constructor(options: OpenClawSessionRuntimeOptions = {}) {
    this.storePath = resolveSessionRuntimeStorePath(options.storePath);
    this.persistSessions = options.persistSessions ?? true;
    this.autoRecoverOnStart = options.autoRecoverOnStart ?? true;
    this.persistDelayMs = Math.max(0, options.persistDelayMs ?? DEFAULT_PERSIST_DELAY_MS);
    this.nowMs = options.nowMs ?? Date.now;
    this.loadSessionEntryImpl = options.loadSessionEntry ?? loadSessionEntry;
    this.requestHeartbeatNowImpl = options.requestHeartbeatNow ?? requestHeartbeatNow;
    this.subscribeToAgentEvents = options.subscribeToAgentEvents ?? onAgentEvent;
    this.subscribeToTranscriptUpdates = options.subscribeToTranscriptUpdates ?? onSessionTranscriptUpdate;
    this.loadSessionsFromDisk();
  }

  async ensureStarted() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.unsubscribeAgentEvents = this.subscribeToAgentEvents((evt) => {
      this.handleAgentEvent(evt);
    });
    this.unsubscribeTranscriptUpdates = this.subscribeToTranscriptUpdates((update) => {
      this.handleTranscriptUpdate(update);
    });
    if (this.autoRecoverOnStart && !this.startupRecoveryApplied) {
      this.startupRecoveryApplied = true;
      this.recoverInterruptedSessions("session-runtime:startup-recovery");
    }
    this.schedulePersist();
  }

  stop() {
    this.started = false;
    this.unsubscribeAgentEvents?.();
    this.unsubscribeTranscriptUpdates?.();
    this.unsubscribeAgentEvents = null;
    this.unsubscribeTranscriptUpdates = null;
    this.flushPersistNow();
  }

  getStatus(): OpenClawSessionRuntimeStatus {
    const records = [...this.sessions.values()];
    const lastEventAtMs = records.reduce<number | null>(
      (latest, record) =>
        record.lastEventAtMs != null && (latest == null || record.lastEventAtMs > latest)
          ? record.lastEventAtMs
          : latest,
      null,
    );
    const lastTranscriptAtMs = records.reduce<number | null>(
      (latest, record) =>
        record.lastTranscriptAtMs != null && (latest == null || record.lastTranscriptAtMs > latest)
          ? record.lastTranscriptAtMs
          : latest,
      null,
    );
    const lastRecoveryAtMs = records.reduce<number | null>(
      (latest, record) =>
        record.recoveryRequestedAtMs != null &&
        (latest == null || record.recoveryRequestedAtMs > latest)
          ? record.recoveryRequestedAtMs
          : latest,
      null,
    );

    return {
      storePath: this.storePath,
      persistSessions: this.persistSessions,
      started: this.started,
      autoRecoverOnStart: this.autoRecoverOnStart,
      totalSessions: records.length,
      activeSessions: records.filter((record) => record.status === "active").length,
      interruptedSessions: records.filter((record) => record.status === "interrupted").length,
      recoveryRequestedSessions: records.filter((record) => record.status === "recovery-requested")
        .length,
      errorSessions: records.filter((record) => record.status === "error").length,
      lastEventAtMs,
      lastTranscriptAtMs,
      lastRecoveryAtMs,
    };
  }

  listSessions(options: ListSessionOptions = {}) {
    const query = normalizeString(options.query)?.toLowerCase();
    const status = options.status ?? "all";
    const limit = Math.max(1, Math.min(500, options.limit ?? 50));
    const sessions = [...this.sessions.values()]
      .filter((record) => status === "all" || record.status === status)
      .filter((record) => {
        if (!query) {
          return true;
        }
        return (
          record.sessionKey.toLowerCase().includes(query) ||
          record.sessionId?.toLowerCase().includes(query) ||
          record.lastRunId?.toLowerCase().includes(query) ||
          record.lastError?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, limit)
      .map((record) => cloneJson(record));

    return {
      count: sessions.length,
      sessions,
    };
  }

  getSession(sessionKey: string) {
    const record = this.sessions.get(normalizeSessionKey(sessionKey));
    return record ? cloneJson(record) : undefined;
  }

  recoverSession(sessionKey: string, opts: { reason?: string; coalesceMs?: number } = {}) {
    const normalizedKey = normalizeSessionKey(sessionKey);
    if (!normalizedKey) {
      throw new Error("sessionKey is required");
    }
    const record = this.getOrCreateRecord(normalizedKey);
    const now = this.nowMs();
    this.refreshSessionMetadata(record);
    record.status = record.activeRunIds.length > 0 ? "active" : "recovery-requested";
    record.recoveryAttempts += 1;
    record.recoveryRequestedAtMs = now;
    record.updatedAtMs = now;
    this.requestHeartbeatNowImpl({
      reason: opts.reason ?? `session-runtime:recover:${normalizedKey}`,
      coalesceMs: opts.coalesceMs ?? 0,
      sessionKey: normalizedKey,
    });
    this.schedulePersist();
    return {
      queued: true,
      session: cloneJson(record),
    };
  }

  private handleAgentEvent(event: AgentEventPayload) {
    const normalizedKey = normalizeString(event.sessionKey);
    if (!normalizedKey) {
      return;
    }
    const sessionKey = normalizeSessionKey(normalizedKey);
    const now = this.nowMs();
    const record = this.getOrCreateRecord(sessionKey);
    record.eventCount += 1;
    record.lastEventAtMs = event.ts ?? now;
    record.lastRunId = normalizeString(event.runId) ?? record.lastRunId;
    record.updatedAtMs = now;
    this.refreshSessionMetadata(record);

    const lifecyclePhase =
      event.stream === "lifecycle" ? normalizeString((event.data as Record<string, unknown>)?.phase) : undefined;

    if (lifecyclePhase) {
      record.lastLifecyclePhase = lifecyclePhase;
      if (lifecyclePhase === "start") {
        record.lastStartedAtMs = event.ts ?? now;
        record.lastEndedAtMs = null;
        record.lastError = null;
        if (event.runId) {
          record.activeRunIds = uniq([...record.activeRunIds, event.runId]);
        }
        if (record.pendingRecoveryRunIds.length > 0 || record.status === "interrupted" || record.status === "recovery-requested") {
          record.pendingRecoveryRunIds = [];
          record.recoveredAtMs = event.ts ?? now;
        }
        record.status = "active";
      } else if (lifecyclePhase === "end") {
        if (event.runId) {
          record.activeRunIds = record.activeRunIds.filter((runId) => runId !== event.runId);
        }
        record.lastEndedAtMs = event.ts ?? now;
        record.status = record.activeRunIds.length > 0 ? "active" : "idle";
      } else if (lifecyclePhase === "error") {
        if (event.runId) {
          record.activeRunIds = record.activeRunIds.filter((runId) => runId !== event.runId);
        }
        record.lastEndedAtMs = event.ts ?? now;
        record.lastError =
          normalizeString((event.data as Record<string, unknown>)?.error) ?? "Agent run failed";
        record.status = record.activeRunIds.length > 0 ? "active" : "error";
      }
    } else if (event.runId) {
      if (!record.activeRunIds.includes(event.runId)) {
        record.activeRunIds = uniq([...record.activeRunIds, event.runId]);
      }
      if (record.pendingRecoveryRunIds.length > 0 || record.status === "interrupted" || record.status === "recovery-requested") {
        record.pendingRecoveryRunIds = [];
        record.recoveredAtMs = event.ts ?? now;
      }
      if (record.status !== "active") {
        record.status = "active";
      }
    }

    this.schedulePersist();
  }

  private handleTranscriptUpdate(update: TranscriptUpdate) {
    const sessionFile = normalizeSessionFilePath(update.sessionFile);
    if (!sessionFile) {
      return;
    }
    const now = this.nowMs();
    const sessionKey = this.sessionKeyByFile.get(sessionFile) ?? this.findSessionKeyByFile(sessionFile);
    if (!sessionKey) {
      return;
    }
    const record = this.getOrCreateRecord(sessionKey);
    record.lastTranscriptAtMs = now;
    record.lastTranscriptFile = sessionFile;
    record.updatedAtMs = now;
    if (!record.sessionFile) {
      record.sessionFile = sessionFile;
    }
    this.sessionKeyByFile.set(sessionFile, sessionKey);
    this.schedulePersist();
  }

  private findSessionKeyByFile(sessionFile: string): string | undefined {
    for (const record of this.sessions.values()) {
      if (record.sessionFile && normalizeSessionFilePath(record.sessionFile) === sessionFile) {
        this.sessionKeyByFile.set(sessionFile, record.sessionKey);
        return record.sessionKey;
      }
    }
    return undefined;
  }

  private recoverInterruptedSessions(reason: string) {
    for (const record of this.sessions.values()) {
      if (record.status !== "interrupted") {
        continue;
      }
      this.recoverSession(record.sessionKey, { reason, coalesceMs: 0 });
    }
  }

  private getOrCreateRecord(sessionKey: string) {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      return existing;
    }
    const next = createEmptySessionRecord(sessionKey, this.nowMs());
    this.sessions.set(sessionKey, next);
    this.trimRetention();
    return next;
  }

  private refreshSessionMetadata(record: OpenClawSessionRuntimeRecord) {
    try {
      const loaded = this.loadSessionEntryImpl(record.sessionKey);
      if (loaded.storePath) {
        record.storePath = loaded.storePath;
      }
      if (loaded.entry?.sessionId) {
        record.sessionId = loaded.entry.sessionId;
      }
      const resolvedFile = normalizeSessionFilePath(loaded.entry?.sessionFile, loaded.storePath);
      if (resolvedFile) {
        record.sessionFile = resolvedFile;
        this.sessionKeyByFile.set(resolvedFile, record.sessionKey);
      }
    } catch {
      // Best effort only; runtime state should not fail if the session store is unavailable.
    }
  }

  private loadSessionsFromDisk() {
    if (!this.persistSessions) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<OpenClawSessionRuntimeStoreFile>;
      if (!parsed || !Array.isArray(parsed.sessions)) {
        return;
      }
      const recoveredAt = this.nowMs();
      for (const entry of parsed.sessions.slice(0, MAX_SESSION_RETENTION)) {
        const sessionKey = normalizeString(entry?.sessionKey);
        if (!sessionKey) {
          continue;
        }
        const record = createEmptySessionRecord(normalizeSessionKey(sessionKey), recoveredAt);
        record.sessionId = normalizeString(entry?.sessionId);
        record.sessionFile = normalizeSessionFilePath(normalizeString(entry?.sessionFile), normalizeString(entry?.storePath));
        record.storePath = normalizeString(entry?.storePath);
        record.status = isSessionRuntimeState(entry?.status) ? entry.status : "idle";
        record.activeRunIds = uniq(Array.isArray(entry?.activeRunIds) ? entry.activeRunIds : []);
        record.pendingRecoveryRunIds = uniq(
          Array.isArray(entry?.pendingRecoveryRunIds) ? entry.pendingRecoveryRunIds : [],
        );
        record.lastRunId = normalizeString(entry?.lastRunId);
        record.lastLifecyclePhase = normalizeString(entry?.lastLifecyclePhase) ?? null;
        record.lastEventAtMs =
          typeof entry?.lastEventAtMs === "number" && Number.isFinite(entry.lastEventAtMs)
            ? entry.lastEventAtMs
            : null;
        record.lastStartedAtMs =
          typeof entry?.lastStartedAtMs === "number" && Number.isFinite(entry.lastStartedAtMs)
            ? entry.lastStartedAtMs
            : null;
        record.lastEndedAtMs =
          typeof entry?.lastEndedAtMs === "number" && Number.isFinite(entry.lastEndedAtMs)
            ? entry.lastEndedAtMs
            : null;
        record.lastTranscriptAtMs =
          typeof entry?.lastTranscriptAtMs === "number" && Number.isFinite(entry.lastTranscriptAtMs)
            ? entry.lastTranscriptAtMs
            : null;
        record.lastTranscriptFile = normalizeSessionFilePath(
          normalizeString(entry?.lastTranscriptFile),
          normalizeString(entry?.storePath),
        );
        record.lastError = normalizeString(entry?.lastError) ?? null;
        record.eventCount =
          typeof entry?.eventCount === "number" && Number.isFinite(entry.eventCount)
            ? Math.max(0, Math.floor(entry.eventCount))
            : 0;
        record.recoveryAttempts =
          typeof entry?.recoveryAttempts === "number" && Number.isFinite(entry.recoveryAttempts)
            ? Math.max(0, Math.floor(entry.recoveryAttempts))
            : 0;
        record.recoveryRequestedAtMs =
          typeof entry?.recoveryRequestedAtMs === "number" &&
          Number.isFinite(entry.recoveryRequestedAtMs)
            ? entry.recoveryRequestedAtMs
            : null;
        record.interruptedAtMs =
          typeof entry?.interruptedAtMs === "number" && Number.isFinite(entry.interruptedAtMs)
            ? entry.interruptedAtMs
            : null;
        record.recoveredAtMs =
          typeof entry?.recoveredAtMs === "number" && Number.isFinite(entry.recoveredAtMs)
            ? entry.recoveredAtMs
            : null;
        record.updatedAtMs =
          typeof entry?.updatedAtMs === "number" && Number.isFinite(entry.updatedAtMs)
            ? entry.updatedAtMs
            : recoveredAt;

        if (
          record.activeRunIds.length > 0 ||
          record.status === "active" ||
          record.status === "recovery-requested"
        ) {
          record.pendingRecoveryRunIds = uniq([
            ...record.pendingRecoveryRunIds,
            ...record.activeRunIds,
          ]);
          record.activeRunIds = [];
          record.status = "interrupted";
          record.interruptedAtMs = recoveredAt;
          record.updatedAtMs = recoveredAt;
        }

        if (record.sessionFile) {
          this.sessionKeyByFile.set(record.sessionFile, record.sessionKey);
        }
        if (record.lastTranscriptFile) {
          this.sessionKeyByFile.set(record.lastTranscriptFile, record.sessionKey);
        }
        this.sessions.set(record.sessionKey, record);
      }
      this.trimRetention();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        console.warn(
          `[OpenClawSessionRuntime] Failed to load persisted sessions from ${this.storePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private schedulePersist() {
    if (!this.persistSessions) {
      return;
    }
    if (this.persistDelayMs === 0) {
      this.flushPersistNow();
      return;
    }
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistNow();
    }, this.persistDelayMs);
    this.persistTimer.unref?.();
  }

  private flushPersistNow() {
    if (!this.persistSessions) {
      return;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      const payload: OpenClawSessionRuntimeStoreFile = {
        version: 1,
        updatedAt: new Date().toISOString(),
        sessions: [...this.sessions.values()]
          .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
          .slice(0, MAX_SESSION_RETENTION)
          .map((record) => cloneJson(record)),
      };
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const tmpPath = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(tmpPath, this.storePath);
    } catch (error) {
      console.warn(
        `[OpenClawSessionRuntime] Failed to persist sessions to ${this.storePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private trimRetention() {
    const records = [...this.sessions.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    const retained = new Set(records.slice(0, MAX_SESSION_RETENTION).map((record) => record.sessionKey));
    for (const key of this.sessions.keys()) {
      if (!retained.has(key)) {
        this.sessions.delete(key);
      }
    }
    for (const [sessionFile, sessionKey] of this.sessionKeyByFile.entries()) {
      if (!retained.has(sessionKey)) {
        this.sessionKeyByFile.delete(sessionFile);
      }
    }
  }
}

export const openClawSessionRuntime = new OpenClawSessionRuntime();
