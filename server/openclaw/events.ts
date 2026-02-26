import { EventEmitter } from 'events';

/**
 * Lightweight event bus for the OpenClaw subsystem.
 *
 * Bridges AgentRunner lifecycle events → streaming adapter → WebSocket clients.
 * Uses standard EventEmitter semantics (unlike the SSE-based agentEventBus
 * which has a custom emit(runId, type, opts) signature).
 *
 * Events:
 *   stream:delta   { runId, content }
 *   stream:end     { runId }
 *   stream:error   { runId, error }
 *   tool:start     { runId, toolName }
 *   tool:end       { runId, toolName, success }
 *   tool:result    { runId, toolName, result }
 *   agent:status   { runId, status, step, totalSteps, toolsUsed }
 */
class OpenClawEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }
}

export const openclawEventBus = new OpenClawEventBus();
