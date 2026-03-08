type SessionTranscriptUpdate = {
  sessionFile: string;
};

type SessionTranscriptListener = (update: SessionTranscriptUpdate) => void;

type SessionTranscriptState = {
  listeners: Set<SessionTranscriptListener>;
};

const SESSION_TRANSCRIPT_STATE = Symbol.for("openclaw.sessionTranscriptState");

const state = (() => {
  const globalState = globalThis as typeof globalThis & {
    [SESSION_TRANSCRIPT_STATE]?: SessionTranscriptState;
  };
  if (!globalState[SESSION_TRANSCRIPT_STATE]) {
    globalState[SESSION_TRANSCRIPT_STATE] = {
      listeners: new Set<SessionTranscriptListener>(),
    };
  }
  return globalState[SESSION_TRANSCRIPT_STATE]!;
})();

export function onSessionTranscriptUpdate(listener: SessionTranscriptListener): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function emitSessionTranscriptUpdate(sessionFile: string): void {
  const trimmed = sessionFile.trim();
  if (!trimmed) {
    return;
  }
  const update = { sessionFile: trimmed };
  for (const listener of state.listeners) {
    try {
      listener(update);
    } catch {
      /* ignore */
    }
  }
}
