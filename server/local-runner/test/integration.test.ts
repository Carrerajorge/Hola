import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { afterEach, describe, expect, it } from "vitest";

type CliRun = {
  code: number;
  stdout: string;
  stderr: string;
};

const runnerRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(runnerRoot, "src", "cli.ts");

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.remove(dir);
    }
  }
});

describe("iliagpt-run integration", () => {
  it("blocks paths outside workspace", async () => {
    const workspace = await mkWorkspace();
    const outsideFile = path.join(path.dirname(workspace), "outside.txt");
    await fs.writeFile(outsideFile, "secret", "utf-8");

    const planPath = path.join(workspace, "plan.json");
    await writePlan(planPath, {
      runId: "run-block-path",
      steps: [
        {
          id: "read-outside",
          type: "read_file",
          args: { path: "../outside.txt" },
        },
      ],
    });

    const result = await runCli(["--plan", planPath, "--workspace", workspace, "--yes"]);
    expect(result.code).toBe(1);

    const resultsJson = await fs.readJson(
      path.join(workspace, ".iliagpt", "runs", "run-block-path", "results.json"),
    );
    expect(resultsJson.steps["read-outside"].result.status).toBe("error");
    expect(resultsJson.steps["read-outside"].result.error).toContain("outside of workspace");
  });

  it("blocks command not in allowlist", async () => {
    const workspace = await mkWorkspace();
    const planPath = path.join(workspace, "plan.json");

    await writePlan(planPath, {
      runId: "run-block-command",
      steps: [
        {
          id: "blocked-cmd",
          type: "run_command_allowlisted",
          args: { command: "uname -a" },
        },
      ],
    });

    const result = await runCli(["--plan", planPath, "--workspace", workspace, "--yes"]);
    expect(result.code).toBe(1);

    const resultsJson = await fs.readJson(
      path.join(workspace, ".iliagpt", "runs", "run-block-command", "results.json"),
    );
    expect(resultsJson.steps["blocked-cmd"].result.error).toContain("allowlist");
  });

  it("asks confirmation for dangerous commands", async () => {
    const workspace = await mkWorkspace();
    const planPath = path.join(workspace, "plan.json");
    const allowlistPath = path.join(workspace, "allowlist.json");

    await fs.writeJson(
      allowlistPath,
      {
        commands: ["rm"],
        dangerous: ["rm"],
      },
      { spaces: 2 },
    );

    await writePlan(planPath, {
      runId: "run-confirm",
      steps: [
        {
          id: "dangerous-cmd",
          type: "run_command_allowlisted",
          args: { command: "rm -rf demo.txt" },
        },
      ],
    });

    const result = await runCli(
      ["--plan", planPath, "--workspace", workspace, "--allowlist", allowlistPath],
      "n\n",
    );

    expect(result.code).toBe(1);
    const resultsJson = await fs.readJson(
      path.join(workspace, ".iliagpt", "runs", "run-confirm", "results.json"),
    );
    expect(resultsJson.steps["dangerous-cmd"].result.error).toContain("rejected by user");
  });

  it("respects timeout and max-output limits", async () => {
    const workspace = await mkWorkspace();
    const largeFile = path.join(workspace, "large.txt");
    await fs.writeFile(largeFile, "x".repeat(5000), "utf-8");

    const allowlistPath = path.join(workspace, "allowlist.json");
    await fs.writeJson(
      allowlistPath,
      {
        commands: ["sleep"],
        dangerous: [],
      },
      { spaces: 2 },
    );

    const planPath = path.join(workspace, "plan.json");
    await writePlan(planPath, {
      runId: "run-limits",
      steps: [
        {
          id: "read-large",
          type: "read_file",
          args: { path: "large.txt" },
        },
        {
          id: "timeout-cmd",
          type: "run_command_allowlisted",
          args: { command: "sleep 2", timeoutMs: 100 },
        },
      ],
    });

    const result = await runCli([
      "--plan",
      planPath,
      "--workspace",
      workspace,
      "--allowlist",
      allowlistPath,
      "--yes",
      "--max-output-bytes",
      "100",
    ]);

    expect(result.code).toBe(1);

    const resultsJson = await fs.readJson(
      path.join(workspace, ".iliagpt", "runs", "run-limits", "results.json"),
    );

    expect(resultsJson.steps["read-large"].result.meta.truncated).toBe(true);
    expect(String(resultsJson.steps["read-large"].result.output).length).toBeLessThanOrEqual(100);
    expect(resultsJson.steps["timeout-cmd"].result.error).toContain("timed out");
  });

  it("creates logs and keeps idempotency by runId+step", async () => {
    const workspace = await mkWorkspace();
    const planPath = path.join(workspace, "plan.json");
    const runId = "run-idempotent";

    await writePlan(planPath, {
      runId,
      steps: [
        {
          id: "write-version",
          type: "write_file",
          args: { path: "state.txt", content: "v1" },
        },
      ],
    });

    const first = await runCli(["--plan", planPath, "--workspace", workspace, "--yes"]);
    expect(first.code).toBe(0);
    expect(await fs.readFile(path.join(workspace, "state.txt"), "utf-8")).toBe("v1");

    await writePlan(planPath, {
      runId,
      steps: [
        {
          id: "write-version",
          type: "write_file",
          args: { path: "state.txt", content: "v2" },
        },
      ],
    });

    const second = await runCli(["--plan", planPath, "--workspace", workspace, "--yes"]);
    expect(second.code).toBe(0);

    const state = await fs.readFile(path.join(workspace, "state.txt"), "utf-8");
    expect(state).toBe("v1");

    const summary = JSON.parse(second.stdout);
    expect(summary.ok).toBe(1);

    const logPath = path.join(workspace, ".iliagpt", "logs", `${runId}.jsonl`);
    expect(await fs.pathExists(logPath)).toBe(true);
    const lines = (await fs.readFile(logPath, "utf-8")).trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("streams JSONL events when --stream is enabled", async () => {
    const workspace = await mkWorkspace();
    const planPath = path.join(workspace, "plan.json");

    await writePlan(planPath, {
      runId: "run-stream",
      steps: [
        {
          id: "list",
          type: "list_dir",
          args: { path: "." },
        },
      ],
    });

    const result = await runCli(["--plan", planPath, "--workspace", workspace, "--yes", "--stream"]);
    expect(result.code).toBe(0);

    const events = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("run_started");
    expect(eventTypes).toContain("step_started");
    expect(eventTypes).toContain("step_result");
    expect(eventTypes).toContain("run_finished");
  });
});

async function mkWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "iliagpt-runner-test-"));
  tmpDirs.push(dir);
  return dir;
}

async function writePlan(target: string, value: Record<string, unknown>): Promise<void> {
  await fs.writeJson(target, value, { spaces: 2 });
}

function runCli(args: string[], stdinData?: string): Promise<CliRun> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register", cliEntry, ...args],
      {
        cwd: runnerRoot,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (stdinData !== undefined) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}
