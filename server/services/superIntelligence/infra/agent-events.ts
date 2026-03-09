import type { VerboseLevel } from "../auto-reply/thinking.js";

export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
};

type AgentEventListener = (evt: AgentEventPayload) => void;

type AgentEventsState = {
  seqByRun: Map<string, number>;
  listeners: Set<AgentEventListener>;
  runContextById: Map<string, AgentRunContext>;
};

const AGENT_EVENTS_STATE = Symbol.for("openclaw.agentEventsState");

const state = (() => {
  const globalState = globalThis as typeof globalThis & {
    [AGENT_EVENTS_STATE]?: AgentEventsState;
  };
  if (!globalState[AGENT_EVENTS_STATE]) {
    globalState[AGENT_EVENTS_STATE] = {
      seqByRun: new Map<string, number>(),
      listeners: new Set<AgentEventListener>(),
      runContextById: new Map<string, AgentRunContext>(),
    };
  }
  return globalState[AGENT_EVENTS_STATE]!;
})();

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) {
    return;
  }
  const existing = state.runContextById.get(runId);
  if (!existing) {
    state.runContextById.set(runId, { ...context });
    return;
  }
  if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
    existing.sessionKey = context.sessionKey;
  }
  if (context.verboseLevel && existing.verboseLevel !== context.verboseLevel) {
    existing.verboseLevel = context.verboseLevel;
  }
  if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
    existing.isHeartbeat = context.isHeartbeat;
  }
}

export function getAgentRunContext(runId: string) {
  return state.runContextById.get(runId);
}

export function clearAgentRunContext(runId: string) {
  state.runContextById.delete(runId);
}

export function resetAgentRunContextForTest() {
  state.seqByRun.clear();
  state.listeners.clear();
  state.runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const nextSeq = (state.seqByRun.get(event.runId) ?? 0) + 1;
  state.seqByRun.set(event.runId, nextSeq);
  const context = state.runContextById.get(event.runId);
  const sessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim()
      ? event.sessionKey
      : context?.sessionKey;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  for (const listener of state.listeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore */
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
