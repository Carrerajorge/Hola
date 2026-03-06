import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOrchestrationEngine } from "./orchestrationEngine";
import { OpenClawBrowserRuntime } from "./openclawBrowserRuntime";
import { OpenClawConnectorRuntime } from "./openclawConnectorRuntime";
import { OpenClawTaskRuntime } from "./openclawTaskRuntime";

const isCI = process.env.CI === "true";
const benchmarkBudgetMultiplier = Number.parseFloat(
  process.env.BENCHMARK_BUDGET_MULTIPLIER || (isCI ? "4" : "1"),
);

export type OpenClawRuntimeBenchmarkResult = {
  name: string;
  metrics: Record<string, number | string>;
  budgets: Record<string, number>;
  passed: boolean;
  failures: string[];
};

export function getOpenClawRuntimeBenchmarkBudget(ms: number): number {
  return Math.ceil(ms * Math.max(1, benchmarkBudgetMultiplier));
}

function percentile(values: number[], target: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((target / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function measureHeapDeltaMb(initialHeapUsed: number): number {
  return (process.memoryUsage().heapUsed - initialHeapUsed) / 1024 / 1024;
}

function logBenchmark(name: string, details: Record<string, number | string>) {
  const parts = Object.entries(details).map(([key, value]) =>
    typeof value === "number" ? `${key}=${value.toFixed(2)}` : `${key}=${value}`,
  );
  console.log(`[OpenClaw Benchmark] ${name} | ${parts.join(" | ")}`);
}

function createPlannerOutput(subtaskCount: number) {
  const subtasks = Array.from({ length: subtaskCount }, (_, index) => {
    const id = `step_${index + 1}`;
    const dependencyId = index > 0 ? `step_${index}` : null;
    const toolHint =
      index % 9 === 0
        ? "synthesize"
        : index % 5 === 0
          ? "schedule_task"
          : index % 3 === 0
            ? "web_search"
            : "analyze_data";

    return {
      id,
      description: `Execute complex runtime task ${index + 1}`,
      toolHint,
      args: {
        index,
        payload: `payload_${index}`,
      },
      dependencies: dependencyId ? [dependencyId] : [],
      priority: index % 4 === 0 ? ("critical" as const) : index % 2 === 0 ? ("high" as const) : ("normal" as const),
      estimatedComplexity:
        index % 6 === 0 ? ("complex" as const) : index % 2 === 0 ? ("medium" as const) : ("simple" as const),
      alternateStrategy: "Fallback to synthesized answer",
    };
  });

  return {
    subtasks,
    reasoning: `Plan with ${subtaskCount} subtasks for a high-complexity agent objective.`,
  };
}

function buildPlannerWavesFromSubtasks(subtaskIds: string[], waveSize: number) {
  const waves: string[][] = [];
  for (let offset = 0; offset < subtaskIds.length; offset += waveSize) {
    waves.push(subtaskIds.slice(offset, offset + waveSize));
  }
  return waves;
}

function finalizeBenchmark(
  name: string,
  metrics: Record<string, number | string>,
  budgets: Record<string, number>,
  assertions: Array<{ ok: boolean; message: string }>,
): OpenClawRuntimeBenchmarkResult {
  logBenchmark(name, metrics);
  const failures = assertions.filter((assertion) => !assertion.ok).map((assertion) => assertion.message);
  return {
    name,
    metrics,
    budgets,
    passed: failures.length === 0,
    failures,
  };
}

export async function runOrchestrationStressBenchmark(): Promise<OpenClawRuntimeBenchmarkResult> {
  const plannerOutput = createPlannerOutput(60);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bench-orch-"));
  const storePath = path.join(tempRoot, "runs.json");
  const heapStart = process.memoryUsage().heapUsed;
  const iterationDurations: number[] = [];
  const iterations = 30;

  const orchestrationEngine = createOrchestrationEngine({
    storePath,
    persistRuns: true,
    deps: {
      decomposeGoal: async () => plannerOutput,
      buildPlannerWaves: (plannerSubtasks) =>
        buildPlannerWavesFromSubtasks(
          plannerSubtasks.map((task) => task.id),
          8,
        ),
      executeGoal: async (_objective, options) => {
        const results = Object.fromEntries(
          plannerOutput.subtasks.map((subtask) => [subtask.id, { ok: true, runId: options.runId }]),
        );
        return {
          planId: `plan_${options.runId}`,
          status: "completed",
          results,
          errors: {},
          finalOutput: { ok: true },
          timeline: plannerOutput.subtasks.map((subtask, index) => ({
            ts: Date.now() + index,
            event: "completed",
            detail: subtask.id,
          })),
          subtasks: plannerOutput.subtasks.map((subtask) => ({
            ...subtask,
            status: "completed",
            retryCount: 0,
            maxRetries: 2,
            result: { ok: true },
          })),
          stats: {
            totalSubtasks: plannerOutput.subtasks.length,
            completed: plannerOutput.subtasks.length,
            failed: 0,
            skipped: 0,
            selfExpanded: 0,
            replanned: 0,
            totalDurationMs: 25,
          },
          artifacts: {
            workspacePath: tempRoot,
            files: ["summary.md", "trace.json"],
          },
        };
      },
      resolvePrimaryModelForRole: (role) => `${role}-benchmark-model`,
      agentManager: {
        getActiveAgent: () =>
          ({
            id: "assistant",
            name: "Assistant",
            capabilities: ["analysis", "execution"],
          }) as any,
        getAgent: () =>
          ({
            id: "assistant",
            name: "Assistant",
            capabilities: ["analysis", "execution"],
          }) as any,
        getAgents: () =>
          [
            {
              id: "assistant",
              name: "Assistant",
              capabilities: ["analysis", "execution"],
            },
          ] as any,
        recommendAgent: () =>
          ({
            id: "assistant",
            name: "Assistant",
            capabilities: ["analysis", "execution"],
          }) as any,
      },
      toolRegistry: {
        getToolById: (id) =>
          ({
            id,
            name: id,
            description: `Tool ${id}`,
            category: id === "schedule_task" ? "automation" : "analysis",
            capabilities: [id, "runtime"],
          }) as any,
        searchTools: (query) =>
          [
            {
              id: query,
              name: query,
              description: `Tool ${query}`,
              category: "analysis",
              capabilities: [query, "runtime"],
            },
          ] as any,
        searchByCapability: (token) =>
          [
            {
              id: `${token}_tool`,
              name: `${token}_tool`,
              description: `Tool ${token}`,
              category: "analysis",
              capabilities: [token, "runtime"],
            },
          ] as any,
      },
    },
  });

  const suiteStart = performance.now();
  try {
    for (let index = 0; index < iterations; index += 1) {
      const runStart = performance.now();
      const subtasks = await orchestrationEngine.decomposeTask(
        `Resolve complex objective ${index}`,
        9,
      );
      const plan = orchestrationEngine.buildExecutionPlan(subtasks);
      const execution = await orchestrationEngine.executeParallel(plan);
      if (execution.completedTasks !== 60) {
        throw new Error(`Unexpected completed task count: ${execution.completedTasks}`);
      }
      iterationDurations.push(performance.now() - runStart);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const elapsed = performance.now() - suiteStart;
  const p95 = percentile(iterationDurations, 95);
  const avg = average(iterationDurations);
  const throughput = iterations / Math.max(elapsed / 1000, 0.001);
  const heapDeltaMb = measureHeapDeltaMb(heapStart);
  const budgets = {
    totalMs: getOpenClawRuntimeBenchmarkBudget(7000),
    p95Ms: getOpenClawRuntimeBenchmarkBudget(450),
    heapDeltaMb: 80,
  };

  return finalizeBenchmark(
    "orchestration_stress",
    {
      iterations,
      totalMs: elapsed,
      avgMs: avg,
      p95Ms: p95,
      throughputPerSec: throughput,
      heapDeltaMb,
      runCount: orchestrationEngine.getStatus().runCount,
    },
    budgets,
    [
      {
        ok: elapsed <= budgets.totalMs,
        message: `totalMs exceeded budget (${elapsed.toFixed(2)} > ${budgets.totalMs})`,
      },
      {
        ok: p95 <= budgets.p95Ms,
        message: `p95Ms exceeded budget (${p95.toFixed(2)} > ${budgets.p95Ms})`,
      },
      {
        ok: heapDeltaMb <= budgets.heapDeltaMb,
        message: `heapDeltaMb exceeded budget (${heapDeltaMb.toFixed(2)} > ${budgets.heapDeltaMb})`,
      },
      {
        ok: orchestrationEngine.getStatus().runCount === iterations,
        message: `runCount mismatch (${orchestrationEngine.getStatus().runCount} !== ${iterations})`,
      },
    ],
  );
}

export async function runBrowserPressureBenchmark(): Promise<OpenClawRuntimeBenchmarkResult> {
  let browserSessionCounter = 0;
  let computerSessionCounter = 0;
  const browserState = new Map<string, { url: string; title: string }>();
  const computerState = new Map<string, { url: string; mode: "browser" | "desktop" }>();

  const runtime = new OpenClawBrowserRuntime({
    universalBrowserController: {
      createSession: async () => {
        const sessionId = `browser_${++browserSessionCounter}`;
        browserState.set(sessionId, { url: "about:blank", title: "New tab" });
        return sessionId;
      },
      closeSession: async (sessionId: string) => {
        browserState.delete(sessionId);
      },
      getSession: (sessionId: string) =>
        browserState.has(sessionId)
          ? ({ id: sessionId, activeTabId: `${sessionId}_tab`, tabs: new Map() } as any)
          : null,
      listTabs: (sessionId: string) => {
        const state = browserState.get(sessionId) ?? { url: "about:blank", title: "Unknown" };
        return [
          {
            id: `${sessionId}_tab`,
            url: state.url,
            title: state.title,
            active: true,
          },
        ];
      },
      navigate: async (sessionId: string, url: string) => {
        browserState.set(sessionId, {
          url,
          title: `Title ${new URL(url).hostname}`,
        });
        return {
          success: true,
          url,
          title: `Title ${new URL(url).hostname}`,
          status: 200,
        };
      },
      click: async () => ({ success: true }),
      type: async () => ({ success: true }),
      select: async (_sessionId: string, _selector: string, values: string | string[]) => ({
        success: true,
        selected: Array.isArray(values) ? values : [values],
      }),
      hover: async () => {},
      scroll: async () => {},
      extract: async (_sessionId: string, rules: Array<{ name: string }>) =>
        Object.fromEntries(rules.map((rule) => [rule.name, "value"])),
      extractStructured: async (_sessionId: string, description: string) => ({
        summary: description,
      }),
      screenshot: async () => "base64-browser",
      executeAgenticTask: async () => ({
        taskId: "task_bench",
        success: true,
        stepsCompleted: 3,
        totalSteps: 3,
        results: [],
        extractedData: {},
        screenshots: [],
        errors: [],
        duration: 15,
      }),
      agenticNavigate: async () => ({
        success: true,
        steps: ["navigate", "extract"],
        data: { ok: true },
        screenshots: [],
      }),
    },
    computerUseEngine: {
      createSession: async (mode?: "browser" | "desktop") => {
        const sessionId = `computer_${++computerSessionCounter}`;
        computerState.set(sessionId, {
          url: "about:blank",
          mode: mode ?? "browser",
        });
        return sessionId;
      },
      closeSession: async (sessionId: string) => {
        computerState.delete(sessionId);
      },
      getSession: (sessionId: string) => {
        const state = computerState.get(sessionId);
        if (!state) {
          return undefined;
        }
        return {
          id: sessionId,
          mode: state.mode,
          status: "active",
          page: {
            url: () => state.url,
          },
        } as any;
      },
      navigateToUrl: async (sessionId: string, url: string) => {
        const existing = computerState.get(sessionId);
        if (existing) {
          existing.url = url;
        }
        return { success: true, duration: 1 };
      },
      mouseClick: async () => ({ success: true, duration: 1, changesDetected: [] }),
      mouseScroll: async () => ({ success: true, duration: 1, changesDetected: [] }),
      typeText: async () => ({ success: true, duration: 1, changesDetected: [] }),
      pressKey: async () => ({ success: true, duration: 1, changesDetected: [] }),
      hotkey: async () => ({ success: true, duration: 1, changesDetected: [] }),
      captureScreenshot: async () => "base64-computer",
      analyzeScreen: async () => ({
        description: "analysis",
        elements: [],
        suggestedActions: [],
        currentState: "ready",
        confidence: 0.9,
      }),
      getPageContent: async () => ({ title: "desktop" }),
    },
  });

  const heapStart = process.memoryUsage().heapUsed;
  const totalBrowserSessions = 120;
  const totalComputerSessions = 80;
  const suiteStart = performance.now();

  const browserSessions = await Promise.all(
    Array.from({ length: totalBrowserSessions }, (_, index) =>
      runtime.createSession({
        userId: "perf_user",
        controller: "browser",
        profileId: index % 2 === 0 ? "chrome-desktop" : "firefox-desktop",
        objective: `Browser objective ${index}`,
        allowedDomains: ["example.com"],
      }),
    ),
  );
  const computerSessions = await Promise.all(
    Array.from({ length: totalComputerSessions }, (_, index) =>
      runtime.createSession({
        userId: "perf_user",
        controller: "computer",
        mode: index % 2 === 0 ? "desktop" : "browser",
        objective: `Computer objective ${index}`,
      }),
    ),
  );

  await Promise.all(
    browserSessions.flatMap((session, index) => [
      runtime.navigate({
        userId: "perf_user",
        sessionId: session.sessionId,
        url: `https://example.com/page-${index}`,
      }),
      runtime.interact({
        userId: "perf_user",
        sessionId: session.sessionId,
        action: "click",
        selector: "button.primary",
      }),
      runtime.extract({
        userId: "perf_user",
        sessionId: session.sessionId,
        description: `Extract page ${index}`,
      }),
      runtime.screenshot({
        userId: "perf_user",
        sessionId: session.sessionId,
      }),
    ]),
  );

  await Promise.all(
    computerSessions.flatMap((session, index) => [
      runtime.navigate({
        userId: "perf_user",
        sessionId: session.sessionId,
        url: `https://example.com/desktop-${index}`,
      }),
      runtime.interact({
        userId: "perf_user",
        sessionId: session.sessionId,
        action: "press_key",
        value: "Enter",
        modifiers: ["ctrl"],
      }),
      runtime.analyze({
        userId: "perf_user",
        sessionId: session.sessionId,
        query: `Analyze screen ${index}`,
      }),
      runtime.screenshot({
        userId: "perf_user",
        sessionId: session.sessionId,
      }),
    ]),
  );

  const status = await runtime.getStatus("perf_user");
  await Promise.all(
    [...browserSessions, ...computerSessions].map((session) =>
      runtime.closeSession("perf_user", session.sessionId),
    ),
  );

  const elapsed = performance.now() - suiteStart;
  const heapDeltaMb = measureHeapDeltaMb(heapStart);
  const totalSessions = totalBrowserSessions + totalComputerSessions;
  const totalActions = totalSessions * 4;
  const budgets = {
    totalMs: getOpenClawRuntimeBenchmarkBudget(6000),
    heapDeltaMb: 90,
  };

  return finalizeBenchmark(
    "browser_runtime_pressure",
    {
      sessions: totalSessions,
      actions: totalActions,
      totalMs: elapsed,
      throughputPerSec: totalActions / Math.max(elapsed / 1000, 0.001),
      heapDeltaMb,
      activeSessions: status.activeSessions,
    },
    budgets,
    [
      {
        ok: elapsed <= budgets.totalMs,
        message: `totalMs exceeded budget (${elapsed.toFixed(2)} > ${budgets.totalMs})`,
      },
      {
        ok: heapDeltaMb <= budgets.heapDeltaMb,
        message: `heapDeltaMb exceeded budget (${heapDeltaMb.toFixed(2)} > ${budgets.heapDeltaMb})`,
      },
      {
        ok: status.activeSessions === totalSessions,
        message: `activeSessions mismatch (${status.activeSessions} !== ${totalSessions})`,
      },
      {
        ok: status.counts.browser === totalBrowserSessions,
        message: `browser session count mismatch (${status.counts.browser} !== ${totalBrowserSessions})`,
      },
    ],
  );
}

export async function runConnectorPressureBenchmark(): Promise<OpenClawRuntimeBenchmarkResult> {
  const manifests = Array.from({ length: 240 }, (_, index) => {
    const connectorId = `connector_${index}`;
    const providerId = `provider_${Math.floor(index / 4)}`;
    return {
      connectorId,
      providerId,
      displayName: `Connector ${index}`,
      description: `Benchmark connector ${index}`,
      version: "1.0.0",
      category: index % 3 === 0 ? "productivity" : index % 2 === 0 ? "comms" : "data",
      authType: index % 11 === 0 ? "none" : "oauth2",
      capabilities: [
        {
          operationId: `${connectorId}_read`,
          name: `Read ${connectorId}`,
          description: "Read benchmark capability",
          requiredScopes: ["read"],
          dataAccessLevel: "read",
          confirmationRequired: false,
          tags: ["read"],
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
        {
          operationId: `${connectorId}_write`,
          name: `Write ${connectorId}`,
          description: "Write benchmark capability",
          requiredScopes: ["write"],
          dataAccessLevel: "write",
          confirmationRequired: true,
          tags: ["write"],
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      ],
    } as any;
  });
  const manifestMap = new Map(manifests.map((manifest) => [manifest.connectorId, manifest]));

  const runtime = new OpenClawConnectorRuntime({
    initializeConnectorManifests: async () => {},
    connectorRegistry: {
      listEnabled: () => manifests,
      get: (connectorId: string) => manifestMap.get(connectorId),
    },
    credentialVault: {
      hasCredential: async (_userId: string, providerId: string) => {
        const numericSuffix = Number(providerId.split("_").pop() || "0");
        return numericSuffix % 2 === 0;
      },
    },
    connectorExecutor: {
      execute: async (connectorId: string, operationId: string, input: unknown, context) => ({
        success: true,
        data: {
          connectorId,
          operationId,
          input,
          runId: context.runId,
        },
        metadata: {
          latencyMs: 3,
        },
      }),
    },
    getIntegrationPolicy: async () => null,
    createRunId: () => "bench_run_id",
  });

  const heapStart = process.memoryUsage().heapUsed;
  const suiteStart = performance.now();
  const catalogIterations = 12;

  for (let index = 0; index < catalogIterations; index += 1) {
    const catalog = await runtime.listCatalog("perf_user");
    if (catalog.length !== manifests.length) {
      throw new Error(`Unexpected catalog length: ${catalog.length}`);
    }
  }

  const detailChecks = await Promise.all(
    manifests.slice(0, 40).map((manifest) => runtime.getConnector("perf_user", manifest.connectorId)),
  );

  const operations = manifests.slice(0, 160).map((manifest, index) =>
    runtime.executeOperation({
      userId: "perf_user",
      connectorId: manifest.connectorId,
      operationId: `${manifest.connectorId}_${index % 2 === 0 ? "read" : "write"}`,
      input: {
        batch: index,
      },
      confirmed: index % 2 !== 0,
    }),
  );
  const operationResults = await Promise.all(operations);
  const successCount = operationResults.filter((result) => result.success).length;
  const elapsed = performance.now() - suiteStart;
  const heapDeltaMb = measureHeapDeltaMb(heapStart);
  const budgets = {
    totalMs: getOpenClawRuntimeBenchmarkBudget(5000),
    heapDeltaMb: 85,
  };

  return finalizeBenchmark(
    "connector_runtime_pressure",
    {
      connectors: manifests.length,
      catalogIterations,
      operations: operations.length,
      successes: successCount,
      totalMs: elapsed,
      throughputPerSec: operations.length / Math.max(elapsed / 1000, 0.001),
      heapDeltaMb,
      detailChecks: detailChecks.filter(Boolean).length,
    },
    budgets,
    [
      {
        ok: successCount === 160,
        message: `success count mismatch (${successCount} !== 160)`,
      },
      {
        ok: detailChecks.filter(Boolean).length === 40,
        message: `connector detail coverage mismatch (${detailChecks.filter(Boolean).length} !== 40)`,
      },
      {
        ok: elapsed <= budgets.totalMs,
        message: `totalMs exceeded budget (${elapsed.toFixed(2)} > ${budgets.totalMs})`,
      },
      {
        ok: heapDeltaMb <= budgets.heapDeltaMb,
        message: `heapDeltaMb exceeded budget (${heapDeltaMb.toFixed(2)} > ${budgets.heapDeltaMb})`,
      },
    ],
  );
}

export async function runBackgroundRuntimePressureBenchmark(): Promise<OpenClawRuntimeBenchmarkResult> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-bench-task-"));
  const storePath = path.join(tempRoot, "cron-store.json");
  const spawnedRuns: string[] = [];
  const runtime = new OpenClawTaskRuntime({
    storePath,
    cronEnabled: false,
    heartbeatsEnabled: true,
    heartbeatIntervalMs: 60_000,
    subagentService: {
      spawn: ({ objective }: { objective: string }) => {
        const id = `subagent_${spawnedRuns.length + 1}`;
        spawnedRuns.push(`${id}:${objective}`);
        return {
          id,
        } as any;
      },
    },
    fetchImpl: async () => ({ ok: true, status: 200 }) as any,
  });

  const heapStart = process.memoryUsage().heapUsed;
  const suiteStart = performance.now();
  const isolatedJobs = 120;
  const mainJobs = 40;
  let status: Awaited<ReturnType<OpenClawTaskRuntime["status"]>> | null = null;
  let firstPage: Awaited<ReturnType<OpenClawTaskRuntime["listPage"]>> | null = null;
  let heartbeatRun: Awaited<ReturnType<OpenClawTaskRuntime["runHeartbeatNow"]>> | null = null;
  let heartbeatStatus: Awaited<ReturnType<OpenClawTaskRuntime["getHeartbeatStatus"]>> | null = null;

  try {
    await runtime.ensureStarted();

    for (let index = 0; index < isolatedJobs; index += 1) {
      await runtime.addJobFromInput({
        name: `Isolated job ${index}`,
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: `Run isolated task ${index}`,
        },
      });
    }

    for (let index = 0; index < mainJobs; index += 1) {
      await runtime.addJobFromInput({
        name: `Main job ${index}`,
        enabled: true,
        schedule: { kind: "every", everyMs: 120_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: {
          kind: "systemEvent",
          text: `System wake ${index}`,
        },
      });
    }

    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        runtime.wake({
          mode: index % 2 === 0 ? "next-heartbeat" : "now",
          text: `Manual wake ${index}`,
        }),
      ),
    );

    [status, firstPage] = await Promise.all([
      runtime.status(),
      runtime.listPage({ limit: 50, offset: 0, sortBy: "name", sortDir: "asc" }),
    ]);
    heartbeatRun = await runtime.runHeartbeatNow({ reason: "bench:manual" });
    heartbeatStatus = await runtime.getHeartbeatStatus();
  } finally {
    runtime.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const elapsed = performance.now() - suiteStart;
  const heapDeltaMb = measureHeapDeltaMb(heapStart);
  const budgets = {
    totalMs: getOpenClawRuntimeBenchmarkBudget(9000),
    heapDeltaMb: 110,
  };

  return finalizeBenchmark(
    "background_runtime_pressure",
    {
      jobs: isolatedJobs + mainJobs,
      spawnedRuns: spawnedRuns.length,
      totalMs: elapsed,
      throughputPerSec: (isolatedJobs + mainJobs) / Math.max(elapsed / 1000, 0.001),
      heapDeltaMb,
      listedJobs: firstPage?.jobs.length ?? 0,
      heartbeatRuns: heartbeatStatus?.runCount ?? 0,
    },
    budgets,
    [
      {
        ok: status?.jobs === isolatedJobs + mainJobs,
        message: `job count mismatch (${status?.jobs} !== ${isolatedJobs + mainJobs})`,
      },
      {
        ok: firstPage?.jobs.length === 50,
        message: `listPage length mismatch (${firstPage?.jobs.length} !== 50)`,
      },
      {
        ok: heartbeatRun?.status === "ran",
        message: `heartbeat run did not complete successfully (${heartbeatRun?.status})`,
      },
      {
        ok: (heartbeatStatus?.runCount ?? 0) >= 1,
        message: `heartbeat run count did not increment (${heartbeatStatus?.runCount ?? 0})`,
      },
      {
        ok: spawnedRuns.length >= 60,
        message: `spawned run volume too low (${spawnedRuns.length} < 60)`,
      },
      {
        ok: elapsed <= budgets.totalMs,
        message: `totalMs exceeded budget (${elapsed.toFixed(2)} > ${budgets.totalMs})`,
      },
      {
        ok: heapDeltaMb <= budgets.heapDeltaMb,
        message: `heapDeltaMb exceeded budget (${heapDeltaMb.toFixed(2)} > ${budgets.heapDeltaMb})`,
      },
    ],
  );
}

export async function runOpenClawRuntimeBenchmarks(): Promise<OpenClawRuntimeBenchmarkResult[]> {
  return [
    await runOrchestrationStressBenchmark(),
    await runBrowserPressureBenchmark(),
    await runConnectorPressureBenchmark(),
    await runBackgroundRuntimePressureBenchmark(),
  ];
}
