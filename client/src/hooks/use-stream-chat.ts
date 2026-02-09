/**
 * useStreamChat - All-in-one streaming chat hook.
 *
 * Replaces the pattern of:
 *   1. setAiState("thinking")
 *   2. fetch("/api/chat/stream", ...)
 *   3. reader = response.body.getReader()
 *   4. while (!done) { decode → parse SSE → accumulate → setStreamingContent }
 *   5. setOptimisticMessages + onSendMessage + setStreamingContent("") + setAiState("idle")
 *
 * With:
 *   const result = await streamChat.stream("/api/chat/stream", { body, chatId });
 *   // Done. Message is already finalized and visible.
 *
 * Features:
 *  - Proper SSE line buffering across TCP chunk boundaries
 *  - requestAnimationFrame-throttled state updates (~60fps)
 *  - Atomic finalize (optimistic message → clear streaming → in one tick)
 *  - Chat-scoped abort: switching chats auto-aborts stale streams
 *  - AbortController integration
 *  - Production event forwarding (for progress steps)
 *  - Handles [DONE], done/finish events, errors gracefully
 */

import { useCallback, useRef, useEffect } from "react";
import { getAnonUserIdHeader } from "@/lib/apiClient";
import type { Message } from "@/hooks/use-chats";

type AiState = "idle" | "thinking" | "responding" | "agent_working";

export interface StreamChatDeps {
  setOptimisticMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onSendMessage: (message: Message) => Promise<any>;
  setStreamingContent: (content: string) => void;
  streamingContentRef: React.MutableRefObject<string>;
  setAiState: React.Dispatch<React.SetStateAction<AiState>>;
  setAiProcessSteps?: React.Dispatch<React.SetStateAction<any[]>>;
}

export interface StreamOptions {
  /** Request body (will be JSON.stringified) */
  body: Record<string, any>;
  /** Current chat ID — used for stale-stream detection */
  chatId?: string | null;
  /** AbortSignal for external cancellation */
  signal?: AbortSignal;
  /** Called on each SSE event (for production_start, production_event, etc.) */
  onEvent?: (eventType: string, data: any) => void;
  /** Called when the AI state should change (e.g. "responding", "agent_working") */
  onAiStateChange?: (state: AiState) => void;
  /** Called with the full content when streaming completes normally. Return a Message to customize the final message.
   *  `messageId` is pre-generated to match the streaming message key for zero-flicker Virtuoso transition. */
  buildFinalMessage?: (fullContent: string, lastEventData?: any, messageId?: string) => Message;
  /** Called with the error when streaming fails. Return a Message to customize the error message. */
  buildErrorMessage?: (error: Error, messageId?: string) => Message;
}

export interface StreamResult {
  /** Whether the stream completed successfully */
  ok: boolean;
  /** The accumulated full content */
  content: string;
  /** The final message that was sent */
  message?: Message;
  /** HTTP response (for status code checks) */
  response?: Response;
  /** Error if stream failed */
  error?: Error;
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useStreamChat(deps: StreamChatDeps) {
  const {
    setOptimisticMessages,
    onSendMessage,
    setStreamingContent,
    streamingContentRef,
    setAiState,
    setAiProcessSteps,
  } = deps;

  // Active stream tracking
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const finalizingRef = useRef(false);
  // Pre-generated message ID for the next stream — allows ChatMessageList
  // to use the same key for the streaming message and the final message,
  // so Virtuoso keeps the same DOM node (zero-flicker transition).
  const nextMessageIdRef = useRef<string | null>(null);

  // RAF throttling state
  const rafIdRef = useRef<number | null>(null);
  const pendingContentRef = useRef<string | null>(null);

  // Flush pending content to React state via RAF
  const scheduleFlush = useCallback(() => {
    if (pendingContentRef.current !== null && rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingContentRef.current !== null) {
          setStreamingContent(pendingContentRef.current);
          pendingContentRef.current = null;
        }
      });
    }
  }, [setStreamingContent]);

  // Immediate flush (for finalize)
  const flushNow = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (pendingContentRef.current !== null) {
      setStreamingContent(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [setStreamingContent]);

  // Atomic finalize — same logic as useStreamingTransition but self-contained
  const finalize = useCallback(
    (message: Message) => {
      if (finalizingRef.current) return;
      finalizingRef.current = true;

      // Cancel any pending RAF
      flushNow();

      // 1. Optimistic insert — instant DOM presence
      setOptimisticMessages((prev) => [...prev, message]);

      // 2. Persist to backend
      onSendMessage(message).catch((err) => {
        console.error("[useStreamChat] onSendMessage failed:", err);
      });

      // 3. Clear streaming
      streamingContentRef.current = "";
      setStreamingContent("");
      pendingContentRef.current = null;

      // 4. Reset AI state
      setAiState("idle");
      setAiProcessSteps?.([]);

      queueMicrotask(() => {
        finalizingRef.current = false;
      });
    },
    [setOptimisticMessages, onSendMessage, setStreamingContent, streamingContentRef, setAiState, setAiProcessSteps, flushNow]
  );

  /**
   * Abort the current stream.
   */
  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  /**
   * Stream a chat request. Returns when the stream is complete and the
   * message has been finalized.
   */
  const stream = useCallback(
    async (url: string, options: StreamOptions): Promise<StreamResult> => {
      const { body, chatId, signal, onEvent, onAiStateChange, buildFinalMessage, buildErrorMessage } = options;

      // Abort any previous stream
      abort();

      // Set up new abort controller
      const controller = new AbortController();
      abortControllerRef.current = controller;
      activeChatIdRef.current = chatId ?? null;

      // Combine signals if caller provides one
      const combinedSignal = signal
        ? AbortSignal.any?.([controller.signal, signal]) ?? controller.signal
        : controller.signal;

      // Pre-generate message ID so streaming and final message share the same key
      const messageId = `assistant-${Date.now()}`;
      nextMessageIdRef.current = messageId;

      // Initialize streaming state
      streamingContentRef.current = "";
      pendingContentRef.current = null;
      setStreamingContent("");
      setAiState("thinking");
      setAiProcessSteps?.([]);

      let fullContent = "";
      let response: Response | undefined;

      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
          credentials: "include",
          body: JSON.stringify(body),
          signal: combinedSignal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const error = new Error(errorData.error || `HTTP ${response.status}`);

          const errorMsg = buildErrorMessage?.(error, messageId) ?? {
            id: messageId,
            role: "assistant" as const,
            content: error.message || "Error de conexión. Por favor, intenta de nuevo.",
            timestamp: new Date(),
            requestId: generateRequestId(),
          };

          finalize(errorMsg);
          return { ok: false, content: "", message: errorMsg, response, error };
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const error = new Error("No response body");
          finalize(buildErrorMessage?.(error, messageId) ?? {
            id: messageId,
            role: "assistant" as const,
            content: "No se recibió respuesta del servidor.",
            timestamp: new Date(),
            requestId: generateRequestId(),
          });
          return { ok: false, content: "", response, error };
        }

        // Start responding
        setAiState("responding");
        onAiStateChange?.("responding");

        const decoder = new TextDecoder();
        let sseBuffer = "";
        let currentEventType = "chunk";
        let lastEventData: any = null;
        let streamDone = false;

        while (!streamDone) {
          if (combinedSignal.aborted) break;

          // Stale chat guard: if chatId changed, abort this stream
          if (chatId && activeChatIdRef.current !== chatId) {
            controller.abort();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith("event: ")) {
              currentEventType = trimmed.slice(7).trim();
              continue;
            }

            if (!trimmed.startsWith("data: ")) continue;

            const dataStr = trimmed.slice(6);
            if (dataStr === "[DONE]") {
              streamDone = true;
              break;
            }

            try {
              const data = JSON.parse(dataStr);
              lastEventData = data;

              // Forward all events to caller
              onEvent?.(currentEventType, data);

              // Accumulate text content
              if (currentEventType === "chunk" || currentEventType === "text") {
                const content = data.content || "";
                if (content) {
                  fullContent += content;
                  streamingContentRef.current = fullContent;
                  // RAF-throttled update
                  pendingContentRef.current = fullContent;
                  scheduleFlush();
                }
              }

              // Handle AI state changes from events.
              // Guard: skip state updates if the stream was aborted or chat switched
              // to avoid setting stale states on a dead stream.
              const isStale = combinedSignal.aborted ||
                (chatId && activeChatIdRef.current !== chatId);

              if (!isStale && currentEventType === "thinking") {
                // Server is doing heavy I/O (search, context load) — keep thinking state
                setAiState("thinking");
                onAiStateChange?.("thinking");
              }

              if (!isStale && currentEventType === "context") {
                // Enriched metadata arrived — switch to responding
                setAiState("responding");
                onAiStateChange?.("responding");
              }

              if (!isStale && currentEventType === "production_start") {
                setAiState("agent_working");
                onAiStateChange?.("agent_working");
              }

              // Terminal: done/finish
              if (currentEventType === "done" || currentEventType === "finish") {
                streamDone = true;

                const msg = buildFinalMessage?.(fullContent, data, messageId) ?? {
                  id: messageId,
                  role: "assistant" as const,
                  content: fullContent,
                  timestamp: new Date(),
                  requestId: data.requestId || generateRequestId(),
                  artifact: data.artifact,
                  webSources: data.webSources,
                };

                finalize(msg);
                return { ok: true, content: fullContent, message: msg, response };
              }

              // Terminal: error
              if (currentEventType === "error" || currentEventType === "production_error") {
                const errorMsg = data.message || data.error || "Stream error";
                throw new Error(errorMsg);
              }
            } catch (parseErr: any) {
              // If this is a re-thrown error from above, propagate it
              if (parseErr?.message && (currentEventType === "error" || currentEventType === "production_error")) {
                throw parseErr;
              }
              // Otherwise ignore JSON parse errors for partial data
            }
          }
        }

        // Stream ended without explicit done event — finalize with accumulated content
        if (!finalizingRef.current && fullContent) {
          const msg = buildFinalMessage?.(fullContent, lastEventData, messageId) ?? {
            id: messageId,
            role: "assistant" as const,
            content: fullContent || "No se recibió respuesta del servidor.",
            timestamp: new Date(),
            requestId: generateRequestId(),
          };

          finalize(msg);
          return { ok: true, content: fullContent, message: msg, response };
        }

        // No content received
        if (!finalizingRef.current) {
          const msg: Message = {
            id: messageId,
            role: "assistant" as const,
            content: "No se recibió respuesta del servidor.",
            timestamp: new Date(),
            requestId: generateRequestId(),
          };
          finalize(msg);
          return { ok: false, content: "", message: msg, response };
        }

        return { ok: true, content: fullContent, response };

      } catch (err: any) {
        if (err.name === "AbortError") {
          return { ok: false, content: fullContent, response, error: err };
        }

        console.error("[useStreamChat] Stream error:", err);

        const errorMsg = buildErrorMessage?.(err, messageId) ?? {
          id: messageId,
          role: "assistant" as const,
          content: err.message || "Error de conexión. Por favor, intenta de nuevo.",
          timestamp: new Date(),
          requestId: generateRequestId(),
        };

        if (!finalizingRef.current) {
          finalize(errorMsg);
        }

        return { ok: false, content: fullContent, message: errorMsg, response, error: err };
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [abort, finalize, scheduleFlush, setAiState, setAiProcessSteps, streamingContentRef, setStreamingContent]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  return {
    /** Stream a chat request — handles everything from fetch to finalize */
    stream,
    /** Abort the current stream */
    abort,
    /** Atomically finalize a message (for paths that handle their own streaming) */
    finalize,
    /** Ref to the current abort controller */
    abortControllerRef,
    /** Current accumulated content ref */
    contentRef: streamingContentRef,
    /** Pre-generated message ID for the current/next stream.
     *  Pass to ChatMessageList as streamingMsgId for zero-flicker Virtuoso transition. */
    nextMessageIdRef,
  };
}
