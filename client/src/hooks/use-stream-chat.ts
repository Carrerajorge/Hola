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
import { type AIState, type AiProcessStep } from "@/components/chat-interface/types";
import { hasMeaningfulAssistantContent } from "@shared/assistantContent";
import {
  normalizeResponseHealth,
  type ResponseHealthMetadata,
} from "@shared/responseHealth";

export interface StreamChatDeps {
  setOptimisticMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onSendMessage: (message: Message) => Promise<any>;
  setStreamingContent: (content: string) => void;
  streamingContentRef: React.MutableRefObject<string>;
  setAiState: (value: React.SetStateAction<AIState>, conversationId?: string | null) => void;
  setAiProcessSteps?: (value: React.SetStateAction<AiProcessStep[]>, conversationId?: string | null) => void;
  getActiveConversationId?: () => string | null;
  onStreamStart?: (payload: {
    conversationId: string;
    activeConversationId: string | null;
    requestId: string;
    messageId: string;
  }) => void;
  onStreamChunk?: (payload: {
    conversationId: string;
    activeConversationId: string | null;
    requestId: string;
    messageId: string;
    chunk: string;
    fullContent: string;
    seq: number;
  }) => void;
  onStreamComplete?: (payload: {
    conversationId: string;
    activeConversationId: string | null;
    requestId: string;
    messageId: string;
    content: string;
    message: Message;
  }) => void;
  onStreamError?: (payload: {
    conversationId: string;
    activeConversationId: string | null;
    requestId: string;
    messageId: string;
    content: string;
    error: Error;
    message?: Message;
  }) => void;
  onStreamAbort?: (payload: {
    conversationId: string;
    activeConversationId: string | null;
    requestId: string;
    messageId: string;
    content: string;
    reason: "cancelled" | "noop";
  }) => void;
}

export interface StreamOptions {
  body: Record<string, any>;
  chatId?: string | null;
  conversationId?: string | null;
  signal?: AbortSignal;
  onEvent?: (eventType: string, data: any) => void;
  onAiStateChange?: (state: AIState) => void;
  buildFinalMessage?: (fullContent: string, lastEventData?: any, messageId?: string) => Message;
  buildErrorMessage?: (error: Error, messageId?: string) => Message;
  queueMode?: "replace" | "reject";
  timeoutMs?: number;
  firstTokenTimeoutMs?: number;
  doneTimeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  retryJitterMs?: number;
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
  contentTokenTimeoutId: ReturnType<typeof setTimeout> | null;
  idleRecoveryTimeoutId: ReturnType<typeof setTimeout> | null;
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
    contentTokenTimeoutId: null,
    idleRecoveryTimeoutId: null,
  };
}

const DEFAULT_STREAM_TIMEOUT_MS = 300_000;
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 30_000;
const DEFAULT_DONE_TIMEOUT_MS = 45_000;
// Gap guard: max time between receiving any SSE event and the first content token.
// Covers the window after firstTokenTimeout is cleared (by a non-content event like
// "thinking") but before doneTimeout is armed (which requires a content chunk).
const DEFAULT_CONTENT_TOKEN_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_RECOVERY_MS = 1_500;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_BACKOFF_MS = 800;
const DEFAULT_RETRY_JITTER_MS = 250;

const isBusyAiState = (state: AIState): boolean =>
  state === "sending" ||
  state === "streaming" ||
  state === "thinking" ||
  state === "responding" ||
  state === "agent_working";

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

function hasArtifactPayload(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "artifact" in value && (value as { artifact?: unknown }).artifact);
}

function hasUsableStreamOutcome(content: string, lastEventData?: unknown): boolean {
  return hasMeaningfulAssistantContent(content) || hasArtifactPayload(lastEventData);
}

function withResponseHealth(
  message: Message,
  responseHealth?: ResponseHealthMetadata,
): Message {
  if (!responseHealth) return message;

  return {
    ...message,
    metadata: {
      ...(message.metadata || {}),
      responseHealth,
    },
  };
}

type StreamErrorWithResponseHealth = Error & {
  responseHealth?: unknown;
};

function attachResponseHealth(
  error: Error,
  responseHealth?: unknown,
): StreamErrorWithResponseHealth {
  const enriched = error as StreamErrorWithResponseHealth;
  if (responseHealth !== undefined) {
    enriched.responseHealth = responseHealth;
  }
  return enriched;
}

export function useStreamChat(deps: StreamChatDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const mountedRef = useRef(true);

  const { streamingContentRef } = deps;

  const setAiState = useCallback<StreamChatDeps["setAiState"]>((...args) => depsRef.current.setAiState(...args), []);
  const setAiProcessSteps = useCallback<NonNullable<StreamChatDeps["setAiProcessSteps"]>>((...args) => depsRef.current.setAiProcessSteps?.(...args), []);
  const getActiveConversationId = useCallback<NonNullable<StreamChatDeps["getActiveConversationId"]>>(() => depsRef.current.getActiveConversationId?.(), []);
  const setOptimisticMessages = useCallback<StreamChatDeps["setOptimisticMessages"]>((...args) => {
    if (!mountedRef.current) return;
    depsRef.current.setOptimisticMessages(...args);
  }, []);
  const onSendMessage = useCallback<StreamChatDeps["onSendMessage"]>((...args) => depsRef.current.onSendMessage(...args), []);
  const setStreamingContent = useCallback<StreamChatDeps["setStreamingContent"]>((...args) => {
    if (!mountedRef.current) return;
    depsRef.current.setStreamingContent(...args);
  }, []);

  const getStreamCallbacks = useCallback(() => {
    const activeConversationId = depsRef.current.getActiveConversationId?.() || null;
    return {
      activeConversationId,
      onStreamStart: depsRef.current.onStreamStart,
      onStreamChunk: depsRef.current.onStreamChunk,
      onStreamComplete: depsRef.current.onStreamComplete,
      onStreamError: depsRef.current.onStreamError,
      onStreamAbort: depsRef.current.onStreamAbort,
    };
  }, []);

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
    if (session.firstTokenTimeoutId) {
      clearTimeout(session.firstTokenTimeoutId);
      session.firstTokenTimeoutId = null;
    }
    if (session.doneTimeoutId) {
      clearTimeout(session.doneTimeoutId);
      session.doneTimeoutId = null;
    }
    if (session.contentTokenTimeoutId) {
      clearTimeout(session.contentTokenTimeoutId);
      session.contentTokenTimeoutId = null;
    }
    if (session.idleRecoveryTimeoutId) {
      clearTimeout(session.idleRecoveryTimeoutId);
      session.idleRecoveryTimeoutId = null;
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
    (message: Message, conversationId?: string | null, finalState: AIState = "idle") => {
      const targetConversationId =
        (conversationId && conversationId.trim()) ||
        getActiveConversationId?.() ||
        lastStartedConversationRef.current;

      const applyFinalState = (state: AIState, targetId: string | null) => {
        setAiState(state, targetId);
        if (state !== "idle") {
          queueMicrotask(() => {
            setAiState((prev) => (prev === state ? "idle" : prev), targetId);
          });
        }

        if (!targetId) return;

        const targetSession = getSession(targetId);
        if (targetSession.idleRecoveryTimeoutId) {
          clearTimeout(targetSession.idleRecoveryTimeoutId);
          targetSession.idleRecoveryTimeoutId = null;
        }

        // Aggressive stale-state recovery:
        // if no request is pending shortly after finalize, force non-terminal busy
        // states back to idle so "stop chat" and thinking indicators never stick.
        targetSession.idleRecoveryTimeoutId = setTimeout(() => {
          const latestSession = getSession(targetId);
          latestSession.idleRecoveryTimeoutId = null;
          if (latestSession.pendingRequestId) return;
          setAiState((prev) => (isBusyAiState(prev) ? "idle" : prev), targetId);
          setAiProcessSteps?.([], targetId);
        }, DEFAULT_IDLE_RECOVERY_MS);
      };

      if (!targetConversationId) {
        setOptimisticMessages((prev) => [...prev, message]);
        onSendMessage(message).catch((err) => {
          console.error("[useStreamChat] onSendMessage failed:", err);
        });
        streamingContentRef.current = "";
        setStreamingContent("");
        applyFinalState(finalState, targetConversationId);
        setAiProcessSteps?.([], targetConversationId);
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

      applyFinalState(finalState, targetConversationId);
      setAiProcessSteps?.([], targetConversationId);

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
        chatId: rawChatId,
        signal,
        onEvent,
        onAiStateChange,
        buildFinalMessage,
        buildErrorMessage,
        queueMode = "replace",
        timeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
        firstTokenTimeoutMs = DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
        doneTimeoutMs = DEFAULT_DONE_TIMEOUT_MS,
        maxRetries = DEFAULT_MAX_RETRIES,
        retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
        retryJitterMs = DEFAULT_RETRY_JITTER_MS,
      } = options;

      const conversationId = normalizeConversationId(options);
      if (!conversationId) {
        const error = new Error("conversationId is required for isolated streaming");
        return { ok: false, content: "", error };
      }

      const scopedChatId = typeof rawChatId === "string" ? rawChatId.trim() : "";
      const bodyChatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";

      const session = getSession(conversationId);

      if (session.abortController && queueMode === "reject") {
        const error = new Error("Conversation already has a pending response");
        return { ok: false, content: session.fullContent, error };
      }

      if (session.abortController && queueMode === "replace") {
        abortConversation(conversationId);
      }

      const messageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      session.nextMessageId = messageId;
      const baseRequestId =
        typeof body?.requestId === "string" && body.requestId.trim()
          ? body.requestId.trim()
          : generateRequestId();

      const buildAttemptRequestId = (attempt: number) => {
        if (attempt === 0) return baseRequestId;
        const withSuffix = `${baseRequestId}_retry${attempt}`;
        return withSuffix.length > 120 ? withSuffix.slice(0, 120) : withSuffix;
      };

      const normalizedMaxRetries =
        Number.isFinite(maxRetries) && Number(maxRetries) >= 0
          ? Math.floor(Number(maxRetries))
          : DEFAULT_MAX_RETRIES;

      const computeBackoff = (attemptIndex: number) => {
        const base = retryBackoffMs * Math.pow(2, attemptIndex);
        const jitter = retryJitterMs ? Math.floor(Math.random() * retryJitterMs) : 0;
        return Math.max(0, base + jitter);
      };

      const shouldRetry = (
        error: any,
        response?: Response,
        timeoutCause?: "overall" | "first-token" | "done" | null
      ) => {
        if (timeoutCause) return true;
        const status = (error as any)?.status ?? response?.status;
        if (typeof status === "number") {
          if (status >= 500 || status === 429 || status === 408 || status === 504) return true;
          return false;
        }
        const msg = String(error?.message || "").toLowerCase();
        if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout")) return true;
        return false;
      };

      let lastError: Error | undefined;
      let lastResponse: Response | undefined;
      let lastContent = "";

      const resolveErrorResponseHealth = (
        error: StreamErrorWithResponseHealth,
        content: string,
        fallbackRetryable: boolean,
      ): ResponseHealthMetadata => {
        const eventResponseHealth = normalizeResponseHealth(error.responseHealth);

        if (hasMeaningfulAssistantContent(content)) {
          if (eventResponseHealth?.state === "partial") {
            return {
              ...eventResponseHealth,
              retryable: eventResponseHealth.retryable ?? fallbackRetryable,
              detail: eventResponseHealth.detail || error.message || undefined,
            };
          }

          return {
            state: "partial",
            retryable: eventResponseHealth?.retryable ?? fallbackRetryable,
            reason:
              "Se recupero una respuesta parcial antes de que el stream terminara correctamente.",
            detail: eventResponseHealth?.detail || error.message || undefined,
            provider: eventResponseHealth?.provider,
          };
        }

        return (
          eventResponseHealth || {
            state: "failed",
            retryable: fallbackRetryable,
            reason: "No se pudo completar esta respuesta.",
            detail:
              error.message || "Error de conexión. Por favor, intenta de nuevo.",
          }
        );
      };

      const buildStreamErrorMessage = (
        error: StreamErrorWithResponseHealth,
        content: string,
        requestId: string,
        fallbackRetryable: boolean,
      ) => {
        const responseHealth = resolveErrorResponseHealth(
          error,
          content,
          fallbackRetryable,
        );
        const baseMessage = buildErrorMessage?.(error, messageId) ?? {
          id: messageId,
          role: "assistant" as const,
          content:
            error.message || "Error de conexión. Por favor, intenta de nuevo.",
          timestamp: new Date(),
          requestId,
        };

        const resolvedContent =
          responseHealth.state === "partial"
            ? content
            : hasMeaningfulAssistantContent(baseMessage.content)
              ? baseMessage.content
              : responseHealth.reason ||
                baseMessage.content ||
                "No se pudo completar esta respuesta.";

        return withResponseHealth(
          {
            ...baseMessage,
            requestId: baseMessage.requestId || requestId,
            content: resolvedContent,
          },
          responseHealth,
        );
      };

      for (let attempt = 0; attempt <= normalizedMaxRetries; attempt++) {
        const streamRequestId = buildAttemptRequestId(attempt);
        const controller = new AbortController();
        abortControllerRef.current = controller;
        session.abortController = controller;
        lastStartedConversationRef.current = conversationId;

        const requestBody: Record<string, any> = {
          ...body,
          requestId: streamRequestId,
          conversationId,
          chatId: bodyChatId || scopedChatId || conversationId,
        };

        const combinedSignal = signal
          ? AbortSignal.any?.([controller.signal, signal]) ?? controller.signal
          : controller.signal;

        session.pendingRequestId = streamRequestId;
        session.fullContent = "";
        session.pendingContent = null;
        session.finalizing = false;
        if (session.idleRecoveryTimeoutId) {
          clearTimeout(session.idleRecoveryTimeoutId);
          session.idleRecoveryTimeoutId = null;
        }

        if (isConversationActive(conversationId)) {
          nextMessageIdRef.current = messageId;
          streamingContentRef.current = "";
          setStreamingContent("");
        }

        const { activeConversationId, onStreamStart } = getStreamCallbacks();
        onStreamStart?.({
          conversationId,
          activeConversationId,
          requestId: streamRequestId,
          messageId,
        });

        setAiState("thinking", conversationId);
        onAiStateChange?.("thinking");
        setAiProcessSteps?.([], conversationId);

        let response: Response | undefined;
        let fullContent = "";
        let lastEventData: any = null;
        let timeoutCause: "overall" | "first-token" | "done" | null = null;
        let hasReceivedEvent = false;
        let hasReceivedToken = false;
        let chunkSeq = 0;

        if (session.timeoutId) {
          clearTimeout(session.timeoutId);
        }
        session.timeoutId = setTimeout(() => {
          timeoutCause = "overall";
          controller.abort();
        }, timeoutMs);

        if (session.firstTokenTimeoutId) {
          clearTimeout(session.firstTokenTimeoutId);
        }
        if (firstTokenTimeoutMs > 0) {
          session.firstTokenTimeoutId = setTimeout(() => {
            if (!hasReceivedEvent && !session.finalizing && session.pendingRequestId === streamRequestId) {
              timeoutCause = "first-token";
              controller.abort();
            }
          }, firstTokenTimeoutMs);
        }

        if (session.doneTimeoutId) {
          clearTimeout(session.doneTimeoutId);
        }
        const armDoneTimeout = () => {
          if (doneTimeoutMs <= 0) return;
          if (session.doneTimeoutId) {
            clearTimeout(session.doneTimeoutId);
            session.doneTimeoutId = null;
          }
          session.doneTimeoutId = setTimeout(() => {
            if (!session.finalizing && session.pendingRequestId === streamRequestId && hasReceivedToken) {
              timeoutCause = "done";
              controller.abort();
            }
          }, doneTimeoutMs);
        };
        const clearTokenTimeouts = () => {
          if (session.firstTokenTimeoutId) {
            clearTimeout(session.firstTokenTimeoutId);
            session.firstTokenTimeoutId = null;
          }
          if (session.doneTimeoutId) {
            clearTimeout(session.doneTimeoutId);
            session.doneTimeoutId = null;
          }
          if (session.contentTokenTimeoutId) {
            clearTimeout(session.contentTokenTimeoutId);
            session.contentTokenTimeoutId = null;
          }
        };

        try {
          // Normalize optional array fields — never send null (breaks PARE schema validation)
          const cleanedBody = {
            ...requestBody,
            attachments: Array.isArray((requestBody as any).attachments) ? (requestBody as any).attachments : undefined,
            images: Array.isArray((requestBody as any).images) ? (requestBody as any).images : undefined,
          };

          response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-request-id": streamRequestId,
              ...getAnonUserIdHeader(),
            },
            credentials: "include",
            body: JSON.stringify(cleanedBody),
            signal: combinedSignal,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(errorData.error || `HTTP ${response.status}`);
            (error as any).status = response.status;
            throw error;
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
              setAiState("idle", conversationId);
              setAiProcessSteps?.([], conversationId);
              const { activeConversationId, onStreamAbort } = getStreamCallbacks();
              onStreamAbort?.({
                conversationId,
                activeConversationId,
                requestId: streamRequestId,
                messageId,
                content: "",
                reason: "noop",
              });
              return { ok: true, content: "", response };
            }

            const error = new Error(
              jsonData?.error || jsonData?.message || `Unexpected JSON response (${status || "json"})`
            );
            (error as any).status = response.status;
            throw error;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body");
          }

          setAiState("responding", conversationId);
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

              const eventConversationIdRaw =
                typeof data.conversationId === "string" ? data.conversationId.trim() : "";
              const eventChatIdRaw =
                typeof data.chatId === "string" ? data.chatId.trim() : "";
              const effectiveEventConversationId =
                eventConversationIdRaw || eventChatIdRaw || conversationId;
              const isContentEvent =
                currentEventType === "chunk" || currentEventType === "text";

              // Content chunks must be explicitly scoped so parallel chats never
              // bleed text into each other when a backend omits routing fields.
              if (isContentEvent && !eventConversationIdRaw && !eventChatIdRaw) {
                continue;
              }

              // For non-content events, be tolerant with missing routing
              // metadata and bind them to the current stream conversation.
              if (effectiveEventConversationId !== conversationId) {
                continue;
              }
              if (!eventConversationIdRaw) {
                data.conversationId = conversationId;
              }

              const eventRequestId = typeof data.requestId === "string" ? data.requestId.trim() : "";
              if (eventRequestId) {
                const normalizeRetrySuffix = (value: string) => value.replace(/_retry\d+$/i, "");
                const normalizedEventRequestId = normalizeRetrySuffix(eventRequestId);
                const normalizedStreamRequestId = normalizeRetrySuffix(streamRequestId);
                if (
                  eventRequestId !== streamRequestId &&
                  normalizedEventRequestId !== normalizedStreamRequestId
                ) {
                  continue;
                }
              }

              lastEventData = data;

              if (!hasReceivedEvent) {
                hasReceivedEvent = true;
                if (session.firstTokenTimeoutId) {
                  clearTimeout(session.firstTokenTimeoutId);
                  session.firstTokenTimeoutId = null;
                }
                // Arm contentTokenTimeout: guards the gap between receiving any SSE
                // event and the first content chunk. Without this, the spinner could
                // stay visible for up to 5 min (overallTimeout) if no chunks arrive.
                if (!hasReceivedToken && !session.contentTokenTimeoutId) {
                  session.contentTokenTimeoutId = setTimeout(() => {
                    if (!hasReceivedToken && !session.finalizing && session.pendingRequestId === streamRequestId) {
                      timeoutCause = "first-token";
                      controller.abort();
                    }
                  }, DEFAULT_CONTENT_TOKEN_TIMEOUT_MS);
                }
              }

              onEvent?.(currentEventType, data);

              if (currentEventType === "chunk" || currentEventType === "text") {
                const content = typeof data.content === "string" ? data.content : "";
                if (content) {
                  if (!hasReceivedToken) {
                    hasReceivedToken = true;
                    if (session.firstTokenTimeoutId) {
                      clearTimeout(session.firstTokenTimeoutId);
                      session.firstTokenTimeoutId = null;
                    }
                    // Clear contentTokenTimeout — we got a real token
                    if (session.contentTokenTimeoutId) {
                      clearTimeout(session.contentTokenTimeoutId);
                      session.contentTokenTimeoutId = null;
                    }
                    armDoneTimeout();
                  } else {
                    // Re-arm on every chunk so it acts as an inactivity timer
                    armDoneTimeout();
                  }
                  fullContent += content;
                  session.fullContent = fullContent;
                  chunkSeq += 1;
                  const { activeConversationId, onStreamChunk } = getStreamCallbacks();
                  onStreamChunk?.({
                    conversationId,
                    activeConversationId,
                    requestId: streamRequestId,
                    messageId,
                    chunk: content,
                    fullContent,
                    seq: chunkSeq,
                  });
                  if (isConversationActive(conversationId)) {
                    session.pendingContent = hasMeaningfulAssistantContent(fullContent)
                      ? fullContent
                      : "";
                    scheduleFlush(conversationId);
                  }
                }
              }

              const isStaleConversation = session.pendingRequestId !== streamRequestId;
              if (!isStaleConversation && currentEventType === "thinking") {
                setAiState("thinking", conversationId);
                onAiStateChange?.("thinking");

                if (data.step && data.message) {
                  setAiProcessSteps?.(
                    (prev: any[]) => {
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
                    },
                    conversationId
                  );
                }
              }

              if (!isStaleConversation && currentEventType === "context") {
                setAiState("responding", conversationId);
                onAiStateChange?.("responding");
                setAiProcessSteps?.(
                  (prev: any[]) => prev.map((s: any) => ({ ...s, status: "done" })),
                  conversationId
                );
              }

              if (!isStaleConversation && currentEventType === "production_start") {
                setAiState("agent_working", conversationId);
                onAiStateChange?.("agent_working");
              }

              if (currentEventType === "done" || currentEventType === "finish") {
                clearTokenTimeouts();
                streamDone = true;
                flushNow(conversationId);

                const finalEventData = { ...(lastEventData || {}), ...(data || {}) };
                if (!hasUsableStreamOutcome(fullContent, finalEventData)) {
                  throw new Error("No se recibio contenido util del servidor.");
                }
                const msg = withResponseHealth(
                  buildFinalMessage?.(fullContent, finalEventData, messageId) ?? {
                    id: messageId,
                    role: "assistant" as const,
                    content: fullContent,
                    timestamp: new Date(),
                    requestId: finalEventData.requestId || streamRequestId,
                    artifact: finalEventData.artifact,
                    webSources: finalEventData.webSources,
                  },
                  normalizeResponseHealth(finalEventData.responseHealth),
                );

                finalize(msg, conversationId, "done");
                const { activeConversationId, onStreamComplete } = getStreamCallbacks();
                onStreamComplete?.({
                  conversationId,
                  activeConversationId,
                  requestId: streamRequestId,
                  messageId,
                  content: fullContent,
                  message: msg,
                });
                return { ok: true, content: fullContent, message: msg, response };
              }

              if (currentEventType === "error" || currentEventType === "production_error") {
                const errorMsg = data.message || data.error || "Stream error";
                throw attachResponseHealth(
                  new Error(errorMsg),
                  data.responseHealth,
                );
              }
            }
          }

          if (!session.finalizing && hasUsableStreamOutcome(fullContent, lastEventData)) {
            clearTokenTimeouts();
            flushNow(conversationId);
            const msg = withResponseHealth(
              buildFinalMessage?.(fullContent, lastEventData, messageId) ?? {
                id: messageId,
                role: "assistant" as const,
                content: fullContent,
                timestamp: new Date(),
                requestId: streamRequestId,
              },
              normalizeResponseHealth(lastEventData?.responseHealth),
            );

            finalize(msg, conversationId, "done");
            const { activeConversationId, onStreamComplete } = getStreamCallbacks();
            onStreamComplete?.({
              conversationId,
              activeConversationId,
              requestId: streamRequestId,
              messageId,
              content: fullContent,
              message: msg,
            });
            return { ok: true, content: fullContent, message: msg, response };
          }

          if (!session.finalizing) {
            clearTokenTimeouts();
            throw new Error("No se recibio contenido util del servidor.");
          }

          return { ok: true, content: fullContent, response };
        } catch (err: any) {
          if (err?.name === "AbortError") {
            clearTokenTimeouts();

            if (!timeoutCause) {
              if (isConversationActive(conversationId)) {
                streamingContentRef.current = "";
                setStreamingContent("");
              }
              setAiState("idle", conversationId);
              setAiProcessSteps?.([], conversationId);
              const { activeConversationId, onStreamAbort } = getStreamCallbacks();
              onStreamAbort?.({
                conversationId,
                activeConversationId,
                requestId: streamRequestId,
                messageId,
                content: fullContent,
                reason: "cancelled",
              });
              return { ok: false, content: fullContent, response, error: err };
            }

            const abortMessage =
              timeoutCause === "first-token"
                ? `No se recibió ningún evento del servidor en ${firstTokenTimeoutMs}ms.`
                : timeoutCause === "done"
                  ? `La respuesta demoró demasiado (>${doneTimeoutMs}ms).`
                  : `La respuesta excedio el tiempo limite general (${timeoutMs}ms).`;

            const abortError = new Error(abortMessage);
            lastError = abortError;
            lastResponse = response;
            lastContent = fullContent;

            if (attempt < normalizedMaxRetries) {
              await sleep(computeBackoff(attempt));
              continue;
            }

            const timeoutResponseHealth: ResponseHealthMetadata =
              hasMeaningfulAssistantContent(fullContent)
                ? {
                    state: "partial",
                    retryable: true,
                    reason: "Se recupero una respuesta parcial antes del timeout.",
                    detail: abortMessage,
                  }
                : {
                    state: "failed",
                    retryable: true,
                    reason: "La respuesta excedio el tiempo limite.",
                    detail: abortMessage,
                  };

            const timeoutErrorMsg = buildStreamErrorMessage(
              attachResponseHealth(abortError, timeoutResponseHealth),
              fullContent,
              streamRequestId,
              true,
            );
            finalize(timeoutErrorMsg, conversationId, "error");
            const { activeConversationId, onStreamError } = getStreamCallbacks();
            onStreamError?.({
              conversationId,
              activeConversationId,
              requestId: streamRequestId,
              messageId,
              content: fullContent,
              error: abortError,
              message: timeoutErrorMsg,
            });

            return { ok: false, content: fullContent, response, error: abortError };
          }

          const normalizedError = (
            err instanceof Error ? err : new Error(String(err))
          ) as StreamErrorWithResponseHealth;
          console.error("[useStreamChat] Stream error:", normalizedError);

          const retryable = shouldRetry(normalizedError, response, timeoutCause);
          lastError = normalizedError;
          lastResponse = response;
          lastContent = fullContent;

          if (retryable && attempt < normalizedMaxRetries) {
            await sleep(computeBackoff(attempt));
            continue;
          }

          const errorMsg = buildStreamErrorMessage(
            normalizedError,
            fullContent,
            streamRequestId,
            retryable,
          );

          if (!session.finalizing) {
            finalize(errorMsg, conversationId, "error");
          }
          const { activeConversationId, onStreamError } = getStreamCallbacks();
          onStreamError?.({
            conversationId,
            activeConversationId,
            requestId: streamRequestId,
            messageId,
            content: fullContent,
            error: normalizedError,
            message: errorMsg,
          });

          return { ok: false, content: fullContent, message: errorMsg, response, error: normalizedError };
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
          if (session.firstTokenTimeoutId) {
            clearTimeout(session.firstTokenTimeoutId);
            session.firstTokenTimeoutId = null;
          }
          if (session.doneTimeoutId) {
            clearTimeout(session.doneTimeoutId);
            session.doneTimeoutId = null;
          }
          if (session.contentTokenTimeoutId) {
            clearTimeout(session.contentTokenTimeoutId);
            session.contentTokenTimeoutId = null;
          }

          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
          }
        }
      }

      if (lastError) {
        const retryable = shouldRetry(lastError, lastResponse, null);
        const errorMsg = buildStreamErrorMessage(
          lastError as StreamErrorWithResponseHealth,
          lastContent,
          baseRequestId,
          retryable,
        );
        finalize(errorMsg, conversationId, "error");
        const { activeConversationId, onStreamError } = getStreamCallbacks();
        onStreamError?.({
          conversationId,
          activeConversationId,
          requestId: baseRequestId,
          messageId,
          content: lastContent,
          error: lastError,
          message: errorMsg,
        });
        return { ok: false, content: lastContent, message: errorMsg, response: lastResponse, error: lastError };
      }

      const fallbackError = new Error("Stream failed");
      return { ok: false, content: "", error: fallbackError };
    },
    [
      abortConversation,
      finalize,
      flushNow,
      getStreamCallbacks,
      getSession,
      isConversationActive,
      scheduleFlush,
      setAiProcessSteps,
      setAiState,
    ]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
