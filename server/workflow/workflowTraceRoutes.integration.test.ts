import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, Server } from "http";

import { createWorkflowTraceRouter, registerDefaultWorkflowExecutors } from "../routes/workflowTraceRoutes";
import { ensureWorkflowTraceSchema } from "./schemaSetup";
import { WorkflowStore } from "./store";
import { WorkflowTraceStreamHub } from "./streaming";
import { buildPlan, deleteRunCascade, ensureTestChat, makeId, waitForRunTerminal } from "./testUtils";
import { InMemoryStepExecutorRegistry, WorkflowRunner } from "./workflowRunner";

function parseSseBlock(block: string) {
  const lines = block.split("\n");
  let id: number | null = null;
  let event: string | null = null;
  let dataText = "";

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      const parsed = Number(line.slice(3).trim());
      id = Number.isFinite(parsed) ? parsed : null;
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataText += `${line.slice(5).trim()}\n`;
    }
  }

  if (!event && !dataText.trim()) {
    return null;
  }

  let data: any = null;
  if (dataText.trim()) {
    try {
      data = JSON.parse(dataText.trim());
    } catch {
      data = dataText.trim();
    }
  }

  return {
    id,
    event,
    data,
  };
}

async function consumeSse(
  url: string,
  options: {
    untilTerminal?: boolean;
    maxEvents?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxEvents = options.maxEvents ?? Number.POSITIVE_INFINITY;
  const untilTerminal = Boolean(options.untilTerminal);
  const terminalEvents = new Set(["run_completed", "run_failed", "run_cancelled"]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

  const response = await fetch(url, {
    headers: {
      Accept: "text/event-stream",
      ...(options.headers || {}),
    },
    signal: controller.signal,
  });

  if (!response.ok) {
    clearTimeout(timeout);
    throw new Error(`SSE request failed with ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ id: number | null; event: string | null; data: any }> = [];
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const parsed = parseSseBlock(block);
        if (parsed) {
          events.push(parsed);
          if ((untilTerminal && parsed.event && terminalEvents.has(parsed.event)) || events.length >= maxEvents) {
            controller.abort("done");
            break;
          }
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    events,
  };
}

describe("workflowTraceRoutes integration", () => {
  let server: Server;
  let baseUrl: string;
  let streamHub: WorkflowTraceStreamHub;
  const createdRuns: string[] = [];

  beforeAll(async () => {
    process.env.WORKFLOW_REPRO = "1";
    process.env.NODE_ENV = "test";
    await ensureWorkflowTraceSchema();

    const app = express();
    app.use(express.json());

    const store = new WorkflowStore();
    const registry = new InMemoryStepExecutorRegistry();
    registerDefaultWorkflowExecutors(registry);
    const runner = new WorkflowRunner(store, registry);
    streamHub = new WorkflowTraceStreamHub(store);

    app.use(
      "/api/run-traces",
      createWorkflowTraceRouter({
        store,
        runner,
        streamHub,
      }),
    );

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind integration server");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    while (createdRuns.length > 0) {
      const runId = createdRuns.pop();
      if (runId) {
        await deleteRunCascade(runId);
      }
    }
  });

  afterAll(async () => {
    streamHub.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("runs workflow with retries and persists ordered events/artifacts", async () => {
    const chatId = makeId("chat-route-success");
    await ensureTestChat(chatId);

    const postResponse = await fetch(`${baseUrl}/api/run-traces/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chatId,
        idempotencyKey: makeId("idem-route-success"),
        plan: buildPlan(),
      }),
    });

    expect(postResponse.status).toBe(201);
    const body = await postResponse.json();
    const runId = body.runId as string;
    createdRuns.push(runId);

    const sse = await consumeSse(`${baseUrl}/api/run-traces/runs/${runId}/stream`, {
      untilTerminal: true,
      timeoutMs: 25_000,
    });

    const terminal = [...sse.events].reverse().find((event) => ["run_completed", "run_failed", "run_cancelled"].includes(event.event || ""));
    expect(terminal?.event).toBe("run_completed");

    const runResponse = await fetch(`${baseUrl}/api/run-traces/runs/${runId}`);
    expect(runResponse.status).toBe(200);
    const runBody = await runResponse.json();
    expect(runBody.status).toBe("completed");
    expect(Array.isArray(runBody.artifacts)).toBe(true);
    expect(runBody.artifacts.length).toBeGreaterThan(0);

    const eventsResponse = await fetch(`${baseUrl}/api/run-traces/runs/${runId}/events?order=asc&limit=200`);
    expect(eventsResponse.status).toBe(200);
    const eventsBody = await eventsResponse.json();

    const seqs = eventsBody.events.map((event: any) => event.eventSeq);
    const sorted = [...seqs].sort((a: number, b: number) => a - b);
    expect(seqs).toEqual(sorted);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(eventsBody.events.some((event: any) => event.eventType === "step_retried")).toBe(true);
  });

  it("supports cancellation and emits run_cancelled", async () => {
    const chatId = makeId("chat-route-cancel");
    await ensureTestChat(chatId);

    const cancelPlan = {
      objective: "cancel flow",
      concurrency: 1,
      steps: [
        {
          id: "slow",
          name: "Slow",
          toolName: "sleep",
          executorKey: "sleep",
          input: { delayMs: 1200 },
          retryPolicy: { attempts: 1, backoffMs: 0 },
        },
        {
          id: "after",
          name: "After",
          toolName: "noop",
          executorKey: "noop",
          dependencies: ["slow"],
          retryPolicy: { attempts: 1, backoffMs: 0 },
        },
      ],
    };

    const postResponse = await fetch(`${baseUrl}/api/run-traces/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chatId,
        idempotencyKey: makeId("idem-route-cancel"),
        plan: cancelPlan,
      }),
    });

    expect(postResponse.status).toBe(201);
    const body = await postResponse.json();
    const runId = body.runId as string;
    createdRuns.push(runId);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const cancelResponse = await fetch(`${baseUrl}/api/run-traces/runs/${runId}/cancel`, {
      method: "POST",
    });
    expect(cancelResponse.status).toBe(200);

    const terminal = await waitForRunTerminal(async () => {
      const response = await fetch(`${baseUrl}/api/run-traces/runs/${runId}`);
      return response.json();
    }, 20_000);

    expect(terminal.status).toBe("cancelled");

    const eventsResponse = await fetch(`${baseUrl}/api/run-traces/runs/${runId}/events?order=asc&limit=200`);
    const eventsBody = await eventsResponse.json();
    expect(eventsBody.events.some((event: any) => event.eventType === "run_cancelled")).toBe(true);
  });

  it("supports SSE reconnection and catch-up from Last-Event-ID", async () => {
    const chatId = makeId("chat-route-reconnect");
    await ensureTestChat(chatId);

    const postResponse = await fetch(`${baseUrl}/api/run-traces/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chatId,
        idempotencyKey: makeId("idem-route-reconnect"),
        plan: buildPlan(),
      }),
    });

    expect(postResponse.status).toBe(201);
    const body = await postResponse.json();
    const runId = body.runId as string;
    createdRuns.push(runId);

    const initial = await consumeSse(`${baseUrl}/api/run-traces/runs/${runId}/stream`, {
      untilTerminal: true,
      timeoutMs: 25_000,
    });

    const ids = initial.events.map((event) => event.id).filter((value): value is number => typeof value === "number");
    expect(ids.length).toBeGreaterThan(3);

    const lastId = ids[ids.length - 1];
    const reconnectFrom = Math.max(0, lastId - 2);

    const reconnect = await consumeSse(`${baseUrl}/api/run-traces/runs/${runId}/stream`, {
      timeoutMs: 8_000,
      maxEvents: 3,
      headers: {
        "Last-Event-ID": String(reconnectFrom),
      },
    });

    const reconnectIds = reconnect.events
      .map((event) => event.id)
      .filter((value): value is number => typeof value === "number");

    expect(reconnectIds.length).toBeGreaterThanOrEqual(2);
    expect(reconnectIds.every((id) => id > reconnectFrom)).toBe(true);
    expect(reconnectIds).toEqual([...reconnectIds].sort((a, b) => a - b));
  });
});
