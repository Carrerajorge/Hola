import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenClawSessionRuntime } from "./openclawSessionRuntime";
import type { AgentEventPayload } from "../openclaw/src/infra/agent-events";

function createRuntimeSubscribers() {
  let agentListener: ((evt: AgentEventPayload) => void) | undefined;
  let transcriptListener: ((update: { sessionFile: string }) => void) | undefined;

  return {
    subscribeToAgentEvents: (listener: (evt: AgentEventPayload) => void) => {
      agentListener = listener;
      return () => {
        if (agentListener === listener) {
          agentListener = undefined;
        }
      };
    },
    subscribeToTranscriptUpdates: (listener: (update: { sessionFile: string }) => void) => {
      transcriptListener = listener;
      return () => {
        if (transcriptListener === listener) {
          transcriptListener = undefined;
        }
      };
    },
    emitAgentEvent: (evt: AgentEventPayload) => {
      agentListener?.(evt);
    },
    emitTranscriptUpdate: (update: { sessionFile: string }) => {
      transcriptListener?.(update);
    },
  };
}

describe("OpenClawSessionRuntime", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-runtime-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("persists lifecycle state, flags interrupted sessions, and requests startup recovery", async () => {
    const transcriptsDir = path.join(tempDir, "transcripts");
    const transcriptFile = path.join(transcriptsDir, "sess_1.json");
    const sessionStorePath = path.join(tempDir, "sessions.json");
    const runtimeStorePath = path.join(tempDir, "session-runtime.json");

    const loadSessionEntryMock = vi.fn(() => ({
      storePath: sessionStorePath,
      entry: {
        sessionId: "sess_1",
        sessionFile: transcriptFile,
      },
    }));

    const firstSubscribers = createRuntimeSubscribers();
    const firstRuntime = new OpenClawSessionRuntime({
      storePath: runtimeStorePath,
      persistDelayMs: 0,
      autoRecoverOnStart: false,
      loadSessionEntry: loadSessionEntryMock as any,
      subscribeToAgentEvents: firstSubscribers.subscribeToAgentEvents,
      subscribeToTranscriptUpdates: firstSubscribers.subscribeToTranscriptUpdates,
    });

    await firstRuntime.ensureStarted();
    firstSubscribers.emitAgentEvent({
      runId: "run_1",
      seq: 1,
      stream: "lifecycle",
      ts: 100,
      sessionKey: "Agent:Main:Main",
      data: { phase: "start" },
    });
    firstSubscribers.emitTranscriptUpdate({ sessionFile: transcriptFile });

    expect(firstRuntime.getSession("agent:main:main")).toMatchObject({
      sessionKey: "agent:main:main",
      sessionId: "sess_1",
      sessionFile: transcriptFile,
      status: "active",
      activeRunIds: ["run_1"],
      lastTranscriptFile: transcriptFile,
      eventCount: 1,
    });

    firstRuntime.stop();

    const requestHeartbeatNowMock = vi.fn();
    const secondSubscribers = createRuntimeSubscribers();
    const secondRuntime = new OpenClawSessionRuntime({
      storePath: runtimeStorePath,
      persistDelayMs: 0,
      autoRecoverOnStart: true,
      loadSessionEntry: loadSessionEntryMock as any,
      requestHeartbeatNow: requestHeartbeatNowMock as any,
      subscribeToAgentEvents: secondSubscribers.subscribeToAgentEvents,
      subscribeToTranscriptUpdates: secondSubscribers.subscribeToTranscriptUpdates,
    });

    expect(secondRuntime.getSession("agent:main:main")).toMatchObject({
      status: "interrupted",
      pendingRecoveryRunIds: ["run_1"],
      activeRunIds: [],
    });

    await secondRuntime.ensureStarted();

    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({
      reason: "session-runtime:startup-recovery",
      coalesceMs: 0,
      sessionKey: "agent:main:main",
    });
    expect(secondRuntime.getSession("agent:main:main")?.status).toBe("recovery-requested");

    secondSubscribers.emitAgentEvent({
      runId: "run_2",
      seq: 1,
      stream: "lifecycle",
      ts: 200,
      sessionKey: "agent:main:main",
      data: { phase: "start" },
    });

    expect(secondRuntime.getSession("agent:main:main")).toMatchObject({
      status: "active",
      activeRunIds: ["run_2"],
      pendingRecoveryRunIds: [],
      recoveredAtMs: 200,
    });
    secondRuntime.stop();
  });

  it("tracks idle and error transitions and supports filtered listing", async () => {
    const subscribers = createRuntimeSubscribers();
    const testedRuntime = new OpenClawSessionRuntime({
      storePath: path.join(tempDir, "session-runtime-filtered.json"),
      persistDelayMs: 0,
      autoRecoverOnStart: false,
      loadSessionEntry: (() => ({ storePath: path.join(tempDir, "sessions.json"), entry: undefined })) as any,
      subscribeToAgentEvents: subscribers.subscribeToAgentEvents,
      subscribeToTranscriptUpdates: subscribers.subscribeToTranscriptUpdates,
    });

    await testedRuntime.ensureStarted();
    subscribers.emitAgentEvent({
      runId: "run_ok",
      seq: 1,
      stream: "lifecycle",
      ts: 100,
      sessionKey: "agent:main:main",
      data: { phase: "start" },
    });
    subscribers.emitAgentEvent({
      runId: "run_ok",
      seq: 2,
      stream: "lifecycle",
      ts: 120,
      sessionKey: "agent:main:main",
      data: { phase: "end" },
    });

    expect(testedRuntime.getSession("agent:main:main")).toMatchObject({
      status: "idle",
      activeRunIds: [],
    });

    subscribers.emitAgentEvent({
      runId: "run_error",
      seq: 3,
      stream: "lifecycle",
      ts: 130,
      sessionKey: "agent:main:secondary",
      data: { phase: "error", error: "boom" },
    });

    expect(testedRuntime.getSession("agent:main:secondary")).toMatchObject({
      status: "error",
      lastError: "boom",
    });
    expect(testedRuntime.listSessions({ status: "error" }).sessions).toHaveLength(1);
    expect(testedRuntime.listSessions({ query: "secondary" }).sessions[0]?.sessionKey).toBe(
      "agent:main:secondary",
    );

    testedRuntime.stop();
  });
});
