import { formatDurationCompact } from "../openclaw/src/infra/format-time/format-duration.ts";
import { killProcessTree } from "../openclaw/src/process/kill-tree.ts";
import type { ProcessSession } from "../openclaw/src/agents/bash-process-registry.ts";
import {
  deleteSession,
  drainSession,
  getFinishedSession,
  getSession,
  listFinishedSessions,
  listRunningSessions,
  markExited,
} from "../openclaw/src/agents/bash-process-registry.ts";
import { deriveSessionName, sliceLogLines, truncateMiddle } from "../openclaw/src/agents/bash-tools.shared.ts";
import { encodeKeySequence, encodePaste } from "../openclaw/src/agents/pty-keys.ts";

type WritableStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroyed?: boolean;
};

const DEFAULT_LOG_TAIL_LINES = 200;
const MAX_POLL_WAIT_MS = 120_000;

function resolvePollWaitMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(MAX_POLL_WAIT_MS, Math.floor(value)));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(MAX_POLL_WAIT_MS, parsed));
    }
  }
  return 0;
}

function resolveLogSliceWindow(offset?: number, limit?: number) {
  const usingDefaultTail = offset === undefined && limit === undefined;
  const effectiveLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? limit
      : usingDefaultTail
        ? DEFAULT_LOG_TAIL_LINES
        : undefined;
  return { effectiveOffset: offset, effectiveLimit, usingDefaultTail };
}

function defaultTailNote(totalLines: number, usingDefaultTail: boolean) {
  if (!usingDefaultTail || totalLines <= DEFAULT_LOG_TAIL_LINES) {
    return "";
  }
  return `\n\n[showing last ${DEFAULT_LOG_TAIL_LINES} of ${totalLines} lines; pass offset/limit to page]`;
}

function terminateSession(session: ProcessSession) {
  const pid = session.pid ?? session.child?.pid;
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  killProcessTree(pid);
  return true;
}

async function writeToStdin(stdin: WritableStdin, data: string) {
  await new Promise<void>((resolve, reject) => {
    stdin.write(data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function resolveWritableSession(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`No active session found for ${sessionId}`);
  }
  if (!session.backgrounded) {
    throw new Error(`Session ${sessionId} is not backgrounded.`);
  }
  const stdin = session.stdin ?? session.child?.stdin;
  if (!stdin || stdin.destroyed) {
    throw new Error(`Session ${sessionId} stdin is not writable.`);
  }
  return { session, stdin: stdin as WritableStdin };
}

function summarizeRunningSession(session: ProcessSession) {
  return {
    sessionId: session.id,
    status: "running" as const,
    pid: session.pid ?? session.child?.pid ?? undefined,
    startedAt: session.startedAt,
    runtimeMs: Date.now() - session.startedAt,
    cwd: session.cwd,
    command: session.command,
    name: deriveSessionName(session.command),
    tail: session.tail,
    truncated: session.truncated,
  };
}

function summarizeFinishedSession(session: ReturnType<typeof getFinishedSession> extends infer T ? Exclude<T, undefined> : never) {
  return {
    sessionId: session.id,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    runtimeMs: session.endedAt - session.startedAt,
    cwd: session.cwd,
    command: session.command,
    name: deriveSessionName(session.command),
    tail: session.tail,
    truncated: session.truncated,
    exitCode: session.exitCode ?? undefined,
    exitSignal: session.exitSignal ?? undefined,
  };
}

export class OpenClawProcessRuntime {
  listSessions() {
    const running = listRunningSessions().map(summarizeRunningSession);
    const finished = listFinishedSessions().map(summarizeFinishedSession);
    const sessions = [...running, ...finished].toSorted((a, b) => b.startedAt - a.startedAt);
    const lines = sessions.map((session) => {
      const label = session.name
        ? truncateMiddle(session.name, 80)
        : truncateMiddle(session.command, 120);
      return `${session.sessionId} ${String(session.status).padEnd(9)} ${formatDurationCompact(session.runtimeMs) ?? "n/a"} :: ${label}`;
    });
    return {
      count: sessions.length,
      sessions,
      text: lines.join("\n") || "No running or recent sessions.",
    };
  }

  async pollSession(sessionId: string, timeoutMs?: unknown) {
    const session = getSession(sessionId);
    const finished = getFinishedSession(sessionId);

    if (!session) {
      if (!finished) {
        throw new Error(`No session found for ${sessionId}`);
      }
      return {
        status: finished.status === "completed" ? "completed" : "failed",
        sessionId,
        output:
          (finished.tail || `(no output recorded${finished.truncated ? " - truncated to cap" : ""})`) +
          `\n\nProcess exited with ${
            finished.exitSignal ? `signal ${finished.exitSignal}` : `code ${finished.exitCode ?? 0}`
          }.`,
        aggregated: finished.aggregated,
        exitCode: finished.exitCode ?? undefined,
        exitSignal: finished.exitSignal ?? undefined,
        name: deriveSessionName(finished.command),
      };
    }

    if (!session.backgrounded) {
      throw new Error(`Session ${sessionId} is not backgrounded.`);
    }

    const pollWaitMs = resolvePollWaitMs(timeoutMs);
    if (pollWaitMs > 0 && !session.exited) {
      const deadline = Date.now() + pollWaitMs;
      while (!session.exited && Date.now() < deadline) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, Math.min(250, deadline - Date.now()))),
        );
      }
    }

    const { stdout, stderr } = drainSession(session);
    const exited = session.exited;
    const exitCode = session.exitCode ?? 0;
    const exitSignal = session.exitSignal ?? undefined;
    if (exited) {
      const status = exitCode === 0 && exitSignal == null ? "completed" : "failed";
      markExited(session, session.exitCode ?? null, session.exitSignal ?? null, status);
    }

    const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n").trim();
    return {
      status: exited ? (exitCode === 0 && exitSignal == null ? "completed" : "failed") : "running",
      sessionId,
      output:
        (output || "(no new output)") +
        (exited
          ? `\n\nProcess exited with ${exitSignal ? `signal ${exitSignal}` : `code ${exitCode}`}.`
          : "\n\nProcess still running."),
      aggregated: session.aggregated,
      exitCode: exited ? exitCode : undefined,
      exitSignal: exited ? exitSignal : undefined,
      name: deriveSessionName(session.command),
    };
  }

  getSessionLog(sessionId: string, offset?: number, limit?: number) {
    const running = getSession(sessionId);
    const finished = getFinishedSession(sessionId);
    const window = resolveLogSliceWindow(offset, limit);

    if (running) {
      if (!running.backgrounded) {
        throw new Error(`Session ${sessionId} is not backgrounded.`);
      }
      const { slice, totalLines, totalChars } = sliceLogLines(
        running.aggregated,
        window.effectiveOffset,
        window.effectiveLimit,
      );
      return {
        status: running.exited ? "completed" : "running",
        sessionId,
        total: totalLines,
        totalLines,
        totalChars,
        truncated: running.truncated,
        name: deriveSessionName(running.command),
        text: (slice || "(no output yet)") + defaultTailNote(totalLines, window.usingDefaultTail),
      };
    }

    if (!finished) {
      throw new Error(`No session found for ${sessionId}`);
    }

    const { slice, totalLines, totalChars } = sliceLogLines(
      finished.aggregated,
      window.effectiveOffset,
      window.effectiveLimit,
    );
    return {
      status: finished.status === "completed" ? "completed" : "failed",
      sessionId,
      total: totalLines,
      totalLines,
      totalChars,
      truncated: finished.truncated,
      exitCode: finished.exitCode ?? undefined,
      exitSignal: finished.exitSignal ?? undefined,
      name: deriveSessionName(finished.command),
      text: (slice || "(no output recorded)") + defaultTailNote(totalLines, window.usingDefaultTail),
    };
  }

  async writeToSession(sessionId: string, data = "", eof = false) {
    const { session, stdin } = resolveWritableSession(sessionId);
    await writeToStdin(stdin, data);
    if (eof) {
      stdin.end();
    }
    return {
      status: "running",
      sessionId,
      name: deriveSessionName(session.command),
      message: `Wrote ${data.length} bytes to session ${sessionId}${eof ? " (stdin closed)" : ""}.`,
    };
  }

  async sendKeys(sessionId: string, params: { keys?: string[]; hex?: string[]; literal?: string }) {
    const { session, stdin } = resolveWritableSession(sessionId);
    const { data, warnings } = encodeKeySequence(params);
    if (!data) {
      throw new Error("No key data provided.");
    }
    await writeToStdin(stdin, data);
    return {
      status: "running",
      sessionId,
      name: deriveSessionName(session.command),
      message: `Sent ${data.length} bytes to session ${sessionId}.`,
      warnings,
    };
  }

  async submitSession(sessionId: string) {
    const { session, stdin } = resolveWritableSession(sessionId);
    await writeToStdin(stdin, "\r");
    return {
      status: "running",
      sessionId,
      name: deriveSessionName(session.command),
      message: `Submitted session ${sessionId} (sent CR).`,
    };
  }

  async pasteToSession(sessionId: string, text = "", bracketed = true) {
    const { session, stdin } = resolveWritableSession(sessionId);
    const payload = encodePaste(text, bracketed);
    if (!payload) {
      throw new Error("No paste text provided.");
    }
    await writeToStdin(stdin, payload);
    return {
      status: "running",
      sessionId,
      name: deriveSessionName(session.command),
      message: `Pasted ${text.length} chars to session ${sessionId}.`,
    };
  }

  killSession(sessionId: string) {
    const session = getSession(sessionId);
    if (!session) {
      throw new Error(`No active session found for ${sessionId}`);
    }
    if (!session.backgrounded) {
      throw new Error(`Session ${sessionId} is not backgrounded.`);
    }
    const terminated = terminateSession(session);
    if (!terminated) {
      throw new Error(
        `Unable to terminate session ${sessionId}: no active process id is available.`,
      );
    }
    markExited(session, null, "SIGKILL", "failed");
    return {
      status: "failed",
      sessionId,
      name: deriveSessionName(session.command),
      message: `Killed session ${sessionId}.`,
    };
  }

  clearSession(sessionId: string) {
    const finished = getFinishedSession(sessionId);
    if (!finished) {
      throw new Error(`No finished session found for ${sessionId}`);
    }
    deleteSession(sessionId);
    return {
      status: "completed",
      sessionId,
      message: `Cleared session ${sessionId}.`,
    };
  }

  removeSession(sessionId: string) {
    const running = getSession(sessionId);
    if (running) {
      if (running.backgrounded) {
        const terminated = terminateSession(running);
        if (!terminated) {
          throw new Error(
            `Unable to remove session ${sessionId}: no active process id is available.`,
          );
        }
        markExited(running, null, "SIGKILL", "failed");
      }
      deleteSession(sessionId);
      return {
        status: "failed",
        sessionId,
        name: deriveSessionName(running.command),
        message: `Removed session ${sessionId}.`,
      };
    }

    const finished = getFinishedSession(sessionId);
    if (!finished) {
      throw new Error(`No session found for ${sessionId}`);
    }
    deleteSession(sessionId);
    return {
      status: "completed",
      sessionId,
      message: `Removed session ${sessionId}.`,
    };
  }
}

export const openClawProcessRuntime = new OpenClawProcessRuntime();
