import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProcessSessionFixture } from "../openclaw/src/agents/bash-process-registry.test-helpers.ts";
import {
  addSession,
  appendOutput,
  resetProcessRegistryForTests,
} from "../openclaw/src/agents/bash-process-registry.ts";
import { OpenClawProcessRuntime } from "./openclawProcessRuntime";

describe("OpenClawProcessRuntime", () => {
  const runtime = new OpenClawProcessRuntime();

  beforeEach(() => {
    resetProcessRegistryForTests();
  });

  it("lists, polls, and writes to background sessions", async () => {
    const stdin = {
      write: vi.fn((data: string, cb?: (err?: Error | null) => void) => cb?.(null)),
      end: vi.fn(),
    };
    const session = createProcessSessionFixture({
      id: "sess_1",
      command: "npm run dev",
      backgrounded: true,
      pid: 1234,
    });
    session.stdin = stdin;
    addSession(session);
    appendOutput(session, "stdout", "server ready\n");

    const listed = runtime.listSessions();
    expect(listed.count).toBe(1);
    expect(listed.sessions[0]?.sessionId).toBe("sess_1");

    const polled = await runtime.pollSession("sess_1");
    expect(polled.status).toBe("running");
    expect(polled.output).toContain("server ready");

    const written = await runtime.writeToSession("sess_1", "status\n", true);
    expect(written.status).toBe("running");
    expect(stdin.write).toHaveBeenCalledWith("status\n", expect.any(Function));
    expect(stdin.end).toHaveBeenCalled();
  });
});
