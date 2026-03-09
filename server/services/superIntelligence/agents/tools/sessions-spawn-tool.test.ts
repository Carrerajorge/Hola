import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const spawnSubagentDirectMock = vi.fn();
  const spawnAcpDirectMock = vi.fn();
  return {
    spawnSubagentDirectMock,
    spawnAcpDirectMock,
  };
});

vi.mock("../subagent-spawn.js", () => ({
  SUBAGENT_SPAWN_MODES: ["run", "session"],
  spawnSubagentDirect: (...args: unknown[]) => hoisted.spawnSubagentDirectMock(...args),
}));

vi.mock("../acp-spawn.js", () => ({
  ACP_SPAWN_MODES: ["run", "session"],
  spawnAcpDirect: (...args: unknown[]) => hoisted.spawnAcpDirectMock(...args),
}));

const { createSessionsSpawnTool } = await import("./sessions-spawn-tool.js");

describe("sessions_spawn tool", () => {
  beforeEach(() => {
    hoisted.spawnSubagentDirectMock.mockReset().mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:subagent:1",
      runId: "run-subagent",
    });
    hoisted.spawnAcpDirectMock.mockReset().mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:codex:acp:1",
      runId: "run-acp",
    });
  });

  it("uses subagent runtime by default and forwards attachments/sandbox", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
      agentAccountId: "default",
      agentTo: "channel:123",
      agentThreadId: "456",
    });

    const result = await tool.execute("call-1", {
      task: "build feature",
      agentId: "main",
      model: "anthropic/claude-sonnet-4-6",
      thinking: "medium",
      runTimeoutSeconds: 5,
      thread: true,
      mode: "session",
      cleanup: "keep",
      sandbox: "require",
      attachments: [{ name: "brief.md", content: "hello", encoding: "utf8" }],
      attachAs: { mountPath: "/work/briefs" },
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      childSessionKey: "agent:main:subagent:1",
      runId: "run-subagent",
    });
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "build feature",
        agentId: "main",
        model: "anthropic/claude-sonnet-4-6",
        thinking: "medium",
        runTimeoutSeconds: 5,
        thread: true,
        mode: "session",
        cleanup: "keep",
        sandbox: "require",
        attachments: [{ name: "brief.md", content: "hello", encoding: "utf8" }],
        attachMountPath: "/work/briefs",
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
      }),
    );
    expect(hoisted.spawnAcpDirectMock).not.toHaveBeenCalled();
  });

  it("routes to ACP runtime when runtime=acp", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
      sandboxed: true,
    });

    const result = await tool.execute("call-2", {
      runtime: "acp",
      task: "investigate the failing CI run",
      agentId: "codex",
      cwd: "/workspace",
      thread: true,
      mode: "session",
      sandbox: "require",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      childSessionKey: "agent:codex:acp:1",
      runId: "run-acp",
    });
    expect(hoisted.spawnAcpDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "investigate the failing CI run",
        agentId: "codex",
        cwd: "/workspace",
        thread: true,
        mode: "session",
        sandbox: "require",
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
        sandboxed: true,
      }),
    );
  });

  it("rejects attachments for ACP runtime", async () => {
    const tool = createSessionsSpawnTool({
      agentSessionKey: "agent:main:main",
    });

    const result = await tool.execute("call-3", {
      runtime: "acp",
      task: "analyze file",
      attachments: [{ name: "a.txt", content: "hello", encoding: "utf8" }],
    });

    expect(result.details).toMatchObject({ status: "error" });
    expect((result.details as { error?: string }).error).toContain(
      "attachments are currently unsupported for runtime=acp",
    );
    expect(hoisted.spawnAcpDirectMock).not.toHaveBeenCalled();
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });
});
