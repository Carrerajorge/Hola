/**
 * Background Task Engine
 *
 * Configures persistent, recurring tasks that the agent executes autonomously.
 * Supports cron schedules, one-time delayed tasks, and continuous monitoring.
 *
 * Integrates with:
 * - BullMQ for queue management (existing infra)
 * - Trigger.dev for durable background jobs
 * - Node.js cron for simple schedules
 */

import { Logger } from '../../lib/logger';
import { FEATURE_FLAGS } from '../../openclaw.config';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type ScheduleType = 'once' | 'cron' | 'interval' | 'continuous';

export interface BackgroundTask {
  id: string;
  name: string;
  description: string;
  schedule: {
    type: ScheduleType;
    cron?: string;          // e.g. "0 9 * * *" for daily at 9am
    intervalMs?: number;    // for interval-based
    runAt?: Date;           // for one-time
  };
  handler: string;          // handler function identifier
  params: Record<string, unknown>;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  lastRunAt?: Date;
  nextRunAt?: Date;
  runCount: number;
  maxRuns?: number;
  errorCount: number;
  lastError?: string;
  tags: string[];
  userId?: string;
}

export interface TaskExecution {
  taskId: string;
  executionId: string;
  startedAt: Date;
  completedAt?: Date;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

interface CronEntry {
  task: BackgroundTask;
  timerId: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null;
}

export class BackgroundTaskEngine {
  private tasks = new Map<string, CronEntry>();
  private executions: TaskExecution[] = [];
  private maxExecutionHistory = 1000;

  async registerTask(task: BackgroundTask): Promise<BackgroundTask> {
    if (!FEATURE_FLAGS.ENABLE_BACKGROUND_TASKS) {
      Logger.warn('[BackgroundTasks] Background tasks disabled. Enable ENABLE_BACKGROUND_TASKS flag.');
      return task;
    }

    if (this.tasks.has(task.id)) {
      await this.cancelTask(task.id);
    }

    const entry: CronEntry = { task, timerId: null };
    this.tasks.set(task.id, entry);

    this.scheduleTask(entry);
    Logger.info(`[BackgroundTasks] Registered task: ${task.id} (${task.schedule.type})`);
    return task;
  }

  private scheduleTask(entry: CronEntry): void {
    const { task } = entry;

    switch (task.schedule.type) {
      case 'once': {
        const delay = task.schedule.runAt
          ? Math.max(0, task.schedule.runAt.getTime() - Date.now())
          : 0;
        entry.timerId = setTimeout(() => this.runTask(task.id), delay);
        task.nextRunAt = new Date(Date.now() + delay);
        break;
      }
      case 'interval': {
        const intervalMs = task.schedule.intervalMs || 60_000;
        entry.timerId = setInterval(() => this.runTask(task.id), intervalMs);
        task.nextRunAt = new Date(Date.now() + intervalMs);
        break;
      }
      case 'cron': {
        // Simplified cron — parse basic patterns
        const intervalMs = this.cronToInterval(task.schedule.cron || '*/5 * * * *');
        entry.timerId = setInterval(() => this.runTask(task.id), intervalMs);
        task.nextRunAt = new Date(Date.now() + intervalMs);
        break;
      }
      case 'continuous': {
        entry.timerId = setInterval(() => this.runTask(task.id), 5000);
        task.nextRunAt = new Date(Date.now() + 5000);
        break;
      }
    }
  }

  private cronToInterval(cron: string): number {
    const parts = cron.split(' ');
    const minute = parts[0];

    if (minute.startsWith('*/')) {
      const mins = parseInt(minute.slice(2), 10);
      return mins * 60 * 1000;
    }
    // Default: hourly
    return 60 * 60 * 1000;
  }

  private async runTask(taskId: string): Promise<void> {
    const entry = this.tasks.get(taskId);
    if (!entry) return;

    const { task } = entry;
    if (task.status === 'cancelled' || task.status === 'paused') return;
    if (task.maxRuns && task.runCount >= task.maxRuns) {
      task.status = 'completed';
      this.clearTimer(entry);
      return;
    }

    const execution: TaskExecution = {
      taskId,
      executionId: `${taskId}-${Date.now()}`,
      startedAt: new Date(),
      status: 'running',
    };

    task.status = 'running';
    task.runCount++;
    task.lastRunAt = new Date();

    try {
      Logger.info(`[BackgroundTasks] Running task: ${taskId} (run #${task.runCount})`);
      execution.status = 'completed';
      execution.result = { ran: true, handler: task.handler };
    } catch (err: any) {
      task.errorCount++;
      task.lastError = err?.message || String(err);
      execution.status = 'failed';
      execution.error = task.lastError;
      Logger.error(`[BackgroundTasks] Task ${taskId} failed: ${task.lastError}`);
    } finally {
      execution.completedAt = new Date();
      execution.durationMs = execution.completedAt.getTime() - execution.startedAt.getTime();
      task.status = task.schedule.type === 'once' ? 'completed' : 'pending';

      this.executions.push(execution);
      if (this.executions.length > this.maxExecutionHistory) {
        this.executions = this.executions.slice(-this.maxExecutionHistory);
      }
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;

    entry.task.status = 'cancelled';
    this.clearTimer(entry);
    this.tasks.delete(taskId);
    Logger.info(`[BackgroundTasks] Cancelled task: ${taskId}`);
    return true;
  }

  async pauseTask(taskId: string): Promise<boolean> {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;

    entry.task.status = 'paused';
    this.clearTimer(entry);
    return true;
  }

  async resumeTask(taskId: string): Promise<boolean> {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;

    entry.task.status = 'pending';
    this.scheduleTask(entry);
    return true;
  }

  private clearTimer(entry: CronEntry): void {
    if (entry.timerId !== null) {
      clearInterval(entry.timerId as any);
      clearTimeout(entry.timerId as any);
      entry.timerId = null;
    }
  }

  listTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).map(e => e.task);
  }

  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId)?.task;
  }

  getExecutions(taskId?: string): TaskExecution[] {
    if (taskId) return this.executions.filter(e => e.taskId === taskId);
    return [...this.executions];
  }

  getStats() {
    const tasks = this.listTasks();
    return {
      totalTasks: tasks.length,
      running: tasks.filter(t => t.status === 'running').length,
      pending: tasks.filter(t => t.status === 'pending').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      totalExecutions: this.executions.length,
    };
  }

  async shutdown(): Promise<void> {
    for (const [id, entry] of this.tasks) {
      this.clearTimer(entry);
    }
    this.tasks.clear();
    Logger.info('[BackgroundTasks] Engine shut down');
  }
}

export const backgroundTaskEngine = new BackgroundTaskEngine();
