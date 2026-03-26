import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/hooks/use-chats";

const { toastDoneMock } = vi.hoisted(() => ({
  toastDoneMock: vi.fn(),
}));

vi.mock("../lib/toastDone", () => ({
  toastDone: toastDoneMock,
}));

function createLocalStorageMock() {
  let storage: Record<string, string> = {};

  return {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = String(value);
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    },
  };
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

async function loadStreamingStore() {
  const mod = await import("./streamingStore");
  await mod.useStreamingStore.persist.rehydrate();
  return mod;
}

function createMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: overrides.role || "assistant",
    content: overrides.content || "",
    timestamp: overrides.timestamp || new Date(),
    requestId: overrides.requestId,
    userMessageId: overrides.userMessageId,
    runId: overrides.runId,
  };
}

describe("streamingStore persistence and recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    const localStorageMock = createLocalStorageMock();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
    toastDoneMock.mockReset();
    setVisibilityState("visible");
  });

  it("rehydrates in-flight runs and unread badge counts across reloads", async () => {
    const firstLoad = await loadStreamingStore();
    const firstState = firstLoad.useStreamingStore.getState();

    firstState.startRun("chat-reload", "run-reload", "req-reload", "Chat Reload");
    expect(firstState.appendContent("chat-reload", "Hola", 0)).toBe(true);
    firstLoad.useStreamingStore.setState({
      pendingBadges: {
        "chat-review": 2,
      },
    });

    vi.resetModules();

    const secondLoad = await loadStreamingStore();
    const restoredState = secondLoad.useStreamingStore.getState();
    const restoredRun = restoredState.getRun("chat-reload");

    expect(restoredRun).toMatchObject({
      chatId: "chat-reload",
      runId: "run-reload",
      requestId: "req-reload",
      status: "streaming",
      content: "Hola",
      lastSeq: 0,
      chatTitle: "Chat Reload",
    });
    expect(restoredState.pendingBadges).toEqual({
      "chat-review": 2,
    });
  });

  it("reconciles a recovered in-flight run once the assistant message exists", async () => {
    const { useStreamingStore } = await loadStreamingStore();
    const state = useStreamingStore.getState();

    state.startRun("chat-background", "run-background", "req-background", "Chat Background");
    state.appendContent("chat-background", "Respuesta parcial", 0);

    const assistantTimestamp = new Date("2026-03-26T14:03:00.000Z");
    const messages: Message[] = [
      createMessage({
        id: "user-background",
        role: "user",
        content: "Hola",
        timestamp: new Date("2026-03-26T14:02:00.000Z"),
        requestId: "req-background",
      }),
      createMessage({
        id: "assistant-background",
        role: "assistant",
        content: "Respuesta final recuperada",
        timestamp: assistantTimestamp,
        userMessageId: "user-background",
        runId: "run-background",
      }),
    ];

    state.reconcileRunFromMessages({
      chatId: "chat-background",
      chatTitle: "Chat Background",
      activeChatId: "chat-active",
      messages,
    });

    const recoveredState = useStreamingStore.getState();
    expect(recoveredState.getRun("chat-background")).toMatchObject({
      status: "completed",
      content: "Respuesta final recuperada",
      completedAt: assistantTimestamp.getTime(),
      chatTitle: "Chat Background",
    });
    expect(recoveredState.pendingBadges).toEqual({
      "chat-background": 1,
    });
    expect(recoveredState.notifications).toHaveLength(1);
    expect(recoveredState.notifications[0]).toMatchObject({
      chatId: "chat-background",
      chatTitle: "Chat Background",
      type: "completed",
      runId: "run-background",
      dismissed: false,
    });
    expect(toastDoneMock).not.toHaveBeenCalled();

    recoveredState.clearBadge("chat-background");

    const clearedState = useStreamingStore.getState();
    expect(clearedState.pendingBadges).toEqual({});
    expect(clearedState.notifications[0]?.dismissed).toBe(true);
  });
});
