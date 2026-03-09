import { beforeEach, describe, expect, it, vi } from "vitest";

const runCommandWithTimeoutMock = vi.hoisted(() => vi.fn());
const requestHeartbeatNowMock = vi.hoisted(() => vi.fn());
const onAgentEventMock = vi.hoisted(() => vi.fn(() => () => {}));
const onSessionTranscriptUpdateMock = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock("../../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

vi.mock("../../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: (...args: unknown[]) => requestHeartbeatNowMock(...args),
}));

vi.mock("../../infra/agent-events.js", () => ({
  onAgentEvent: (...args: unknown[]) => onAgentEventMock(...args),
}));

vi.mock("../../sessions/transcript-events.js", () => ({
  onSessionTranscriptUpdate: (...args: unknown[]) => onSessionTranscriptUpdateMock(...args),
}));

import { createPluginRuntime } from "./index.js";

describe("plugin runtime command execution", () => {
  beforeEach(() => {
    runCommandWithTimeoutMock.mockClear();
    requestHeartbeatNowMock.mockClear();
    onAgentEventMock.mockClear();
    onSessionTranscriptUpdateMock.mockClear();
  });

  it("exposes runtime.system.runCommandWithTimeout by default", async () => {
    const commandResult = {
      stdout: "hello\n",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
      termination: "exit" as const,
    };
    runCommandWithTimeoutMock.mockResolvedValue(commandResult);

    const runtime = createPluginRuntime();
    await expect(
      runtime.system.runCommandWithTimeout(["echo", "hello"], { timeoutMs: 1000 }),
    ).resolves.toEqual(commandResult);
    expect(runCommandWithTimeoutMock).toHaveBeenCalledWith(["echo", "hello"], { timeoutMs: 1000 });
  });

  it("forwards runtime.system.runCommandWithTimeout errors", async () => {
    runCommandWithTimeoutMock.mockRejectedValue(new Error("boom"));
    const runtime = createPluginRuntime();
    await expect(
      runtime.system.runCommandWithTimeout(["echo", "hello"], { timeoutMs: 1000 }),
    ).rejects.toThrow("boom");
    expect(runCommandWithTimeoutMock).toHaveBeenCalledWith(["echo", "hello"], { timeoutMs: 1000 });
  });

  it("exposes heartbeat and runtime event bridges", () => {
    const runtime = createPluginRuntime();
    const agentListener = vi.fn();
    const transcriptListener = vi.fn();

    runtime.system.requestHeartbeatNow({ reason: "plugin:test", sessionKey: "agent:main:main" });
    runtime.events.onAgentEvent(agentListener);
    runtime.events.onSessionTranscriptUpdate(transcriptListener);

    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({
      reason: "plugin:test",
      sessionKey: "agent:main:main",
    });
    expect(onAgentEventMock).toHaveBeenCalledWith(agentListener);
    expect(onSessionTranscriptUpdateMock).toHaveBeenCalledWith(transcriptListener);
  });
});
