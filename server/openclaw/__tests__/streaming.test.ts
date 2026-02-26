import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockStreamAccumulator } from '../streaming/blockStreaming';

// ── Mock wsServer so we can inspect broadcast calls ───────────────────────
const broadcastToSubscribed = vi.fn();
const broadcastEvent = vi.fn();
vi.mock('../gateway/wsServer', () => ({
  broadcastToSubscribed,
  broadcastEvent,
}));

// Mock streamingSeq (adapter imports it)
vi.mock('../../lib/streamingSeq', () => ({
  saveStreamingProgress: vi.fn().mockResolvedValue(undefined),
  getStreamingProgress: vi.fn().mockResolvedValue(null),
}));

// Mock openclawEventBus — capture registered listeners so we can fire them manually
const listeners = new Map<string, Function[]>();
vi.mock('../events', () => ({
  openclawEventBus: {
    on: vi.fn((event: string, handler: Function) => {
      const existing = listeners.get(event) || [];
      existing.push(handler);
      listeners.set(event, existing);
    }),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ══════════════════════════════════════════════════════════════════════════
// Part 1: Block Streaming (existing tests, preserved)
// ══════════════════════════════════════════════════════════════════════════

describe('Block Streaming', () => {
  it('accumulates text and emits blocks when threshold is reached', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 50, onBlock });

    acc.push('Hello ');
    expect(onBlock).not.toHaveBeenCalled();

    acc.push('World! This is a test.');
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onBlock.mock.calls[0][0]).toContain('Hello World!');
  });

  it('flushes remaining text on end', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 100, maxChars: 500, onBlock });

    acc.push('Short text');
    expect(onBlock).not.toHaveBeenCalled();

    acc.end();
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onBlock.mock.calls[0][0]).toBe('Short text');
  });

  it('respects sentence boundaries for block breaks', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 50, onBlock });

    acc.push('First sentence. Second sentence. Third sentence.');
    acc.end();

    // Should break at sentence boundaries
    for (const call of onBlock.mock.calls) {
      const text = call[0] as string;
      expect(text.trimEnd().endsWith('.') || text.length < 10).toBe(true);
    }
  });

  it('tracks block indices incrementally', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 5, maxChars: 20, onBlock });

    acc.push('First block. Second block. Third block.');
    acc.end();

    // Each block should have incrementing indices
    const indices = onBlock.mock.calls.map(call => call[1]);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('force-emits when buffer exceeds maxChars', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 20, onBlock });

    // Push a long string without any sentence boundaries
    acc.push('abcdefghijklmnopqrstuvwxyz1234567890');

    expect(onBlock).toHaveBeenCalled();
    // All emitted blocks should be <= maxChars
    for (const call of onBlock.mock.calls) {
      expect((call[0] as string).length).toBeLessThanOrEqual(20);
    }
  });

  it('reports buffered length', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 100, maxChars: 500, onBlock });

    acc.push('hello');
    expect(acc.bufferedLength).toBe(5);

    acc.push(' world');
    expect(acc.bufferedLength).toBe(11);

    acc.end();
    expect(acc.bufferedLength).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Part 2: PreviewStream
// ══════════════════════════════════════════════════════════════════════════

describe('PreviewStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing in "off" mode', async () => {
    const { PreviewStream } = await import('../streaming/previewStreaming');
    const ps = new PreviewStream('run-off', 'off');

    ps.push('hello');
    ps.push(' world');
    ps.end();

    expect(broadcastToSubscribed).not.toHaveBeenCalled();
  });

  it('sends full accumulated text in "partial" mode', async () => {
    const { PreviewStream } = await import('../streaming/previewStreaming');
    const ps = new PreviewStream('run-partial', 'partial');

    ps.push('hello');
    expect(broadcastToSubscribed).toHaveBeenCalledWith('chat.preview', expect.objectContaining({
      runId: 'run-partial',
      mode: 'replace',
      content: 'hello',
    }));

    ps.push(' world');
    expect(broadcastToSubscribed).toHaveBeenCalledWith('chat.preview', expect.objectContaining({
      mode: 'replace',
      content: 'hello world',
    }));
  });

  it('sends only delta in "block" mode', async () => {
    const { PreviewStream } = await import('../streaming/previewStreaming');
    const ps = new PreviewStream('run-block', 'block');

    ps.push('hello');
    expect(broadcastToSubscribed).toHaveBeenCalledWith('chat.preview', expect.objectContaining({
      mode: 'append',
      content: 'hello',
    }));

    ps.push(' world');
    expect(broadcastToSubscribed).toHaveBeenCalledWith('chat.preview', expect.objectContaining({
      mode: 'append',
      content: ' world',
    }));
  });

  it('sends char count in "progress" mode', async () => {
    const { PreviewStream } = await import('../streaming/previewStreaming');
    const ps = new PreviewStream('run-progress', 'progress');

    ps.push('hello');
    expect(broadcastToSubscribed).toHaveBeenCalledWith('chat.preview', expect.objectContaining({
      mode: 'progress',
      chars: 5,
    }));
  });

  it('sends "done" event on end()', async () => {
    const { PreviewStream } = await import('../streaming/previewStreaming');
    const ps = new PreviewStream('run-end', 'partial');

    ps.push('text');
    vi.clearAllMocks();

    ps.end();
    expect(broadcastToSubscribed).toHaveBeenCalledWith('chat.preview', expect.objectContaining({
      runId: 'run-end',
      mode: 'done',
      content: 'text',
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Part 3: Adapter — eventBus bridge
// ══════════════════════════════════════════════════════════════════════════

describe('Streaming Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('registers event listeners on init', async () => {
    const { initStreaming } = await import('../streaming/adapter');

    initStreaming({
      streaming: { enabled: true, blockMinChars: 10, blockMaxChars: 100, previewMode: 'off' },
    } as any);

    expect(listeners.has('stream:delta')).toBe(true);
    expect(listeners.has('stream:end')).toBe(true);
    expect(listeners.has('stream:error')).toBe(true);
    expect(listeners.has('tool:start')).toBe(true);
    expect(listeners.has('tool:end')).toBe(true);
    expect(listeners.has('tool:result')).toBe(true);
    expect(listeners.has('agent:status')).toBe(true);
  });

  it('broadcasts tool.start and tool.end via broadcastToSubscribed', async () => {
    const { initStreaming } = await import('../streaming/adapter');
    initStreaming({
      streaming: { enabled: true, blockMinChars: 10, blockMaxChars: 100, previewMode: 'off' },
    } as any);

    // Fire tool:start
    const startHandlers = listeners.get('tool:start') || [];
    for (const h of startHandlers) {
      h({ runId: 'run-tool', toolName: 'search' });
    }

    expect(broadcastToSubscribed).toHaveBeenCalledWith('tool.start', expect.objectContaining({
      runId: 'run-tool',
      tool: 'search',
    }));

    // Fire tool:end
    const endHandlers = listeners.get('tool:end') || [];
    for (const h of endHandlers) {
      h({ runId: 'run-tool', toolName: 'search', success: true });
    }

    expect(broadcastToSubscribed).toHaveBeenCalledWith('tool.end', expect.objectContaining({
      runId: 'run-tool',
      tool: 'search',
      success: true,
    }));
  });

  it('chunks large tool results into multiple frames', async () => {
    const { initStreaming } = await import('../streaming/adapter');
    initStreaming({
      streaming: { enabled: true, blockMinChars: 10, blockMaxChars: 100, previewMode: 'off' },
    } as any);

    // Create a result larger than TOOL_RESULT_CHUNK_SIZE (8192)
    const bigResult = 'x'.repeat(20_000);
    const resultHandlers = listeners.get('tool:result') || [];
    for (const h of resultHandlers) {
      h({ runId: 'run-chunk', toolName: 'bigTool', result: bigResult });
    }

    // Should have been called multiple times
    const toolResultCalls = broadcastToSubscribed.mock.calls.filter(
      (c: any) => c[0] === 'tool.result',
    );
    expect(toolResultCalls.length).toBeGreaterThan(1);

    // Only the last chunk should have final: true
    const lastCall = toolResultCalls[toolResultCalls.length - 1];
    expect(lastCall[1].final).toBe(true);

    // All non-final chunks should have final: false
    for (let i = 0; i < toolResultCalls.length - 1; i++) {
      expect(toolResultCalls[i][1].final).toBe(false);
    }

    // Concatenated chunks should equal original
    const reassembled = toolResultCalls.map((c: any) => c[1].chunk).join('');
    expect(reassembled).toBe(bigResult);
  });

  it('sends small tool results in a single frame', async () => {
    const { initStreaming } = await import('../streaming/adapter');
    initStreaming({
      streaming: { enabled: true, blockMinChars: 10, blockMaxChars: 100, previewMode: 'off' },
    } as any);

    const resultHandlers = listeners.get('tool:result') || [];
    vi.clearAllMocks();
    for (const h of resultHandlers) {
      h({ runId: 'run-small', toolName: 'smallTool', result: 'done' });
    }

    const toolResultCalls = broadcastToSubscribed.mock.calls.filter(
      (c: any) => c[0] === 'tool.result',
    );
    expect(toolResultCalls.length).toBe(1);
    expect(toolResultCalls[0][1].final).toBe(true);
    expect(toolResultCalls[0][1].chunk).toBe('done');
  });
});
