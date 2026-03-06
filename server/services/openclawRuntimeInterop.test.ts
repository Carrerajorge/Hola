import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onAgentEvent as onOpenClawAgentEvent,
  resetAgentRunContextForTest as resetOpenClawAgentEvents,
} from "../openclaw/src/infra/agent-events";
import {
  emitAgentEvent as emitSuperIntelligenceAgentEvent,
  registerAgentRunContext as registerSuperIntelligenceAgentRunContext,
  resetAgentRunContextForTest as resetSuperIntelligenceAgentEvents,
} from "./superIntelligence/infra/agent-events";
import {
  onSessionTranscriptUpdate as onOpenClawSessionTranscriptUpdate,
} from "../openclaw/src/sessions/transcript-events";
import {
  emitSessionTranscriptUpdate as emitSuperIntelligenceTranscriptUpdate,
} from "./superIntelligence/sessions/transcript-events";
import {
  resetHeartbeatWakeStateForTests as resetOpenClawHeartbeatWakeState,
  setHeartbeatWakeHandler as setOpenClawHeartbeatWakeHandler,
} from "../openclaw/src/infra/heartbeat-wake";
import {
  requestHeartbeatNow as requestSuperIntelligenceHeartbeatNow,
  resetHeartbeatWakeStateForTests as resetSuperIntelligenceHeartbeatWakeState,
} from "./superIntelligence/infra/heartbeat-wake";

describe("openclaw runtime interop", () => {
  beforeEach(() => {
    resetOpenClawAgentEvents();
    resetSuperIntelligenceAgentEvents();
    resetOpenClawHeartbeatWakeState();
    resetSuperIntelligenceHeartbeatWakeState();
  });

  afterEach(() => {
    resetOpenClawAgentEvents();
    resetSuperIntelligenceAgentEvents();
    resetOpenClawHeartbeatWakeState();
    resetSuperIntelligenceHeartbeatWakeState();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delivers superIntelligence agent events to openclaw listeners", () => {
    const seen: Array<{ runId: string; sessionKey?: string; seq: number }> = [];
    const stop = onOpenClawAgentEvent((evt) => {
      seen.push({
        runId: evt.runId,
        sessionKey: evt.sessionKey,
        seq: evt.seq,
      });
    });

    registerSuperIntelligenceAgentRunContext("run-interop", {
      sessionKey: "agent:main:main",
    });
    emitSuperIntelligenceAgentEvent({
      runId: "run-interop",
      stream: "lifecycle",
      data: { phase: "start" },
    });
    stop();

    expect(seen).toEqual([
      {
        runId: "run-interop",
        sessionKey: "agent:main:main",
        seq: 1,
      },
    ]);
  });

  it("delivers transcript updates across both runtime trees", () => {
    const updates: string[] = [];
    const stop = onOpenClawSessionTranscriptUpdate((update) => {
      updates.push(update.sessionFile);
    });

    emitSuperIntelligenceTranscriptUpdate("/tmp/interop-session.json");
    stop();

    expect(updates).toEqual(["/tmp/interop-session.json"]);
  });

  it("runs heartbeats requested from superIntelligence through the openclaw handler", async () => {
    vi.useFakeTimers();
    const handler = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const dispose = setOpenClawHeartbeatWakeHandler(handler);

    requestSuperIntelligenceHeartbeatNow({
      reason: "interop",
      coalesceMs: 0,
      sessionKey: "agent:main:main",
    });

    await vi.advanceTimersByTimeAsync(1);
    dispose();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      reason: "interop",
      sessionKey: "agent:main:main",
    });
  });
});
