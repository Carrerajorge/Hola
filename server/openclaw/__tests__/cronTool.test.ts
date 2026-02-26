import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../events', () => ({
  openclawEventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createCronTool, _getJobStore, _clearAllJobs } from '../tools/cronTool';

describe('Cron Tool', () => {
  const tool = createCronTool();
  const ctx = { userId: 'user-cron', chatId: 'chat-1', runId: 'run-1' };

  beforeEach(() => {
    _clearAllJobs();
  });

  afterEach(() => {
    _clearAllJobs();
  });

  it('adds a one-shot job', async () => {
    const result = await tool.execute(
      {
        action: 'add',
        text: 'Remind me to check tests',
        schedule: new Date(Date.now() + 60_000).toISOString(),
        mode: 'once',
      },
      ctx as any,
    );

    expect(result.success).toBe(true);
    expect((result.output as any).jobId).toMatch(/^cron_/);
    expect(_getJobStore().size).toBe(1);
  });

  it('adds a recurring job', async () => {
    const result = await tool.execute(
      {
        action: 'add',
        text: 'Check health every 5 minutes',
        schedule: 'every 5m',
        mode: 'recurring',
      },
      ctx as any,
    );

    expect(result.success).toBe(true);
    const job = [..._getJobStore().values()][0];
    expect(job.mode).toBe('recurring');
    expect(job.enabled).toBe(true);
  });

  it('lists jobs for current user', async () => {
    await tool.execute(
      { action: 'add', text: 'Job 1', schedule: 'every 1h', mode: 'recurring' },
      ctx as any,
    );
    await tool.execute(
      { action: 'add', text: 'Job 2', schedule: 'every 2h', mode: 'recurring' },
      ctx as any,
    );

    const result = await tool.execute({ action: 'list' }, ctx as any);
    expect(result.success).toBe(true);
    expect((result.output as any[]).length).toBe(2);
  });

  it('does not list jobs from other users', async () => {
    await tool.execute(
      { action: 'add', text: 'Other user job', schedule: 'every 1h' },
      { userId: 'other-user', chatId: '', runId: '' } as any,
    );

    const result = await tool.execute({ action: 'list' }, ctx as any);
    expect((result.output as any[]).length).toBe(0);
  });

  it('removes a job', async () => {
    const addResult = await tool.execute(
      { action: 'add', text: 'Removable', schedule: 'every 1h' },
      ctx as any,
    );
    const jobId = (addResult.output as any).jobId;

    const removeResult = await tool.execute(
      { action: 'remove', jobId },
      ctx as any,
    );
    expect(removeResult.success).toBe(true);
    expect(_getJobStore().has(jobId)).toBe(false);
  });

  it('gets job status', async () => {
    const addResult = await tool.execute(
      { action: 'add', text: 'Status check', schedule: 'every 1h' },
      ctx as any,
    );
    const jobId = (addResult.output as any).jobId;

    const statusResult = await tool.execute(
      { action: 'status', jobId },
      ctx as any,
    );
    expect(statusResult.success).toBe(true);
    expect((statusResult.output as any).text).toBe('Status check');
  });

  it('force-runs a job', async () => {
    const addResult = await tool.execute(
      { action: 'add', text: 'Force run', schedule: 'every 1h' },
      ctx as any,
    );
    const jobId = (addResult.output as any).jobId;

    const runResult = await tool.execute(
      { action: 'run', jobId },
      ctx as any,
    );
    expect(runResult.success).toBe(true);
    expect((runResult.output as any).runCount).toBe(1);
  });

  it('fails when adding without text', async () => {
    const result = await tool.execute(
      { action: 'add', schedule: 'every 1h' },
      ctx as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_TEXT');
  });

  it('fails when adding without schedule', async () => {
    const result = await tool.execute(
      { action: 'add', text: 'No schedule' },
      ctx as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_SCHEDULE');
  });

  it('fails when removing non-existent job', async () => {
    const result = await tool.execute(
      { action: 'remove', jobId: 'nonexistent' },
      ctx as any,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('wakes a disabled job', async () => {
    const addResult = await tool.execute(
      { action: 'add', text: 'Wake me', schedule: 'every 1h' },
      ctx as any,
    );
    const jobId = (addResult.output as any).jobId;

    // Force-run to disable (if once mode)
    const job = _getJobStore().get(jobId)!;
    job.enabled = false;

    const wakeResult = await tool.execute(
      { action: 'wake', jobId },
      ctx as any,
    );
    expect(wakeResult.success).toBe(true);
    expect(_getJobStore().get(jobId)!.enabled).toBe(true);
  });
});
