import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenClawSubagentService } from '../openclaw/agents/subagentService';

function makeStorePath(): string {
  return path.join(
    os.tmpdir(),
    'hola-openclaw-tests',
    `subagent-service-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for predicate');
}

describe('OpenClawSubagentService', () => {
  let storePath: string;

  beforeEach(() => {
    storePath = makeStorePath();
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
  });

  it('persists completed runs and reloads them from disk', async () => {
    const runner = {
      run: vi.fn(async () => ({
        success: true,
        result: { ok: true },
        state: { status: 'completed' },
      })),
      cancel: vi.fn(),
    };

    const service = createOpenClawSubagentService({
      storePath,
      runnerFactory: () => runner,
    });

    const run = service.spawn({
      requesterUserId: 'user_1',
      objective: 'Preparar resumen diario',
      planHint: ['schedule_task'],
    });

    await waitFor(() => service.get(run.id)?.status === 'completed');

    const reloaded = createOpenClawSubagentService({
      storePath,
      runnerFactory: () => runner,
    });

    expect(reloaded.get(run.id)).toMatchObject({
      id: run.id,
      status: 'completed',
      requesterUserId: 'user_1',
    });
    expect(reloaded.getStatus()).toMatchObject({
      storePath,
      totalRuns: 1,
      activeRunners: 0,
      counts: {
        queued: 0,
        running: 0,
        completed: 1,
        failed: 0,
        cancelled: 0,
      },
    });
  });

  it('marks interrupted queued or running runs as failed after restart recovery', () => {
    const interruptedRun = {
      id: 'subagent_old',
      requesterUserId: 'user_2',
      objective: 'Investigar pipeline',
      planHint: [],
      status: 'running' as const,
      createdAt: Date.now() - 5000,
      startedAt: Date.now() - 4000,
    };

    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          runs: [interruptedRun],
        },
        null,
        2,
      ),
      'utf8',
    );

    const service = createOpenClawSubagentService({
      storePath,
      runnerFactory: () => ({
        run: vi.fn(),
        cancel: vi.fn(),
      }),
    });

    expect(service.get('subagent_old')).toMatchObject({
      status: 'failed',
      error: 'Recovered interrupted subagent run after restart',
    });
    expect(service.getStatus().counts.failed).toBe(1);
  });
});
