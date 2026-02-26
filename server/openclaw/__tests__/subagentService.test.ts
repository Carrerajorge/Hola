import { describe, it, expect, vi, beforeEach } from 'vitest';

// Raise concurrent limit so accumulated runs across test suites don't block later tests.
// Must be set before the service module is first evaluated (reads env at construction time).
process.env.OPENCLAW_MAX_CONCURRENT_SUBAGENTS = '50';

// Track run resolution for controlled test timing
let runResolve: ((v: any) => void) | null = null;

// Mock heavy dependencies before importing — use real classes for `new` compatibility
vi.mock('../../services/agentRunner', () => {
  return {
    AgentRunner: class MockAgentRunner {
      on = vi.fn();
      cancel = vi.fn();
      run = vi.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            // Store resolve so tests can control when execution completes
            runResolve = resolve;
            // Auto-resolve after 200ms if test doesn't manually resolve
            setTimeout(
              () =>
                resolve({
                  success: true,
                  result: 'Test completed',
                  state: {
                    status: 'completed',
                    history: [{ tool: 'search', success: true }],
                    toolsUsed: ['search'],
                  },
                  run_id: 'test-run',
                }),
              200,
            );
          }),
      );
    },
  };
});

vi.mock('../persistence/statePersistence', () => ({
  getStatePersistence: vi.fn().mockReturnValue({
    saveRun: vi.fn().mockResolvedValue(undefined),
    getRun: vi.fn().mockResolvedValue(null),
    listRuns: vi.fn().mockResolvedValue([]),
    updateRunStatus: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../plugins/hookSystem', () => ({
  hookSystem: {
    dispatch: vi.fn().mockResolvedValue(undefined),
    register: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('../events', () => ({
  openclawEventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ══════════════════════════════════════════════════════════════════════════
// Part 1: Core CRUD (existing tests, preserved)
// ══════════════════════════════════════════════════════════════════════════

describe('OpenClaw Subagent Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runResolve = null;
  });

  it('spawns a subagent run and returns a valid record', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const run = openclawSubagentService.spawn({
      requesterUserId: 'user-1',
      objective: 'Search for AI research papers',
      planHint: ['search', 'analyze'],
    });

    expect(run.id).toMatch(/^subagent_/);
    // Status transitions from 'queued' → 'running' synchronously in execute(),
    // so by the time spawn returns it may already be 'running'
    expect(['queued', 'running']).toContain(run.status);
    expect(run.objective).toBe('Search for AI research papers');
    expect(run.planHint).toEqual(['search', 'analyze']);
  });

  it('lists runs filtered by user', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    openclawSubagentService.spawn({
      requesterUserId: 'user-a',
      objective: 'Task for user A',
    });

    const runs = openclawSubagentService.list({ requesterUserId: 'user-a' });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every(r => r.requesterUserId === 'user-a')).toBe(true);
  });

  it('can cancel a running subagent before it completes', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const run = openclawSubagentService.spawn({
      requesterUserId: 'user-cancel',
      objective: 'Cancellable task',
    });

    // Run is now 'running' (execute started synchronously).
    // The mock runner.run won't resolve for 200ms, so cancel should succeed.
    const cancelled = openclawSubagentService.cancel(run.id);
    expect(cancelled).toBe(true);

    const updated = openclawSubagentService.get(run.id);
    expect(updated?.status).toBe('cancelled');
  });

  it('cannot cancel a completed run', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const run = openclawSubagentService.spawn({
      requesterUserId: 'user-done',
      objective: 'Quick task',
    });

    // Wait for the mock to auto-resolve and execution to complete
    await new Promise(resolve => setTimeout(resolve, 350));

    const status = openclawSubagentService.get(run.id)?.status;
    // After 350ms the mock resolved, so run should be completed
    expect(status).toBe('completed');

    const cancelled = openclawSubagentService.cancel(run.id);
    expect(cancelled).toBe(false);
  });

  it('returns undefined for non-existent run', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');
    expect(openclawSubagentService.get('nonexistent')).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Part 2: Depth Enforcement
// ══════════════════════════════════════════════════════════════════════════

describe('Depth Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runResolve = null;
  });

  it('allows spawning at depth <= MAX_DEPTH (3)', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    // Depth 0: root run
    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-depth',
      objective: 'Root task',
    });
    expect(root.status).not.toBe('failed');

    // Depth 1: child of root
    const child1 = openclawSubagentService.spawn({
      requesterUserId: 'user-depth',
      objective: 'Child depth 1',
      parentRunId: root.id,
    });
    expect(child1.status).not.toBe('failed');

    // Depth 2: grandchild
    const child2 = openclawSubagentService.spawn({
      requesterUserId: 'user-depth',
      objective: 'Child depth 2',
      parentRunId: child1.id,
    });
    expect(child2.status).not.toBe('failed');
  });

  it('fails when spawning beyond MAX_DEPTH (3)', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    // Build a chain: root → child1 → child2 → child3
    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-deep',
      objective: 'Root',
    });

    const child1 = openclawSubagentService.spawn({
      requesterUserId: 'user-deep',
      objective: 'Depth 1',
      parentRunId: root.id,
    });

    const child2 = openclawSubagentService.spawn({
      requesterUserId: 'user-deep',
      objective: 'Depth 2',
      parentRunId: child1.id,
    });

    // child2 is at depth 2 from root. Spawning from child2 tries depth 3.
    // getDepth(child2.id) = 2, which should be < MAX_DEPTH(3), so this should succeed.
    const child3 = openclawSubagentService.spawn({
      requesterUserId: 'user-deep',
      objective: 'Depth 3',
      parentRunId: child2.id,
    });
    // depth of child2 = 2, which is < 3, so child3 should NOT fail
    expect(child3.status).not.toBe('failed');

    // Now child3 is at depth 3. Spawning from child3 should fail.
    const child4 = openclawSubagentService.spawn({
      requesterUserId: 'user-deep',
      objective: 'Depth 4 - should fail',
      parentRunId: child3.id,
    });
    expect(child4.status).toBe('failed');
    expect(child4.error).toContain('nesting depth');
  });

  it('getDepth returns 0 for root runs', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-gd',
      objective: 'Root',
    });

    expect(openclawSubagentService.getDepth(root.id)).toBe(0);
  });

  it('getDepth returns correct depth for nested runs', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-gd2',
      objective: 'Root',
    });
    const child = openclawSubagentService.spawn({
      requesterUserId: 'user-gd2',
      objective: 'Child',
      parentRunId: root.id,
    });

    expect(openclawSubagentService.getDepth(child.id)).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Part 3: SharedContext
// ══════════════════════════════════════════════════════════════════════════

describe('SharedContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runResolve = null;
  });

  it('set and get values within the same run tree', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-ctx',
      objective: 'Root',
    });

    openclawSubagentService.setSharedValue(root.id, 'key1', 'value1');
    expect(openclawSubagentService.getSharedValue(root.id, 'key1')).toBe('value1');
  });

  it('child and parent share the same context store', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-share',
      objective: 'Root',
    });
    const child = openclawSubagentService.spawn({
      requesterUserId: 'user-share',
      objective: 'Child',
      parentRunId: root.id,
    });

    // Parent sets a value
    openclawSubagentService.setSharedValue(root.id, 'shared_key', 'from_parent');

    // Child should see it (same root)
    expect(openclawSubagentService.getSharedValue(child.id, 'shared_key')).toBe('from_parent');

    // Child sets a value
    openclawSubagentService.setSharedValue(child.id, 'child_key', 'from_child');

    // Parent should see it
    expect(openclawSubagentService.getSharedValue(root.id, 'child_key')).toBe('from_child');
  });

  it('getSharedEntries returns all entries', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-entries',
      objective: 'Root',
    });

    openclawSubagentService.setSharedValue(root.id, 'a', 1);
    openclawSubagentService.setSharedValue(root.id, 'b', 2);

    const entries = openclawSubagentService.getSharedEntries(root.id);
    expect(entries).toEqual(expect.objectContaining({ a: 1, b: 2 }));
  });

  it('returns undefined for missing keys', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-miss',
      objective: 'Root',
    });

    expect(openclawSubagentService.getSharedValue(root.id, 'nonexistent')).toBeUndefined();
  });

  it('different run trees have isolated contexts', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const rootA = openclawSubagentService.spawn({
      requesterUserId: 'user-iso',
      objective: 'Tree A',
    });
    const rootB = openclawSubagentService.spawn({
      requesterUserId: 'user-iso',
      objective: 'Tree B',
    });

    openclawSubagentService.setSharedValue(rootA.id, 'key', 'valueA');
    openclawSubagentService.setSharedValue(rootB.id, 'key', 'valueB');

    expect(openclawSubagentService.getSharedValue(rootA.id, 'key')).toBe('valueA');
    expect(openclawSubagentService.getSharedValue(rootB.id, 'key')).toBe('valueB');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Part 4: awaitChildren
// ══════════════════════════════════════════════════════════════════════════

describe('awaitChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runResolve = null;
  });

  it('returns immediately when parent has no children', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-await0',
      objective: 'Root with no children',
    });

    // Use a unique parentRunId that has no children
    const result = await openclawSubagentService.awaitChildren('no-children-parent', {
      timeoutMs: 1000,
      pollIntervalMs: 50,
    });

    expect(result.allDone).toBe(true);
    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('waits for children to complete and returns aggregated results', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-await1',
      objective: 'Parent',
    });

    // Spawn children
    openclawSubagentService.spawn({
      requesterUserId: 'user-await1',
      objective: 'Child 1',
      parentRunId: root.id,
    });
    openclawSubagentService.spawn({
      requesterUserId: 'user-await1',
      objective: 'Child 2',
      parentRunId: root.id,
    });

    // The mock auto-resolves after 200ms, so await with generous timeout
    const result = await openclawSubagentService.awaitChildren(root.id, {
      timeoutMs: 2000,
      pollIntervalMs: 100,
    });

    expect(result.allDone).toBe(true);
    expect(result.completed.length).toBe(2);
    expect(result.failed.length).toBe(0);
  });

  it('returns allDone: false on timeout', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const parent = openclawSubagentService.spawn({
      requesterUserId: 'user-timeout',
      objective: 'Parent',
    });

    // Spawn a child — mock takes 200ms but we'll set timeout to 50ms
    openclawSubagentService.spawn({
      requesterUserId: 'user-timeout',
      objective: 'Slow child',
      parentRunId: parent.id,
    });

    const result = await openclawSubagentService.awaitChildren(parent.id, {
      timeoutMs: 50,
      pollIntervalMs: 10,
    });

    expect(result.allDone).toBe(false);
  });

  it('includes shared context in result', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const root = openclawSubagentService.spawn({
      requesterUserId: 'user-ctx-await',
      objective: 'Root',
    });

    // Set shared context before awaiting
    openclawSubagentService.setSharedValue(root.id, 'plan', 'step1,step2');

    const result = await openclawSubagentService.awaitChildren(root.id, {
      timeoutMs: 500,
      pollIntervalMs: 50,
    });

    expect(result.sharedContext).toEqual(expect.objectContaining({ plan: 'step1,step2' }));
  });
});
