import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { decodeStrictBase64, spawnSubagentDirect } from "./subagent-spawn.js";

const callGatewayMock = vi.fn();

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: Record<string, unknown> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
  tools: {
    sessions_spawn: {
      attachments: {
        enabled: true,
        maxFiles: 50,
        maxFileBytes: 1 * 1024 * 1024,
        maxTotalBytes: 5 * 1024 * 1024,
      },
    },
  },
  agents: {
    defaults: {
      workspace: os.tmpdir(),
    },
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
  };
});

vi.mock("./subagent-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-registry.js")>();
  return {
    ...actual,
    countActiveRunsForSession: () => 0,
    registerSubagentRun: () => {},
  };
});

vi.mock("./subagent-announce.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-announce.js")>();
  return {
    ...actual,
    buildSubagentSystemPrompt: () => "system-prompt",
  };
});

vi.mock("./agent-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-scope.js")>();
  return {
    ...actual,
    resolveAgentWorkspaceDir: () => path.join(os.tmpdir(), "agent-workspace"),
    resolveAgentConfig: () => undefined,
  };
});

vi.mock("./subagent-depth.js", () => ({
  getSubagentDepthFromSessionStore: () => 0,
}));

vi.mock("./sandbox/runtime-status.js", () => ({
  resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({ hasHooks: () => false }),
}));

function setupGatewayMock() {
  callGatewayMock.mockImplementation(async (opts: { method?: string }) => {
    if (opts.method === "sessions.patch") {
      return { ok: true };
    }
    if (opts.method === "sessions.delete") {
      return { ok: true };
    }
    if (opts.method === "agent") {
      return { runId: "run-1" };
    }
    return {};
  });
}

describe("decodeStrictBase64", () => {
  const maxBytes = 1024;

  it("returns a buffer for valid base64", () => {
    const encoded = Buffer.from("hello world").toString("base64");
    const result = decodeStrictBase64(encoded, maxBytes);
    expect(result?.toString("utf8")).toBe("hello world");
  });

  it("rejects malformed and oversized payloads", () => {
    expect(decodeStrictBase64("", maxBytes)).toBeNull();
    expect(decodeStrictBase64("abc", maxBytes)).toBeNull();
    expect(decodeStrictBase64("!@#$", maxBytes)).toBeNull();
    expect(decodeStrictBase64("A".repeat(2737), maxBytes)).toBeNull();
    expect(decodeStrictBase64(Buffer.alloc(1025, 0x42).toString("base64"), maxBytes)).toBeNull();
  });
});

describe("spawnSubagentDirect attachment filename validation", () => {
  const ctx = {
    agentSessionKey: "agent:main:main",
    agentChannel: "telegram" as const,
    agentAccountId: "123",
    agentTo: "456",
  };
  const validContent = Buffer.from("hello").toString("base64");

  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockClear();
    setupGatewayMock();
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      tools: {
        sessions_spawn: {
          attachments: {
            enabled: true,
            maxFiles: 50,
            maxFileBytes: 1 * 1024 * 1024,
            maxTotalBytes: 5 * 1024 * 1024,
          },
        },
      },
      agents: {
        defaults: {
          workspace: os.tmpdir(),
        },
      },
    };
  });

  async function spawnWithName(name: string) {
    return spawnSubagentDirect(
      {
        task: "test",
        attachments: [{ name, content: validContent, encoding: "base64" }],
      },
      ctx,
    );
  }

  it("rejects invalid names and duplicates", async () => {
    await expect(spawnWithName("foo/bar")).resolves.toMatchObject({
      status: "error",
      error: expect.stringMatching(/attachments_invalid_name/),
    });
    await expect(spawnWithName("..")).resolves.toMatchObject({
      status: "error",
      error: expect.stringMatching(/attachments_invalid_name/),
    });
    await expect(spawnWithName(".manifest.json")).resolves.toMatchObject({
      status: "error",
      error: expect.stringMatching(/attachments_invalid_name/),
    });
    await expect(spawnWithName("foo\nbar")).resolves.toMatchObject({
      status: "error",
      error: expect.stringMatching(/attachments_invalid_name/),
    });
    await expect(spawnWithName("")).resolves.toMatchObject({
      status: "error",
      error: expect.stringMatching(/attachments_invalid_name/),
    });

    const duplicate = await spawnSubagentDirect(
      {
        task: "test",
        attachments: [
          { name: "file.txt", content: validContent, encoding: "base64" },
          { name: "file.txt", content: validContent, encoding: "base64" },
        ],
      },
      ctx,
    );
    expect(duplicate).toMatchObject({
      status: "error",
      error: expect.stringMatching(/attachments_duplicate_name/),
    });
  });
});
