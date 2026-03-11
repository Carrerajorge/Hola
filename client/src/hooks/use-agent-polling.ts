import { useEffect, useRef, useCallback } from "react";
import { useAgentStore, useAgentRun } from "@/stores/agent-store";
import { pollingManager } from "@/lib/polling-manager";
import { apiFetch } from "@/lib/apiClient";

// Global map of AbortControllers for pending agent start requests
const pendingAgentStartControllers = new Map<string, AbortController>();

export function abortPendingAgentStart(messageId: string): void {
  const controller = pendingAgentStartControllers.get(messageId);
  if (controller) {
    controller.abort();
    pendingAgentStartControllers.delete(messageId);
  }
}

export function useAgentPolling(messageId: string | null) {
  const agentRun = useAgentRun(messageId || "");
  const hasValidMessageId = Boolean(messageId && messageId.length > 0);
  const runId = agentRun?.runId || null;
  const status = agentRun?.status || null;
  
  const lastStartedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasValidMessageId || !messageId || !runId) {
      return;
    }
    
    const isActiveStatus = ['starting', 'queued', 'planning', 'running', 'verifying', 'replanning'].includes(status || '');
    
    if (isActiveStatus && runId !== lastStartedRunIdRef.current) {
      lastStartedRunIdRef.current = runId;
      pollingManager.start(messageId, runId);
    }
    
  }, [hasValidMessageId, messageId, runId, status]);

  useEffect(() => {
    return () => {
      if (lastStartedRunIdRef.current) {
        pollingManager.cancel(lastStartedRunIdRef.current);
        lastStartedRunIdRef.current = null;
      }
    };
  }, []);

  return {
    isPolling: runId ? pollingManager.isPolling(runId) : false,
  };
}

export function useStartAgentRun() {
  const { createRun, setRunId, clearRun } = useAgentStore();
  
  const startRun = useCallback(async (
    chatId: string,
    userMessage: string,
    messageId: string,
    attachments?: any[],
    options?: { model?: string; provider?: string }
  ): Promise<{ runId: string; chatId: string } | null> => {
    // Create AbortController for this request
    const abortController = new AbortController();
    pendingAgentStartControllers.set(messageId, abortController);
    
    createRun(chatId, userMessage, messageId);
    
    try {
      let resolvedChatId = chatId;
      
      if (!chatId || chatId.startsWith("pending-") || chatId === "") {
        const chatRes = await apiFetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: abortController.signal,
          timeoutMs: 10_000,
          body: JSON.stringify({
            title: userMessage.substring(0, 50) + (userMessage.length > 50 ? "..." : ""),
            model: options?.model || "gemini-3-flash-preview",
            provider: options?.provider || "google"
          })
        });
        if (!chatRes.ok) throw new Error('Inicia sesión para usar el modo agente');
        const newChat = await chatRes.json();
        resolvedChatId = newChat.id;
      }
      
      // Check if run was cancelled while waiting for chat creation
      const currentRun = useAgentStore.getState().runs[messageId];
      if (currentRun?.status === 'cancelled') {
        pendingAgentStartControllers.delete(messageId);
        return null;
      }
      
      const runRes = await apiFetch('/api/agent/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: abortController.signal,
        timeoutMs: 12_000,
        body: JSON.stringify({
          chatId: resolvedChatId,
          message: userMessage,
          attachments,
          model: options?.model,
        })
      });

      let runErrorBody: any = null;
      if (!runRes.ok) {
        try {
          runErrorBody = await runRes.json();
        } catch {
          runErrorBody = null;
        }

        // Guard blocks are expected in some flows; fallback to normal chat without noisy failed runs.
        if (runRes.status === 409 && runErrorBody?.error === 'EXECUTION_BLOCKED_BY_INTENT_GUARD') {
          clearRun(messageId);
          pendingAgentStartControllers.delete(messageId);
          return null;
        }

        const message =
          runErrorBody?.message ||
          runErrorBody?.error ||
          `Error al iniciar el agente (HTTP ${runRes.status})`;
        throw new Error(message);
      }

      const runData = await runRes.json();
      
      // Check again if cancelled while waiting for API response
      const runAfterApi = useAgentStore.getState().runs[messageId];
      if (runAfterApi?.status === 'cancelled') {
        pendingAgentStartControllers.delete(messageId);
        // Attempt to cancel the backend run that was just created
        try {
          await apiFetch(`/api/agent/runs/${runData.id}/cancel`, {
            method: 'POST',
            credentials: 'include'
          });
        } catch {
          // Best effort cancellation
        }
        return null;
      }
      
      setRunId(messageId, runData.id, runData.chatId);
      
      // Verify state is still active after setRunId before starting polling
      const stateAfterSetRunId = useAgentStore.getState().runs[messageId];
      if (stateAfterSetRunId?.status && !['cancelled', 'failed', 'completed'].includes(stateAfterSetRunId.status)) {
        pollingManager.start(messageId, runData.id);
      }
      
      pendingAgentStartControllers.delete(messageId);
      return { runId: runData.id, chatId: runData.chatId };
      
    } catch (error: any) {
      pendingAgentStartControllers.delete(messageId);
      // Handle abort errors gracefully - don't fail the run, it was user-initiated
      if (error.name === 'AbortError') {
        clearRun(messageId);
        return null;
      }
      clearRun(messageId);
      throw error;
    }
  }, [createRun, setRunId, clearRun]);
  
  return { startRun };
}

export function useCancelAgentRun() {
  const { cancelRun, stopPolling } = useAgentStore();
  
  const cancel = useCallback(async (messageId: string, runId: string) => {
    pollingManager.cancel(runId);
    stopPolling(messageId);
    
    try {
      await apiFetch(`/api/agent/runs/${runId}/cancel`, {
        method: 'POST',
        credentials: 'include'
      });
      cancelRun(messageId);
      return true;
    } catch (error) {
      console.error('[AgentPolling] Failed to cancel run:', error);
      return false;
    }
  }, [cancelRun, stopPolling]);
  
  return { cancel };
}
