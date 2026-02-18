/**
 * Chat Session Store — Per-conversation ephemeral state
 *
 * Holds the state that must remain isolated per chat so that
 * multiple chats can stream in parallel without contamination.
 *
 * Key principle: every piece of mutable state that is "per-conversation"
 * lives inside a ConversationSession keyed by chatId.
 * The UI simply reads/writes through selectors that take a chatId.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Message } from '@/hooks/use-chats';

// ── Types ──────────────────────────────────────────────────────

export type AiState = 'idle' | 'thinking' | 'responding' | 'agent_working';

export interface AiProcessStep {
  id?: string;
  step: string;
  title?: string;
  message?: string;
  status: 'pending' | 'active' | 'done';
}

export interface ConversationSession {
  aiState: AiState;
  streamingContent: string;
  optimisticMessages: Message[];
  aiProcessSteps: AiProcessStep[];
  /** requestId of the in-flight stream (null when idle) */
  pendingRequestId: string | null;
  /** Tracks which chatId this session belongs to (for sanity checks) */
  chatId: string;
}

function createEmptySession(chatId: string): ConversationSession {
  return {
    aiState: 'idle',
    streamingContent: '',
    optimisticMessages: [],
    aiProcessSteps: [],
    pendingRequestId: null,
    chatId,
  };
}

// ── Store ──────────────────────────────────────────────────────

interface ChatSessionState {
  /** Map of chatId → per-conversation ephemeral state */
  sessions: Map<string, ConversationSession>;

  // ── Accessors ────────────────────────────────────────────────
  getSession: (chatId: string) => ConversationSession;

  // ── Per-conversation mutators ────────────────────────────────
  setAiState: (chatId: string, state: AiState) => void;
  setStreamingContent: (chatId: string, content: string) => void;
  setOptimisticMessages: (chatId: string, updater: Message[] | ((prev: Message[]) => Message[])) => void;
  setAiProcessSteps: (chatId: string, updater: AiProcessStep[] | ((prev: AiProcessStep[]) => AiProcessStep[])) => void;
  setPendingRequestId: (chatId: string, requestId: string | null) => void;

  /** Reset a single conversation's ephemeral state (e.g. "New chat" button) */
  resetSession: (chatId: string) => void;

  /** Remove a session entirely (chat deleted) */
  removeSession: (chatId: string) => void;

  /** Check if a specific chat is busy (thinking/responding/agent_working) */
  isChatBusy: (chatId: string) => boolean;
}

export const useChatSessionStore = create<ChatSessionState>()(
  devtools(
    (set, get) => ({
      sessions: new Map(),

      getSession: (chatId: string): ConversationSession => {
        const existing = get().sessions.get(chatId);
        if (existing) return existing;
        // Lazily create session on first access
        const session = createEmptySession(chatId);
        set((state) => {
          const next = new Map(state.sessions);
          next.set(chatId, session);
          return { sessions: next };
        });
        return session;
      },

      setAiState: (chatId, aiState) =>
        set((state) => {
          const next = new Map(state.sessions);
          const session = next.get(chatId) ?? createEmptySession(chatId);
          next.set(chatId, { ...session, aiState });
          return { sessions: next };
        }),

      setStreamingContent: (chatId, content) =>
        set((state) => {
          const next = new Map(state.sessions);
          const session = next.get(chatId) ?? createEmptySession(chatId);
          next.set(chatId, { ...session, streamingContent: content });
          return { sessions: next };
        }),

      setOptimisticMessages: (chatId, updater) =>
        set((state) => {
          const next = new Map(state.sessions);
          const session = next.get(chatId) ?? createEmptySession(chatId);
          const optimisticMessages =
            typeof updater === 'function'
              ? updater(session.optimisticMessages)
              : updater;
          next.set(chatId, { ...session, optimisticMessages });
          return { sessions: next };
        }),

      setAiProcessSteps: (chatId, updater) =>
        set((state) => {
          const next = new Map(state.sessions);
          const session = next.get(chatId) ?? createEmptySession(chatId);
          const aiProcessSteps =
            typeof updater === 'function'
              ? updater(session.aiProcessSteps)
              : updater;
          next.set(chatId, { ...session, aiProcessSteps });
          return { sessions: next };
        }),

      setPendingRequestId: (chatId, requestId) =>
        set((state) => {
          const next = new Map(state.sessions);
          const session = next.get(chatId) ?? createEmptySession(chatId);
          next.set(chatId, { ...session, pendingRequestId: requestId });
          return { sessions: next };
        }),

      resetSession: (chatId) =>
        set((state) => {
          const next = new Map(state.sessions);
          next.set(chatId, createEmptySession(chatId));
          return { sessions: next };
        }),

      removeSession: (chatId) =>
        set((state) => {
          const next = new Map(state.sessions);
          next.delete(chatId);
          return { sessions: next };
        }),

      isChatBusy: (chatId) => {
        const session = get().sessions.get(chatId);
        if (!session) return false;
        return session.aiState !== 'idle';
      },
    }),
    { name: 'ChatSessionStore' }
  )
);

// ── Selectors / Hooks ─────────────────────────────────────────

/** Hook: get the aiState for a specific chat (defaults to 'idle') */
export function useChatAiState(chatId: string | null | undefined): AiState {
  return useChatSessionStore((state) => {
    if (!chatId) return 'idle';
    return state.sessions.get(chatId)?.aiState ?? 'idle';
  });
}

/** Hook: get the streaming content for a specific chat */
export function useChatStreamingContent(chatId: string | null | undefined): string {
  return useChatSessionStore((state) => {
    if (!chatId) return '';
    return state.sessions.get(chatId)?.streamingContent ?? '';
  });
}

/** Hook: get the optimistic messages for a specific chat */
export function useChatOptimisticMessages(chatId: string | null | undefined): Message[] {
  return useChatSessionStore((state) => {
    if (!chatId) return [];
    return state.sessions.get(chatId)?.optimisticMessages ?? [];
  });
}

/** Hook: get the AI process steps for a specific chat */
export function useChatAiProcessSteps(chatId: string | null | undefined): AiProcessStep[] {
  return useChatSessionStore((state) => {
    if (!chatId) return [];
    return state.sessions.get(chatId)?.aiProcessSteps ?? [];
  });
}

/** Hook: check if a specific chat is busy */
export function useChatIsBusy(chatId: string | null | undefined): boolean {
  return useChatSessionStore((state) => {
    if (!chatId) return false;
    const session = state.sessions.get(chatId);
    return session ? session.aiState !== 'idle' : false;
  });
}
