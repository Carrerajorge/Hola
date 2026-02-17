/**
 * useStreamChat - conversation-isolated streaming chat hook.
 *
 * Guarantees:
 * - One in-flight stream per conversationId (replace/reject policy)
 * - SSE events are routed strictly by conversationId + request correlation
 * - Background streams do not write into the active chat buffer
 * - Stream buffers and abort controllers are scoped per conversation
 */

import { useCallback, useRef, useEffect } from "react";
import { getAnonUserIdHeader } from "@/lib/apiClient";
import type { Message } from "@/hooks/use-chats";
import { type AIState } from "@/components/chat-interface/types";

type StreamRetryState = "idle" | "running" | "retry";

export interface StreamChatDeps {
  setOptimisticMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onSendMessage: (message: Message) => Promise<any>;
  setStreamingContent: (content: string) => void;
  streamingContentRef: React.MutableRefObject<string>;
  setAiState: React.Dispatch<React.SetStateAction<AiState>>;
  setAiProcessSteps?: React.Dispatch<React.SetStateAction<any[]>>;
  getActiveConversationId?: () => string | null;
}

export interface StreamOptions {
  body: Record<string, any>;
  chatId?: string | null;
  conversationId?: string | null;
  signal?: AbortSignal;
  onEvent?: (eventType: string, data: any) => void;
  onAiStateChange?: (state: AiState) => void;
  buildFinalMessage?: (fullContent: string, lastEventData?: any, messageId?: string) => Message;
  buildErrorMessage?: (error: Error, messageId?: string) => Message;
  queueMode?: "replace" | "reject";
  timeoutMs?: number;
  firstTokenTimeoutMs?: number;
  doneTimeoutMs?: number;
  maxRetries?: number;
}

export interface StreamResult {
  ok: boolean;
  content: string;
  message?: Message;
  response?: Response;
  error?: Error;
}

interface ConversationSession {
  abortController: AbortController | null;
  pendingRequestId: string | null;
  nextMessageId: string | null;
  fullContent: string;
  pendingContent: string | null;
  rafId: number | null;
  finalizing: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  firstTokenTimeoutId: ReturnType<typeof setTimeout> | null;
  doneTimeoutId: ReturnType<typeof setTimeout> | null;
}

function createSession(): ConversationSession {
  return {
    abortController: null,
    pendingRequestId: null,
    nextMessageId: null,
    fullContent: "",
    pendingContent: null,
    rafId: null,
    finalizing: false,
    timeoutId: null,
    firstTokenTimeoutId: null,
    doneTimeoutId: null,
  };
}

const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 8_000;
const DEFAULT_DONE_TIMEOUT_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRequestId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `req_${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeConversationId(options: StreamOptions): string | null {
  const fromOptions = typeof options.conversationId === "string" ? options.conversationId.trim() : "";
  if (fromOptions) return fromOptions;

  const fromChat = typeof options.chatId === "string" ? options.chatId.trim() : "";
  if (fromChat) return fromChat;

  const fromBodyConversationId =
    typeof options.body?.conversationId === "string" ? options.body.conversationId.trim() : "";
  if (fromBodyConversationId) return fromBodyConversationId;

  const fromBodyChatId = typeof options.body?.chatId === "string" ? options.body.chatId.trim() : "";
  if (fromBodyChatId) return fromBodyChatId;

  return null;
}

export function useStreamChat(deps: StreamChatDeps) {
  const {
    setOptimisticMessages,
    onSendMessage,
    setStreamingContent,
    streamingContentRef,
    setAiState,
    setAiProcessSteps,
    getActiveConversationId,
  } = deps;

  const sessionsRef = useRef<Map<string, ConversationSession>>(new Map());
  const lastStartedConversationRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const nextMessageIdRef = useRef<string | null>(null);

  const getSession = useCallback((conversationId: string): ConversationSession => {
    const existing = sessionsRef.current.get(conversationId);
    if (existing) return existing;
    const created = createSession();
    sessionsRef.current.set(conversationId, created);
    return created;
  }, []);

  const isConversationActive = useCallback(
    (conversationId: string): boolean => {
      const activeConversationId = getActiveConversationId?.();
      if (!activeConversationId) return true;
      return activeConversationId === conversationId;
    },
    [getActiveConversationId]
  );

  const flushNow = useCallback(
    (conversationId: string) => {
      const session = getSession(conversationId);
      if (session.rafId !== null) {
        cancelAnimationFrame(session.rafId);
        session.rafId = null;
      }
      if (session.pendingContent !== null && isConversationActive(conversationId)) {
        streamingContentRef.current = session.pendingContent;
        setStreamingContent(session.pendingContent);
        session.pendingContent = null;
      }
    },
    [getSession, isConversationActive, setStreamingContent, streamingContentRef]
  );

  const scheduleFlush = useCallback(
    (conversationId: string) => {
      const session = getSession(conversationId);
      if (session.pendingContent === null || session.rafId !== null) return;
      if (!isConversationActive(conversationId)) return;

      session.rafId = requestAnimationFrame(() => {
        session.rafId = null;
        if (session.pendingContent !== null && isConversationActive(conversationId)) {
          streamingContentRef.current = session.pendingContent;
          setStreamingContent(session.pendingContent);
          session.pendingContent = null;
        }
      });
    },
    [getSession, isConversationActive, setStreamingContent, streamingContentRef]
  );

  const clearSessionRuntime = useCallback((conversationId: string) => {
    const session = getSession(conversationId);

    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }

    if (session.rafId !== null) {
      cancelAnimationFrame(session.rafId);
      session.rafId = null;
    }

    session.pendingRequestId = null;
  }, [getSession]);

  const abortConversation = useCallback(
    (conversationId: string) => {
      const session = getSession(conversationId);
      if (session.abortController) {
        session.abortController.abort();
      }
      session.abortController = null;
      clearSessionRuntime(conversationId);
    },
    [clearSessionRuntime, getSession]
  );

  const abort = useCallback(
    (conversationId?: string | null) => {
      const resolvedConversationId =
        (conversationId && conversationId.trim()) ||
        getActiveConversationId?.() ||
        lastStartedConversationRef.current;

      if (!resolvedConversationId) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        return;
      }

      abortConversation(resolvedConversationId);

      if (
        abortControllerRef.current &&
        getSession(resolvedConversationId).abortController !== abortControllerRef.current
      ) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = null;
    },
    [abortConversation, getActiveConversationId, getSession]
  );

  const synchronizeConversation = useCallback(
    (conversationId?: string | null) => {
      const targetConversationId =
        (conversationId && conversationId.trim()) || getActiveConversationId?.() || null;

      if (!targetConversationId) {
        nextMessageIdRef.current = null;
        streamingContentRef.current = "";
        setStreamingContent("");
        return;
      }

      const session = sessionsRef.current.get(targetConversationId);
      const content = session?.fullContent || "";

      nextMessageIdRef.current = session?.nextMessageId || null;
      streamingContentRef.current = content;
      setStreamingContent(content);
    },
    [getActiveConversationId, setStreamingContent, streamingContentRef]
  );

  const finalize = useCallback(
    (message: Message, conversationId?: string | null) => {
      const targetConversationId =
        (conversationId && conversationId.trim()) ||
        getActiveConversationId?.() ||
        lastStartedConversationRef.current;

      if (!targetConversationId) {
        setOptimisticMessages((prev) => [...prev, message]);
        onSendMessage(message).catch((err) => {
          console.error("[useStreamChat] onSendMessage failed:", err);
        });
        streamingContentRef.current = "";
        setStreamingContent("");
        setAiState("idle");
        setAiProcessSteps?.([]);
        return;
      }

      const session = getSession(targetConversationId);
      if (session.finalizing) return;
      session.finalizing = true;

      flushNow(targetConversationId);

      setOptimisticMessages((prev) => [...prev, message]);
      onSendMessage(message).catch((err) => {
        console.error("[useStreamChat] onSendMessage failed:", err);
      });

      session.fullContent = "";
      session.pendingContent = null;
      session.pendingRequestId = null;

      if (isConversationActive(targetConversationId)) {
        streamingContentRef.current = "";
        setStreamingContent("");
      }

      setAiState("idle");
      setAiProcessSteps?.([]);

      queueMicrotask(() => {
        const latestSession = getSession(targetConversationId);
        latestSession.finalizing = false;
      });
    },
    [
      flushNow,
      getActiveConversationId,
      getSession,
      isConversationActive,
      onSendMessage,
      setAiProcessSteps,
      setAiState,
      setOptimisticMessages,
      setStreamingContent,
      streamingContentRef,
    ]
  );

  const stream = useCallback(
    async (url: string, options: StreamOptions): Promise<StreamResult> => {
      const {
        body,
        signal,
        onEvent,
        onAiStateChange,
        buildFinalMessage,
        buildErrorMessage,
        queueMode = "replace",
        timeoutMs = 120_000,
      } = options;

      const conversationId = normalizeConversationId(options);
      if (!conversationId) {
        const error = new Error("conversationId is required for isolated streaming");
        return { ok: false, content: "", error };
      }

      const session = getSession(conversationId);

      if (session.abortController && queueMode === "reject") {
        const error = new Error("Conversation already has a pending response");
        return { ok: false, content: session.fullContent, error };
      }

      if (session.abortController && queueMode === "replace") {
        abortConversation(conversationId);
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      session.abortController = controller;
      lastStartedConversationRef.current = conversationId;

      const streamRequestId =
        typeof body?.requestId === "string" && body.requestId.trim()
          ? body.requestId.trim()
          : generateRequestId();

      const requestBody: Record<string, any> = {
        ...body,
        requestId: streamRequestId,
        conversationId,
        chatId: body.chatId || conversationId,
      };

      const combinedSignal = signal
        ? AbortSignal.any?.([controller.signal, signal]) ?? controller.signal
        : controller.signal;

      const messageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      session.nextMessageId = messageId;
      session.pendingRequestId = streamRequestId;
      session.fullContent = "";
      session.pendingContent = null;
      if (isConversationActive(conversationId)) {
        nextMessageIdRef.current = messageId;
        streamingContentRef.current = "";
        setStreamingContent("");
      }

      setAiState("thinking");
      onAiStateChange?.("thinking");
      setAiProcessSteps?.([]);

      let response: Response | undefined;
      let fullContent = "";
      let lastEventData: any = null;
      let streamTimedOut = false;

      if (session.timeoutId) {
        clearTimeout(session.timeoutId);
      }
      session.timeoutId = setTimeout(() => {
        streamTimedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-request-id": streamRequestId,
            ...getAnonUserIdHeader(),
          },
          credentials: "include",
          body: JSON.stringify(requestBody),
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
            requestId: streamRequestId,
          };

          finalize(errorMsg, conversationId);
          return { ok: false, content: "", message: errorMsg, response, error };
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
          const jsonData = await response.json().catch(() => null);
          const status = jsonData?.status;

          if (status === "already_done" || status === "already_processing" || status === "claim_failed") {
            session.fullContent = "";
            session.pendingContent = null;
            if (isConversationActive(conversationId)) {
              streamingContentRef.current = "";
              setStreamingContent("");
            }
            setAiState("idle");
            setAiProcessSteps?.([]);
            return { ok: true, content: "", response };
          }

          const error = new Error(
            jsonData?.error || jsonData?.message || `Unexpected JSON response (${status || "json"})`
          );
          const errorMsg = buildErrorMessage?.(error, messageId) ?? {
            id: messageId,
            role: "assistant" as const,
            content: error.message || "Error de conexión. Por favor, intenta de nuevo.",
            timestamp: new Date(),
            requestId: streamRequestId,
          };

          finalize(errorMsg, conversationId);
          return { ok: false, content: "", message: errorMsg, response, error };
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const error = new Error("No response body");
          const errorMsg = buildErrorMessage?.(error, messageId) ?? {
            id: messageId,
            role: "assistant" as const,
            content: "No se recibió respuesta del servidor.",
            timestamp: new Date(),
            requestId: streamRequestId,
          };
          finalize(errorMsg, conversationId);
          return { ok: false, content: "", message: errorMsg, response, error };
        }

        setAiState("responding");
        onAiStateChange?.("responding");

        const decoder = new TextDecoder();
        let sseBuffer = "";
        let currentEventType = "chunk";
        let streamDone = false;

        while (!streamDone) {
          if (combinedSignal.aborted) break;

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

            let data: any;
            try {
              data = JSON.parse(dataStr);
            } catch {
              continue;
            }

            if (!data || typeof data !== "object") continue;

            const eventConversationId =
              typeof data.conversationId === "string" ? data.conversationId.trim() : "";
            if (!eventConversationId || eventConversationId !== conversationId) {
              continue;
            }

            const eventRequestId = typeof data.requestId === "string" ? data.requestId.trim() : "";
            const eventAssistantMessageId =
              typeof data.assistantMessageId === "string" ? data.assistantMessageId.trim() : "";

            if (!eventRequestId && !eventAssistantMessageId) {
              continue;
            }

            if (eventRequestId && eventRequestId !== streamRequestId) {
              continue;
            }

            lastEventData = data;
            onEvent?.(currentEventType, data);

            if (currentEventType === "chunk" || currentEventType === "text") {
              const content = typeof data.content === "string" ? data.content : "";
              if (content) {
                fullContent += content;
                session.fullContent = fullContent;
                if (isConversationActive(conversationId)) {
                  session.pendingContent = fullContent;
                  scheduleFlush(conversationId);
                }
              }
            }

            const isStaleConversation = session.pendingRequestId !== streamRequestId;
            if (!isStaleConversation && currentEventType === "thinking") {
              setAiState("thinking");
              onAiStateChange?.("thinking");

              if (data.step && data.message) {
                setAiProcessSteps?.((prev: any[]) => {
                  const existing = prev.find((s: any) => s.id === data.step);
                  if (existing) return prev;
                  return [
                    ...prev,
                    {
                      id: data.step,
                      step: data.step,
                      title: data.message,
                      status: "pending",
                    },
                  ];
                });
              }
            }

            if (!isStaleConversation && currentEventType === "context") {
              setAiState("responding");
              onAiStateChange?.("responding");
              setAiProcessSteps?.((prev: any[]) =>
                prev.map((s: any) => ({ ...s, status: "done" }))
              );
            }

            if (!isStaleConversation && currentEventType === "production_start") {
              setAiState("agent_working");
              onAiStateChange?.("agent_working");
            }

            if (currentEventType === "done" || currentEventType === "finish") {
              streamDone = true;
              flushNow(conversationId);

              const msg = buildFinalMessage?.(fullContent, data, messageId) ?? {
                id: messageId,
                role: "assistant" as const,
                content: fullContent,
                timestamp: new Date(),
                requestId: data.requestId || streamRequestId,
                artifact: data.artifact,
                webSources: data.webSources,
              };

              finalize(msg, conversationId);
              return { ok: true, content: fullContent, message: msg, response };
            }

            if (currentEventType === "error" || currentEventType === "production_error") {
              const errorMsg = data.message || data.error || "Stream error";
              throw new Error(errorMsg);
            }
          }
        }

        if (!session.finalizing && fullContent) {
          flushNow(conversationId);
          const msg = buildFinalMessage?.(fullContent, lastEventData, messageId) ?? {
            id: messageId,
            role: "assistant" as const,
            content: fullContent,
            timestamp: new Date(),
            requestId: streamRequestId,
          };

          finalize(msg, conversationId);
          return { ok: true, content: fullContent, message: msg, response };
        }

        if (!session.finalizing) {
          const msg: Message = {
            id: messageId,
            role: "assistant" as const,
            content: "No se recibió respuesta del servidor.",
            timestamp: new Date(),
            requestId: streamRequestId,
          };
          finalize(msg, conversationId);
          return { ok: false, content: "", message: msg, response };
        }

        return { ok: true, content: fullContent, response };
      } catch (err: any) {
        if (err?.name === "AbortError") {
          const abortError =
            streamTimedOut
              ? new Error(`Stream timeout after ${timeoutMs}ms`)
              : err;
          return { ok: false, content: fullContent, response, error: abortError };
        }

        console.error("[useStreamChat] Stream error:", err);

        const errorMsg = buildErrorMessage?.(err, messageId) ?? {
          id: messageId,
          role: "assistant" as const,
          content: err?.message || "Error de conexión. Por favor, intenta de nuevo.",
          timestamp: new Date(),
          requestId: streamRequestId,
        };

        if (!session.finalizing) {
          finalize(errorMsg, conversationId);
        }

        return { ok: false, content: fullContent, message: errorMsg, response, error: err };
      } finally {
        if (session.abortController === controller) {
          session.abortController = null;
        }

        if (session.pendingRequestId === streamRequestId) {
          session.pendingRequestId = null;
        }

        if (session.timeoutId) {
          clearTimeout(session.timeoutId);
          session.timeoutId = null;
        }

        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      abortConversation,
      finalize,
      flushNow,
      getSession,
      isConversationActive,
      scheduleFlush,
      setAiProcessSteps,
      setAiState,
    ]
  );

  useEffect(() => {
    return () => {
      for (const [conversationId, session] of sessionsRef.current.entries()) {
        if (session.abortController) {
          session.abortController.abort();
          session.abortController = null;
        }
        if (session.timeoutId) {
          clearTimeout(session.timeoutId);
          session.timeoutId = null;
        }
        if (session.rafId !== null) {
          cancelAnimationFrame(session.rafId);
          session.rafId = null;
        }
        session.pendingRequestId = null;
        session.pendingContent = null;
        session.fullContent = "";
        session.finalizing = false;
        session.nextMessageId = null;
      }
      sessionsRef.current.clear();
      abortControllerRef.current = null;
      nextMessageIdRef.current = null;
      streamingContentRef.current = "";
    };
  }, [streamingContentRef]);

  const getPendingRequestId = useCallback((conversationId: string): string | null => {
    return sessionsRef.current.get(conversationId)?.pendingRequestId || null;
  }, []);

  return {
    stream,
    abort,
    abortConversation,
    finalize,
    synchronizeConversation,
    getPendingRequestId,
    abortControllerRef,
    contentRef: streamingContentRef,
    nextMessageIdRef,
  };
}
