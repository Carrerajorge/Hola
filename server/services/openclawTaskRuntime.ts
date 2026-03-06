import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { TimeMatcher } from "../../node_modules/node-cron/dist/esm/time/time-matcher.js";
import { openclawSubagentService } from "../openclaw/agents/subagentService";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../openclaw/src/cron/normalize.ts";
import { parseAbsoluteTimeMs } from "../openclaw/src/cron/parse.ts";
import {
  appendCronRunLog,
  readCronRunLogEntriesPage,
  readCronRunLogEntriesPageAll,
  resolveCronRunLogPath,
} from "../openclaw/src/cron/run-log.ts";
import { inferLegacyName } from "../openclaw/src/cron/service/normalize.ts";
import { loadCronStore, resolveCronStorePath, saveCronStore } from "../openclaw/src/cron/store.ts";
import {
  hasHeartbeatWakeHandler,
  hasPendingHeartbeatWake,
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
  type HeartbeatRunResult,
} from "../openclaw/src/infra/heartbeat-wake.ts";
import type {
  CronDeliveryStatus,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronRunStatus,
  CronSchedule,
} from "../openclaw/src/cron/types.ts";
import { validateScheduleTimestamp } from "../openclaw/src/cron/validate-timestamp.ts";

type RecordValue = Record<string, unknown>;

export type OpenClawWakeEvent = {
  id: string;
  mode: "now" | "next-heartbeat";
  text: string;
  source: string;
  createdAtMs: number;
  dispatchedAtMs?: number;
  spawnedRunId?: string;
  agentId?: string;
  sessionKey?: string;
};

export type OpenClawHeartbeatStatus = {
  enabled: boolean;
  intervalMs: number | null;
  handlerAttached: boolean;
  pendingSignals: boolean;
  pendingWakeEvents: number;
  lastRequestedAtMs: number | null;
  lastRunAtMs: number | null;
  lastReason: string | null;
  lastStatus: "idle" | "ran" | "skipped" | "failed";
  lastDurationMs: number | null;
  lastError: string | null;
  runCount: number;
  processedWakeEvents: number;
};

export type OpenClawTaskRuntimeStatus = {
  started: boolean;
  cronEnabled: boolean;
  heartbeatsEnabled: boolean;
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
  runningJobs: string[];
  pendingWakes: number;
  lastTickAtMs: number | null;
  startupError: string | null;
  heartbeatWakeHandlerAttached: boolean;
  heartbeat: OpenClawHeartbeatStatus;
};

export type OpenClawTaskRuntimeOptions = {
  storePath?: string;
  cronEnabled?: boolean;
  heartbeatsEnabled?: boolean;
  heartbeatIntervalMs?: number;
  requesterUserId?: string;
  subagentService?: Pick<typeof openclawSubagentService, "spawn">;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  maxWakeEvents?: number;
};

type JobListOptions = {
  includeDisabled?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  enabled?: "all" | "enabled" | "disabled";
  sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
  sortDir?: "asc" | "desc";
};

type JobRunOptions = {
  mode?: "due" | "force";
};

type JobRunResult =
  | { ok: true; ran: true; job: CronJob }
  | { ok: true; ran: false; reason: "not-due" | "already-running" | "disabled" | "missing" }
  | { ok: false; error: string };

type ExecuteJobResult = {
  status: CronRunStatus;
  summary?: string;
  error?: string;
  sessionId?: string;
  sessionKey?: string;
  delivered?: boolean;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
};

const DEFAULT_WAKE_EVENTS = 100;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeRunStatus(value: unknown): CronRunStatus | undefined {
  return value === "ok" || value === "error" || value === "skipped" ? value : undefined;
}

function normalizeDeliveryStatus(value: unknown): CronDeliveryStatus | undefined {
  return value === "delivered" ||
    value === "not-delivered" ||
    value === "unknown" ||
    value === "not-requested"
    ? value
    : undefined;
}

function normalizeWebhookTarget(raw: unknown): string | undefined {
  const value = normalizeString(raw);
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function getDefaultName(input: CronJobCreate): string {
  return (
    normalizeString(input.name) ??
    inferLegacyName({
      schedule: input.schedule,
      payload: input.payload,
    })
  );
}

function computeCronNextRunAtMs(schedule: Extract<CronSchedule, { kind: "cron" }>, nowMs: number) {
  const expr = normalizeString(schedule.expr);
  if (!expr || !cron.validate(expr)) {
    throw new Error("invalid cron expression");
  }
  const matcher = new TimeMatcher(expr, normalizeString(schedule.tz));
  const next = matcher.getNextMatch(new Date(nowMs));
  const nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) {
    return undefined;
  }
  if (nextMs > nowMs) {
    return nextMs;
  }
  return matcher.getNextMatch(new Date(nowMs + 1_000)).getTime();
}

function computeEveryNextRunAtMs(
  schedule: Extract<CronSchedule, { kind: "every" }>,
  createdAtMs: number,
  lastRunAtMs: number | undefined,
  nowMs: number,
) {
  const everyMs = Math.max(1, Math.floor(schedule.everyMs));
  if (typeof lastRunAtMs === "number" && Number.isFinite(lastRunAtMs)) {
    return Math.floor(lastRunAtMs) + everyMs;
  }
  const anchorMs =
    typeof schedule.anchorMs === "number" && Number.isFinite(schedule.anchorMs)
      ? Math.max(0, Math.floor(schedule.anchorMs))
      : Math.max(0, Math.floor(createdAtMs));
  if (nowMs < anchorMs) {
    return anchorMs;
  }
  const elapsed = nowMs - anchorMs;
  const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
  return anchorMs + steps * everyMs;
}

function computeNextRunAtMs(job: CronJob, nowMs: number): number | undefined {
  if (!job.enabled) {
    return undefined;
  }
  if (job.schedule.kind === "at") {
    if (job.state.lastRunAtMs) {
      return undefined;
    }
    return parseAbsoluteTimeMs(job.schedule.at) ?? undefined;
  }
  if (job.schedule.kind === "every") {
    return computeEveryNextRunAtMs(
      job.schedule,
      job.createdAtMs,
      job.state.lastRunAtMs,
      nowMs,
    );
  }
  return computeCronNextRunAtMs(job.schedule, nowMs);
}

function validateCronJobShape(input: CronJobCreate) {
  if (!input.schedule || typeof input.schedule !== "object") {
    throw new Error("cron job schedule is required");
  }
  if (!input.payload || typeof input.payload !== "object") {
    throw new Error("cron job payload is required");
  }
  if (!normalizeString(input.name)) {
    throw new Error("cron job name is required");
  }
  if (input.sessionTarget !== "main" && input.sessionTarget !== "isolated") {
    throw new Error("cron job sessionTarget must be 'main' or 'isolated'");
  }
  if (input.wakeMode !== "now" && input.wakeMode !== "next-heartbeat") {
    throw new Error("cron job wakeMode must be 'now' or 'next-heartbeat'");
  }
  if (input.schedule.kind === "at") {
    const result = validateScheduleTimestamp(input.schedule);
    if (!result.ok) {
      throw new Error(result.message);
    }
  }
  if (input.schedule.kind === "cron") {
    const expr = normalizeString(input.schedule.expr);
    if (!expr || !cron.validate(expr)) {
      throw new Error("cron job schedule.expr is invalid");
    }
  }
  if (input.schedule.kind === "every") {
    if (
      typeof input.schedule.everyMs !== "number" ||
      !Number.isFinite(input.schedule.everyMs) ||
      input.schedule.everyMs <= 0
    ) {
      throw new Error("cron job schedule.everyMs must be a positive number");
    }
  }
  if (input.sessionTarget === "main" && input.payload.kind !== "systemEvent") {
    throw new Error('main cron jobs require payload.kind="systemEvent"');
  }
  if (input.sessionTarget === "isolated" && input.payload.kind !== "agentTurn") {
    throw new Error('isolated cron jobs require payload.kind="agentTurn"');
  }
  if (input.payload.kind === "agentTurn" && !normalizeString(input.payload.message)) {
    throw new Error("cron job payload.message is required");
  }
  if (input.payload.kind === "systemEvent" && !normalizeString(input.payload.text)) {
    throw new Error("cron job payload.text is required");
  }
  if (input.delivery?.mode === "webhook" && !normalizeWebhookTarget(input.delivery.to)) {
    throw new Error("cron job delivery.to must be a valid http(s) URL");
  }
}

function buildCronJob(
  input: CronJobCreate,
  nowMs: number,
  existing?: Pick<CronJob, "id" | "createdAtMs"> & { state?: CronJob["state"] },
): CronJob {
  const name = getDefaultName(input);
  const baseState = existing?.state ? cloneJson(existing.state) : {};
  const job: CronJob = {
    id: existing?.id ?? `cron_${randomUUID()}`,
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    name,
    description: normalizeString(input.description),
    enabled: input.enabled !== false,
    deleteAfterRun: input.deleteAfterRun === true,
    createdAtMs: existing?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
    schedule: cloneJson(input.schedule),
    sessionTarget: input.sessionTarget,
    wakeMode: input.wakeMode,
    payload: cloneJson(input.payload),
    delivery: input.delivery ? cloneJson(input.delivery) : undefined,
    state: {
      lastRunAtMs: normalizeFiniteNumber(baseState.lastRunAtMs),
      lastRunStatus: normalizeRunStatus(baseState.lastRunStatus ?? baseState.lastStatus),
      lastStatus: normalizeRunStatus(baseState.lastStatus),
      lastError: normalizeString(baseState.lastError),
      lastDurationMs: normalizeFiniteNumber(baseState.lastDurationMs),
      lastDeliveryStatus: normalizeDeliveryStatus(baseState.lastDeliveryStatus),
      lastDeliveryError: normalizeString(baseState.lastDeliveryError),
      lastDelivered: typeof baseState.lastDelivered === "boolean" ? baseState.lastDelivered : undefined,
      nextRunAtMs: undefined,
      runningAtMs: undefined,
    },
  };
  job.state.nextRunAtMs = computeNextRunAtMs(job, nowMs);
  return job;
}

function mergePatchIntoCreateInput(job: CronJob, patch: CronJobPatch): CronJobCreate {
  const next = cloneJson({
    agentId: job.agentId,
    sessionKey: job.sessionKey,
    name: job.name,
    description: job.description,
    enabled: job.enabled,
    deleteAfterRun: job.deleteAfterRun,
    schedule: job.schedule,
    sessionTarget: job.sessionTarget,
    wakeMode: job.wakeMode,
    payload: job.payload,
    delivery: job.delivery,
  } satisfies CronJobCreate);

  if (patch.agentId !== undefined) {
    next.agentId = patch.agentId ?? undefined;
  }
  if (patch.sessionKey !== undefined) {
    next.sessionKey = patch.sessionKey ?? undefined;
  }
  if (patch.name !== undefined) {
    next.name = patch.name as string;
  }
  if (patch.description !== undefined) {
    next.description = patch.description as string;
  }
  if (patch.enabled !== undefined) {
    next.enabled = patch.enabled;
  }
  if (patch.deleteAfterRun !== undefined) {
    next.deleteAfterRun = patch.deleteAfterRun;
  }
  if (patch.schedule !== undefined) {
    next.schedule = cloneJson(patch.schedule as CronSchedule);
  }
  if (patch.sessionTarget !== undefined) {
    next.sessionTarget = patch.sessionTarget;
  }
  if (patch.wakeMode !== undefined) {
    next.wakeMode = patch.wakeMode;
  }
  if (patch.payload !== undefined) {
    const incoming = patch.payload as RecordValue;
    const existingKind = next.payload.kind;
    const incomingKind = normalizeString(incoming.kind);
    if (incomingKind && incomingKind !== existingKind) {
      next.payload = cloneJson(incoming) as CronJobCreate["payload"];
    } else {
      next.payload = {
        ...cloneJson(next.payload),
        ...cloneJson(incoming),
      } as CronJobCreate["payload"];
    }
  }
  if (patch.delivery !== undefined) {
    next.delivery = {
      ...(next.delivery ? cloneJson(next.delivery) : {}),
      ...cloneJson(patch.delivery),
    };
  }
  return next;
}

function sortJobs(
  jobs: CronJob[],
  sortBy: "nextRunAtMs" | "updatedAtMs" | "name",
  sortDir: "asc" | "desc",
) {
  const dir = sortDir === "desc" ? -1 : 1;
  return jobs.toSorted((a, b) => {
    let cmp = 0;
    if (sortBy === "name") {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    } else if (sortBy === "updatedAtMs") {
      cmp = a.updatedAtMs - b.updatedAtMs;
    } else {
      const aNext = a.state.nextRunAtMs;
      const bNext = b.state.nextRunAtMs;
      if (typeof aNext === "number" && typeof bNext === "number") {
        cmp = aNext - bNext;
      } else if (typeof aNext === "number") {
        cmp = -1;
      } else if (typeof bNext === "number") {
        cmp = 1;
      }
    }
    if (cmp !== 0) {
      return cmp * dir;
    }
    return a.id.localeCompare(b.id);
  });
}

export class OpenClawTaskRuntime {
  private readonly storePath: string;
  private readonly cronEnabled: boolean;
  private readonly heartbeatsEnabled: boolean;
  private readonly heartbeatIntervalMs: number | null;
  private readonly requesterUserId: string;
  private readonly subagentService: Pick<typeof openclawSubagentService, "spawn">;
  private readonly fetchImpl?: typeof fetch;
  private readonly nowMs: () => number;
  private readonly maxWakeEvents: number;
  private jobs: CronJob[] = [];
  private wakes: OpenClawWakeEvent[] = [];
  private runningJobs = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatDisposer: (() => void) | null = null;
  private started = false;
  private lastTickAtMs: number | null = null;
  private startupError: string | null = null;
  private startPromise: Promise<void> | null = null;
  private op: Promise<unknown> = Promise.resolve();
  private heartbeat = {
    lastRequestedAtMs: null as number | null,
    lastRunAtMs: null as number | null,
    lastReason: null as string | null,
    lastStatus: "idle" as OpenClawHeartbeatStatus["lastStatus"],
    lastDurationMs: null as number | null,
    lastError: null as string | null,
    runCount: 0,
    processedWakeEvents: 0,
  };

  constructor(options: OpenClawTaskRuntimeOptions = {}) {
    this.storePath = resolveCronStorePath(options.storePath);
    this.cronEnabled = options.cronEnabled !== false;
    this.heartbeatsEnabled = options.heartbeatsEnabled !== false;
    this.heartbeatIntervalMs = this.heartbeatsEnabled
      ? Math.max(1_000, Math.floor(options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS))
      : null;
    this.requesterUserId = options.requesterUserId ?? "system_openclaw_runtime";
    this.subagentService = options.subagentService ?? openclawSubagentService;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.maxWakeEvents = Math.max(10, options.maxWakeEvents ?? DEFAULT_WAKE_EVENTS);
  }

  async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }
    if (this.startPromise) {
      return await this.startPromise;
    }
    this.startPromise = (async () => {
      try {
        const store = await loadCronStore(this.storePath);
        const now = this.nowMs();
        const jobs = store.jobs
          .map((raw) => this.hydratePersistedJob(raw, now))
          .filter((job): job is CronJob => Boolean(job));
        this.jobs = jobs;
        this.started = true;
        this.startupError = null;
        await this.persistStore();
        this.ensureHeartbeatHandler();
        this.armTimer();
        this.armHeartbeatTimer();
      } catch (error) {
        this.startupError = (error as Error)?.message ?? "Failed to start OpenClaw task runtime";
        throw error;
      } finally {
        this.startPromise = null;
      }
    })();
    return await this.startPromise;
  }

  stop(): void {
    this.clearTimer();
    this.clearHeartbeatTimer();
    this.detachHeartbeatHandler();
    this.started = false;
  }

  async status(): Promise<OpenClawTaskRuntimeStatus> {
    await this.ensureStarted();
    return {
      started: this.started,
      cronEnabled: this.cronEnabled,
      heartbeatsEnabled: this.heartbeatsEnabled,
      storePath: this.storePath,
      jobs: this.jobs.length,
      nextWakeAtMs: this.resolveNextWakeAtMs(),
      runningJobs: Array.from(this.runningJobs.values()),
      pendingWakes: this.countPendingWakeEvents(),
      lastTickAtMs: this.lastTickAtMs,
      startupError: this.startupError,
      heartbeatWakeHandlerAttached: this.isHeartbeatHandlerAttached(),
      heartbeat: this.buildHeartbeatStatus(),
    };
  }

  async getHeartbeatStatus(): Promise<OpenClawHeartbeatStatus> {
    await this.ensureStarted();
    return this.buildHeartbeatStatus();
  }

  async list(options: JobListOptions = {}): Promise<CronJob[]> {
    await this.ensureStarted();
    return this.selectJobs(options);
  }

  async listPage(options: JobListOptions = {}) {
    await this.ensureStarted();
    const jobs = this.selectJobs(options);
    const total = jobs.length;
    const offset = Math.max(0, Math.min(total, Math.floor(options.offset ?? 0)));
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? (total || 50))));
    const page = jobs.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      jobs: page,
      total,
      offset,
      limit,
      hasMore: nextOffset < total,
      nextOffset: nextOffset < total ? nextOffset : null,
    };
  }

  async listRuns(options: {
    id?: string;
    jobId?: string;
    scope?: "job" | "all";
    limit?: number;
    offset?: number;
    status?: "all" | "ok" | "error" | "skipped";
    statuses?: Array<"ok" | "error" | "skipped">;
    deliveryStatus?: "delivered" | "not-delivered" | "unknown" | "not-requested";
    deliveryStatuses?: Array<"delivered" | "not-delivered" | "unknown" | "not-requested">;
    query?: string;
    sortDir?: "asc" | "desc";
  }) {
    await this.ensureStarted();
    const jobId = options.id ?? options.jobId;
    const scope = options.scope ?? (jobId ? "job" : "all");
    if (scope === "job") {
      if (!jobId) {
        throw new Error("jobId is required");
      }
      return await readCronRunLogEntriesPage(resolveCronRunLogPath({ storePath: this.storePath, jobId }), {
        jobId,
        limit: options.limit,
        offset: options.offset,
        status: options.status,
        statuses: options.statuses,
        deliveryStatus: options.deliveryStatus,
        deliveryStatuses: options.deliveryStatuses,
        query: options.query,
        sortDir: options.sortDir,
      });
    }
    const jobNameById = Object.fromEntries(this.jobs.map((job) => [job.id, job.name]));
    return await readCronRunLogEntriesPageAll({
      storePath: this.storePath,
      limit: options.limit,
      offset: options.offset,
      status: options.status,
      statuses: options.statuses,
      deliveryStatus: options.deliveryStatus,
      deliveryStatuses: options.deliveryStatuses,
      query: options.query,
      sortDir: options.sortDir,
      jobNameById,
    });
  }

  async listWakeEvents(limit = 20) {
    await this.ensureStarted();
    const max = Math.max(1, Math.min(200, Math.floor(limit)));
    return {
      count: Math.min(max, this.wakes.length),
      events: this.wakes.slice(-max).toReversed(),
    };
  }

  async addJobFromInput(raw: unknown): Promise<CronJob> {
    return await this.withLock(async () => {
      await this.ensureStarted();
      const normalized = normalizeCronJobCreate(raw);
      if (!normalized) {
        throw new Error("Invalid cron job payload");
      }
      validateCronJobShape(normalized);
      const now = this.nowMs();
      const job = buildCronJob(normalized, now);
      this.jobs.push(job);
      await this.persistStore();
      this.armTimer();
      return cloneJson(job);
    });
  }

  async updateJobFromInput(id: string, raw: unknown): Promise<CronJob> {
    return await this.withLock(async () => {
      await this.ensureStarted();
      const patch = normalizeCronJobPatch(isRecord(raw) && "patch" in raw ? raw.patch : raw);
      if (!patch) {
        throw new Error("Invalid cron job patch");
      }
      const index = this.jobs.findIndex((job) => job.id === id);
      if (index === -1) {
        throw new Error(`unknown cron job id: ${id}`);
      }
      const nextInput = mergePatchIntoCreateInput(this.jobs[index], patch);
      const normalized = normalizeCronJobCreate(nextInput);
      if (!normalized) {
        throw new Error("Invalid cron job patch");
      }
      validateCronJobShape(normalized);
      const job = buildCronJob(normalized, this.nowMs(), {
        id: this.jobs[index].id,
        createdAtMs: this.jobs[index].createdAtMs,
        state: this.jobs[index].state,
      });
      this.jobs[index] = job;
      await this.persistStore();
      this.armTimer();
      return cloneJson(job);
    });
  }

  async removeJob(id: string): Promise<{ ok: true; removed: boolean }> {
    return await this.withLock(async () => {
      await this.ensureStarted();
      const before = this.jobs.length;
      this.jobs = this.jobs.filter((job) => job.id !== id);
      const removed = this.jobs.length !== before;
      if (removed) {
        this.runningJobs.delete(id);
        await this.persistStore();
        this.armTimer();
      }
      return { ok: true, removed };
    });
  }

  async runJob(id: string, options: JobRunOptions = {}): Promise<JobRunResult> {
    await this.ensureStarted();
    const begin = await this.beginRun(id, options.mode ?? "force");
    if (!begin.ok) {
      return begin.result;
    }
    const result = await this.executeRun(begin.job, begin.startedAtMs, `manual:${options.mode ?? "force"}`);
    await this.finishRun(begin.job.id, begin.startedAtMs, result);
    const finished = this.jobs.find((job) => job.id === begin.job.id);
    return finished
      ? { ok: true, ran: true, job: cloneJson(finished) }
      : { ok: true, ran: false, reason: "missing" };
  }

  async wake(opts: { mode: "now" | "next-heartbeat"; text: string }) {
    await this.ensureStarted();
    const event = this.enqueueWakeEvent({
      mode: opts.mode,
      text: opts.text,
      source: "runtime:manual",
    });
    if (opts.mode === "now") {
      const run = this.spawnSubagent(opts.text, ["source:wake", "mode:now"]);
      event.dispatchedAtMs = this.nowMs();
      event.spawnedRunId = run.id;
      return {
        queued: true,
        event: cloneJson(event),
        runId: run.id,
      };
    }
    return {
      queued: true,
      event: cloneJson(event),
    };
  }

  async requestHeartbeat(opts: {
    reason?: string;
    coalesceMs?: number;
    agentId?: string;
    sessionKey?: string;
  } = {}) {
    await this.ensureStarted();
    if (!this.heartbeatsEnabled) {
      throw new Error("Heartbeats are disabled");
    }
    const requestedAtMs = this.nowMs();
    const reason = normalizeString(opts.reason) ?? "runtime:manual";
    this.heartbeat.lastRequestedAtMs = requestedAtMs;
    this.heartbeat.lastReason = reason;
    requestHeartbeatNow({
      reason,
      coalesceMs: opts.coalesceMs,
      agentId: opts.agentId,
      sessionKey: opts.sessionKey,
    });
    return {
      queued: true,
      requestedAtMs,
      heartbeat: this.buildHeartbeatStatus(),
    };
  }

  async runHeartbeatNow(opts: {
    reason?: string;
    agentId?: string;
    sessionKey?: string;
  } = {}) {
    await this.ensureStarted();
    if (!this.heartbeatsEnabled) {
      throw new Error("Heartbeats are disabled");
    }
    const result = await this.processHeartbeatWake({
      reason: normalizeString(opts.reason) ?? "runtime:manual-run",
      agentId: opts.agentId,
      sessionKey: opts.sessionKey,
    });
    return {
      ...result,
      heartbeat: this.buildHeartbeatStatus(),
    };
  }

  private async onTimer(): Promise<void> {
    this.clearTimer();
    this.lastTickAtMs = this.nowMs();
    const dueIds = await this.withLock(async () => {
      await this.ensureStarted();
      const now = this.nowMs();
      return this.jobs
        .filter(
          (job) =>
            job.enabled &&
            !this.runningJobs.has(job.id) &&
            typeof job.state.nextRunAtMs === "number" &&
            job.state.nextRunAtMs <= now,
        )
        .map((job) => job.id);
    });
    for (const id of dueIds) {
      const begin = await this.beginRun(id, "due");
      if (!begin.ok) {
        continue;
      }
      const result = await this.executeRun(begin.job, begin.startedAtMs, "schedule:due");
      await this.finishRun(begin.job.id, begin.startedAtMs, result);
    }
    this.armTimer();
  }

  private async beginRun(id: string, mode: "due" | "force") {
    return await this.withLock(async () => {
      await this.ensureStarted();
      const job = this.jobs.find((entry) => entry.id === id);
      if (!job) {
        return {
          ok: false as const,
          result: { ok: true as const, ran: false as const, reason: "missing" as const },
        };
      }
      if (!job.enabled) {
        return {
          ok: false as const,
          result: { ok: true as const, ran: false as const, reason: "disabled" as const },
        };
      }
      if (this.runningJobs.has(id)) {
        return {
          ok: false as const,
          result: { ok: true as const, ran: false as const, reason: "already-running" as const },
        };
      }
      const now = this.nowMs();
      if (mode === "due") {
        if (typeof job.state.nextRunAtMs !== "number" || job.state.nextRunAtMs > now) {
          return {
            ok: false as const,
            result: { ok: true as const, ran: false as const, reason: "not-due" as const },
          };
        }
      }
      this.runningJobs.add(id);
      job.state.runningAtMs = now;
      await this.persistStore();
      return {
        ok: true as const,
        job: cloneJson(job),
        startedAtMs: now,
      };
    });
  }

  private async executeRun(
    job: CronJob,
    startedAtMs: number,
    source: string,
  ): Promise<ExecuteJobResult> {
    try {
      let outcome: ExecuteJobResult;
      if (job.payload.kind === "agentTurn") {
        const hints = [
          `source:${source}`,
          `cron:${job.id}`,
          job.agentId ? `agent:${job.agentId}` : undefined,
          job.payload.model ? `model:${job.payload.model}` : undefined,
        ].filter((value): value is string => Boolean(value));
        const run = this.spawnSubagent(job.payload.message, hints);
        outcome = {
          status: "ok",
          summary: `Spawned background run ${run.id} for job "${job.name}"`,
          sessionId: run.id,
          sessionKey: `subagent:${run.id}`,
        };
      } else {
        const wake = this.enqueueWakeEvent({
          mode: job.wakeMode,
          text: job.payload.text,
          source: `cron:${job.id}`,
          agentId: job.agentId,
          sessionKey: job.sessionKey,
        });
        if (job.wakeMode === "now") {
          const run = this.spawnSubagent(job.payload.text, [
            `source:${source}`,
            `cron:${job.id}`,
            "payload:systemEvent",
          ]);
          wake.dispatchedAtMs = this.nowMs();
          wake.spawnedRunId = run.id;
          outcome = {
            status: "ok",
            summary: `Queued wake ${wake.id} and spawned background run ${run.id}`,
            sessionId: run.id,
            sessionKey: `subagent:${run.id}`,
          };
        } else {
          outcome = {
            status: "ok",
            summary: `Queued wake ${wake.id} for next supervision cycle`,
          };
        }
      }

      const delivery = await this.deliver(job, {
        jobId: job.id,
        jobName: job.name,
        startedAtMs,
        summary: outcome.summary,
        status: outcome.status,
        sessionId: outcome.sessionId,
        sessionKey: outcome.sessionKey,
      });
      return {
        ...outcome,
        delivered: delivery.delivered,
        deliveryStatus: delivery.deliveryStatus,
        deliveryError: delivery.deliveryError,
      };
    } catch (error) {
      return {
        status: "error",
        error: (error as Error)?.message ?? "Cron execution failed",
      };
    }
  }

  private async finishRun(jobId: string, startedAtMs: number, outcome: ExecuteJobResult) {
    const finishedAtMs = this.nowMs();
    await this.withLock(async () => {
      await this.ensureStarted();
      const index = this.jobs.findIndex((job) => job.id === jobId);
      const job = index === -1 ? null : this.jobs[index];
      this.runningJobs.delete(jobId);
      if (!job) {
        return;
      }
      job.state.runningAtMs = undefined;
      job.state.lastRunAtMs = finishedAtMs;
      job.state.lastRunStatus = outcome.status;
      job.state.lastStatus = outcome.status;
      job.state.lastError = outcome.error;
      job.state.lastDurationMs = Math.max(0, finishedAtMs - startedAtMs);
      job.state.lastDelivered = outcome.delivered;
      job.state.lastDeliveryStatus = outcome.deliveryStatus;
      job.state.lastDeliveryError = outcome.deliveryError;

      if (job.schedule.kind === "at") {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      } else {
        job.state.nextRunAtMs = computeNextRunAtMs(job, finishedAtMs);
      }

      if (job.deleteAfterRun === true && outcome.status === "ok") {
        this.jobs.splice(index, 1);
      }

      await this.persistStore();
      this.armTimer();
    });

    await appendCronRunLog(resolveCronRunLogPath({ storePath: this.storePath, jobId }), {
      ts: finishedAtMs,
      jobId,
      action: "finished",
      status: outcome.status,
      error: outcome.error,
      summary: outcome.summary,
      delivered: outcome.delivered,
      deliveryStatus: outcome.deliveryStatus,
      deliveryError: outcome.deliveryError,
      sessionId: outcome.sessionId,
      sessionKey: outcome.sessionKey,
      runAtMs: startedAtMs,
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      nextRunAtMs: this.jobs.find((job) => job.id === jobId)?.state.nextRunAtMs,
    });
  }

  private async deliver(
    job: CronJob,
    payload: RecordValue,
  ): Promise<{
    delivered?: boolean;
    deliveryStatus?: CronDeliveryStatus;
    deliveryError?: string;
  }> {
    if (job.delivery?.mode !== "webhook") {
      return {
        delivered: false,
        deliveryStatus: "not-requested",
      };
    }
    const target = normalizeWebhookTarget(job.delivery.to);
    if (!target || !this.fetchImpl) {
      return {
        delivered: false,
        deliveryStatus: "not-delivered",
        deliveryError: "Webhook delivery is not available",
      };
    }
    try {
      const response = await this.fetchImpl(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        return {
          delivered: false,
          deliveryStatus: "not-delivered",
          deliveryError: `HTTP ${response.status}`,
        };
      }
      return {
        delivered: true,
        deliveryStatus: "delivered",
      };
    } catch (error) {
      return {
        delivered: false,
        deliveryStatus: "not-delivered",
        deliveryError: (error as Error)?.message ?? "Webhook delivery failed",
      };
    }
  }

  private spawnSubagent(objective: string, planHint: string[]) {
    return this.subagentService.spawn({
      requesterUserId: this.requesterUserId,
      objective,
      planHint,
    });
  }

  private enqueueWakeEvent(input: {
    mode: "now" | "next-heartbeat";
    text: string;
    source: string;
    agentId?: string;
    sessionKey?: string;
  }): OpenClawWakeEvent {
    const event: OpenClawWakeEvent = {
      id: `wake_${randomUUID()}`,
      mode: input.mode,
      text: input.text.trim(),
      source: input.source,
      createdAtMs: this.nowMs(),
      agentId: normalizeString(input.agentId),
      sessionKey: normalizeString(input.sessionKey),
    };
    this.wakes.push(event);
    if (this.wakes.length > this.maxWakeEvents) {
      this.wakes.splice(0, this.wakes.length - this.maxWakeEvents);
    }
    return event;
  }

  private countPendingWakeEvents() {
    return this.wakes.filter((event) => event.mode === "next-heartbeat" && !event.dispatchedAtMs).length;
  }

  private buildHeartbeatStatus(): OpenClawHeartbeatStatus {
    return cloneJson({
      enabled: this.heartbeatsEnabled,
      intervalMs: this.heartbeatIntervalMs,
      handlerAttached: this.isHeartbeatHandlerAttached(),
      pendingSignals: hasPendingHeartbeatWake(),
      pendingWakeEvents: this.countPendingWakeEvents(),
      lastRequestedAtMs: this.heartbeat.lastRequestedAtMs,
      lastRunAtMs: this.heartbeat.lastRunAtMs,
      lastReason: this.heartbeat.lastReason,
      lastStatus: this.heartbeat.lastStatus,
      lastDurationMs: this.heartbeat.lastDurationMs,
      lastError: this.heartbeat.lastError,
      runCount: this.heartbeat.runCount,
      processedWakeEvents: this.heartbeat.processedWakeEvents,
    });
  }

  private isHeartbeatHandlerAttached() {
    return this.heartbeatsEnabled && hasHeartbeatWakeHandler() && Boolean(this.heartbeatDisposer);
  }

  private ensureHeartbeatHandler() {
    if (!this.heartbeatsEnabled || this.heartbeatDisposer) {
      return;
    }
    this.heartbeatDisposer = setHeartbeatWakeHandler(async (opts) =>
      await this.processHeartbeatWake({
        reason: opts.reason,
        agentId: opts.agentId,
        sessionKey: opts.sessionKey,
      }),
    );
  }

  private detachHeartbeatHandler() {
    if (!this.heartbeatDisposer) {
      return;
    }
    this.heartbeatDisposer();
    this.heartbeatDisposer = null;
  }

  private armHeartbeatTimer() {
    this.clearHeartbeatTimer();
    if (!this.started || !this.heartbeatsEnabled || !this.heartbeatIntervalMs) {
      return;
    }
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeat.lastRequestedAtMs = this.nowMs();
      this.heartbeat.lastReason = "runtime:interval";
      requestHeartbeatNow({ reason: "runtime:interval" });
      this.armHeartbeatTimer();
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private clearHeartbeatTimer() {
    if (!this.heartbeatTimer) {
      return;
    }
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async processHeartbeatWake(opts: {
    reason?: string;
    agentId?: string;
    sessionKey?: string;
  }): Promise<HeartbeatRunResult> {
    const startedAtMs = this.nowMs();
    const reason = normalizeString(opts.reason) ?? "runtime:heartbeat";
    const agentId = normalizeString(opts.agentId);
    const sessionKey = normalizeString(opts.sessionKey);

    this.heartbeat.lastRequestedAtMs = startedAtMs;
    this.heartbeat.lastReason = reason;

    let processedCount = 0;
    try {
      await this.withLock(async () => {
        await this.ensureStarted();
        const pending = this.wakes.filter((event) => {
          if (event.mode !== "next-heartbeat" || event.dispatchedAtMs) {
            return false;
          }
          if (agentId && event.agentId && event.agentId !== agentId) {
            return false;
          }
          if (sessionKey && event.sessionKey && event.sessionKey !== sessionKey) {
            return false;
          }
          return true;
        });

        processedCount = pending.length;
        for (const event of pending) {
          const run = this.spawnSubagent(event.text, [
            "source:heartbeat",
            `heartbeat:${reason}`,
            `wake:${event.id}`,
            `event-source:${event.source}`,
            event.agentId ? `agent:${event.agentId}` : undefined,
            event.sessionKey ? `session:${event.sessionKey}` : undefined,
          ].filter((value): value is string => Boolean(value)));
          event.dispatchedAtMs = this.nowMs();
          event.spawnedRunId = run.id;
        }
      });

      this.heartbeat.lastRunAtMs = this.nowMs();
      this.heartbeat.lastDurationMs = Math.max(0, this.nowMs() - startedAtMs);
      this.heartbeat.lastError = processedCount > 0 ? null : "No pending wake events";
      this.heartbeat.lastStatus = processedCount > 0 ? "ran" : "skipped";
      this.heartbeat.runCount += 1;
      this.heartbeat.processedWakeEvents += processedCount;

      if (processedCount === 0) {
        return { status: "skipped", reason: "no-pending-wakes" };
      }
      return {
        status: "ran",
        durationMs: Math.max(0, this.nowMs() - startedAtMs),
      };
    } catch (error) {
      this.heartbeat.lastRunAtMs = this.nowMs();
      this.heartbeat.lastDurationMs = Math.max(0, this.nowMs() - startedAtMs);
      this.heartbeat.lastError = (error as Error)?.message ?? "Heartbeat dispatch failed";
      this.heartbeat.lastStatus = "failed";
      this.heartbeat.runCount += 1;
      return {
        status: "failed",
        reason: this.heartbeat.lastError,
      };
    }
  }

  private selectJobs(options: JobListOptions): CronJob[] {
    const enabledFilter = options.enabled ?? (options.includeDisabled ? "all" : "enabled");
    const query = options.query?.trim().toLowerCase() ?? "";
    const filtered = this.jobs.filter((job) => {
      if (enabledFilter === "enabled" && !job.enabled) {
        return false;
      }
      if (enabledFilter === "disabled" && job.enabled) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [job.name, job.description ?? "", job.agentId ?? ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
    return cloneJson(
      sortJobs(filtered, options.sortBy ?? "nextRunAtMs", options.sortDir ?? "asc"),
    );
  }

  private hydratePersistedJob(raw: unknown, nowMs: number): CronJob | null {
    if (!isRecord(raw)) {
      return null;
    }
    const normalized = normalizeCronJobCreate(raw);
    if (!normalized) {
      return null;
    }
    validateCronJobShape(normalized);
    const id = normalizeString(raw.id) ?? `cron_${randomUUID()}`;
    const createdAtMs = normalizeFiniteNumber(raw.createdAtMs) ?? nowMs;
    const state = isRecord(raw.state) ? (raw.state as CronJob["state"]) : undefined;
    return buildCronJob(normalized, nowMs, {
      id,
      createdAtMs,
      state,
    });
  }

  private resolveNextWakeAtMs(): number | null {
    const next = this.jobs
      .filter((job) => job.enabled && typeof job.state.nextRunAtMs === "number")
      .map((job) => job.state.nextRunAtMs as number)
      .sort((a, b) => a - b)[0];
    return typeof next === "number" ? next : null;
  }

  private async persistStore() {
    await saveCronStore(this.storePath, {
      version: 1,
      jobs: this.jobs,
    });
  }

  private armTimer() {
    this.clearTimer();
    if (!this.started || !this.cronEnabled) {
      return;
    }
    const nextWakeAtMs = this.resolveNextWakeAtMs();
    if (typeof nextWakeAtMs !== "number") {
      return;
    }
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, nextWakeAtMs - this.nowMs()));
    this.timer = setTimeout(() => {
      void this.onTimer();
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer() {
    if (!this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.op.then(fn, fn);
    this.op = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  }
}

export const openClawTaskRuntime = new OpenClawTaskRuntime();
