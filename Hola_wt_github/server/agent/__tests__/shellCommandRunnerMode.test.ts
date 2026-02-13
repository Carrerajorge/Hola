import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

function startMockRunner(token: string) {
  const app = express();
  app.use(express.json());

  app.post("/v1/shell/run", (req, res) => {
    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${token}`) return res.status(403).json({ error: "FORBIDDEN" });
    const { runId } = req.body || {};
    return res.json({ jobId: `job-${runId}`, streamUrl: `/v1/shell/stream/job-${runId}` });
  });

  app.get("/v1/shell/stream/:jobId", (req, res) => {
    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${token}`) return res.status(403).json({ error: "FORBIDDEN" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");

    res.write(`event: shell\n`);
    res.write(`data: ${JSON.stringify({ type: "stdout", chunk: "hello" })}\n\n`);

    res.write(`event: shell\n`);
    res.write(`data: ${JSON.stringify({ type: "exit", exitCode: 0, signal: null, wasKilled: false, durationMs: 5 })}\n\n`);

    res.write(`event: done\n`);
    res.write(`data: {}\n\n`);
    res.end();
  });

  const server = http.createServer(app);
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("shell_command runner mode", () => {
  const token = "test-token";
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    const started = await startMockRunner(token);
    server = started.server;
    port = started.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it(
    "should stream via runner when SHELL_COMMAND_SANDBOX_MODE=runner",
    async () => {
      const prevMode = process.env.SHELL_COMMAND_SANDBOX_MODE;
    const prevUrl = process.env.SHELL_COMMAND_RUNNER_URL;
    const prevTok = process.env.SHELL_COMMAND_RUNNER_TOKEN;

    process.env.SHELL_COMMAND_SANDBOX_MODE = "runner";
    process.env.SHELL_COMMAND_RUNNER_URL = `http://127.0.0.1:${port}`;
    process.env.SHELL_COMMAND_RUNNER_TOKEN = token;

    // force re-import so toolRegistry sees env
    vi.resetModules();
    const { toolRegistry } = await import("../toolRegistry");

    const chunks: any[] = [];
    let exit: any = null;

    const res = await toolRegistry.execute(
      "shell_command",
      // In CI/loaded environments this can take a bit longer than 5s.
      { command: "echo hello", timeout: 15000 },
      {
        userId: "u1",
        chatId: "c1",
        runId: "run-test-runner",
        userPlan: "admin",
        isConfirmed: true,
        onStream: (evt) => chunks.push(evt),
        onExit: (evt) => {
          exit = evt;
        },
      }
    );

    expect(res.success).toBe(true);
    expect(res.output?.stdout).toContain("hello");
    expect(chunks.length).toBeGreaterThan(0);
    expect(exit?.exitCode).toBe(0);

    // restore env (avoid leaking to other suites)
    if (prevMode === undefined) delete process.env.SHELL_COMMAND_SANDBOX_MODE;
    else process.env.SHELL_COMMAND_SANDBOX_MODE = prevMode;

    if (prevUrl === undefined) delete process.env.SHELL_COMMAND_RUNNER_URL;
    else process.env.SHELL_COMMAND_RUNNER_URL = prevUrl;

    if (prevTok === undefined) delete process.env.SHELL_COMMAND_RUNNER_TOKEN;
    else process.env.SHELL_COMMAND_RUNNER_TOKEN = prevTok;
  },
  20000);
});
