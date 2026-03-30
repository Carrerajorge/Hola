import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import type { Message } from '../hooks/use-chats';
import { toastDone } from '../lib/toastDone';

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
}

export interface BackgroundNotification {
  id: string;
  chatId: string;
  chatTitle: string;
  preview: string;
  type: 'completed' | 'failed';
  timestamp: number;
  dismissed: boolean;
  runId?: string;
}

interface ReconcileRunParams {
  chatId: string;
  chatTitle?: string;
  activeChatId: string | null;
  messages: Message[];
}

interface PersistedStreamingState {
  runs: Map<string, StreamingRun>;
  pendingBadges: Record<string, number>;
}

interface StreamingState {
  runs: Map<string, StreamingRun>;
  pendingBadges: Record<string, number>;
  notifications: BackgroundNotification[];

  startRun: (chatId: string, runId?: string, requestId?: string, chatTitle?: string) => void;
  updateStatus: (chatId: string, status: StreamingStatus) => void;
  appendContent: (chatId: string, chunk: string, seq: number) => boolean;
  getContent: (chatId: string) => string;
  completeRun: (chatId: string, activeChatId: string | null, chatTitle?: string) => void;
  failRun: (chatId: string, error: string, activeChatId: string | null, chatTitle?: string) => void;
  abortRun: (chatId: string) => void;
  clearRun: (chatId: string) => void;
  reconcileRunFromMessages: (params: ReconcileRunParams) => void;

  clearBadge: (chatId: string) => void;
  clearAllBadges: () => void;

  addNotification: (notification: Omit<BackgroundNotification, 'id' | 'timestamp' | 'dismissed'>) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  isProcessing: (chatId: string) => boolean;
  getProcessingChatIds: () => string[];
  getRun: (chatId: string) => StreamingRun | undefined;
}

const STREAMING_STORAGE_NAME = 'sira-streaming-store';
const STREAMING_STORAGE_VERSION = 1;
const MAX_RECOVERABLE_RUN_AGE_MS = 30 * 60 * 1000;
const MAX_NOTIFICATION_ITEMS = 20;
const MAX_NOTIFICATION_AGE_MS = 12 * 60 * 60 * 1000;
const MAP_STORAGE_MARKER = '__ilia_map__';
const PROCESSING_STATUS_SET = new Set<StreamingStatus>(['started', 'streaming']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStreamingStatus(value: unknown): value is StreamingStatus {
  return value === 'idle'
    || value === 'started'
    || value === 'streaming'
    || value === 'completed'
    || value === 'failed'
    || value === 'aborted';
}

function isProcessingStatus(status: StreamingStatus): boolean {
  return PROCESSING_STATUS_SET.has(status);
}

function sanitizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clampPreview(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function sanitizePendingBadges(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};

  const badges: Record<string, number> = {};
  for (const [chatId, count] of Object.entries(value)) {
    if (typeof chatId !== 'string' || chatId.trim().length === 0) continue;
    if (typeof count !== 'number' || !Number.isFinite(count)) continue;

    const normalized = Math.max(0, Math.trunc(count));
    if (normalized > 0) {
      badges[chatId] = normalized;
    }
  }

  return badges;
}

function sanitizeRun(chatId: string, candidate: unknown, now: number = Date.now()): StreamingRun | null {
  if (!isObject(candidate)) return null;

  const status = isStreamingStatus(candidate.status) ? candidate.status : 'started';
  const startedAt = typeof candidate.startedAt === 'number' && Number.isFinite(candidate.startedAt)
    ? candidate.startedAt
    : now;

  if (!isProcessingStatus(status)) return null;
  if (now - startedAt > MAX_RECOVERABLE_RUN_AGE_MS) return null;

  const runId = sanitizeText(candidate.runId).trim();
  if (!runId) return null;

  return {
    chatId,
    chatTitle: sanitizeText(candidate.chatTitle).trim() || undefined,
    runId,
    requestId: sanitizeText(candidate.requestId).trim() || undefined,
    status,
    content: sanitizeText(candidate.content),
    lastSeq: typeof candidate.lastSeq === 'number' && Number.isFinite(candidate.lastSeq)
      ? candidate.lastSeq
      : -1,
    startedAt,
    completedAt: typeof candidate.completedAt === 'number' && Number.isFinite(candidate.completedAt)
      ? candidate.completedAt
      : undefined,
    error: sanitizeText(candidate.error).trim() || undefined,
  };
}

function sanitizePersistedRuns(value: unknown, now: number = Date.now()): Map<string, StreamingRun> {
  const runs = new Map<string, StreamingRun>();
  const entries = value instanceof Map
    ? Array.from(value.entries())
    : Array.isArray(value)
      ? value
      : [];

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [chatId, candidate] = entry;
    if (typeof chatId !== 'string' || chatId.trim().length === 0) continue;

    const run = sanitizeRun(chatId, candidate, now);
    if (run) {
      runs.set(chatId, run);
    }
  }

  return runs;
}

function filterRecoverableRuns(runs: Map<string, StreamingRun>, now: number = Date.now()): Map<string, StreamingRun> {
  const nextRuns = new Map<string, StreamingRun>();

  runs.forEach((run, chatId) => {
    if (isProcessingStatus(run.status) && now - run.startedAt <= MAX_RECOVERABLE_RUN_AGE_MS) {
      nextRuns.set(chatId, run);
    }
  });

  return nextRuns;
}

function createNotificationId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getMessageTimestamp(message: Message): number {
  const timestamp = message.timestamp instanceof Date
    ? message.timestamp.getTime()
    : new Date(message.timestamp as unknown as string).getTime();

  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function getMessageContent(message: Message): string {
  return sanitizeText(message.content);
}

function findCompletionMessage(run: StreamingRun, messages: Message[]): Message | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const orderedMessages = [...messages].sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
  const userMessageIndex = run.requestId
    ? orderedMessages.findIndex((message) => message.role === 'user' && message.requestId === run.requestId)
    : -1;
  const userMessage = userMessageIndex >= 0 ? orderedMessages[userMessageIndex] : null;

  if (userMessage) {
    const linkedByUserMessage = orderedMessages.find((message) =>
      message.role === 'assistant'
      && message.userMessageId === userMessage.id
      && getMessageContent(message).trim().length > 0
    );
    if (linkedByUserMessage) return linkedByUserMessage;

    const requestTimestamp = getMessageTimestamp(userMessage);
    const nextUserTimestamp = orderedMessages
      .slice(userMessageIndex + 1)
      .find((message) => message.role === 'user');
    const nextUserBoundary = nextUserTimestamp ? getMessageTimestamp(nextUserTimestamp) : Number.POSITIVE_INFINITY;

    const linkedWithinTurn = orderedMessages.find((message, index) =>
      index > userMessageIndex
      && message.role === 'assistant'
      && getMessageTimestamp(message) >= requestTimestamp
      && getMessageTimestamp(message) < nextUserBoundary
      && getMessageContent(message).trim().length > 0
    );
    if (linkedWithinTurn) return linkedWithinTurn;
  }

  if (run.runId) {
    const linkedByRunId = orderedMessages.find((message) =>
      message.role === 'assistant'
      && message.runId === run.runId
      && getMessageContent(message).trim().length > 0
    );
    if (linkedByRunId) return linkedByRunId;
  }

  return orderedMessages.find((message) =>
    message.role === 'assistant'
    && getMessageTimestamp(message) >= run.startedAt
    && getMessageContent(message).trim().length > 0
  ) || null;
}

function shouldNotify(chatId: string, activeChatId: string | null): { isBackgroundChat: boolean; shouldNotify: boolean } {
  const isHidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
  const isBackgroundChat = chatId !== activeChatId;

  return {
    isBackgroundChat,
    shouldNotify: isBackgroundChat || isHidden,
  };
}

function appendNotification(
  notifications: BackgroundNotification[],
  notification: Omit<BackgroundNotification, 'id' | 'timestamp' | 'dismissed'>,
): BackgroundNotification[] {
  const now = Date.now();
  const freshNotifications = notifications
    .filter((item) => now - item.timestamp <= MAX_NOTIFICATION_AGE_MS)
    .slice(-(MAX_NOTIFICATION_ITEMS - 1));

  const duplicate = freshNotifications.find((item) =>
    !item.dismissed
    && item.chatId === notification.chatId
    && item.type === notification.type
    && item.runId === notification.runId
  );

  if (duplicate) {
    return freshNotifications;
  }

  return [
    ...freshNotifications,
    {
      ...notification,
      id: createNotificationId(),
      timestamp: now,
      dismissed: false,
    },
  ];
}

function buildNotificationPreview(status: 'completed' | 'failed', content: string, error?: string): string {
  if (status === 'failed') {
    return clampPreview(`Error: ${sanitizeText(error)}`, 100);
  }

  return clampPreview(content, 100);
}

function dismissNotificationsForChat(notifications: BackgroundNotification[], chatId: string): BackgroundNotification[] {
  return notifications.map((notification) =>
    notification.chatId === chatId
      ? { ...notification, dismissed: true }
      : notification
  );
}

interface ApplyTerminalStateParams {
  chatId: string;
  activeChatId: string | null;
  status: 'completed' | 'failed';
  chatTitle?: string;
  completedAt?: number;
  content?: string;
  error?: string;
}

function applyTerminalState(state: StreamingState, params: ApplyTerminalStateParams): Partial<StreamingState> | StreamingState {
  const run = state.runs.get(params.chatId);
  if (!run || !isProcessingStatus(run.status)) {
    return state;
  }

  const newRuns = new Map(state.runs);
  const resolvedContent = typeof params.content === 'string' && params.content.length >= run.content.length
    ? params.content
    : run.content;
  const updatedRun: StreamingRun = {
    ...run,
    chatTitle: params.chatTitle || run.chatTitle,
    status: params.status,
    content: resolvedContent,
    completedAt: params.completedAt ?? Date.now(),
    error: params.status === 'failed' ? params.error || run.error : undefined,
  };
  newRuns.set(params.chatId, updatedRun);

  const notificationPolicy = shouldNotify(params.chatId, params.activeChatId);
  const newBadges = notificationPolicy.isBackgroundChat
    ? { ...state.pendingBadges, [params.chatId]: (state.pendingBadges[params.chatId] || 0) + 1 }
    : state.pendingBadges;

  if (params.status === 'completed' && !notificationPolicy.shouldNotify) {
    toastDone();
  }

  const newNotifications = notificationPolicy.shouldNotify
    ? appendNotification(state.notifications, {
      chatId: params.chatId,
      chatTitle: updatedRun.chatTitle || 'Chat',
      preview: buildNotificationPreview(
        params.status,
        resolvedContent,
        params.error,
      ),
      type: params.status === 'failed' ? 'failed' : 'completed',
      runId: updatedRun.runId,
    })
    : state.notifications;

  return {
    runs: newRuns,
    pendingBadges: newBadges,
    notifications: newNotifications,
  };
}

const streamingStorage = createJSONStorage<PersistedStreamingState>(() => localStorage, {
  replacer: (_key, value) => {
    if (value instanceof Map) {
      return {
        [MAP_STORAGE_MARKER]: true,
        value: Array.from(value.entries()),
      };
    }

    return value;
  },
  reviver: (_key, value) => {
    if (
      isObject(value)
      && value[MAP_STORAGE_MARKER] === true
      && Array.isArray(value.value)
    ) {
      return new Map(value.value);
    }

    return value;
  },
});

export const useStreamingStore = create<StreamingState>()(
  persist(
    (set, get) => ({
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
          });
          return { runs: newRuns };
        });
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

        if (!run || seq <= run.lastSeq) {
          return false;
        }

        set((currentState) => {
          const currentRun = currentState.runs.get(chatId);
          if (!currentRun || seq <= currentRun.lastSeq) return currentState;

          const newRuns = new Map(currentState.runs);
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
        set((state) => applyTerminalState(state, {
          chatId,
          activeChatId,
          status: 'completed',
          chatTitle,
        }));
      },

      failRun: (chatId: string, error: string, activeChatId: string | null, chatTitle?: string) => {
        set((state) => applyTerminalState(state, {
          chatId,
          activeChatId,
          status: 'failed',
          chatTitle,
          error,
        }));
      },

      abortRun: (chatId: string) => {
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
        set((state) => {
          const newRuns = new Map(state.runs);
          newRuns.delete(chatId);
          return { runs: newRuns };
        });
      },

      reconcileRunFromMessages: ({ chatId, chatTitle, activeChatId, messages }: ReconcileRunParams) => {
        if (!Array.isArray(messages) || messages.length === 0) return;

        set((state) => {
          const run = state.runs.get(chatId);
          if (!run || !isProcessingStatus(run.status)) {
            return state;
          }

          const completionMessage = findCompletionMessage(run, messages);
          if (!completionMessage) {
            return state;
          }

          return applyTerminalState(state, {
            chatId,
            activeChatId,
            status: 'completed',
            chatTitle,
            content: getMessageContent(completionMessage),
            completedAt: getMessageTimestamp(completionMessage),
          });
        });
      },

      clearBadge: (chatId: string) => {
        set((state) => {
          const newBadges = { ...state.pendingBadges };
          delete newBadges[chatId];
          return {
            pendingBadges: newBadges,
            notifications: dismissNotificationsForChat(state.notifications, chatId),
          };
        });
      },

      clearAllBadges: () => {
        set({ pendingBadges: {} });
      },

      addNotification: (notification) => {
        set((state) => ({
          notifications: appendNotification(state.notifications, notification),
        }));
      },

      dismissNotification: (id: string) => {
        set((state) => ({
          notifications: state.notifications.map((notification) =>
            notification.id === id ? { ...notification, dismissed: true } : notification
          ),
        }));
      },

      clearNotifications: () => {
        set({ notifications: [] });
      },

      isProcessing: (chatId: string) => {
        const run = get().runs.get(chatId);
        return run ? isProcessingStatus(run.status) : false;
      },

      getProcessingChatIds: () => {
        const processingIds: string[] = [];
        get().runs.forEach((run, chatId) => {
          if (isProcessingStatus(run.status)) {
            processingIds.push(chatId);
          }
        });
        return processingIds;
      },

      getRun: (chatId: string) => {
        return get().runs.get(chatId);
      },
    }),
    {
      name: STREAMING_STORAGE_NAME,
      version: STREAMING_STORAGE_VERSION,
      storage: streamingStorage,
      partialize: (state): PersistedStreamingState => ({
        runs: filterRecoverableRuns(state.runs),
        pendingBadges: sanitizePendingBadges(state.pendingBadges),
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<PersistedStreamingState>;
        return {
          ...currentState,
          runs: sanitizePersistedRuns(persisted.runs),
          pendingBadges: sanitizePendingBadges(persisted.pendingBadges),
          notifications: [],
        };
      },
    },
  ),
);

const selectProcessingChatIds = (state: StreamingState): string[] => {
  const ids: string[] = [];
  state.runs.forEach((run, chatId) => {
    if (isProcessingStatus(run.status)) {
      ids.push(chatId);
    }
  });
  return ids;
};

const selectPendingBadges = (state: StreamingState): Record<string, number> => state.pendingBadges;
const selectPendingBadgeTotal = (state: StreamingState): number =>
  Object.values(state.pendingBadges).reduce((sum, count) => sum + count, 0);

const selectNotifications = (state: StreamingState): BackgroundNotification[] =>
  state.notifications.filter((notification) => !notification.dismissed);

export function useProcessingChatIds(): string[] {
  return useStreamingStore(useShallow(selectProcessingChatIds));
}

export function usePendingBadges(): Record<string, number> {
  return useStreamingStore(useShallow(selectPendingBadges));
}

export function usePendingBadgeTotal(): number {
  return useStreamingStore(selectPendingBadgeTotal);
}

export function useNotifications(): BackgroundNotification[] {
  return useStreamingStore(useShallow(selectNotifications));
}

export function useChatIsProcessing(chatId: string | null | undefined): boolean {
  return useStreamingStore((state) => {
    if (!chatId) return false;
    const run = state.runs.get(chatId);
    return run ? isProcessingStatus(run.status) : false;
  });
}

export function useChatStreamContent(chatId: string | null | undefined): string {
  return useStreamingStore((state) => {
    if (!chatId) return '';
    return state.runs.get(chatId)?.content || '';
  });
}

// ============================================================================
// PERFORMANCE METRICS
// ============================================================================

export interface StreamPerformanceMetrics {
  startTime: number;
  firstTokenTime: number | null;
  endTime: number | null;
  tokenCount: number;
  charCount: number;
  duration: number;
  tokensPerSecond: number;
  timeToFirstToken: number;
}

const performanceMetrics = new Map<string, StreamPerformanceMetrics>();

export function recordStreamStart(chatId: string): void {
  performanceMetrics.set(chatId, {
    startTime: performance.now(),
    firstTokenTime: null,
    endTime: null,
    tokenCount: 0,
    charCount: 0,
    duration: 0,
    tokensPerSecond: 0,
    timeToFirstToken: 0,
  });
}

export function recordStreamToken(chatId: string, tokenLength: number): void {
  const metrics = performanceMetrics.get(chatId);
  if (!metrics) return;

  const now = performance.now();
  if (metrics.firstTokenTime === null) {
    metrics.firstTokenTime = now;
    metrics.timeToFirstToken = now - metrics.startTime;
  }

  metrics.tokenCount++;
  metrics.charCount += tokenLength;
}

export function recordStreamEnd(chatId: string): StreamPerformanceMetrics | null {
  const metrics = performanceMetrics.get(chatId);
  if (!metrics) return null;

  const endTime = performance.now();
  const duration = (endTime - metrics.startTime) / 1000;

  metrics.endTime = endTime;
  metrics.duration = duration;
  metrics.tokensPerSecond = duration > 0 ? metrics.tokenCount / duration : 0;

  // Log metrics
  console.info(`[Stream Performance] Chat ${chatId}:`, {
    duration: `${duration.toFixed(2)}s`,
    tokens: metrics.tokenCount,
    tokensPerSecond: metrics.tokensPerSecond.toFixed(2),
    timeToFirstToken: `${metrics.timeToFirstToken.toFixed(2)}ms`,
    chars: metrics.charCount,
  });

  return { ...metrics };
}

export function getStreamMetrics(chatId: string): StreamPerformanceMetrics | null {
  const metrics = performanceMetrics.get(chatId);
  return metrics ? { ...metrics } : null;
}

export function clearStreamMetrics(chatId: string): void {
  performanceMetrics.delete(chatId);
}

// ============================================================================
// OPTIMIZED SELECTORS (to prevent unnecessary re-renders)
// ============================================================================

// Selector for just the streaming status (prevents re-renders on content changes)
export function useChatIsStreaming(chatId: string | null | undefined): boolean {
  return useStreamingStore((state) => {
    if (!chatId) return false;
    const run = state.runs.get(chatId);
    return run?.status === 'streaming' || run?.status === 'started';
  });
}

// Selector for stream status only
export function useChatStreamStatus(chatId: string | null | undefined): StreamingStatus | null {
  return useStreamingStore((state) => {
    if (!chatId) return null;
    return state.runs.get(chatId)?.status || null;
  });
}

// Selector for stream start time
export function useChatStreamStartTime(chatId: string | null | undefined): number | null {
  return useStreamingStore((state) => {
    if (!chatId) return null;
    return state.runs.get(chatId)?.startedAt || null;
  });
}
