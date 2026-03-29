import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatRuntime } from "../useChatRuntime";

// Mock dependencies
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("@/lib/logger", () => ({
  chatLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/promptIntegrity", () => ({
  computePromptIntegrity: vi.fn().mockResolvedValue({
    integrityHash: "mock-hash-123",
  }),
}));

describe("useChatRuntime", () => {
  const defaultProps = {
    chatId: "test-chat-123",
    user: { id: "user-123", plan: "free" },
    onSendMessage: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with default state", () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    expect(result.current.messages).toEqual([]);
    expect(result.current.input).toBe("");
    expect(result.current.aiState).toBe("idle");
    expect(result.current.streamingContent).toBe("");
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should update input value", () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    act(() => {
      result.current.setInput("Hello world");
    });

    expect(result.current.input).toBe("Hello world");
  });

  it("should not submit empty messages", async () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    act(() => {
      result.current.handleSubmit();
    });

    expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
  });

  it("should submit message successfully", async () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    // Set input
    act(() => {
      result.current.setInput("Test message");
    });

    // Submit
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(defaultProps.onSendMessage).toHaveBeenCalledWith("Test message");
    expect(result.current.input).toBe(""); // Input cleared after submit
    expect(result.current.aiState).toBe("streaming");
  });

  it("should handle submission error", async () => {
    const onSendMessage = vi.fn().mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() =>
      useChatRuntime({ ...defaultProps, onSendMessage })
    );

    act(() => {
      result.current.setInput("Test message");
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Network error");
    expect(result.current.aiState).toBe("error");
  });

  it("should prevent duplicate submissions while submitting", async () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    act(() => {
      result.current.setInput("Test message");
    });

    // First submission
    const firstSubmit = act(async () => {
      await result.current.handleSubmit();
    });

    // Try second submission immediately (should be ignored)
    act(() => {
      result.current.handleSubmit();
    });

    await firstSubmit;

    expect(defaultProps.onSendMessage).toHaveBeenCalledTimes(1);
  });

  it("should handle keyboard shortcuts", () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    act(() => {
      result.current.setInput("Test message");
    });

    // Simulate Enter key
    const mockEvent = {
      key: "Enter",
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;

    act(() => {
      result.current.handleKeyDown(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(defaultProps.onSendMessage).toHaveBeenCalled();
  });

  it("should allow Shift+Enter for new lines", () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    act(() => {
      result.current.setInput("Line 1");
    });

    const mockEvent = {
      key: "Enter",
      shiftKey: true,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;

    act(() => {
      result.current.handleKeyDown(mockEvent);
    });

    expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
  });

  it("should clear error", () => {
    const onSendMessage = vi.fn().mockRejectedValue(new Error("Test error"));
    const { result } = renderHook(() =>
      useChatRuntime({ ...defaultProps, onSendMessage })
    );

    act(() => {
      result.current.setInput("Test");
    });

    act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it("should update messages", () => {
    const { result } = renderHook(() => useChatRuntime(defaultProps));

    const newMessages = [
      { id: "1", role: "user" as const, content: "Hello", timestamp: new Date() },
      { id: "2", role: "assistant" as const, content: "Hi!", timestamp: new Date() },
    ];

    act(() => {
      result.current.setMessages(newMessages);
    });

    expect(result.current.messages).toEqual(newMessages);
  });
});
