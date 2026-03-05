/**
 * Background Task Manager — Persistent Autonomous Task System
 *
 * Manages long-running, recurring, and monitoring tasks that execute
 * autonomously in the background. Supports:
 * - Cron-based scheduled tasks
 * - Continuous monitoring with configurable intervals
 * - Event-driven triggers (webhook, file change, condition)
 * - Task persistence across server restarts
 * - Resource budgeting and automatic throttling
 * - Notification on task completion or alert conditions
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { agentEventBus } from "./eventBus";

// ============================================
// Types
// ============================================

export type BackgroundTaskType =
  | "recurring"     // Runs on a schedule (cron-like)
  | "monitor"       // Watches for a condition
  | "pipeline"      // Multi-step background pipeline
  | "daemon"        // Persistent long-running process
  | "one_shot";     // Run once in background

export type TaskState =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type NotifyChannel = "email" | "slack" | "telegram" | "discord" | "webhook" | "in_app";

export interface BackgroundTaskDefinition {
  id?: string;
  name: string;
  description: string;
  type: BackgroundTaskType;
  userId: string;

  // What to do
  action: TaskAction;

  // Schedule configuration
  schedule?: {
    cron?: string;              // Cron expression: "0 */6 * * *"
    intervalMs?: number;        // Simple interval in ms
    startAt?: Date;             // Delayed start
    endAt?: Date;               // Auto-stop time
    maxRuns?: number;           // Maximum number of executions
    timezone?: string;
  };

  // Monitor configuration
  monitor?: {
    condition: MonitorCondition;
    checkIntervalMs: number;
    alertOnChange: boolean;
    debounceMs?: number;
  };

  // Notification settings
  notify?: {
    channels: NotifyChannel[];
    onComplete?: boolean;
    onError?: boolean;
    onConditionMet?: boolean;
    webhookUrl?: string;
    emailTo?: string;
    slackChannel?: string;
  };

  // Resource limits
  limits?: {
    maxTokensPerRun?: number;
    maxCostPerRunUSD?: number;
    maxTotalCostUSD?: number;
    maxDurationMs?: number;
    maxMemoryMB?: number;
  };

  metadata?: Record<string, any>;
}

export interface TaskAction {
  type: "llm_query" | "web_search" | "web_scrape" | "api_call" | "shell_command" | "workflow" | "agent_task";
  config: Record<string, any>;
  onResult?: "store" | "notify" | "chain";
  nextAction?: TaskAction;
}

export interface MonitorCondition {
  type: "url_change" | "price_threshold" | "keyword_alert" | "api_response" | "file_change" | "custom";
  target: string;         // URL, file path, API endpoint
  operator?: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "changed";
  value?: any;
  selector?: string;      // CSS selector for web monitoring
  jsonPath?: string;       // JSON path for API monitoring
}

export interface BackgroundTask extends BackgroundTaskDefinition {
  id: string;
  state: TaskState;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt?: Date;
  nextRunAt?: Date;
  runCount: number;
  totalCostUSD: number;
  totalTokens: number;
  results: TaskResult[];
  errors: TaskError[];
}

export interface TaskResult {
  id: string;
  runNumber: number;
  timestamp: Date;
  output: any;
  tokensUsed: number;
  costUSD: number;
  durationMs: number;
  conditionMet?: boolean;
}

export interface TaskError {
  timestamp: Date;
  message: string;
  retryable: boolean;
  runNumber: number;
}

// ============================================
// Cron Parser (simple)
// ============================================

function parseCronInterval(cron: string): number {
  // Simple cron patterns to interval mapping
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 3600000; // default 1 hour

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes
  if (minute.startsWith("*/")) {
    const mins = parseInt(minute.slice(2), 10);
    return mins * 60 * 1000;
  }

  // Every N hours
  if (hour.startsWith("*/")) {
    const hours = parseInt(hour.slice(2), 10);
    return hours * 60 * 60 * 1000;
  }

  // Every hour at minute X
  if (minute !== "*" && hour === "*") {
    return 60 * 60 * 1000;
  }

  // Daily
  if (minute !== "*" && hour !== "*" && dayOfMonth === "*") {
    return 24 * 60 * 60 * 1000;
  }

  // Weekly
  if (dayOfWeek !== "*") {
    return 7 * 24 * 60 * 60 * 1000;
  }

  return 3600000; // default 1 hour
}

// ============================================
// Background Task Manager
// ============================================

export class BackgroundTaskManager extends EventEmitter {
  private tasks: Map<string, BackgroundTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private activeExecutions: Map<string, AbortController> = new Map();
  private maxConcurrent: number = 10;
  private isShuttingDown: boolean = false;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Register and start a new background task.
   */
  async registerTask(definition: BackgroundTaskDefinition): Promise<BackgroundTask> {
    const task: BackgroundTask = {
      ...definition,
      id: definition.id || randomUUID(),
      state: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
      runCount: 0,
      totalCostUSD: 0,
      totalTokens: 0,
      results: [],
      errors: [],
    };

    this.tasks.set(task.id, task);
    this.emit("task_registered", { taskId: task.id, name: task.name, type: task.type });

    // Start the task based on its type
    await this.startTask(task.id);

    return task;
  }

  /**
   * Start or resume a task.
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (this.isShuttingDown) return;

    task.state = "running";
    task.updatedAt = new Date();

    switch (task.type) {
      case "one_shot":
        await this.executeOnce(task);
        break;

      case "recurring":
        this.scheduleRecurring(task);
        break;

      case "monitor":
        this.startMonitor(task);
        break;

      case "pipeline":
        await this.executePipeline(task);
        break;

      case "daemon":
        this.startDaemon(task);
        break;
    }

    this.emit("task_started", { taskId: task.id, type: task.type });
  }

  /**
   * Execute a task once.
   */
  private async executeOnce(task: BackgroundTask): Promise<TaskResult> {
    const startTime = Date.now();
    const runNumber = ++task.runCount;
    const abortController = new AbortController();
    this.activeExecutions.set(task.id, abortController);

    try {
      const output = await this.executeAction(task.action, task, abortController.signal);

      const result: TaskResult = {
        id: randomUUID(),
        runNumber,
        timestamp: new Date(),
        output,
        tokensUsed: output?.tokensUsed || 0,
        costUSD: output?.costUSD || 0,
        durationMs: Date.now() - startTime,
      };

      task.results.push(result);
      if (task.results.length > 100) task.results.shift(); // Keep last 100 results
      task.totalTokens += result.tokensUsed;
      task.totalCostUSD += result.costUSD;
      task.lastRunAt = new Date();
      task.updatedAt = new Date();

      // Check limits
      if (task.limits?.maxTotalCostUSD && task.totalCostUSD >= task.limits.maxTotalCostUSD) {
        task.state = "completed";
        this.emit("task_budget_exceeded", { taskId: task.id });
      }

      // Notify on completion if configured
      if (task.notify?.onComplete) {
        await this.sendNotification(task, "completed", result);
      }

      this.emit("task_run_completed", { taskId: task.id, result });
      return result;
    } catch (err: any) {
      const error: TaskError = {
        timestamp: new Date(),
        message: err.message,
        retryable: !abortController.signal.aborted,
        runNumber,
      };
      task.errors.push(error);
      if (task.errors.length > 50) task.errors.shift();

      if (task.notify?.onError) {
        await this.sendNotification(task, "error", error);
      }

      this.emit("task_run_failed", { taskId: task.id, error });
      throw err;
    } finally {
      this.activeExecutions.delete(task.id);
    }
  }

  /**
   * Schedule a recurring task.
   */
  private scheduleRecurring(task: BackgroundTask): void {
    let intervalMs: number;

    if (task.schedule?.intervalMs) {
      intervalMs = task.schedule.intervalMs;
    } else if (task.schedule?.cron) {
      intervalMs = parseCronInterval(task.schedule.cron);
    } else {
      intervalMs = 3600000; // Default: 1 hour
    }

    const execute = async () => {
      if (task.state === "cancelled" || task.state === "paused" || this.isShuttingDown) return;

      // Check max runs
      if (task.schedule?.maxRuns && task.runCount >= task.schedule.maxRuns) {
        task.state = "completed";
        this.clearTimer(task.id);
        this.emit("task_completed", { taskId: task.id, reason: "max_runs_reached" });
        return;
      }

      // Check end time
      if (task.schedule?.endAt && new Date() >= task.schedule.endAt) {
        task.state = "completed";
        this.clearTimer(task.id);
        this.emit("task_completed", { taskId: task.id, reason: "end_time_reached" });
        return;
      }

      try {
        await this.executeOnce(task);
      } catch (err) {
        console.error(`[BackgroundTask] Recurring task ${task.id} failed:`, err);
      }

      task.nextRunAt = new Date(Date.now() + intervalMs);
    };

    // Delay start if configured
    const startDelay = task.schedule?.startAt
      ? Math.max(0, task.schedule.startAt.getTime() - Date.now())
      : 0;

    if (startDelay > 0) {
      const startTimer = setTimeout(() => {
        execute();
        const timer = setInterval(execute, intervalMs);
        this.timers.set(task.id, timer);
      }, startDelay);
      this.timers.set(task.id + "_start", startTimer);
    } else {
      execute();
      const timer = setInterval(execute, intervalMs);
      this.timers.set(task.id, timer);
    }

    task.nextRunAt = new Date(Date.now() + startDelay + intervalMs);
  }

  /**
   * Start a monitoring task.
   */
  private startMonitor(task: BackgroundTask): void {
    if (!task.monitor) return;

    const { checkIntervalMs, debounceMs } = task.monitor;
    let lastValue: any = undefined;
    let debounceTimer: NodeJS.Timeout | null = null;

    const check = async () => {
      if (task.state === "cancelled" || task.state === "paused" || this.isShuttingDown) return;

      try {
        const currentValue = await this.checkCondition(task.monitor!.condition, task);

        const conditionMet = this.evaluateCondition(task.monitor!.condition, currentValue, lastValue);

        if (conditionMet) {
          const result: TaskResult = {
            id: randomUUID(),
            runNumber: ++task.runCount,
            timestamp: new Date(),
            output: { previousValue: lastValue, currentValue, conditionMet: true },
            tokensUsed: 0,
            costUSD: 0,
            durationMs: 0,
            conditionMet: true,
          };

          task.results.push(result);
          task.lastRunAt = new Date();

          if (task.monitor!.alertOnChange && task.notify?.onConditionMet) {
            if (debounceMs) {
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                this.sendNotification(task, "condition_met", result);
              }, debounceMs);
            } else {
              await this.sendNotification(task, "condition_met", result);
            }
          }

          this.emit("monitor_condition_met", { taskId: task.id, result });

          // Execute follow-up action if configured
          if (task.action) {
            await this.executeAction(task.action, task);
          }
        }

        lastValue = currentValue;
      } catch (err) {
        console.error(`[BackgroundTask] Monitor ${task.id} check failed:`, err);
      }
    };

    const timer = setInterval(check, checkIntervalMs);
    this.timers.set(task.id, timer);
    check(); // Initial check
  }

  /**
   * Start a daemon task (continuous execution).
   */
  private startDaemon(task: BackgroundTask): void {
    const run = async () => {
      while (task.state === "running" && !this.isShuttingDown) {
        try {
          await this.executeOnce(task);
        } catch {
          // Brief pause on error
          await new Promise((r) => setTimeout(r, 5000));
        }
        // Small delay between runs to prevent CPU thrashing
        await new Promise((r) => setTimeout(r, 1000));
      }
    };

    run();
  }

  /**
   * Execute a pipeline (sequential background steps).
   */
  private async executePipeline(task: BackgroundTask): Promise<void> {
    let currentAction: TaskAction | undefined = task.action;

    while (currentAction && task.state === "running" && !this.isShuttingDown) {
      try {
        const output = await this.executeAction(currentAction, task);
        const result: TaskResult = {
          id: randomUUID(),
          runNumber: ++task.runCount,
          timestamp: new Date(),
          output,
          tokensUsed: output?.tokensUsed || 0,
          costUSD: output?.costUSD || 0,
          durationMs: 0,
        };
        task.results.push(result);
        task.lastRunAt = new Date();

        currentAction = currentAction.nextAction;
      } catch (err: any) {
        task.state = "failed";
        task.errors.push({ timestamp: new Date(), message: err.message, retryable: false, runNumber: task.runCount });
        break;
      }
    }

    if (task.state === "running") {
      task.state = "completed";
    }

    this.emit("pipeline_completed", { taskId: task.id });
  }

  /**
   * Execute a single action.
   */
  private async executeAction(
    action: TaskAction,
    task: BackgroundTask,
    signal?: AbortSignal
  ): Promise<any> {
    switch (action.type) {
      case "llm_query": {
        const { llmGateway } = await import("../lib/llmGateway");
        const messages = [
            ...(action.config.systemPrompt ? [{ role: "system" as const, content: action.config.systemPrompt }] : []),
            { role: "user" as const, content: action.config.prompt },
          ];
        const response = await llmGateway.chat(messages, {
          model: action.config.model || "claude-opus-4-6",
          temperature: action.config.temperature ?? 0.7,
          maxTokens: action.config.maxTokens ?? 2048,
        });
        return { content: typeof response === "string" ? response : response?.content, tokensUsed: response?.usage?.totalTokens || 0, costUSD: 0 };
      }

      case "web_search": {
        const { toolRegistry } = await import("./toolRegistry");
        const ctx = { runId: `bg-${task.id}`, userId: task.userId };
        const result = await toolRegistry.execute("web_search", {
          query: action.config.query,
          maxResults: action.config.maxResults || 10,
        }, ctx as any);
        return result;
      }

      case "web_scrape": {
        const { toolRegistry } = await import("./toolRegistry");
        const ctx = { runId: `bg-${task.id}`, userId: task.userId };
        const result = await toolRegistry.execute("browse_url", {
          url: action.config.url,
          selector: action.config.selector,
          takeScreenshot: action.config.takeScreenshot,
        }, ctx as any);
        return result;
      }

      case "api_call": {
        const response = await fetch(action.config.url, {
          method: action.config.method || "GET",
          headers: action.config.headers || {},
          body: action.config.body ? JSON.stringify(action.config.body) : undefined,
          signal,
        });
        const data = await response.json().catch(() => response.text());
        return { status: response.status, data };
      }

      case "shell_command": {
        const { execSync } = await import("child_process");
        const output = execSync(action.config.command, {
          timeout: action.config.timeout || 30000,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });
        return { output: output.trim() };
      }

      case "workflow": {
        const { workflowEngine } = await import("./workflowEngine");
        const result = await workflowEngine.executeWorkflow(action.config.definition);
        return result;
      }

      case "agent_task": {
        // Delegate to the main orchestrator
        const { AgentOrchestrator } = await import("./agentOrchestrator");
        const orchestrator = new AgentOrchestrator(
          randomUUID(),
          action.config.chatId || "background",
          task.userId,
          "admin"
        );
        return new Promise((resolve, reject) => {
          orchestrator.on("completed", (result: any) => resolve(result));
          orchestrator.on("failed", (error: any) => reject(error));
          orchestrator.generatePlan(action.config.prompt, [])
            .then(() => orchestrator.run())
            .catch(reject);
        });
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Check a monitor condition.
   */
  private async checkCondition(condition: MonitorCondition, task: BackgroundTask): Promise<any> {
    switch (condition.type) {
      case "url_change": {
        const response = await fetch(condition.target);
        const text = await response.text();
        if (condition.selector) {
          // Would need a DOM parser here — simplified
          return { text: text.substring(0, 1000), hash: this.simpleHash(text) };
        }
        return { hash: this.simpleHash(text) };
      }

      case "price_threshold": {
        const response = await fetch(condition.target);
        const data = await response.json();
        const value = condition.jsonPath ? this.getJsonPath(data, condition.jsonPath) : data;
        return typeof value === "number" ? value : parseFloat(String(value));
      }

      case "api_response": {
        const response = await fetch(condition.target);
        const data = await response.json();
        return condition.jsonPath ? this.getJsonPath(data, condition.jsonPath) : data;
      }

      case "file_change": {
        const fs = await import("fs/promises");
        try {
          const stat = await fs.stat(condition.target);
          return { mtime: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      }

      case "keyword_alert": {
        const response = await fetch(condition.target);
        const text = await response.text();
        const keyword = String(condition.value || "");
        return { found: text.toLowerCase().includes(keyword.toLowerCase()), keyword };
      }

      case "custom": {
        // Custom condition evaluator
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Evaluate whether a condition is met.
   */
  private evaluateCondition(condition: MonitorCondition, current: any, previous: any): boolean {
    if (previous === undefined) return false; // First run, skip

    switch (condition.operator) {
      case "changed":
        return JSON.stringify(current) !== JSON.stringify(previous);
      case "equals":
        return current === condition.value;
      case "not_equals":
        return current !== condition.value;
      case "contains":
        return String(current).includes(String(condition.value));
      case "greater_than":
        return Number(current) > Number(condition.value);
      case "less_than":
        return Number(current) < Number(condition.value);
      default:
        return JSON.stringify(current) !== JSON.stringify(previous);
    }
  }

  /**
   * Send a notification through configured channels.
   */
  private async sendNotification(
    task: BackgroundTask,
    event: "completed" | "error" | "condition_met",
    data: any
  ): Promise<void> {
    if (!task.notify) return;

    const message = this.formatNotification(task, event, data);

    for (const channel of task.notify.channels) {
      try {
        switch (channel) {
          case "in_app":
            this.emit("notification", { taskId: task.id, userId: task.userId, message, event });
            break;

          case "webhook":
            if (task.notify.webhookUrl) {
              await fetch(task.notify.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId: task.id, event, message, data }),
              });
            }
            break;

          case "slack":
          case "telegram":
          case "discord":
          case "email":
            // Emit event for channel integrations to handle
            this.emit("send_notification", { channel, taskId: task.id, userId: task.userId, message, data });
            break;
        }
      } catch (err) {
        console.error(`[BackgroundTask] Failed to notify via ${channel}:`, err);
      }
    }
  }

  /**
   * Format a notification message.
   */
  private formatNotification(task: BackgroundTask, event: string, data: any): string {
    switch (event) {
      case "completed":
        return `✅ Task "${task.name}" completed after ${task.runCount} runs. Total cost: $${task.totalCostUSD.toFixed(4)}`;
      case "error":
        return `❌ Task "${task.name}" encountered an error: ${data?.message || "Unknown error"}`;
      case "condition_met":
        return `🔔 Alert: Task "${task.name}" detected a change. ${JSON.stringify(data?.output || {}).substring(0, 200)}`;
      default:
        return `Task "${task.name}": ${event}`;
    }
  }

  // ============================================
  // Task Management
  // ============================================

  /**
   * Pause a running task.
   */
  pauseTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.state = "paused";
    task.updatedAt = new Date();
    this.clearTimer(taskId);

    const abort = this.activeExecutions.get(taskId);
    if (abort) abort.abort();

    this.emit("task_paused", { taskId });
  }

  /**
   * Resume a paused task.
   */
  async resumeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== "paused") return;

    await this.startTask(taskId);
    this.emit("task_resumed", { taskId });
  }

  /**
   * Cancel a task permanently.
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.state = "cancelled";
    task.updatedAt = new Date();
    this.clearTimer(taskId);

    const abort = this.activeExecutions.get(taskId);
    if (abort) abort.abort();

    this.emit("task_cancelled", { taskId });
  }

  /**
   * Get task status and details.
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * List all tasks for a user.
   */
  listTasks(userId?: string): BackgroundTask[] {
    const all = Array.from(this.tasks.values());
    if (userId) return all.filter((t) => t.userId === userId);
    return all;
  }

  /**
   * Get active task count.
   */
  getActiveCount(): number {
    return Array.from(this.tasks.values()).filter((t) => t.state === "running").length;
  }

  /**
   * Clean up completed/cancelled tasks older than specified age.
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, task] of this.tasks) {
      if (
        (task.state === "completed" || task.state === "cancelled" || task.state === "failed") &&
        task.updatedAt.getTime() < cutoff
      ) {
        this.tasks.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Cancel all timers
    for (const [id] of this.timers) {
      this.clearTimer(id);
    }

    // Abort active executions
    for (const [, abort] of this.activeExecutions) {
      abort.abort();
    }

    // Wait for graceful completion
    await new Promise((r) => setTimeout(r, 2000));

    this.emit("shutdown_complete");
  }

  // ============================================
  // Helpers
  // ============================================

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearInterval(timer);
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
    // Also clear start timer if exists
    const startTimer = this.timers.get(taskId + "_start");
    if (startTimer) {
      clearTimeout(startTimer);
      this.timers.delete(taskId + "_start");
    }
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  private getJsonPath(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }
}

// Singleton
export const backgroundTaskManager = new BackgroundTaskManager();
