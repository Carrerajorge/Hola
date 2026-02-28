import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";

import { db } from "../db";
import { chats, agentModeRuns, agentModeSteps, agentModeEvents, agentModeArtifacts } from "@shared/schema";

export async function ensureTestChat(chatId: string): Promise<void> {
  await db
    .insert(chats)
    .values({
      id: chatId,
      title: `workflow-test-${chatId}`,
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

export async function deleteRunCascade(runId: string): Promise<void> {
  await db.delete(agentModeRuns).where(eq(agentModeRuns.id, runId));
}

export async function getRunSnapshot(runId: string) {
  const [run] = await db.select().from(agentModeRuns).where(eq(agentModeRuns.id, runId)).limit(1);
  const [steps, events, artifacts] = await Promise.all([
    db.select().from(agentModeSteps).where(eq(agentModeSteps.runId, runId)).orderBy(asc(agentModeSteps.stepIndex)),
    db.select().from(agentModeEvents).where(eq(agentModeEvents.runId, runId)).orderBy(asc(agentModeEvents.eventSeq), asc(agentModeEvents.timestamp)),
    db.select().from(agentModeArtifacts).where(eq(agentModeArtifacts.runId, runId)).orderBy(asc(agentModeArtifacts.stepIndex)),
  ]);
  return { run, steps, events, artifacts };
}

export function buildPlan(overrides?: Partial<any>) {
  const base = {
    objective: "workflow test plan",
    concurrency: 1,
    steps: [
      {
        id: "prepare",
        name: "Prepare",
        toolName: "noop",
        executorKey: "noop",
        input: { delayMs: 25 },
        retryPolicy: { attempts: 1, backoffMs: 0 },
      },
      {
        id: "flaky",
        name: "Flaky",
        toolName: "flaky",
        executorKey: "flaky",
        dependencies: ["prepare"],
        input: { failTimes: 1 },
        retryPolicy: { attempts: 3, backoffMs: 20, maxBackoffMs: 50 },
      },
      {
        id: "artifact",
        name: "Artifact",
        toolName: "artifact",
        executorKey: "artifact",
        dependencies: ["flaky"],
        input: {
          name: "result.json",
          type: "application/json",
          content: '{"ok":true}',
        },
        retryPolicy: { attempts: 1, backoffMs: 0 },
      },
    ],
  };

  return {
    ...base,
    ...overrides,
  };
}

export async function waitForRunTerminal(fetchRun: () => Promise<any>, timeoutMs = 15_000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await fetchRun();
    if (["completed", "failed", "cancelled"].includes(run?.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for run completion after ${timeoutMs}ms`);
}

export function makeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
