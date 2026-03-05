#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { asc, eq } from "drizzle-orm";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}
process.env.WORKFLOW_REPRO = "1";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "workflow-repro-session-secret-000000000000";
process.env.MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "repro-microsoft-client";
process.env.MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "repro-microsoft-secret";
process.env.MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || "repro-tenant";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "repro-openai";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "repro-gemini";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const [
  { createWorkflowTraceRouter },
  { ensureWorkflowTraceSchema },
  { WorkflowStore },
  { getWorkflowTraceStreamHub },
  { agentEventBus },
  { db, pool },
  schema,
] = await Promise.all([
  import("../server/routes/workflowTraceRoutes.ts"),
  import("../server/workflow/schemaSetup.ts"),
  import("../server/workflow/store.ts"),
  import("../server/workflow/streaming.ts"),
  import("../server/agent/eventBus.ts"),
  import("../server/db.ts"),
  import("../shared/schema/index.ts"),
]);

const {
  chats,
  agentModeRuns,
  agentModeSteps,
  agentModeEvents,
  agentModeArtifacts,
} = schema;

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const artifactsDir = path.join(repoRoot, "artifacts", "workflow-repro", stamp);
await fs.mkdir(artifactsDir, { recursive: true });

const planPath = path.join(repoRoot, "fixtures", "workflow", "repro-plan.json");
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/run-traces", createWorkflowTraceRouter());

const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Failed to get repro server address");
}
const baseUrl = `http://127.0.0.1:${address.port}`;

const chatId = `workflow-repro-chat-${stamp}`;

const timings = {
  startedAt: new Date().toISOString(),
  postStartedAt: null,
  postCompletedAt: null,
  firstEventAt: null,
  terminalEventAt: null,
  reconnectStartedAt: null,
  reconnectCompletedAt: null,
  finishedAt: null,
};

const busEvents = [];
let activeRunId = null;

const busListener = (event) => {
  if (activeRunId && event.runId !== activeRunId) {
    return;
  }
  busEvents.push({
    receivedAt: new Date().toISOString(),
    ...event,
  });
};

agentEventBus.on("trace", busListener);

async function ensureChatFixture() {
  await db
    .insert(chats)
    .values({
      id: chatId,
      title: `workflow-repro ${stamp}`,
      userId: null,
      archived: "false",
      hidden: "false",
      pinned: "false",
      messageCount: 0,
      tokensUsed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: [chats.id] });
}

function parseSseBlock(block) {
  const lines = block.split("\n");
  const parsed = { id: null, event: null, data: "" };

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      parsed.id = Number(line.slice(3).trim());
      continue;
    }
    if (line.startsWith("event:")) {
      parsed.event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      parsed.data += `${line.slice(5).trim()}\n`;
    }
  }

  if (!parsed.event && !parsed.data) {
    return null;
  }

  const dataText = parsed.data.trim();
  let data = null;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }

  return {
    id: Number.isFinite(parsed.id) ? parsed.id : null,
    event: parsed.event || null,
    data,
    rawData: dataText,
    receivedAt: new Date().toISOString(),
  };
}

async function consumeSse(url, options = {}) {
  const timeoutMs = options.timeoutMs || 15_000;
  const maxEvents = options.maxEvents || Number.POSITIVE_INFINITY;
  const untilTerminal = Boolean(options.untilTerminal);

  const headers = {
    Accept: "text/event-stream",
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: controller.signal,
  });

  if (!response.ok) {
    clearTimeout(timeout);
    throw new Error(`SSE request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  let lastEventId = null;

  const terminalEvents = new Set(["run_completed", "run_failed", "run_cancelled"]);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const parsed = parseSseBlock(block);
        if (parsed) {
          events.push(parsed);
          if (typeof parsed.id === "number") {
            lastEventId = parsed.id;
          }

          if (untilTerminal && parsed.event && terminalEvents.has(parsed.event)) {
            controller.abort("terminal-event");
            break;
          }

          if (events.length >= maxEvents) {
            controller.abort("max-events");
            break;
          }
        }

        separatorIndex = buffer.indexOf("\n\n");
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
    lastEventId,
  };
}

try {
  await ensureWorkflowTraceSchema();
  await ensureChatFixture();

  const requestPayload = {
    chatId,
    plan,
    idempotencyKey: `workflow-repro-${stamp}`,
    traceId: `workflow-trace-${stamp}`,
  };

  timings.postStartedAt = new Date().toISOString();
  const postResponse = await fetch(`${baseUrl}/api/run-traces/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(requestPayload),
  });
  const postBody = await postResponse.json();
  timings.postCompletedAt = new Date().toISOString();

  const runId = postBody.runId;
  if (!runId) {
    throw new Error(`POST /runs did not return runId: ${JSON.stringify(postBody)}`);
  }
  activeRunId = runId;

  const streamUrl = `${baseUrl}/api/run-traces/runs/${runId}/stream`;
  const firstStream = await consumeSse(streamUrl, {
    timeoutMs: 20_000,
    untilTerminal: true,
  });

  if (firstStream.events.length > 0) {
    timings.firstEventAt = firstStream.events[0].receivedAt;
    const terminal = [...firstStream.events].reverse().find((event) => ["run_completed", "run_failed", "run_cancelled"].includes(event.event));
    timings.terminalEventAt = terminal?.receivedAt || null;
  }

  const lastEventId = Number(firstStream.lastEventId || 0);
  const reconnectLastEventId = Math.max(0, lastEventId - 2);

  timings.reconnectStartedAt = new Date().toISOString();
  const reconnectStream = await consumeSse(streamUrl, {
    timeoutMs: 8_000,
    maxEvents: 4,
    headers: {
      "Last-Event-ID": String(reconnectLastEventId),
    },
  });
  timings.reconnectCompletedAt = new Date().toISOString();

  const [runRows, stepRows, eventRows, artifactRows] = await Promise.all([
    db.select().from(agentModeRuns).where(eq(agentModeRuns.id, runId)).limit(1),
    db.select().from(agentModeSteps).where(eq(agentModeSteps.runId, runId)).orderBy(asc(agentModeSteps.stepIndex)),
    db.select().from(agentModeEvents).where(eq(agentModeEvents.runId, runId)).orderBy(asc(agentModeEvents.eventSeq), asc(agentModeEvents.timestamp)),
    db.select().from(agentModeArtifacts).where(eq(agentModeArtifacts.runId, runId)).orderBy(asc(agentModeArtifacts.stepIndex)),
  ]);

  const traceRows = eventRows.map((row) => ({
    eventSeq: row.eventSeq,
    eventType: row.eventType,
    traceId: row.traceId,
    spanId: row.spanId,
    correlationId: row.correlationId,
    severity: row.severity,
    timestamp: row.timestamp,
  }));

  timings.finishedAt = new Date().toISOString();

  const requestResponse = {
    post: {
      url: `${baseUrl}/api/run-traces/runs`,
      requestHeaders: {
        "content-type": "application/json",
        accept: "application/json",
      },
      requestBody: requestPayload,
      responseStatus: postResponse.status,
      responseHeaders: Object.fromEntries(postResponse.headers.entries()),
      responseBody: postBody,
    },
    stream: {
      url: streamUrl,
      initial: {
        status: firstStream.status,
        headers: firstStream.headers,
      },
      reconnect: {
        status: reconnectStream.status,
        headers: reconnectStream.headers,
        requestHeaders: {
          "Last-Event-ID": String(reconnectLastEventId),
        },
      },
    },
  };

  const dbSnapshot = {
    run: runRows[0] || null,
    steps: stepRows,
    events: eventRows,
    artifacts: artifactRows,
  };

  const diagnosisMd = `# Workflow Repro Diagnosis\n\n- run_id: ${runId}\n- POST status: ${postResponse.status}\n- SSE events captured: ${firstStream.events.length}\n- SSE reconnect from Last-Event-ID=${reconnectLastEventId}: ${reconnectStream.events.length} events\n- Persisted events: ${eventRows.length}\n- Persisted artifacts: ${artifactRows.length}\n- Final run status: ${runRows[0]?.status || "unknown"}\n\n## Event Order Check\n\n${eventRows
    .map((row) => `- seq=${row.eventSeq} type=${row.eventType} ts=${new Date(row.timestamp).toISOString()}`)
    .join("\n")}\n`;

  await Promise.all([
    fs.writeFile(path.join(artifactsDir, "request-response.json"), JSON.stringify(requestResponse, null, 2)),
    fs.writeFile(path.join(artifactsDir, "sse-events.ndjson"), `${firstStream.events.map((event) => JSON.stringify(event)).join("\n")}\n`),
    fs.writeFile(path.join(artifactsDir, "sse-reconnect.json"), JSON.stringify({
      requestedLastEventId: reconnectLastEventId,
      response: reconnectStream,
    }, null, 2)),
    fs.writeFile(path.join(artifactsDir, "db-snapshot.json"), JSON.stringify(dbSnapshot, null, 2)),
    fs.writeFile(path.join(artifactsDir, "traces.json"), JSON.stringify(traceRows, null, 2)),
    fs.writeFile(path.join(artifactsDir, "timings.json"), JSON.stringify(timings, null, 2)),
    fs.writeFile(path.join(artifactsDir, "agent-event-bus.ndjson"), `${busEvents.map((event) => JSON.stringify(event)).join("\n")}\n`),
    fs.writeFile(path.join(artifactsDir, "diagnosis.md"), diagnosisMd),
  ]);

  console.log(JSON.stringify({
    ok: true,
    runId,
    artifactsDir,
    persistedEvents: eventRows.length,
    persistedArtifacts: artifactRows.length,
    sseEvents: firstStream.events.length,
    reconnectEvents: reconnectStream.events.length,
  }, null, 2));
} finally {
  agentEventBus.off("trace", busListener);
  getWorkflowTraceStreamHub(new WorkflowStore()).shutdown();
  agentEventBus.shutdown();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
