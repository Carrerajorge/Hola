
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Message } from '@/types/chat';

/**
 * Per-conversation state bucket.
 * Every field that previously lived as a global singleton is now scoped
 * inside a conversation entry so that two chats running in parallel never
 * share messages, streaming buffers, loading flags, or abort controllers.
 */
export interface ConversationState {
    messages: Message[];
    input: string;
    streamingContent: string;
    uiPhase: 'idle' | 'thinking' | 'console' | 'done';
    activeRunId: string | null;
    editingMessageId: string | null;
}

function createConversationState(): ConversationState {
    return {
        messages: [],
        input: '',
        streamingContent: '',
        uiPhase: 'idle',
        activeRunId: null,
        editingMessageId: null,
    };
}

interface ChatState {
    // ─── Per-conversation map ───────────────────────────────────────
    conversations: Record<string, ConversationState>;
    activeConversationId: string | null;

    // ─── Global UI (not per-conversation) ──────────────────────────
    isSidebarOpen: boolean;

    // ─── Conversation lifecycle ─────────────────────────────────────
    setActiveConversationId: (id: string | null) => void;
    ensureConversation: (conversationId: string) => void;
    removeConversation: (conversationId: string) => void;
    /** Move state from one ID to another (pending → real). */
    migrateConversation: (fromId: string, toId: string) => void;

    // ─── Scoped getters ─────────────────────────────────────────────
    getConversation: (conversationId: string) => ConversationState;

    // ─── Scoped setters (operate on a specific conversationId) ──────
    setMessages: (conversationId: string, messages: Message[] | ((prev: Message[]) => Message[])) => void;
    addMessage: (conversationId: string, message: Message) => void;
    updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
    setInput: (conversationId: string, input: string) => void;
    setStreamingContent: (conversationId: string, content: string) => void;
    setUiPhase: (conversationId: string, phase: ConversationState['uiPhase']) => void;
    setActiveRunId: (conversationId: string, id: string | null) => void;
    setEditingMessageId: (conversationId: string, id: string | null) => void;

    // ─── Convenience: operate on activeConversationId ───────────────
    /** Reset only the active conversation's transient state (keeps messages). */
    resetActiveTransientState: () => void;
    /** Full reset of the active conversation's state (clears everything). */
    resetActiveState: () => void;

    // ─── Global UI setters ──────────────────────────────────────────
    setSidebarOpen: (isOpen: boolean) => void;
    toggleSidebar: () => void;

    // ─── Legacy compatibility helpers (operate on activeConversationId) ──
    /** @deprecated Use the conversationId-scoped version. Reads/writes active conversation input. */
    input: string;
    /** @deprecated Use the conversationId-scoped version. */
    setInputLegacy: (input: string) => void;
}

export const useChatStore = create<ChatState>()(
    devtools(
        (set, get) => ({
            // ─── Initial State ──────────────────────────────────────────
            conversations: {},
            activeConversationId: null,
            isSidebarOpen: true,
            input: '', // legacy mirror of active conversation's input

            // ─── Conversation lifecycle ─────────────────────────────────
            setActiveConversationId: (id) => {
                const state = get();
                if (id && !state.conversations[id]) {
                    set({
                        activeConversationId: id,
                        conversations: { ...state.conversations, [id]: createConversationState() },
                        input: '',
                    });
                } else {
                    const conv = id ? state.conversations[id] : undefined;
                    set({
                        activeConversationId: id,
                        input: conv?.input ?? '',
                    });
                }
            },

            ensureConversation: (conversationId) => {
                const state = get();
                if (state.conversations[conversationId]) return;
                set({
                    conversations: {
                        ...state.conversations,
                        [conversationId]: createConversationState(),
                    },
                });
            },

            removeConversation: (conversationId) => {
                const state = get();
                const { [conversationId]: _, ...rest } = state.conversations;
                set({ conversations: rest });
            },

            migrateConversation: (fromId, toId) => {
                if (fromId === toId) return;
                const state = get();
                const source = state.conversations[fromId];
                if (!source) return;
                const { [fromId]: _, ...rest } = state.conversations;
                if (rest[toId]) return; // target already exists
                const newActiveId = state.activeConversationId === fromId ? toId : state.activeConversationId;
                set({
                    conversations: { ...rest, [toId]: source },
                    activeConversationId: newActiveId,
                });
            },

            // ─── Scoped getters ─────────────────────────────────────────
            getConversation: (conversationId) => {
                return get().conversations[conversationId] || createConversationState();
            },

            // ─── Scoped setters ─────────────────────────────────────────
            setMessages: (conversationId, messages) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                const resolved = typeof messages === 'function' ? messages(conv.messages) : messages;
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: { ...conv, messages: resolved },
                    },
                };
            }),

            addMessage: (conversationId, message) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: { ...conv, messages: [...conv.messages, message] },
                    },
                };
            }),

            updateMessage: (conversationId, messageId, updates) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: {
                            ...conv,
                            messages: conv.messages.map(m => m.id === messageId ? { ...m, ...updates } : m),
                        },
                    },
                };
            }),

            setInput: (conversationId, input) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                const isActive = state.activeConversationId === conversationId;
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: { ...conv, input },
                    },
                    // Keep legacy mirror in sync when writing to the active conversation.
                    ...(isActive ? { input } : {}),
                };
            }),

            setStreamingContent: (conversationId, content) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: { ...conv, streamingContent: content },
                    },
                };
            }),

            setUiPhase: (conversationId, phase) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: { ...conv, uiPhase: phase },
                    },
                };
            }),

            setActiveRunId: (conversationId, id) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: { ...conv, activeRunId: id },
                    },
                };
            }),

            setEditingMessageId: (conversationId, id) => set((state) => {
                const conv = state.conversations[conversationId] || createConversationState();
                return {
                    conversations: {
                        ...state.conversations,
                        [conversationId]: { ...conv, editingMessageId: id },
                    },
                };
            }),

            // ─── Active conversation convenience ────────────────────────
            resetActiveTransientState: () => set((state) => {
                const id = state.activeConversationId;
                if (!id || !state.conversations[id]) return state;
                const conv = state.conversations[id];
                return {
                    conversations: {
                        ...state.conversations,
                        [id]: {
                            ...conv,
                            streamingContent: '',
                            uiPhase: 'idle',
                            activeRunId: null,
                            editingMessageId: null,
                        },
                    },
                };
            }),

            resetActiveState: () => set((state) => {
                const id = state.activeConversationId;
                if (!id) return state;
                return {
                    conversations: {
                        ...state.conversations,
                        [id]: createConversationState(),
                    },
                    input: '',
                };
            }),

            // ─── Global UI ──────────────────────────────────────────────
            setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
            toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

            // ─── Legacy compat ──────────────────────────────────────────
            setInputLegacy: (input) => {
                const state = get();
                const id = state.activeConversationId;
                if (id) {
                    const conv = state.conversations[id] || createConversationState();
                    set({
                        input,
                        conversations: {
                            ...state.conversations,
                            [id]: { ...conv, input },
                        },
                    });
                } else {
                    set({ input });
                }
            },
        }),
        { name: 'ChatStore' }
    )
);

// ─── Selector helpers ───────────────────────────────────────────────
export function selectConversation(state: ChatState, conversationId: string | null): ConversationState {
    if (!conversationId) return createConversationState();
    return state.conversations[conversationId] || createConversationState();
}

export function selectActiveConversation(state: ChatState): ConversationState {
    return selectConversation(state, state.activeConversationId);
}
