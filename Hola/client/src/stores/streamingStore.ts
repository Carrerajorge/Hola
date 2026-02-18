import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

export type StreamingStatus = 'idle' | 'started' | 'streaming' | 'completed' | 'failed' | 'aborted';

export interface StreamingRun {
  chatId: string;
  chatTitle?: string;
  runId: string;
  requestId?: string;
  status: StreamingStatus;
  content: string;
  lastSeq: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  /** Tracks SLA deadline for first token (epoch ms). */
  firstTokenDeadline?: number;
  /** Tracks SLA deadline for terminal event (epoch ms). */
  terminalDeadline?: number;
  /** Number of auto-retry attempts performed. */
  retryCount?: number;
  /** Whether the SLA watchdog already fired for this run. */
  slaFired?: boolean;
}

export interface BackgroundNotification {
  id: string;
  chatId: string;
  chatTitle: string;
  preview: string;
  type: 'completed' | 'failed';
  timestamp: number;
  dismissed: boolean;
}

// ===== SLA Configuration =====
/** Max seconds to wait for first token before showing error. */
const SLA_FIRST_TOKEN_MS = 30_000;
/** Max seconds to wait for any terminal event after stream starts. */
const SLA_TERMINAL_EVENT_MS = 300_000;
/** Max auto-retry attempts on SLA violation. */
const MAX_AUTO_RETRIES = 1;

/** SLA watchdog timers, keyed by chatId. */
const slaTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/** Callback registry for auto-retry. Callers register a retry function per chatId. */
const retryCallbacks: Map<string, () => void> = new Map();

function clearSlaTimer(chatId: string): void {
  const timer = slaTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    slaTimers.delete(chatId);
  }
}

function startFirstTokenWatchdog(chatId: string): void {
  clearSlaTimer(chatId);
  const timer = setTimeout(() => {
    const state = useStreamingStore.getState();
    const run = state.runs.get(chatId);
    if (!run) return;

    // Only fire if still in 'started' (no first token received yet)
    if (run.status !== 'started') return;

    // Check if we can auto-retry
    const retryCount = run.retryCount ?? 0;
    if (retryCount < MAX_AUTO_RETRIES) {
      console.warn(`[StreamingSLA] First-token SLA violated for chat ${chatId}, auto-retrying (attempt ${retryCount + 1})`);
      useStreamingStore.getState().failRun(
        chatId,
        `No response received within ${SLA_FIRST_TOKEN_MS / 1000}s. Retrying...`,
        null,
        run.chatTitle,
      );

      // Attempt auto-retry via registered callback
      const retryCb = retryCallbacks.get(chatId);
      if (retryCb) {
        // Mark retry count on the next run
        setTimeout(() => {
          const newState = useStreamingStore.getState();
          const newRun = newState.runs.get(chatId);
          if (newRun) {
            const newRuns = new Map(newState.runs);
            newRuns.set(chatId, { ...newRun, retryCount: retryCount + 1 });
            useStreamingStore.setState({ runs: newRuns });
          }
        }, 100);
        retryCb();
      }
    } else {
      console.error(`[StreamingSLA] First-token SLA violated for chat ${chatId}, max retries exhausted`);
      useStreamingStore.getState().failRun(
        chatId,
        `The model did not respond within ${SLA_FIRST_TOKEN_MS / 1000}s. Please try again.`,
        null,
        run.chatTitle,
      );
    }
  }, SLA_FIRST_TOKEN_MS);
  slaTimers.set(chatId, timer);
}

function startTerminalWatchdog(chatId: string): void {
  // Don't override a first-token watchdog that hasn't fired yet
  if (slaTimers.has(chatId)) return;

  const timer = setTimeout(() => {
    const state = useStreamingStore.getState();
    const run = state.runs.get(chatId);
    if (!run) return;

    // Only fire if still active
    if (!['started', 'streaming'].includes(run.status)) return;

    console.error(`[StreamingSLA] Terminal event SLA violated for chat ${chatId} (stuck in ${run.status})`);
    useStreamingStore.getState().failRun(
      chatId,
      `Response timed out after ${SLA_TERMINAL_EVENT_MS / 1000}s. Please try again.`,
      null,
      run.chatTitle,
    );
  }, SLA_TERMINAL_EVENT_MS);
  slaTimers.set(chatId, timer);
}

interface StreamingState {
  runs: Map<string, StreamingRun>;
  pendingBadges: Record<string, number>;
  notifications: BackgroundNotification[];

  // Run management
  startRun: (chatId: string, runId?: string, requestId?: string, chatTitle?: string) => void;
  updateStatus: (chatId: string, status: StreamingStatus) => void;
  appendContent: (chatId: string, chunk: string, seq: number) => boolean;
  getContent: (chatId: string) => string;
  completeRun: (chatId: string, activeChatId: string | null, chatTitle?: string) => void;
  failRun: (chatId: string, error: string, activeChatId: string | null, chatTitle?: string) => void;
  abortRun: (chatId: string) => void;
  clearRun: (chatId: string) => void;

  // Badge management
  clearBadge: (chatId: string) => void;
  clearAllBadges: () => void;

  // Notification management
  addNotification: (notification: Omit<BackgroundNotification, 'id' | 'timestamp' | 'dismissed'>) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  // Queries
  isProcessing: (chatId: string) => boolean;
  getProcessingChatIds: () => string[];
  getRun: (chatId: string) => StreamingRun | undefined;

  // SLA management
  registerRetryCallback: (chatId: string, callback: () => void) => void;
  unregisterRetryCallback: (chatId: string) => void;
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  runs: new Map(),
  pendingBadges: {},
  notifications: [],

  startRun: (chatId: string, runId?: string, requestId?: string, chatTitle?: string) => {
    const id = runId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => {
      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        chatId,
        chatTitle,
        runId: id,
        requestId,
        status: 'started',
        content: '',
        lastSeq: -1,
        startedAt: Date.now(),
        firstTokenDeadline: Date.now() + SLA_FIRST_TOKEN_MS,
        terminalDeadline: Date.now() + SLA_TERMINAL_EVENT_MS,
        retryCount: 0,
        slaFired: false,
      });
      return { runs: newRuns };
    });

    // Start SLA watchdog for first token
    startFirstTokenWatchdog(chatId);
  },

  updateStatus: (chatId: string, status: StreamingStatus) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, { ...run, status });
      return { runs: newRuns };
    });
  },

  appendContent: (chatId: string, chunk: string, seq: number) => {
    const state = get();
    const run = state.runs.get(chatId);

    // Idempotency: skip if seq already processed
    if (!run || seq <= run.lastSeq) {
      return false;
    }

    // First content chunk received: clear first-token watchdog, start terminal watchdog
    if (run.status === 'started' && chunk.length > 0) {
      clearSlaTimer(chatId);
      startTerminalWatchdog(chatId);
    }

    set((s) => {
      const currentRun = s.runs.get(chatId);
      if (!currentRun || seq <= currentRun.lastSeq) return s;

      const newRuns = new Map(s.runs);
      newRuns.set(chatId, {
        ...currentRun,
        content: currentRun.content + chunk,
        lastSeq: seq,
        status: 'streaming',
      });
      return { runs: newRuns };
    });
    return true;
  },

  getContent: (chatId: string) => {
    const run = get().runs.get(chatId);
    return run?.content || '';
  },

  completeRun: (chatId: string, activeChatId: string | null, chatTitle?: string) => {
    clearSlaTimer(chatId);
    retryCallbacks.delete(chatId);

    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'completed',
        completedAt: Date.now(),
        chatTitle: chatTitle || run.chatTitle,
      });

      const isBackground = chatId !== activeChatId;
      const newBadges = isBackground
        ? { ...state.pendingBadges, [chatId]: (state.pendingBadges[chatId] || 0) + 1 }
        : state.pendingBadges;

      const newNotifications = isBackground
        ? [
          ...state.notifications,
          {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            chatId,
            chatTitle: chatTitle || run.chatTitle || 'Chat',
            preview: run.content.slice(0, 100),
            type: 'completed' as const,
            timestamp: Date.now(),
            dismissed: false,
          },
        ]
        : state.notifications;

      return { runs: newRuns, pendingBadges: newBadges, notifications: newNotifications };
    });
  },

  failRun: (chatId: string, error: string, activeChatId: string | null, chatTitle?: string) => {
    clearSlaTimer(chatId);

    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'failed',
        completedAt: Date.now(),
        error,
        chatTitle: chatTitle || run.chatTitle,
      });

      const isBackground = chatId !== activeChatId;
      const newBadges = isBackground
        ? { ...state.pendingBadges, [chatId]: (state.pendingBadges[chatId] || 0) + 1 }
        : state.pendingBadges;

      const newNotifications = isBackground
        ? [
          ...state.notifications,
          {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            chatId,
            chatTitle: chatTitle || run.chatTitle || 'Chat',
            preview: `Error: ${error.slice(0, 80)}`,
            type: 'failed' as const,
            timestamp: Date.now(),
            dismissed: false,
          },
        ]
        : state.notifications;

      return { runs: newRuns, pendingBadges: newBadges, notifications: newNotifications };
    });
  },

  abortRun: (chatId: string) => {
    clearSlaTimer(chatId);
    retryCallbacks.delete(chatId);

    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;

      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'aborted',
        completedAt: Date.now(),
      });

      return { runs: newRuns };
    });
  },

  clearRun: (chatId: string) => {
    clearSlaTimer(chatId);
    retryCallbacks.delete(chatId);

    set((state) => {
      const newRuns = new Map(state.runs);
      newRuns.delete(chatId);
      return { runs: newRuns };
    });
  },

  clearBadge: (chatId: string) => {
    set((state) => {
      const newBadges = { ...state.pendingBadges };
      delete newBadges[chatId];
      return { pendingBadges: newBadges };
    });
  },

  clearAllBadges: () => {
    set({ pendingBadges: {} });
  },

  addNotification: (notification) => {
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          ...notification,
          id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          dismissed: false,
        },
      ],
    }));
  },

  dismissNotification: (id: string) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, dismissed: true } : n
      ),
    }));
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },

  isProcessing: (chatId: string) => {
    const run = get().runs.get(chatId);
    return run ? ['started', 'streaming'].includes(run.status) : false;
  },

  getProcessingChatIds: () => {
    const runs = get().runs;
    const processingIds: string[] = [];
    runs.forEach((run, cid) => {
      if (['started', 'streaming'].includes(run.status)) {
        processingIds.push(cid);
      }
    });
    return processingIds;
  },

  getRun: (chatId: string) => {
    return get().runs.get(chatId);
  },

  // --- SLA management ---
  registerRetryCallback: (chatId: string, callback: () => void) => {
    retryCallbacks.set(chatId, callback);
  },

  unregisterRetryCallback: (chatId: string) => {
    retryCallbacks.delete(chatId);
  },
}));

// Selectors
const selectProcessingChatIds = (state: StreamingState): string[] => {
  const ids: string[] = [];
  state.runs.forEach((run, chatId) => {
    if (['started', 'streaming'].includes(run.status)) {
      ids.push(chatId);
    }
  });
  return ids;
};

const selectPendingBadges = (state: StreamingState): Record<string, number> => state.pendingBadges;

const selectNotifications = (state: StreamingState): BackgroundNotification[] =>
  state.notifications.filter((n) => !n.dismissed);

// Hooks
export function useProcessingChatIds(): string[] {
  return useStreamingStore(useShallow(selectProcessingChatIds));
}

export function usePendingBadges(): Record<string, number> {
  return useStreamingStore(useShallow(selectPendingBadges));
}

export function useNotifications(): BackgroundNotification[] {
  return useStreamingStore(useShallow(selectNotifications));
}

export function useChatIsProcessing(chatId: string | null | undefined): boolean {
  return useStreamingStore((state) => {
    if (!chatId) return false;
    const run = state.runs.get(chatId);
    return run ? ['started', 'streaming'].includes(run.status) : false;
  });
}

export function useChatStreamContent(chatId: string | null | undefined): string {
  return useStreamingStore((state) => {
    if (!chatId) return '';
    return state.runs.get(chatId)?.content || '';
  });
}

/**
 * Hook that returns the current run's error (if failed) for displaying to the user.
 */
export function useChatStreamError(chatId: string | null | undefined): string | undefined {
  return useStreamingStore((state) => {
    if (!chatId) return undefined;
    const run = state.runs.get(chatId);
    return run?.status === 'failed' ? run.error : undefined;
  });
}

/**
 * Hook that returns whether the run is in SLA violation (stuck).
 */
export function useChatStreamStuck(chatId: string | null | undefined): boolean {
  return useStreamingStore((state) => {
    if (!chatId) return false;
    const run = state.runs.get(chatId);
    if (!run || !['started', 'streaming'].includes(run.status)) return false;
    const now = Date.now();
    if (run.status === 'started' && run.firstTokenDeadline && now > run.firstTokenDeadline) return true;
    if (run.terminalDeadline && now > run.terminalDeadline) return true;
    return false;
  });
}
