import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore, selectConversation, selectActiveConversation } from "../chatStore";

/**
 * Tests for per-conversation state isolation in the chat store.
 * Verifies that two or more conversations running in parallel never
 * share messages, streaming buffers, loading flags, or input state.
 */
describe("chatStore per-conversation isolation", () => {
  beforeEach(() => {
    // Reset the store to a clean state before each test
    useChatStore.setState({
      conversations: {},
      activeConversationId: null,
      isSidebarOpen: true,
      input: "",
    });
  });

  it("creates isolated conversation entries that don't interfere", () => {
    const store = useChatStore.getState();

    store.ensureConversation("chat_1");
    store.ensureConversation("chat_2");

    store.setStreamingContent("chat_1", "Hello from chat 1");
    store.setStreamingContent("chat_2", "Hello from chat 2");

    const state = useChatStore.getState();
    expect(state.conversations["chat_1"]?.streamingContent).toBe("Hello from chat 1");
    expect(state.conversations["chat_2"]?.streamingContent).toBe("Hello from chat 2");
  });

  it("setInput on one conversation does not affect another", () => {
    const store = useChatStore.getState();

    store.ensureConversation("chat_a");
    store.ensureConversation("chat_b");
    store.setActiveConversationId("chat_a");

    store.setInput("chat_a", "typing in A");
    store.setInput("chat_b", "typing in B");

    const state = useChatStore.getState();
    expect(state.conversations["chat_a"]?.input).toBe("typing in A");
    expect(state.conversations["chat_b"]?.input).toBe("typing in B");

    // Legacy `input` should mirror the active conversation
    expect(state.input).toBe("typing in A");
  });

  it("switching active conversation updates legacy input mirror", () => {
    const store = useChatStore.getState();

    store.ensureConversation("chat_a");
    store.ensureConversation("chat_b");

    store.setInput("chat_a", "input-A");
    store.setInput("chat_b", "input-B");

    store.setActiveConversationId("chat_a");
    expect(useChatStore.getState().input).toBe("input-A");

    store.setActiveConversationId("chat_b");
    expect(useChatStore.getState().input).toBe("input-B");
  });

  it("messages are isolated per conversation", () => {
    const store = useChatStore.getState();

    store.ensureConversation("conv_1");
    store.ensureConversation("conv_2");

    const msg1 = { id: "m1", role: "user" as const, content: "Message for conv1", timestamp: Date.now() };
    const msg2 = { id: "m2", role: "user" as const, content: "Message for conv2", timestamp: Date.now() };

    store.addMessage("conv_1", msg1 as any);
    store.addMessage("conv_2", msg2 as any);

    const state = useChatStore.getState();
    expect(state.conversations["conv_1"]?.messages).toHaveLength(1);
    expect(state.conversations["conv_1"]?.messages[0]?.content).toBe("Message for conv1");
    expect(state.conversations["conv_2"]?.messages).toHaveLength(1);
    expect(state.conversations["conv_2"]?.messages[0]?.content).toBe("Message for conv2");
  });

  it("uiPhase is isolated per conversation", () => {
    const store = useChatStore.getState();

    store.ensureConversation("chat_x");
    store.ensureConversation("chat_y");

    store.setUiPhase("chat_x", "thinking");
    store.setUiPhase("chat_y", "idle");

    const state = useChatStore.getState();
    expect(state.conversations["chat_x"]?.uiPhase).toBe("thinking");
    expect(state.conversations["chat_y"]?.uiPhase).toBe("idle");
  });

  it("activeRunId is isolated per conversation", () => {
    const store = useChatStore.getState();

    store.ensureConversation("chat_x");
    store.ensureConversation("chat_y");

    store.setActiveRunId("chat_x", "run_123");
    store.setActiveRunId("chat_y", null);

    const state = useChatStore.getState();
    expect(state.conversations["chat_x"]?.activeRunId).toBe("run_123");
    expect(state.conversations["chat_y"]?.activeRunId).toBeNull();
  });

  it("new conversation starts with clean state, no inheritance", () => {
    const store = useChatStore.getState();

    // Set up chat_old with ongoing state
    store.ensureConversation("chat_old");
    store.setStreamingContent("chat_old", "still streaming...");
    store.setUiPhase("chat_old", "console");
    store.setActiveRunId("chat_old", "run_active");

    // Create new conversation
    store.ensureConversation("chat_new");

    const state = useChatStore.getState();
    const newConv = state.conversations["chat_new"]!;

    // New chat must start completely clean
    expect(newConv.messages).toEqual([]);
    expect(newConv.input).toBe("");
    expect(newConv.streamingContent).toBe("");
    expect(newConv.uiPhase).toBe("idle");
    expect(newConv.activeRunId).toBeNull();
    expect(newConv.editingMessageId).toBeNull();

    // Old chat must still have its state
    const oldConv = state.conversations["chat_old"]!;
    expect(oldConv.streamingContent).toBe("still streaming...");
    expect(oldConv.uiPhase).toBe("console");
    expect(oldConv.activeRunId).toBe("run_active");
  });

  it("migrateConversation moves state from pending to real ID", () => {
    const store = useChatStore.getState();

    store.ensureConversation("pending-123");
    store.setInput("pending-123", "user typed this");
    store.setStreamingContent("pending-123", "AI is responding...");
    store.setActiveConversationId("pending-123");

    // Migrate to real ID
    store.migrateConversation("pending-123", "chat_real_456");

    const state = useChatStore.getState();
    // Old key is gone
    expect(state.conversations["pending-123"]).toBeUndefined();
    // New key has the state
    expect(state.conversations["chat_real_456"]?.input).toBe("user typed this");
    expect(state.conversations["chat_real_456"]?.streamingContent).toBe("AI is responding...");
    // Active conversation ID is updated
    expect(state.activeConversationId).toBe("chat_real_456");
  });

  it("removeConversation cleans up without affecting others", () => {
    const store = useChatStore.getState();

    store.ensureConversation("keep_me");
    store.ensureConversation("remove_me");

    store.setInput("keep_me", "preserved");
    store.setInput("remove_me", "will be gone");

    store.removeConversation("remove_me");

    const state = useChatStore.getState();
    expect(state.conversations["remove_me"]).toBeUndefined();
    expect(state.conversations["keep_me"]?.input).toBe("preserved");
  });

  it("resetActiveState only resets the active conversation", () => {
    const store = useChatStore.getState();

    store.ensureConversation("active_chat");
    store.ensureConversation("background_chat");

    store.setInput("active_chat", "will be cleared");
    store.setInput("background_chat", "should survive");
    store.setStreamingContent("background_chat", "streaming token");

    store.setActiveConversationId("active_chat");
    store.resetActiveState();

    const state = useChatStore.getState();
    expect(state.conversations["active_chat"]?.input).toBe("");
    expect(state.conversations["active_chat"]?.messages).toEqual([]);
    expect(state.conversations["background_chat"]?.input).toBe("should survive");
    expect(state.conversations["background_chat"]?.streamingContent).toBe("streaming token");
  });

  it("parallel streaming content updates don't cross-contaminate", () => {
    const store = useChatStore.getState();

    store.ensureConversation("stream_1");
    store.ensureConversation("stream_2");
    store.ensureConversation("stream_3");

    // Simulate parallel token appends
    store.setStreamingContent("stream_1", "token1a");
    store.setStreamingContent("stream_2", "token2a");
    store.setStreamingContent("stream_3", "token3a");
    store.setStreamingContent("stream_1", "token1a token1b");
    store.setStreamingContent("stream_2", "token2a token2b");

    const state = useChatStore.getState();
    expect(state.conversations["stream_1"]?.streamingContent).toBe("token1a token1b");
    expect(state.conversations["stream_2"]?.streamingContent).toBe("token2a token2b");
    expect(state.conversations["stream_3"]?.streamingContent).toBe("token3a");
  });

  it("selectConversation returns empty state for unknown conversation", () => {
    const state = useChatStore.getState();
    const conv = selectConversation(state as any, "nonexistent");

    expect(conv.messages).toEqual([]);
    expect(conv.input).toBe("");
    expect(conv.streamingContent).toBe("");
    expect(conv.uiPhase).toBe("idle");
    expect(conv.activeRunId).toBeNull();
  });

  it("selectActiveConversation returns active conversation state", () => {
    const store = useChatStore.getState();

    store.ensureConversation("my_chat");
    store.setInput("my_chat", "hello");
    store.setActiveConversationId("my_chat");

    const active = selectActiveConversation(useChatStore.getState() as any);
    expect(active.input).toBe("hello");
  });
});
