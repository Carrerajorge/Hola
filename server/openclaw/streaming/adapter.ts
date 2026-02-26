import type { OpenClawConfig } from '../config';
import { BlockStreamAccumulator } from './blockStreaming';
import { PreviewStream } from './previewStreaming';
import { broadcastToSubscribed } from '../gateway/wsServer';
import { openclawEventBus } from '../events';
import { saveStreamingProgress } from '../../lib/streamingSeq';
import { Logger } from '../../lib/logger';

/** Maximum chars for a single tool.result WS frame before chunking. */
const TOOL_RESULT_CHUNK_SIZE = 8_192;

// Track active streaming pairs by runId
const activePairs = new Map<string, { block: BlockStreamAccumulator; preview: PreviewStream }>();

/**
 * Initialize the OpenClaw streaming subsystem.
 * Wires the openclawEventBus into the block/preview streaming pipeline
 * so LLM streaming tokens are processed through our chunking layer
 * before being broadcast to WebSocket clients.
 */
export function initStreaming(config: OpenClawConfig): void {
  // ── Bridge: openclawEventBus → streaming pipeline → WebSocket ──────────

  // Handle SSE-style stream deltas from the agent orchestrator
  openclawEventBus.on('stream:delta', (payload: { runId: string; content: string; [key: string]: any }) => {
    if (!payload.runId || !payload.content) return;

    let pair = activePairs.get(payload.runId);
    if (!pair) {
      pair = createStreamingPair(payload.runId, config);
      activePairs.set(payload.runId, pair);
    }

    pair.block.push(payload.content);
    pair.preview.push(payload.content);
  });

  // Handle stream completion
  openclawEventBus.on('stream:end', (payload: { runId: string; [key: string]: any }) => {
    if (!payload.runId) return;

    const pair = activePairs.get(payload.runId);
    if (pair) {
      pair.block.end();
      pair.preview.end();
      activePairs.delete(payload.runId);
    }

    // Persist final progress for resume support
    void saveStreamingProgress(payload.runId, Date.now(), '', 'completed');
  });

  // Handle stream errors (flush any buffered content)
  openclawEventBus.on('stream:error', (payload: { runId: string; error?: string }) => {
    if (!payload.runId) return;

    const pair = activePairs.get(payload.runId);
    if (pair) {
      pair.block.end(); // Flush buffered text
      pair.preview.end();
      activePairs.delete(payload.runId);

      broadcastToSubscribed('chat.error', {
        runId: payload.runId,
        error: payload.error || 'Stream error',
        timestamp: Date.now(),
      });
    }

    void saveStreamingProgress(payload.runId, Date.now(), '', 'failed');
  });

  // Handle tool execution events (broadcast tool start/end)
  openclawEventBus.on('tool:start', (payload: { runId: string; toolName: string; [key: string]: any }) => {
    if (!payload.runId) return;
    broadcastToSubscribed('tool.start', {
      runId: payload.runId,
      tool: payload.toolName,
      timestamp: Date.now(),
    });
  });

  openclawEventBus.on('tool:end', (payload: { runId: string; toolName: string; success: boolean; [key: string]: any }) => {
    if (!payload.runId) return;
    broadcastToSubscribed('tool.end', {
      runId: payload.runId,
      tool: payload.toolName,
      success: payload.success,
      timestamp: Date.now(),
    });
  });

  // ── Tool Result Streaming ───────────────────────────────────────────
  // Large tool outputs are chunked into multiple WS frames to prevent
  // overwhelming slow clients (works hand-in-hand with safeSend backpressure).
  openclawEventBus.on('tool:result', (payload: { runId: string; toolName: string; result?: string; [key: string]: any }) => {
    if (!payload.runId) return;

    const resultStr = typeof payload.result === 'string'
      ? payload.result
      : JSON.stringify(payload.result ?? '');

    if (resultStr.length <= TOOL_RESULT_CHUNK_SIZE) {
      // Small result: single frame
      broadcastToSubscribed('tool.result', {
        runId: payload.runId,
        tool: payload.toolName,
        chunk: resultStr,
        final: true,
        timestamp: Date.now(),
      });
      return;
    }

    // Large result: chunk into multiple frames
    for (let offset = 0; offset < resultStr.length; offset += TOOL_RESULT_CHUNK_SIZE) {
      const chunk = resultStr.slice(offset, offset + TOOL_RESULT_CHUNK_SIZE);
      const isFinal = offset + TOOL_RESULT_CHUNK_SIZE >= resultStr.length;
      broadcastToSubscribed('tool.result', {
        runId: payload.runId,
        tool: payload.toolName,
        chunk,
        final: isFinal,
        timestamp: Date.now(),
      });
    }
  });

  // ── Agent Status Broadcast ─────────────────────────────────────────
  // Structured status updates so clients can render progress indicators.
  openclawEventBus.on('agent:status', (payload: {
    runId: string;
    status: string;
    step: number;
    totalSteps: number;
    toolsUsed: string[];
  }) => {
    if (!payload.runId) return;
    broadcastToSubscribed('agent.status', {
      runId: payload.runId,
      status: payload.status,
      step: payload.step,
      totalSteps: payload.totalSteps,
      toolsUsed: payload.toolsUsed,
      timestamp: Date.now(),
    });
  });

  Logger.info(
    `[OpenClaw:Streaming] Initialized: block(${config.streaming.blockMinChars}-${config.streaming.blockMaxChars}), ` +
    `preview(${config.streaming.previewMode}), eventBus bridge active`,
  );
}

/**
 * Create a block + preview streaming pair for a specific run.
 */
export function createStreamingPair(
  runId: string,
  config: OpenClawConfig,
): { block: BlockStreamAccumulator; preview: PreviewStream } {
  const preview = new PreviewStream(runId, config.streaming.previewMode);

  const block = new BlockStreamAccumulator({
    minChars: config.streaming.blockMinChars,
    maxChars: config.streaming.blockMaxChars,
    onBlock: (text, index) => {
      broadcastToSubscribed('chat.delta', {
        runId,
        blockIndex: index,
        content: text,
        timestamp: Date.now(),
      });

      // Persist streaming progress for resume support
      void saveStreamingProgress(runId, index, text, 'streaming');
    },
  });

  return { block, preview };
}

/**
 * Get or create a streaming pair for a run (used by RPC handlers).
 */
export function getOrCreateStreamingPair(
  runId: string,
  config: OpenClawConfig,
): { block: BlockStreamAccumulator; preview: PreviewStream } {
  let pair = activePairs.get(runId);
  if (!pair) {
    pair = createStreamingPair(runId, config);
    activePairs.set(runId, pair);
  }
  return pair;
}

/**
 * Flush and clean up a streaming pair.
 */
export function endStreamingPair(runId: string): void {
  const pair = activePairs.get(runId);
  if (pair) {
    pair.block.end();
    pair.preview.end();
    activePairs.delete(runId);
  }
}

/** Number of active streaming pairs (for metrics/health). */
export function activeStreamCount(): number {
  return activePairs.size;
}
