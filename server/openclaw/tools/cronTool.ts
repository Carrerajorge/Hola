import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from '../../agent/toolRegistry';
import { Logger } from '../../lib/logger';
import { openclawEventBus } from '../events';

/**
 * OpenClaw Cron/Scheduling Tool
 *
 * Adapted from upstream openclaw cron-tool.ts.
 * Allows agents to schedule reminders, recurring tasks, and one-shot delayed actions.
 *
 * Jobs are stored in-memory with optional persistence via the event bus.
 * Each job belongs to a user and can deliver messages back to the agent session.
 */

export interface CronJob {
  id: string;
  userId: string;
  sessionKey?: string;
  text: string;
  /** ISO 8601 timestamp for one-shot, or cron expression for recurring */
  schedule: string;
  /** 'once' = fire and remove, 'recurring' = keep running */
  mode: 'once' | 'recurring';
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  tags?: string[];
}

// ── In-Memory Job Store ──────────────────────────────────────────────────

const jobs = new Map<string, CronJob>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let jobCounter = 0;

function generateJobId(): string {
  return `cron_${Date.now()}_${++jobCounter}`;
}

function scheduleJob(job: CronJob): void {
  // Clear existing timer
  const existing = timers.get(job.id);
  if (existing) clearTimeout(existing);

  if (!job.enabled) return;

  if (job.mode === 'once') {
    const triggerAt = new Date(job.schedule).getTime();
    const delay = triggerAt - Date.now();

    if (delay <= 0) {
      // Already past — fire immediately
      fireJob(job);
      return;
    }

    const timer = setTimeout(() => fireJob(job), Math.min(delay, 2_147_483_647));
    timers.set(job.id, timer);
    job.nextRunAt = job.schedule;
  } else {
    // Simple recurring: parse interval from schedule (e.g., "every 5m", "every 1h")
    const intervalMs = parseInterval(job.schedule);
    if (intervalMs > 0) {
      const timer = setTimeout(() => {
        fireJob(job);
        // Re-schedule for next interval
        if (job.enabled && jobs.has(job.id)) {
          scheduleJob(job);
        }
      }, intervalMs);
      timers.set(job.id, timer);
      job.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    }
  }
}

function parseInterval(schedule: string): number {
  const match = schedule.match(/every\s+(\d+)\s*(s|sec|m|min|h|hr|d|day)/i);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
    case 'sec':
      return value * 1000;
    case 'm':
    case 'min':
      return value * 60_000;
    case 'h':
    case 'hr':
      return value * 3_600_000;
    case 'd':
    case 'day':
      return value * 86_400_000;
    default:
      return 0;
  }
}

function fireJob(job: CronJob): void {
  job.lastRunAt = new Date().toISOString();
  job.runCount++;

  Logger.info(`[OpenClaw:Cron] Firing job ${job.id}: ${job.text}`);

  openclawEventBus.emit('cron:fired', {
    jobId: job.id,
    userId: job.userId,
    sessionKey: job.sessionKey,
    text: job.text,
    mode: job.mode,
    runCount: job.runCount,
  });

  if (job.mode === 'once') {
    job.enabled = false;
    timers.delete(job.id);
  }
}

function cleanupJob(jobId: string): void {
  const timer = timers.get(jobId);
  if (timer) clearTimeout(timer);
  timers.delete(jobId);
  jobs.delete(jobId);
}

// ── Tool Helpers ─────────────────────────────────────────────────────────

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable } };
}

// ── Tool Definitions ─────────────────────────────────────────────────────

export function createCronTool(): ToolDefinition {
  return {
    name: 'openclaw_cron',
    description:
      'Schedule reminders, recurring tasks, and delayed actions. ' +
      'Actions: add (create job), list (show jobs), remove (delete job), ' +
      'status (job details), run (force-fire a job), wake (re-enable a job).',
    inputSchema: z.object({
      action: z.enum(['add', 'list', 'remove', 'status', 'run', 'wake']),
      text: z
        .string()
        .optional()
        .describe('Reminder/task text (required for "add")'),
      schedule: z
        .string()
        .optional()
        .describe('ISO 8601 timestamp for one-shot, or "every Xm/h/d" for recurring'),
      mode: z
        .enum(['once', 'recurring'])
        .optional()
        .default('once')
        .describe('once = fire and done, recurring = repeat'),
      jobId: z
        .string()
        .optional()
        .describe('Job ID (for remove/status/run/wake)'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional tags for categorization'),
    }),
    capabilities: ['long_running'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const { action } = input;

      switch (action) {
        case 'add': {
          if (!input.text) return fail('MISSING_TEXT', 'Text is required for "add" action');
          if (!input.schedule)
            return fail('MISSING_SCHEDULE', 'Schedule is required for "add" action');

          const job: CronJob = {
            id: generateJobId(),
            userId: context.userId,
            sessionKey: context.chatId,
            text: input.text,
            schedule: input.schedule,
            mode: input.mode || 'once',
            enabled: true,
            createdAt: new Date().toISOString(),
            runCount: 0,
            tags: input.tags,
          };

          jobs.set(job.id, job);
          scheduleJob(job);

          Logger.info(`[OpenClaw:Cron] Created job ${job.id}: "${job.text}" (${job.schedule})`);
          return ok({
            jobId: job.id,
            schedule: job.schedule,
            mode: job.mode,
            nextRunAt: job.nextRunAt,
          });
        }

        case 'list': {
          const userJobs = [...jobs.values()].filter(j => j.userId === context.userId);
          return ok(
            userJobs.map(j => ({
              id: j.id,
              text: j.text.substring(0, 100),
              schedule: j.schedule,
              mode: j.mode,
              enabled: j.enabled,
              runCount: j.runCount,
              nextRunAt: j.nextRunAt,
              lastRunAt: j.lastRunAt,
            })),
          );
        }

        case 'remove': {
          if (!input.jobId) return fail('MISSING_JOB_ID', 'jobId is required for "remove"');
          const job = jobs.get(input.jobId);
          if (!job || job.userId !== context.userId) {
            return fail('NOT_FOUND', `Job not found: ${input.jobId}`);
          }
          cleanupJob(input.jobId);
          return ok({ removed: input.jobId });
        }

        case 'status': {
          if (!input.jobId) return fail('MISSING_JOB_ID', 'jobId is required for "status"');
          const job = jobs.get(input.jobId);
          if (!job || job.userId !== context.userId) {
            return fail('NOT_FOUND', `Job not found: ${input.jobId}`);
          }
          return ok(job);
        }

        case 'run': {
          if (!input.jobId) return fail('MISSING_JOB_ID', 'jobId is required for "run"');
          const job = jobs.get(input.jobId);
          if (!job || job.userId !== context.userId) {
            return fail('NOT_FOUND', `Job not found: ${input.jobId}`);
          }
          fireJob(job);
          return ok({ fired: job.id, runCount: job.runCount });
        }

        case 'wake': {
          if (!input.jobId) return fail('MISSING_JOB_ID', 'jobId is required for "wake"');
          const job = jobs.get(input.jobId);
          if (!job || job.userId !== context.userId) {
            return fail('NOT_FOUND', `Job not found: ${input.jobId}`);
          }
          job.enabled = true;
          scheduleJob(job);
          return ok({ woken: job.id, nextRunAt: job.nextRunAt });
        }

        default:
          return fail('UNKNOWN_ACTION', `Unknown action: ${action}`);
      }
    },
  };
}

// ── Exports for testing ──────────────────────────────────────────────────

export function _getJobStore(): Map<string, CronJob> {
  return jobs;
}

export function _clearAllJobs(): void {
  for (const [id] of jobs) cleanupJob(id);
}
