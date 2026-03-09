import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHeartbeatWakeStateForTests } from "../openclaw/src/infra/heartbeat-wake";
import { OpenClawTaskRuntime } from "./openclawTaskRuntime";

async function removeDirWithRetry(target: string, attempts = 5) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

describe("OpenClawTaskRuntime", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-runtime-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    resetHeartbeatWakeStateForTests();
    await removeDirWithRetry(tempDir);
  });

  it("normalizes and runs a background agent job", async () => {
    const spawn = vi.fn(() => ({
      id: "sub_1",
      objective: "investigar pipeline",
      status: "queued",
    }));
    const runtime = new OpenClawTaskRuntime({
      storePath: path.join(tempDir, "jobs.json"),
      subagentService: { spawn },
    });
    try {
      await runtime.ensureStarted();
      const job = await runtime.addJobFromInput({
        schedule: { kind: "every", everyMs: 60_000 },
        payload: { kind: "agentTurn", message: "investigar pipeline" },
      });

      expect(job.sessionTarget).toBe("isolated");
      expect(job.wakeMode).toBe("now");
      expect(job.name.length).toBeGreaterThan(0);

      const result = await runtime.runJob(job.id, { mode: "force" });
      expect(result.ok).toBe(true);
      expect(result.ran).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          objective: "investigar pipeline",
        }),
      );

      const runs = await runtime.listRuns({ jobId: job.id, scope: "job" });
      expect(runs.total).toBe(1);
      expect(runs.entries[0]?.status).toBe("ok");
    } finally {
      await runtime.stop();
    }
  });

  it("fires recurring jobs on the internal scheduler", async () => {
    const spawn = vi.fn(() => ({
      id: `sub_${spawn.mock.calls.length + 1}`,
      objective: "chequear sitio",
      status: "queued",
    }));
    const runtime = new OpenClawTaskRuntime({
      storePath: path.join(tempDir, "jobs.json"),
      subagentService: { spawn },
    });
    try {
      await runtime.ensureStarted();
      await runtime.addJobFromInput({
        schedule: { kind: "every", everyMs: 25 },
        payload: { kind: "agentTurn", message: "chequear sitio" },
      });

      await new Promise((resolve) => setTimeout(resolve, 90));
      expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await runtime.stop();
    }
  });

  it("dispatches next-heartbeat wakes through the heartbeat runtime", async () => {
    const spawn = vi.fn((params: any) => ({
      id: `sub_${spawn.mock.calls.length + 1}`,
      objective: params.objective,
      status: "queued",
    }));
    const runtime = new OpenClawTaskRuntime({
      storePath: path.join(tempDir, "jobs.json"),
      subagentService: { spawn },
      heartbeatsEnabled: true,
      heartbeatIntervalMs: 60_000,
    });
    try {
      await runtime.ensureStarted();

      const wake = await runtime.wake({
        mode: "next-heartbeat",
        text: "supervisar pipeline nocturno",
      });
      expect(wake.queued).toBe(true);

      const before = await runtime.getHeartbeatStatus();
      expect(before.pendingWakeEvents).toBe(1);
      expect(before.handlerAttached).toBe(true);

      const result = await runtime.runHeartbeatNow({ reason: "test:manual" });
      expect(result.status).toBe("ran");
      expect(result.heartbeat.pendingWakeEvents).toBe(0);
      expect(result.heartbeat.processedWakeEvents).toBe(1);
      expect(spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          objective: "supervisar pipeline nocturno",
        }),
      );

      const wakes = await runtime.listWakeEvents(10);
      expect(wakes.events[0]?.spawnedRunId).toBeTruthy();
      expect(wakes.events[0]?.dispatchedAtMs).toBeTypeOf("number");
    } finally {
      await runtime.stop();
    }
  });
});
