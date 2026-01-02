import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type AgentModeStatus = 'idle' | 'queued' | 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentPlan {
  objective: string;
  steps: string[];
  estimatedTime: number;
}

export interface AgentStep {
  stepIndex: number;
  toolName: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  output?: any;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Artifact {
  type: string;
  name: string;
  data: any;
}

export interface AgentRunResponse {
  id: string;
  chatId: string;
  status: AgentModeStatus;
  plan?: AgentPlan;
  steps: AgentStep[];
  artifacts: Artifact[];
  summary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentModeState {
  runId: string | null;
  status: AgentModeStatus;
  plan: AgentPlan | null;
  steps: AgentStep[];
  artifacts: Artifact[];
  summary: string | null;
  error: string | null;
  progress: { current: number; total: number };
}

const initialState: AgentModeState = {
  runId: null,
  status: 'idle',
  plan: null,
  steps: [],
  artifacts: [],
  summary: null,
  error: null,
  progress: { current: 0, total: 0 }
};

export function useAgentMode(chatId: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AgentModeState>(initialState);
  const lastMessageRef = useRef<string | null>(null);
  const lastAttachmentsRef = useRef<any[] | undefined>(undefined);

  const isPollingActive = ['queued', 'planning', 'running'].includes(state.status);

  const { data: runData } = useQuery<AgentRunResponse | null>({
    queryKey: ['/api/agent/runs', state.runId],
    queryFn: async () => {
      if (!state.runId) return null;
      const res = await fetch(`/api/agent/runs/${state.runId}`, {
        credentials: 'include'
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Failed to fetch run: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!state.runId && isPollingActive,
    refetchInterval: isPollingActive ? 2000 : false,
    staleTime: 0
  });

  useEffect(() => {
    if (runData) {
      const completedSteps = runData.steps.filter(s => s.status === 'succeeded' || s.status === 'failed').length;
      const totalSteps = runData.plan?.steps.length || runData.steps.length || 0;
      
      setState(prev => ({
        ...prev,
        status: runData.status,
        plan: runData.plan || null,
        steps: runData.steps,
        artifacts: runData.artifacts || [],
        summary: runData.summary || null,
        error: runData.error || null,
        progress: { current: completedSteps, total: totalSteps }
      }));
    }
  }, [runData]);

  const startRunMutation = useMutation({
    mutationFn: async ({ message, attachments }: { message: string; attachments?: any[] }) => {
      const res = await apiRequest('POST', `/api/agent/runs`, {
        chatId,
        message,
        attachments
      });
      return res.json() as Promise<AgentRunResponse>;
    },
    onSuccess: (data) => {
      setState({
        runId: data.id,
        status: data.status,
        plan: data.plan || null,
        steps: data.steps || [],
        artifacts: data.artifacts || [],
        summary: data.summary || null,
        error: data.error || null,
        progress: { current: 0, total: data.plan?.steps.length || 0 }
      });
      queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', data.id] });
    },
    onError: (error: Error) => {
      setState(prev => ({
        ...prev,
        status: 'failed',
        error: error.message
      }));
    }
  });

  const cancelRunMutation = useMutation({
    mutationFn: async () => {
      if (!state.runId) throw new Error('No active run to cancel');
      await apiRequest('POST', `/api/agent/runs/${state.runId}/cancel`);
    },
    onSuccess: () => {
      setState(prev => ({
        ...prev,
        status: 'cancelled'
      }));
      if (state.runId) {
        queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', state.runId] });
      }
    },
    onError: (error: Error) => {
      console.error('Failed to cancel run:', error);
    }
  });

  const retryRunMutation = useMutation({
    mutationFn: async () => {
      if (!lastMessageRef.current) throw new Error('No previous message to retry');
      const res = await apiRequest('POST', `/api/agent/runs`, {
        chatId,
        message: lastMessageRef.current,
        attachments: lastAttachmentsRef.current
      });
      return res.json() as Promise<AgentRunResponse>;
    },
    onSuccess: (data) => {
      setState({
        runId: data.id,
        status: data.status,
        plan: data.plan || null,
        steps: data.steps || [],
        artifacts: data.artifacts || [],
        summary: data.summary || null,
        error: data.error || null,
        progress: { current: 0, total: data.plan?.steps.length || 0 }
      });
      queryClient.invalidateQueries({ queryKey: ['/api/agent/runs', data.id] });
    },
    onError: (error: Error) => {
      setState(prev => ({
        ...prev,
        status: 'failed',
        error: error.message
      }));
    }
  });

  const startRun = useCallback(async (message: string, attachments?: any[]): Promise<string> => {
    lastMessageRef.current = message;
    lastAttachmentsRef.current = attachments;
    
    const result = await startRunMutation.mutateAsync({ message, attachments });
    return result.id;
  }, [startRunMutation]);

  const cancelRun = useCallback(async (): Promise<void> => {
    await cancelRunMutation.mutateAsync();
  }, [cancelRunMutation]);

  const retryRun = useCallback(async (): Promise<void> => {
    await retryRunMutation.mutateAsync();
  }, [retryRunMutation]);

  const isRunning = ['queued', 'planning', 'running'].includes(state.status);

  return {
    runId: state.runId,
    status: state.status,
    plan: state.plan,
    steps: state.steps,
    artifacts: state.artifacts,
    summary: state.summary,
    error: state.error,
    progress: state.progress,
    startRun,
    cancelRun,
    retryRun,
    isRunning
  };
}
