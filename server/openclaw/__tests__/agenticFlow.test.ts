import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Raise concurrent limit for test accumulation across suites
process.env.OPENCLAW_MAX_CONCURRENT_SUBAGENTS = '50';

// ── Capture events emitted to the OpenClaw event bus ─────────────────────
const emittedEvents: Array<{ event: string; payload: any }> = [];

vi.mock('../events', () => ({
  openclawEventBus: {
    emit: vi.fn((event: string, payload: any) => {
      emittedEvents.push({ event, payload });
    }),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

// ── Mock AgentRunner to control execution flow ───────────────────────────
let runResolve: ((v: any) => void) | null = null;

vi.mock('../../services/agentRunner', () => {
  return {
    AgentRunner: class MockAgentRunner {
      private listeners = new Map<string, Function[]>();

      on = vi.fn((event: string, handler: Function) => {
        const existing = this.listeners.get(event) || [];
        existing.push(handler);
        this.listeners.set(event, existing);
      });

      cancel = vi.fn();

      run = vi.fn().mockImplementation((objective: string, planHint: string[]) => {
        // Emit lifecycle events that SubagentService bridges to openclawEventBus
        const fire = (event: string, data: any) => {
          for (const h of this.listeners.get(event) || []) h(data);
        };

        return new Promise(resolve => {
          runResolve = resolve;

          // Simulate: started → step_started → step_completed → completed
          fire('started', { run_id: 'mock-run', objective, plan: planHint });

          setTimeout(() => {
            fire('step_started', { stepIndex: 0, action: { tool: 'search', input: {} } });
          }, 10);

          setTimeout(() => {
            fire('step_completed', {
              step: { tool: 'search', success: true, output: 'search results', duration: 50 },
              state: { history: [{ tool: 'search', success: true }], toolsUsed: ['search'] },
            });
          }, 30);

          setTimeout(() => {
            const result = {
              success: true,
              result: `Completed: ${objective}`,
              state: {
                status: 'completed',
                history: [{ tool: 'search', success: true }],
                toolsUsed: ['search'],
              },
              run_id: 'mock-run',
            };
            fire('completed', { run_id: 'mock-run', result: result.result, state: result.state });
            resolve(result);
          }, 60);
        });
      });
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

vi.mock('../../lib/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ══════════════════════════════════════════════════════════════════════════
// End-to-End Agentic Flow: spawn → lifecycle events → streaming → complete
// ══════════════════════════════════════════════════════════════════════════

describe('End-to-End Agentic Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emittedEvents.length = 0;
    runResolve = null;
  });

  it('emits stream:delta events during agent execution', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const run = openclawSubagentService.spawn({
      requesterUserId: 'user-e2e',
      objective: 'Search for AI papers',
      planHint: ['search', 'analyze'],
    });

    expect(run.id).toMatch(/^subagent_/);

    // Wait for mock execution to complete (60ms + buffer)
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should have emitted stream:delta events for plan, steps, and completion
    const deltas = emittedEvents.filter(e => e.event === 'stream:delta');
    expect(deltas.length).toBeGreaterThanOrEqual(3);

    // First delta should contain the objective
    expect(deltas[0].payload.content).toContain('Search for AI papers');
    // Should contain plan
    expect(deltas[0].payload.content).toContain('search');
  });

  it('emits tool:start and tool:end events during steps', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    openclawSubagentService.spawn({
      requesterUserId: 'user-tool-events',
      objective: 'Test tool events',
    });

    await new Promise(resolve => setTimeout(resolve, 150));

    const toolStarts = emittedEvents.filter(e => e.event === 'tool:start');
    const toolEnds = emittedEvents.filter(e => e.event === 'tool:end');

    expect(toolStarts.length).toBeGreaterThanOrEqual(1);
    expect(toolEnds.length).toBeGreaterThanOrEqual(1);
    expect(toolStarts[0].payload.toolName).toBe('search');
    expect(toolEnds[0].payload.success).toBe(true);
  });

  it('emits tool:result with the tool output', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    openclawSubagentService.spawn({
      requesterUserId: 'user-tool-result',
      objective: 'Test tool result',
    });

    await new Promise(resolve => setTimeout(resolve, 150));

    const toolResults = emittedEvents.filter(e => e.event === 'tool:result');
    expect(toolResults.length).toBeGreaterThanOrEqual(1);
    expect(toolResults[0].payload.result).toContain('search results');
  });

  it('emits agent:status updates throughout execution', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    openclawSubagentService.spawn({
      requesterUserId: 'user-status',
      objective: 'Test status updates',
    });

    await new Promise(resolve => setTimeout(resolve, 150));

    const statuses = emittedEvents.filter(e => e.event === 'agent:status');
    expect(statuses.length).toBeGreaterThanOrEqual(2); // at least started + completed

    // First status should be 'running'
    const running = statuses.find(s => s.payload.status === 'running');
    expect(running).toBeDefined();

    // Last status should be 'completed'
    const completed = statuses.find(s => s.payload.status === 'completed');
    expect(completed).toBeDefined();
    expect(completed!.payload.toolsUsed).toContain('search');
  });

  it('emits stream:end on successful completion', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    openclawSubagentService.spawn({
      requesterUserId: 'user-end',
      objective: 'Test stream end',
    });

    await new Promise(resolve => setTimeout(resolve, 150));

    const ends = emittedEvents.filter(e => e.event === 'stream:end');
    expect(ends.length).toBe(1);
    expect(ends[0].payload.runId).toMatch(/^subagent_/);
  });

  it('run record reflects completed status with result', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const run = openclawSubagentService.spawn({
      requesterUserId: 'user-record',
      objective: 'Test final record',
    });

    await new Promise(resolve => setTimeout(resolve, 150));

    const final = openclawSubagentService.get(run.id);
    expect(final?.status).toBe('completed');
    expect(final?.result).toContain('Completed');
    expect(final?.toolsUsed).toContain('search');
    expect(final?.stepsCompleted).toBeGreaterThanOrEqual(1);
  });

  it('parallel subagents all emit independent event streams', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const parent = openclawSubagentService.spawn({
      requesterUserId: 'user-parallel',
      objective: 'Parent coordinator',
    });

    const child1 = openclawSubagentService.spawn({
      requesterUserId: 'user-parallel',
      objective: 'Child task A',
      parentRunId: parent.id,
    });

    const child2 = openclawSubagentService.spawn({
      requesterUserId: 'user-parallel',
      objective: 'Child task B',
      parentRunId: parent.id,
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // All three should have emitted their own stream:delta events
    const parentDeltas = emittedEvents.filter(
      e => e.event === 'stream:delta' && e.payload.runId === parent.id,
    );
    const child1Deltas = emittedEvents.filter(
      e => e.event === 'stream:delta' && e.payload.runId === child1.id,
    );
    const child2Deltas = emittedEvents.filter(
      e => e.event === 'stream:delta' && e.payload.runId === child2.id,
    );

    expect(parentDeltas.length).toBeGreaterThanOrEqual(1);
    expect(child1Deltas.length).toBeGreaterThanOrEqual(1);
    expect(child2Deltas.length).toBeGreaterThanOrEqual(1);

    // Each should reference their own objective
    expect(parentDeltas[0].payload.content).toContain('Parent coordinator');
    expect(child1Deltas[0].payload.content).toContain('Child task A');
    expect(child2Deltas[0].payload.content).toContain('Child task B');
  });

  it('awaitChildren aggregates results from parallel subagents', async () => {
    const { openclawSubagentService } = await import('../agents/subagentService');

    const parent = openclawSubagentService.spawn({
      requesterUserId: 'user-aggregate',
      objective: 'Aggregate parent',
    });

    openclawSubagentService.spawn({
      requesterUserId: 'user-aggregate',
      objective: 'Sub-task 1',
      parentRunId: parent.id,
    });

    openclawSubagentService.spawn({
      requesterUserId: 'user-aggregate',
      objective: 'Sub-task 2',
      parentRunId: parent.id,
    });

    // Wait for all to complete
    const result = await openclawSubagentService.awaitChildren(parent.id, {
      timeoutMs: 2000,
      pollIntervalMs: 50,
    });

    expect(result.allDone).toBe(true);
    expect(result.completed.length).toBe(2);
    expect(result.failed.length).toBe(0);

    // Aggregated results should contain both child results
    const resultValues = Object.values(result.aggregatedResults);
    expect(resultValues.length).toBe(2);
    // Results auto-stored in shared context
    expect(Object.keys(result.sharedContext).length).toBeGreaterThanOrEqual(2);
  });
});
