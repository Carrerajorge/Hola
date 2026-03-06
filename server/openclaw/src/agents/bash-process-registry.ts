import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createSessionSlug as createSessionSlugId } from "./session-slug.js";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_JOB_TTL_MS = 60 * 1000; // 1 minute
const MAX_JOB_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;
const MAX_PERSISTED_SESSIONS = 200;

function clampTtl(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_JOB_TTL_MS;
  }
  return Math.min(Math.max(value, MIN_JOB_TTL_MS), MAX_JOB_TTL_MS);
}

let jobTtlMs = clampTtl(Number.parseInt(process.env.PI_BASH_JOB_TTL_MS ?? "", 10));

export type ProcessStatus = "running" | "completed" | "failed" | "killed";

export type SessionStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  // When backed by a real Node stream (child.stdin), this exists; for PTY wrappers it may not.
  destroy?: () => void;
  destroyed?: boolean;
};

export interface ProcessSession {
  id: string;
  command: string;
  scopeKey?: string;
  sessionKey?: string;
  notifyOnExit?: boolean;
  notifyOnExitEmptySuccess?: boolean;
  exitNotified?: boolean;
  child?: ChildProcessWithoutNullStreams;
  stdin?: SessionStdin;
  pid?: number;
  startedAt: number;
  cwd?: string;
  maxOutputChars: number;
  pendingMaxOutputChars?: number;
  totalOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  aggregated: string;
  tail: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  exited: boolean;
  truncated: boolean;
  backgrounded: boolean;
}

export interface FinishedSession {
  id: string;
  command: string;
  scopeKey?: string;
  startedAt: number;
  endedAt: number;
  cwd?: string;
  status: ProcessStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  aggregated: string;
  tail: string;
  truncated: boolean;
  totalOutputChars: number;
}

type PersistedSessionStatus = ProcessStatus | "running";

type PersistedSessionSnapshot = {
  id: string;
  command: string;
  scopeKey?: string;
  sessionKey?: string;
  startedAt: number;
  endedAt?: number;
  cwd?: string;
  status: PersistedSessionStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  aggregated: string;
  tail: string;
  truncated: boolean;
  totalOutputChars: number;
};

type ProcessRegistryStoreFile = {
  version: 1;
  updatedAt: string;
  sessions: PersistedSessionSnapshot[];
};

export type ProcessRegistryPersistenceStatus = {
  enabled: boolean;
  storePath: string;
  persistedSessions: number;
  recoveredInterruptedSessions: number;
  lastLoadedAt: number | null;
  lastPersistedAt: number | null;
};

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedSession>();

let sweeper: NodeJS.Timeout | null = null;
let recoveredInterruptedSessions = 0;
let lastLoadedAt: number | null = null;
let lastPersistedAt: number | null = null;

function isPersistenceEnabled() {
  return process.env.OPENCLAW_PROCESS_SESSION_PERSIST !== "false";
}

function resolveProcessRegistryStorePath() {
  if (process.env.OPENCLAW_PROCESS_SESSION_STORE_PATH?.trim()) {
    return path.resolve(process.env.OPENCLAW_PROCESS_SESSION_STORE_PATH.trim());
  }
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "hola-openclaw", "process-sessions.json");
  }
  return path.resolve(process.cwd(), "output", "openclaw", "process-sessions.json");
}

function buildRunningSnapshot(session: ProcessSession): PersistedSessionSnapshot {
  return {
    id: session.id,
    command: session.command,
    scopeKey: session.scopeKey,
    sessionKey: session.sessionKey,
    startedAt: session.startedAt,
    cwd: session.cwd,
    status: "running",
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    totalOutputChars: session.totalOutputChars,
  };
}

function buildFinishedSnapshot(session: FinishedSession): PersistedSessionSnapshot {
  return {
    id: session.id,
    command: session.command,
    scopeKey: session.scopeKey,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    cwd: session.cwd,
    status: session.status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    totalOutputChars: session.totalOutputChars,
  };
}

function persistRegistry() {
  if (!isPersistenceEnabled()) {
    return;
  }
  try {
    const storePath = resolveProcessRegistryStorePath();
    const sessions = [
      ...Array.from(runningSessions.values())
        .filter((session) => session.backgrounded)
        .map(buildRunningSnapshot),
      ...Array.from(finishedSessions.values()).map(buildFinishedSnapshot),
    ]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_PERSISTED_SESSIONS);
    const payload: ProcessRegistryStoreFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions,
    };
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const tmpPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmpPath, storePath);
    lastPersistedAt = Date.now();
  } catch (error) {
    console.warn(
      `[bash-process-registry] Failed to persist process registry: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function withRecoveryNote(snapshot: PersistedSessionSnapshot) {
  const note = "\n\n[Recovered after restart: background session was interrupted before completion.]";
  const aggregated = trimWithCap(`${snapshot.aggregated || ""}${note}`, DEFAULT_PENDING_OUTPUT_CHARS * 4);
  return {
    aggregated,
    tail: tail(aggregated, 2000),
  };
}

export function rehydrateProcessRegistryFromDisk() {
  runningSessions.clear();
  finishedSessions.clear();
  recoveredInterruptedSessions = 0;
  lastLoadedAt = Date.now();

  if (!isPersistenceEnabled()) {
    return;
  }

  try {
    const raw = fs.readFileSync(resolveProcessRegistryStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProcessRegistryStoreFile>;
    if (!parsed || !Array.isArray(parsed.sessions)) {
      return;
    }
    for (const snapshot of parsed.sessions.slice(0, MAX_PERSISTED_SESSIONS)) {
      if (!snapshot?.id || !snapshot?.command || typeof snapshot.startedAt !== "number") {
        continue;
      }
      if (snapshot.status === "running") {
        const recovered = withRecoveryNote(snapshot);
        finishedSessions.set(snapshot.id, {
          id: snapshot.id,
          command: snapshot.command,
          scopeKey: snapshot.scopeKey,
          startedAt: snapshot.startedAt,
          endedAt: snapshot.endedAt ?? Date.now(),
          cwd: snapshot.cwd,
          status: "failed",
          exitCode: snapshot.exitCode,
          exitSignal: snapshot.exitSignal,
          aggregated: recovered.aggregated,
          tail: recovered.tail,
          truncated: snapshot.truncated,
          totalOutputChars: snapshot.totalOutputChars,
        });
        recoveredInterruptedSessions += 1;
        continue;
      }
      finishedSessions.set(snapshot.id, {
        id: snapshot.id,
        command: snapshot.command,
        scopeKey: snapshot.scopeKey,
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt ?? snapshot.startedAt,
        cwd: snapshot.cwd,
        status: snapshot.status,
        exitCode: snapshot.exitCode,
        exitSignal: snapshot.exitSignal,
        aggregated: snapshot.aggregated || "",
        tail: snapshot.tail || tail(snapshot.aggregated || "", 2000),
        truncated: Boolean(snapshot.truncated),
        totalOutputChars: snapshot.totalOutputChars ?? (snapshot.aggregated || "").length,
      });
    }
    if (finishedSessions.size > 0) {
      startSweeper();
    }
    if (recoveredInterruptedSessions > 0) {
      persistRegistry();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn(
        `[bash-process-registry] Failed to rehydrate process registry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export function getProcessRegistryPersistenceStatus(): ProcessRegistryPersistenceStatus {
  return {
    enabled: isPersistenceEnabled(),
    storePath: resolveProcessRegistryStorePath(),
    persistedSessions: runningSessions.size + finishedSessions.size,
    recoveredInterruptedSessions,
    lastLoadedAt,
    lastPersistedAt,
  };
}

function isSessionIdTaken(id: string) {
  return runningSessions.has(id) || finishedSessions.has(id);
}

export function createSessionSlug(): string {
  return createSessionSlugId(isSessionIdTaken);
}

export function addSession(session: ProcessSession) {
  runningSessions.set(session.id, session);
  startSweeper();
  persistRegistry();
}

export function getSession(id: string) {
  return runningSessions.get(id);
}

export function getFinishedSession(id: string) {
  return finishedSessions.get(id);
}

export function deleteSession(id: string) {
  runningSessions.delete(id);
  finishedSessions.delete(id);
  persistRegistry();
}

export function appendOutput(session: ProcessSession, stream: "stdout" | "stderr", chunk: string) {
  session.pendingStdout ??= [];
  session.pendingStderr ??= [];
  session.pendingStdoutChars ??= sumPendingChars(session.pendingStdout);
  session.pendingStderrChars ??= sumPendingChars(session.pendingStderr);
  const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const bufferChars = stream === "stdout" ? session.pendingStdoutChars : session.pendingStderrChars;
  const pendingCap = Math.min(
    session.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS,
    session.maxOutputChars,
  );
  buffer.push(chunk);
  let pendingChars = bufferChars + chunk.length;
  if (pendingChars > pendingCap) {
    session.truncated = true;
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }
  if (stream === "stdout") {
    session.pendingStdoutChars = pendingChars;
  } else {
    session.pendingStderrChars = pendingChars;
  }
  session.totalOutputChars += chunk.length;
  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;
  session.aggregated = aggregated;
  session.tail = tail(session.aggregated, 2000);
  if (session.backgrounded) {
    persistRegistry();
  }
}

export function drainSession(session: ProcessSession) {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

export function markExited(
  session: ProcessSession,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | number | null,
  status: ProcessStatus,
) {
  session.exited = true;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.tail = tail(session.aggregated, 2000);
  moveToFinished(session, status);
  persistRegistry();
}

export function markBackgrounded(session: ProcessSession) {
  session.backgrounded = true;
  persistRegistry();
}

function moveToFinished(session: ProcessSession, status: ProcessStatus) {
  runningSessions.delete(session.id);

  // Clean up child process stdio streams to prevent FD leaks
  if (session.child) {
    // Destroy stdio streams to release file descriptors
    session.child.stdin?.destroy?.();
    session.child.stdout?.destroy?.();
    session.child.stderr?.destroy?.();

    // Remove all event listeners to prevent memory leaks
    session.child.removeAllListeners();

    // Clear the reference
    delete session.child;
  }

  // Clean up stdin wrapper - call destroy if available, otherwise just remove reference
  if (session.stdin) {
    // Try to call destroy/end method if exists
    if (typeof session.stdin.destroy === "function") {
      session.stdin.destroy();
    } else if (typeof session.stdin.end === "function") {
      session.stdin.end();
    }
    // Only set flag if writable
    try {
      (session.stdin as { destroyed?: boolean }).destroyed = true;
    } catch {
      // Ignore if read-only
    }
    delete session.stdin;
  }

  if (!session.backgrounded) {
    return;
  }
  finishedSessions.set(session.id, {
    id: session.id,
    command: session.command,
    scopeKey: session.scopeKey,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    cwd: session.cwd,
    status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    totalOutputChars: session.totalOutputChars,
  });
}

export function tail(text: string, max = 2000) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

function sumPendingChars(buffer: string[]) {
  let total = 0;
  for (const chunk of buffer) {
    total += chunk.length;
  }
  return total;
}

function capPendingBuffer(buffer: string[], pendingChars: number, cap: number) {
  if (pendingChars <= cap) {
    return pendingChars;
  }
  const last = buffer.at(-1);
  if (last && last.length >= cap) {
    buffer.length = 0;
    buffer.push(last.slice(last.length - cap));
    return cap;
  }
  while (buffer.length && pendingChars - buffer[0].length >= cap) {
    pendingChars -= buffer[0].length;
    buffer.shift();
  }
  if (buffer.length && pendingChars > cap) {
    const overflow = pendingChars - cap;
    buffer[0] = buffer[0].slice(overflow);
    pendingChars = cap;
  }
  return pendingChars;
}

export function trimWithCap(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

export function listRunningSessions() {
  return Array.from(runningSessions.values()).filter((s) => s.backgrounded);
}

export function listFinishedSessions() {
  return Array.from(finishedSessions.values());
}

export function clearFinished() {
  finishedSessions.clear();
  persistRegistry();
}

export function resetProcessRegistryForTests(options?: { preserveStore?: boolean }) {
  runningSessions.clear();
  finishedSessions.clear();
  recoveredInterruptedSessions = 0;
  lastLoadedAt = null;
  lastPersistedAt = null;
  stopSweeper();
  if (!options?.preserveStore) {
    try {
      fs.rmSync(resolveProcessRegistryStorePath(), { force: true });
    } catch {
      // ignore test cleanup failures
    }
  }
}

export function setJobTtlMs(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return;
  }
  jobTtlMs = clampTtl(value);
  stopSweeper();
  startSweeper();
}

function pruneFinishedSessions() {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, session] of finishedSessions.entries()) {
    if (session.endedAt < cutoff) {
      finishedSessions.delete(id);
    }
  }
  persistRegistry();
}

function startSweeper() {
  if (sweeper) {
    return;
  }
  sweeper = setInterval(pruneFinishedSessions, Math.max(30_000, jobTtlMs / 6));
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}

rehydrateProcessRegistryFromDisk();
