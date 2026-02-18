
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Message } from '@/types/chat';

// ── Per-conversation message/streaming state ───────────────────

interface ConversationData {
    messages: Message[];
    streamingContent: string;
    uiPhase: 'idle' | 'thinking' | 'console' | 'done';
    activeRunId: string | null;
    editingMessageId: string | null;
}

function emptyConversation(): ConversationData {
    return {
        messages: [],
        streamingContent: '',
        uiPhase: 'idle',
        activeRunId: null,
        editingMessageId: null,
    };
}

interface ChatState {
    // ── Per-conversation data (keyed by chatId) ─────────────────
    conversations: Map<string, ConversationData>;

    // Per-conversation accessors
    getConversation: (chatId: string) => ConversationData;

    // Per-conversation message mutations
    setMessages: (chatId: string, messages: Message[] | ((prev: Message[]) => Message[])) => void;
    addMessage: (chatId: string, message: Message) => void;
    updateMessage: (chatId: string, id: string, updates: Partial<Message>) => void;

    // Per-conversation streaming/phase
    setStreamingContent: (chatId: string, content: string) => void;
    setUiPhase: (chatId: string, phase: 'idle' | 'thinking' | 'console' | 'done') => void;
    setActiveRunId: (chatId: string, id: string | null) => void;
    setEditingMessageId: (chatId: string, id: string | null) => void;
    resetConversation: (chatId: string) => void;
    removeConversation: (chatId: string) => void;

    // ── Global UI state (not per-conversation) ──────────────────
    input: string;
    setInput: (input: string) => void;
    isSidebarOpen: boolean;
    setSidebarOpen: (isOpen: boolean) => void;
    toggleSidebar: () => void;

    // ── Legacy compatibility (operates on "active" conversation) ─
    /** @deprecated Use per-chatId methods instead */
    messages: Message[];
    /** @deprecated Use setMessages(chatId, ...) instead */
    setMessagesLegacy: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
    /** @deprecated Use addMessage(chatId, ...) instead */
    addMessageLegacy: (message: Message) => void;
    /** @deprecated Use updateMessage(chatId, ...) instead */
    updateMessageLegacy: (id: string, updates: Partial<Message>) => void;
    streamingContent: string;
    uiPhase: 'idle' | 'thinking' | 'console' | 'done';
    activeRunId: string | null;
    editingMessageId: string | null;
    /** @deprecated Use setStreamingContent(chatId, ...) instead */
    setStreamingContentLegacy: (content: string) => void;
    /** @deprecated Use setUiPhase(chatId, ...) instead */
    setUiPhaseLegacy: (phase: 'idle' | 'thinking' | 'console' | 'done') => void;
    /** @deprecated Use setActiveRunId(chatId, ...) instead */
    setActiveRunIdLegacy: (id: string | null) => void;
    /** @deprecated Use setEditingMessageId(chatId, ...) instead */
    setEditingMessageIdLegacy: (id: string | null) => void;

    // Actions
    resetState: () => void;
}

export const useChatStore = create<ChatState>()(
    devtools(
        (set, get) => ({
            // ── Per-conversation data ──────────────────────────────
            conversations: new Map(),

            getConversation: (chatId: string): ConversationData => {
                return get().conversations.get(chatId) ?? emptyConversation();
            },

            setMessages: (chatId, messages) => set((state) => {
                const next = new Map(state.conversations);
                const conv = next.get(chatId) ?? emptyConversation();
                next.set(chatId, {
                    ...conv,
                    messages: typeof messages === 'function' ? messages(conv.messages) : messages,
                });
                return { conversations: next };
            }),

            addMessage: (chatId, message) => set((state) => {
                const next = new Map(state.conversations);
                const conv = next.get(chatId) ?? emptyConversation();
                next.set(chatId, {
                    ...conv,
                    messages: [...conv.messages, message],
                });
                return { conversations: next };
            }),

            updateMessage: (chatId, id, updates) => set((state) => {
                const next = new Map(state.conversations);
                const conv = next.get(chatId) ?? emptyConversation();
                next.set(chatId, {
                    ...conv,
                    messages: conv.messages.map(m => m.id === id ? { ...m, ...updates } : m),
                });
                return { conversations: next };
            }),

            setStreamingContent: (chatId, content) => set((state) => {
                const next = new Map(state.conversations);
                const conv = next.get(chatId) ?? emptyConversation();
                next.set(chatId, { ...conv, streamingContent: content });
                return { conversations: next };
            }),

            setUiPhase: (chatId, phase) => set((state) => {
                const next = new Map(state.conversations);
                const conv = next.get(chatId) ?? emptyConversation();
                next.set(chatId, { ...conv, uiPhase: phase });
                return { conversations: next };
            }),

            setActiveRunId: (chatId, id) => set((state) => {
                const next = new Map(state.conversations);
                const conv = next.get(chatId) ?? emptyConversation();
                next.set(chatId, { ...conv, activeRunId: id });
                return { conversations: next };
            }),

            setEditingMessageId: (chatId, id) => set((state) => {
                const next = new Map(state.conversations);
                const conv = next.get(chatId) ?? emptyConversation();
                next.set(chatId, { ...conv, editingMessageId: id });
                return { conversations: next };
            }),

            resetConversation: (chatId) => set((state) => {
                const next = new Map(state.conversations);
                next.set(chatId, emptyConversation());
                return { conversations: next };
            }),

            removeConversation: (chatId) => set((state) => {
                const next = new Map(state.conversations);
                next.delete(chatId);
                return { conversations: next };
            }),

            // ── Global UI state ──────────────────────────────────────
            input: '',
            isSidebarOpen: true,

            setInput: (input) => set({ input }),
            setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
            toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

            // ── Legacy compatibility (global, not per-conversation) ──
            messages: [],
            streamingContent: '',
            uiPhase: 'idle',
            activeRunId: null,
            editingMessageId: null,

            setMessagesLegacy: (messages) => set((state) => ({
                messages: typeof messages === 'function' ? messages(state.messages) : messages
            })),
            addMessageLegacy: (message) => set((state) => ({
                messages: [...state.messages, message]
            })),
            updateMessageLegacy: (id, updates) => set((state) => ({
                messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
            })),
            setStreamingContentLegacy: (content) => set({ streamingContent: content }),
            setUiPhaseLegacy: (phase) => set({ uiPhase: phase }),
            setActiveRunIdLegacy: (id) => set({ activeRunId: id }),
            setEditingMessageIdLegacy: (id) => set({ editingMessageId: id }),

            resetState: () => set({
                messages: [],
                input: '',
                uiPhase: 'idle',
                activeRunId: null,
                streamingContent: '',
                editingMessageId: null
            })
        }),
        { name: 'ChatStore' }
    )
);
