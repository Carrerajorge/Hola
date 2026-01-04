import { useEffect, useRef, useCallback } from "react";
import { useAgentStore, useAgentRun } from "@/stores/agent-store";
import { pollingManager } from "@/lib/polling-manager";

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
  const { createRun, setRunId, failRun } = useAgentStore();
  
  const startRun = useCallback(async (
    chatId: string,
    userMessage: string,
    messageId: string,
    attachments?: any[]
  ): Promise<{ runId: string; chatId: string } | null> => {
    createRun(chatId, userMessage, messageId);
    
    try {
      let resolvedChatId = chatId;
      
      if (!chatId || chatId.startsWith("pending-") || chatId === "") {
        const chatRes = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title: userMessage.substring(0, 50) + (userMessage.length > 50 ? "..." : ""),
            model: "gemini-3-flash-preview",
            provider: "google"
          })
        });
        if (!chatRes.ok) throw new Error('Inicia sesión para usar el modo agente');
        const newChat = await chatRes.json();
        resolvedChatId = newChat.id;
      }
      
      const runRes = await fetch('/api/agent/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          chatId: resolvedChatId,
          message: userMessage,
          attachments
        })
      });
      
      if (!runRes.ok) throw new Error('Error al iniciar el agente');
      const runData = await runRes.json();
      
      setRunId(messageId, runData.id, runData.chatId);
      pollingManager.start(messageId, runData.id);
      
      return { runId: runData.id, chatId: runData.chatId };
      
    } catch (error: any) {
      failRun(messageId, error.message);
      return null;
    }
  }, [createRun, setRunId, failRun]);
  
  return { startRun };
}

export function useCancelAgentRun() {
  const { cancelRun, stopPolling } = useAgentStore();
  
  const cancel = useCallback(async (messageId: string, runId: string) => {
    pollingManager.cancel(runId);
    stopPolling(messageId);
    
    try {
      await fetch(`/api/agent/runs/${runId}/cancel`, {
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
