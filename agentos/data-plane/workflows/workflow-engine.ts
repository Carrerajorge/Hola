import { EventEmitter } from "events";
import {
  ActivityContext,
  ActivityFn,
  RetryPolicy,
  WorkflowContext,
  WorkflowDef,
  WorkflowHistoryEvent,
  WorkflowRun,
  WorkflowStatus,
} from "../types";

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  initialIntervalMs: 500,
  backoffMultiplier: 2,
  maxIntervalMs: 30_000,
};

export class WorkflowEngine extends EventEmitter {
  private definitions = new Map<string, WorkflowDef>();
  private runs = new Map<string, WorkflowRun>();
  private signals = new Map<string, Map<string, Array<{ resolve: (v: unknown) => void; timer?: ReturnType<typeof setTimeout> }>>>();
  private idCounter = 0;

  /** Register a workflow definition. */
  registerWorkflow<TIn, TOut>(def: WorkflowDef<TIn, TOut>): void {
    this.definitions.set(def.name, def as WorkflowDef);
  }

  /** Start a workflow run, returning its runId. */
  async startWorkflow<TIn>(
    workflowName: string,
    input: TIn,
    workflowId?: string
  ): Promise<string> {
    const def = this.definitions.get(workflowName);
    if (!def) throw new Error(`Workflow not found: ${workflowName}`);

    const runId = this.nextId();
    const wfId = workflowId ?? this.nextId();

    const run: WorkflowRun = {
      workflowId: wfId,
      runId,
      workflowName,
      status: "running",
      input,
      startedAt: new Date(),
      history: [],
    };
    this.runs.set(runId, run);
    this.emit("workflow:started", run);

    const ctx = this.buildContext(def, run);

    // Execute asynchronously so startWorkflow returns immediately
    this.executeWorkflow(def, ctx, run, input).catch(() => {});

    return runId;
  }

  /** Send a signal to a running workflow. */
  sendSignal(runId: string, signalName: string, payload: unknown): void {
    const waiters = this.signals.get(runId)?.get(signalName);
    if (waiters && waiters.length > 0) {
      const w = waiters.shift()!;
      if (w.timer) clearTimeout(w.timer);
      w.resolve(payload);
    }
    const run = this.runs.get(runId);
    if (run) {
      this.appendHistory(run, "SignalReceived", { signalName, payload });
    }
  }

  /** Cancel a running workflow. */
  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return false;
    run.status = "cancelled";
    run.completedAt = new Date();
    this.emit("workflow:cancelled", run);
    return true;
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(filter?: { status?: WorkflowStatus; workflowName?: string }): WorkflowRun[] {
    let result = Array.from(this.runs.values());
    if (filter?.status) result = result.filter((r) => r.status === filter.status);
    if (filter?.workflowName) result = result.filter((r) => r.workflowName === filter.workflowName);
    return result;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async executeWorkflow(
    def: WorkflowDef,
    ctx: WorkflowContext,
    run: WorkflowRun,
    input: unknown
  ): Promise<void> {
    try {
      const timeout = def.timeoutMs;
      let result: unknown;
      if (timeout) {
        result = await Promise.race([
          def.execute(ctx, input),
          this.timeoutPromise(timeout),
        ]);
      } else {
        result = await def.execute(ctx, input);
      }
      run.output = result;
      run.status = "completed";
      run.completedAt = new Date();
      this.appendHistory(run, "WorkflowCompleted", { output: result });
      this.emit("workflow:completed", run);
    } catch (err: any) {
      if (run.status === "cancelled") return;
      run.status = "failed";
      run.error = err?.message ?? String(err);
      run.completedAt = new Date();
      this.appendHistory(run, "WorkflowFailed", { error: run.error });
      this.emit("workflow:failed", run);
    }
  }

  private buildContext(def: WorkflowDef, run: WorkflowRun): WorkflowContext {
    const engine = this;
    return {
      workflowId: run.workflowId,
      runId: run.runId,

      async executeActivity<TIn, TOut>(
        name: string,
        input: TIn,
        opts?: Partial<RetryPolicy>
      ): Promise<TOut> {
        const activity = def.activities[name];
        if (!activity) throw new Error(`Activity not found: ${name}`);

        const retry = { ...DEFAULT_RETRY, ...(def.retryPolicy ?? {}), ...(opts ?? {}) };
        engine.appendHistory(run, "ActivityScheduled", { name, input });

        const actCtx: ActivityContext = {
          workflowId: run.workflowId,
          runId: run.runId,
          attempt: 0,
        };

        let lastError: unknown;
        for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
          try {
            actCtx.attempt = attempt;
            const result = await (activity as ActivityFn<TIn, TOut>)(input, actCtx);
            engine.appendHistory(run, "ActivityCompleted", { name, result });
            return result;
          } catch (err) {
            lastError = err;
            if (attempt < retry.maxAttempts - 1) {
              const delay = Math.min(
                retry.initialIntervalMs * Math.pow(retry.backoffMultiplier, attempt),
                retry.maxIntervalMs
              );
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        }
        engine.appendHistory(run, "ActivityFailed", { name, error: String(lastError) });
        throw lastError;
      },

      async sleep(ms: number): Promise<void> {
        engine.appendHistory(run, "TimerStarted", { durationMs: ms });
        await new Promise((r) => setTimeout(r, ms));
        engine.appendHistory(run, "TimerFired", { durationMs: ms });
      },

      async waitForSignal(signalName: string, timeoutMs?: number): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
          if (!engine.signals.has(run.runId)) engine.signals.set(run.runId, new Map());
          const sigMap = engine.signals.get(run.runId)!;
          if (!sigMap.has(signalName)) sigMap.set(signalName, []);

          const entry: { resolve: (v: unknown) => void; timer?: ReturnType<typeof setTimeout> } = { resolve };
          if (timeoutMs) {
            entry.timer = setTimeout(() => {
              const arr = sigMap.get(signalName);
              if (arr) {
                const idx = arr.indexOf(entry);
                if (idx >= 0) arr.splice(idx, 1);
              }
              reject(new Error(`Signal '${signalName}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          }
          sigMap.get(signalName)!.push(entry);
        });
      },

      emitSignal(signalName: string, payload: unknown): void {
        engine.sendSignal(run.runId, signalName, payload);
      },
    };
  }

  private appendHistory(run: WorkflowRun, type: WorkflowHistoryEvent["type"], payload: unknown): void {
    run.history.push({
      id: run.history.length + 1,
      type,
      timestamp: new Date(),
      payload,
    });
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Workflow timed out after ${ms}ms`)), ms)
    );
  }

  private nextId(): string {
    return `wf-${Date.now()}-${++this.idCounter}`;
  }
}
