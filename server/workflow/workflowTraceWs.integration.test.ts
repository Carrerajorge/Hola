import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, Server } from "http";
import { WebSocket, WebSocketServer } from "ws";

import { createWorkflowTraceRouter, registerDefaultWorkflowExecutors } from "../routes/workflowTraceRoutes";
import { ensureWorkflowTraceSchema } from "./schemaSetup";
import { WorkflowStore } from "./store";
import { WorkflowTraceStreamHub } from "./streaming";
import { buildPlan, deleteRunCascade, ensureTestChat, makeId } from "./testUtils";
import { InMemoryStepExecutorRegistry, WorkflowRunner } from "./workflowRunner";

interface WsEventMessage {
  type: "event";
  id: number;
  event: string;
  data: Record<string, any>;
}

async function subscribeWs(
  wsUrl: string,
  payload: { runId: string; lastEventId?: number },
  options: { timeoutMs?: number; maxEvents?: number; untilTerminal?: boolean } = {},
): Promise<WsEventMessage[]> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxEvents = options.maxEvents ?? Number.POSITIVE_INFINITY;
  const untilTerminal = Boolean(options.untilTerminal);
  const terminalEvents = new Set(["run_completed", "run_failed", "run_cancelled"]);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const events: WsEventMessage[] = [];

    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error(`Timed out waiting for WS events after ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = () => {
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(events);
    };

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          runId: payload.runId,
          lastEventId: payload.lastEventId,
        }),
      );
    });

    ws.on("message", (raw) => {
      const parsed = JSON.parse(raw.toString());
      if (parsed.type !== "event") {
        return;
      }

      events.push(parsed as WsEventMessage);
      if (events.length >= maxEvents) {
        finish();
        return;
      }

      if (untilTerminal && terminalEvents.has(parsed.event)) {
        finish();
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

describe("workflowTrace websocket integration", () => {
  let server: Server;
  let baseUrl: string;
  let wsUrl: string;
  let wsServer: WebSocketServer;
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
    wsServer = new WebSocketServer({ server, path: "/ws/run-traces" });
    await streamHub.registerWebSocket(wsServer, false);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind websocket integration server");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
    wsUrl = `ws://127.0.0.1:${address.port}/ws/run-traces`;
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
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("streams ordered WS events and includes terminal event", async () => {
    const chatId = makeId("chat-ws-live");
    await ensureTestChat(chatId);

    const livePlan = {
      objective: "ws live plan",
      concurrency: 1,
      steps: [
        {
          id: "slow1",
          name: "Slow1",
          toolName: "sleep",
          executorKey: "sleep",
          input: { delayMs: 120 },
          retryPolicy: { attempts: 1, backoffMs: 0 },
        },
        {
          id: "slow2",
          name: "Slow2",
          toolName: "sleep",
          executorKey: "sleep",
          dependencies: ["slow1"],
          input: { delayMs: 120 },
          retryPolicy: { attempts: 1, backoffMs: 0 },
        },
      ],
    };

    const postResponse = await fetch(`${baseUrl}/api/run-traces/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId,
        idempotencyKey: makeId("idem-ws-live"),
        plan: livePlan,
      }),
    });

    expect(postResponse.status).toBe(201);
    const body = await postResponse.json();
    const runId = body.runId as string;
    createdRuns.push(runId);

    const events = await subscribeWs(
      wsUrl,
      { runId, lastEventId: 0 },
      {
        timeoutMs: 25_000,
        untilTerminal: true,
      },
    );

    expect(events.length).toBeGreaterThan(3);
    const ids = events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(events.some((event) => event.event === "run_completed")).toBe(true);
  });

  it("replays catch-up events from lastEventId over WS", async () => {
    const chatId = makeId("chat-ws-replay");
    await ensureTestChat(chatId);

    const postResponse = await fetch(`${baseUrl}/api/run-traces/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId,
        idempotencyKey: makeId("idem-ws-replay"),
        plan: buildPlan(),
      }),
    });

    expect(postResponse.status).toBe(201);
    const body = await postResponse.json();
    const runId = body.runId as string;
    createdRuns.push(runId);

    const fullStream = await subscribeWs(
      wsUrl,
      { runId, lastEventId: 0 },
      {
        timeoutMs: 25_000,
        untilTerminal: true,
      },
    );

    const ids = fullStream.map((event) => event.id);
    const lastId = ids[ids.length - 1];
    const reconnectFrom = Math.max(0, lastId - 2);

    const replayStream = await subscribeWs(
      wsUrl,
      { runId, lastEventId: reconnectFrom },
      {
        timeoutMs: 10_000,
        maxEvents: 2,
      },
    );

    const replayIds = replayStream.map((event) => event.id);
    expect(replayIds.length).toBeGreaterThanOrEqual(2);
    expect(replayIds.every((id) => id > reconnectFrom)).toBe(true);
    expect(replayIds).toEqual([...replayIds].sort((a, b) => a - b));
  });
});
