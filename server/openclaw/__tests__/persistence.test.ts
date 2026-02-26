import { describe, it, expect, beforeEach } from 'vitest';
import { getStatePersistence, resetStatePersistence, type IStatePersistence } from '../persistence/statePersistence';

describe('OpenClaw State Persistence (in-memory)', () => {
  let persistence: IStatePersistence;

  beforeEach(() => {
    resetStatePersistence();
    persistence = getStatePersistence();
  });

  describe('Agent Runs', () => {
    it('saves and retrieves a run', async () => {
      await persistence.saveRun({
        id: 'run-1',
        userId: 'user-1',
        objective: 'Test objective',
        planHint: ['step1', 'step2'],
        status: 'queued',
        createdAt: Date.now(),
      });

      const run = await persistence.getRun('run-1');
      expect(run).not.toBeNull();
      expect(run!.id).toBe('run-1');
      expect(run!.objective).toBe('Test objective');
      expect(run!.planHint).toEqual(['step1', 'step2']);
    });

    it('returns null for non-existent run', async () => {
      const run = await persistence.getRun('nonexistent');
      expect(run).toBeNull();
    });

    it('updates run status', async () => {
      await persistence.saveRun({
        id: 'run-2',
        userId: 'user-1',
        objective: 'Another test',
        planHint: [],
        status: 'queued',
        createdAt: Date.now(),
      });

      await persistence.updateRunStatus('run-2', 'running', { startedAt: Date.now() });

      const run = await persistence.getRun('run-2');
      expect(run!.status).toBe('running');
      expect(run!.startedAt).toBeDefined();
    });

    it('lists runs filtered by userId', async () => {
      await persistence.saveRun({
        id: 'run-a',
        userId: 'user-1',
        objective: 'Task A',
        planHint: [],
        status: 'completed',
        createdAt: Date.now() - 1000,
      });

      await persistence.saveRun({
        id: 'run-b',
        userId: 'user-2',
        objective: 'Task B',
        planHint: [],
        status: 'running',
        createdAt: Date.now(),
      });

      const user1Runs = await persistence.listRuns({ userId: 'user-1' });
      expect(user1Runs).toHaveLength(1);
      expect(user1Runs[0].id).toBe('run-a');
    });

    it('lists runs filtered by status', async () => {
      await persistence.saveRun({
        id: 'run-x',
        userId: 'user-1',
        objective: 'Running task',
        planHint: [],
        status: 'running',
        createdAt: Date.now(),
      });

      await persistence.saveRun({
        id: 'run-y',
        userId: 'user-1',
        objective: 'Done task',
        planHint: [],
        status: 'completed',
        createdAt: Date.now(),
      });

      const running = await persistence.listRuns({ status: 'running' });
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe('run-x');
    });

    it('upserts on save (update existing)', async () => {
      await persistence.saveRun({
        id: 'run-u',
        userId: 'user-1',
        objective: 'Task',
        planHint: [],
        status: 'queued',
        createdAt: Date.now(),
      });

      await persistence.saveRun({
        id: 'run-u',
        userId: 'user-1',
        objective: 'Task',
        planHint: [],
        status: 'completed',
        result: { answer: 'done' },
        createdAt: Date.now(),
        endedAt: Date.now(),
      });

      const run = await persistence.getRun('run-u');
      expect(run!.status).toBe('completed');
      expect(run!.result).toEqual({ answer: 'done' });
    });
  });

  describe('Graph Checkpoints', () => {
    it('saves and retrieves a checkpoint', async () => {
      await persistence.saveCheckpoint({
        runId: 'cp-run-1',
        state: 'ACT',
        transitionHistory: [
          { from: 'IDLE', to: 'PLAN', trigger: 'task_received', timestamp: Date.now() - 1000 },
          { from: 'PLAN', to: 'ACT', trigger: 'plan_complete', timestamp: Date.now() },
        ],
        plan: { steps: ['search', 'analyze'] },
        metrics: { tokensUsed: 500 },
        updatedAt: Date.now(),
      });

      const cp = await persistence.getCheckpoint('cp-run-1');
      expect(cp).not.toBeNull();
      expect(cp!.state).toBe('ACT');
      expect(cp!.transitionHistory).toHaveLength(2);
      expect(cp!.plan).toEqual({ steps: ['search', 'analyze'] });
    });

    it('returns null for non-existent checkpoint', async () => {
      const cp = await persistence.getCheckpoint('nonexistent');
      expect(cp).toBeNull();
    });

    it('deletes a checkpoint', async () => {
      await persistence.saveCheckpoint({
        runId: 'cp-del',
        state: 'DONE',
        transitionHistory: [],
        updatedAt: Date.now(),
      });

      await persistence.deleteCheckpoint('cp-del');
      const cp = await persistence.getCheckpoint('cp-del');
      expect(cp).toBeNull();
    });
  });
});
