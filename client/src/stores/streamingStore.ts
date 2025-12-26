import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

export type StreamingStatus = 'idle' | 'started' | 'streaming' | 'completed' | 'failed' | 'aborted';

export interface StreamingRun {
  chatId: string;
  runId: string;
  status: StreamingStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

interface StreamingState {
  runs: Map<string, StreamingRun>;
  pendingBadges: Record<string, number>;
  
  startRun: (chatId: string, runId?: string) => void;
  updateStatus: (chatId: string, status: StreamingStatus) => void;
  completeRun: (chatId: string, activeChatId: string | null) => void;
  failRun: (chatId: string, error: string, activeChatId: string | null) => void;
  abortRun: (chatId: string) => void;
  clearBadge: (chatId: string) => void;
  clearAllBadges: () => void;
  isProcessing: (chatId: string) => boolean;
  getProcessingChatIds: () => string[];
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  runs: new Map(),
  pendingBadges: {},
  
  startRun: (chatId: string, runId?: string) => {
    const id = runId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => {
      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        chatId,
        runId: id,
        status: 'started',
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
  
  completeRun: (chatId: string, activeChatId: string | null) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;
      
      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'completed',
        completedAt: Date.now(),
      });
      
      const shouldShowBadge = chatId !== activeChatId;
      const newBadges = shouldShowBadge
        ? { ...state.pendingBadges, [chatId]: (state.pendingBadges[chatId] || 0) + 1 }
        : state.pendingBadges;
      
      return { runs: newRuns, pendingBadges: newBadges };
    });
  },
  
  failRun: (chatId: string, error: string, activeChatId: string | null) => {
    set((state) => {
      const run = state.runs.get(chatId);
      if (!run) return state;
      
      const newRuns = new Map(state.runs);
      newRuns.set(chatId, {
        ...run,
        status: 'failed',
        completedAt: Date.now(),
        error,
      });
      
      const shouldShowBadge = chatId !== activeChatId;
      const newBadges = shouldShowBadge
        ? { ...state.pendingBadges, [chatId]: (state.pendingBadges[chatId] || 0) + 1 }
        : state.pendingBadges;
      
      return { runs: newRuns, pendingBadges: newBadges };
    });
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
  
  isProcessing: (chatId: string) => {
    const run = get().runs.get(chatId);
    return run ? ['started', 'streaming'].includes(run.status) : false;
  },
  
  getProcessingChatIds: () => {
    const runs = get().runs;
    const processingIds: string[] = [];
    runs.forEach((run, chatId) => {
      if (['started', 'streaming'].includes(run.status)) {
        processingIds.push(chatId);
      }
    });
    return processingIds;
  },
}));

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

export function useProcessingChatIds(): string[] {
  return useStreamingStore(useShallow(selectProcessingChatIds));
}

export function usePendingBadges(): Record<string, number> {
  return useStreamingStore(useShallow(selectPendingBadges));
}

export function useChatIsProcessing(chatId: string | null | undefined): boolean {
  return useStreamingStore((state) => {
    if (!chatId) return false;
    const run = state.runs.get(chatId);
    return run ? ['started', 'streaming'].includes(run.status) : false;
  });
}
