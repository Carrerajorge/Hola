import { describe, it, expect, beforeEach } from "vitest";
import { useStreamingStore } from "../streamingStore";

/**
 * Tests that the streaming store correctly isolates per-chat run state.
 * Verifies that two or more chats processing simultaneously don't
 * interfere with each other's streaming content, status, or badges.
 */
describe("streamingStore parallel chat isolation", () => {
  beforeEach(() => {
    // Reset the store
    useStreamingStore.setState({
      runs: new Map(),
      pendingBadges: {},
      notifications: [],
    });
  });

  it("two concurrent streaming runs don't share content", () => {
    const store = useStreamingStore.getState();

    store.startRun("chat_1", "run_1");
    store.startRun("chat_2", "run_2");

    store.appendContent("chat_1", "Hello ", 0);
    store.appendContent("chat_2", "Hola ", 0);
    store.appendContent("chat_1", "world", 1);
    store.appendContent("chat_2", "mundo", 1);

    expect(store.getContent("chat_1")).toBe("Hello world");
    expect(store.getContent("chat_2")).toBe("Hola mundo");
  });

  it("completing one chat doesn't affect another streaming chat", () => {
    const store = useStreamingStore.getState();

    store.startRun("chat_fast", "run_fast");
    store.startRun("chat_slow", "run_slow");

    store.appendContent("chat_fast", "quick reply", 0);
    store.appendContent("chat_slow", "still going...", 0);

    // Complete the fast chat
    store.completeRun("chat_fast", "chat_slow", "Fast Chat");

    const state = useStreamingStore.getState();
    const fastRun = state.runs.get("chat_fast");
    const slowRun = state.runs.get("chat_slow");

    expect(fastRun?.status).toBe("completed");
    expect(slowRun?.status).toBe("streaming");
    expect(slowRun?.content).toBe("still going...");
  });

  it("sequence dedup prevents duplicate tokens per chat independently", () => {
    const store = useStreamingStore.getState();

    store.startRun("chat_a", "run_a");
    store.startRun("chat_b", "run_b");

    // Both chats receive seq=0
    expect(store.appendContent("chat_a", "token_a0", 0)).toBe(true);
    expect(store.appendContent("chat_b", "token_b0", 0)).toBe(true);

    // Retry seq=0 for chat_a (should be deduplicated)
    expect(store.appendContent("chat_a", "token_a0_dup", 0)).toBe(false);

    // But seq=1 for chat_a is fine
    expect(store.appendContent("chat_a", "token_a1", 1)).toBe(true);

    expect(store.getContent("chat_a")).toBe("token_a0token_a1");
    expect(store.getContent("chat_b")).toBe("token_b0");
  });

  it("isProcessing returns correct per-chat status", () => {
    const store = useStreamingStore.getState();

    store.startRun("processing_chat", "run_p");
    store.appendContent("processing_chat", "streaming", 0);

    store.startRun("done_chat", "run_d");
    store.completeRun("done_chat", null);

    expect(store.isProcessing("processing_chat")).toBe(true);
    expect(store.isProcessing("done_chat")).toBe(false);
    expect(store.isProcessing("nonexistent")).toBe(false);
  });

  it("getProcessingChatIds only returns actively streaming chats", () => {
    const store = useStreamingStore.getState();

    store.startRun("chat_1", "r1");
    store.startRun("chat_2", "r2");
    store.startRun("chat_3", "r3");

    store.appendContent("chat_1", "t", 0); // now streaming
    // chat_2 still 'started'
    store.completeRun("chat_3", null); // completed

    const processing = store.getProcessingChatIds();
    expect(processing).toContain("chat_1");
    expect(processing).toContain("chat_2");
    expect(processing).not.toContain("chat_3");
  });

  it("clearRun only removes the specified chat", () => {
    const store = useStreamingStore.getState();

    store.startRun("keep", "r1");
    store.startRun("remove", "r2");
    store.appendContent("keep", "data", 0);

    store.clearRun("remove");

    const state = useStreamingStore.getState();
    expect(state.runs.has("keep")).toBe(true);
    expect(state.runs.has("remove")).toBe(false);
    expect(state.runs.get("keep")?.content).toBe("data");
  });

  it("aborting one chat doesn't abort others", () => {
    const store = useStreamingStore.getState();

    store.startRun("chat_1", "r1");
    store.startRun("chat_2", "r2");

    store.appendContent("chat_1", "streaming...", 0);
    store.appendContent("chat_2", "also streaming...", 0);

    store.abortRun("chat_1");

    const state = useStreamingStore.getState();
    expect(state.runs.get("chat_1")?.status).toBe("aborted");
    expect(state.runs.get("chat_2")?.status).toBe("streaming");
  });

  it("background completion generates badge only for non-active chats", () => {
    const store = useStreamingStore.getState();

    store.startRun("active_chat", "r1");
    store.startRun("background_chat", "r2");

    // Complete active chat while it's the active one
    store.completeRun("active_chat", "active_chat", "Active");

    // Complete background chat while active_chat is active
    store.completeRun("background_chat", "active_chat", "Background");

    const state = useStreamingStore.getState();
    expect(state.pendingBadges["active_chat"]).toBeUndefined();
    expect(state.pendingBadges["background_chat"]).toBe(1);
  });

  it("three parallel streams maintain independent state throughout lifecycle", () => {
    const store = useStreamingStore.getState();

    // Start all three
    store.startRun("A", "rA");
    store.startRun("B", "rB");
    store.startRun("C", "rC");

    // Interleave token arrivals
    store.appendContent("A", "a1", 0);
    store.appendContent("B", "b1", 0);
    store.appendContent("C", "c1", 0);
    store.appendContent("A", "a2", 1);
    store.appendContent("C", "c2", 1);
    store.appendContent("B", "b2", 1);
    store.appendContent("B", "b3", 2);

    // Complete A, fail C, B continues
    store.completeRun("A", "B");
    store.failRun("C", "timeout", "B", "Chat C");
    store.appendContent("B", "b4", 3);

    const state = useStreamingStore.getState();
    expect(state.runs.get("A")?.status).toBe("completed");
    expect(state.runs.get("A")?.content).toBe("a1a2");
    expect(state.runs.get("B")?.status).toBe("streaming");
    expect(state.runs.get("B")?.content).toBe("b1b2b3b4");
    expect(state.runs.get("C")?.status).toBe("failed");
    expect(state.runs.get("C")?.content).toBe("c1c2");
    expect(state.runs.get("C")?.error).toBe("timeout");
  });
});
