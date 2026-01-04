import { create } from 'zustand';
import type { TraceEvent, TraceEventType } from '@shared/schema';

export interface TraceStep {
  index: number;
  toolName: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  output?: string;
  error?: string;
  artifacts: TraceArtifact[];
  events: TraceEvent[];
  isExpanded: boolean;
}

export interface TraceArtifact {
  type: string;
  name: string;
  url?: string;
  data?: any;
}

export interface TracePlan {
  objective: string;
  steps: { index: number; toolName: string; description: string }[];
  estimatedTime?: string;
}

export interface TraceRun {
  runId: string;
  status: 'pending' | 'planning' | 'running' | 'verifying' | 'completed' | 'failed' | 'cancelled';
  phase: 'planning' | 'executing' | 'verifying' | 'completed' | 'failed' | 'cancelled';
  plan: TracePlan | null;
  steps: TraceStep[];
  artifacts: TraceArtifact[];
  events: TraceEvent[];
  summary?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  currentStepIndex: number;
}

interface AgentTraceState {
  runs: Map<string, TraceRun>;
  activeRunId: string | null;
  eventSources: Map<string, EventSource>;
  isConnected: boolean;
  connectionError: string | null;
  
  subscribeToRun: (runId: string) => void;
  unsubscribeFromRun: (runId: string) => void;
  handleEvent: (event: TraceEvent) => void;
  toggleStepExpanded: (runId: string, stepIndex: number) => void;
  setActiveRun: (runId: string | null) => void;
  getActiveRun: () => TraceRun | null;
  clearRun: (runId: string) => void;
}

const createEmptyRun = (runId: string): TraceRun => ({
  runId,
  status: 'pending',
  phase: 'planning',
  plan: null,
  steps: [],
  artifacts: [],
  events: [],
  currentStepIndex: 0,
});

export const useAgentTraceStore = create<AgentTraceState>((set, get) => ({
  runs: new Map(),
  activeRunId: null,
  eventSources: new Map(),
  isConnected: false,
  connectionError: null,

  subscribeToRun: (runId: string) => {
    const { eventSources } = get();
    
    if (eventSources.has(runId)) {
      return;
    }

    const eventSource = new EventSource(`/api/agent/runs/${runId}/events/stream`, {
      withCredentials: true,
    });

    eventSource.onopen = () => {
      set({ isConnected: true, connectionError: null });
      console.log(`[TraceStore] Connected to run ${runId}`);
    };

    eventSource.onerror = (error) => {
      console.error(`[TraceStore] SSE error for run ${runId}:`, error);
      set({ isConnected: false, connectionError: 'Connection lost' });
    };

    const eventTypes: TraceEventType[] = [
      'task_start', 'plan_created', 'plan_step', 'step_started',
      'tool_call', 'tool_output', 'tool_chunk', 'observation',
      'verification', 'step_completed', 'step_failed', 'step_retried',
      'replan', 'thinking', 'shell_output', 'artifact_created',
      'error', 'done', 'cancelled', 'heartbeat'
    ];

    for (const eventType of eventTypes) {
      eventSource.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as TraceEvent;
          get().handleEvent(event);
        } catch (err) {
          console.error(`[TraceStore] Failed to parse event:`, err);
        }
      });
    }

    set(state => {
      const newEventSources = new Map(state.eventSources);
      newEventSources.set(runId, eventSource);
      
      const newRuns = new Map(state.runs);
      if (!newRuns.has(runId)) {
        newRuns.set(runId, createEmptyRun(runId));
      }
      
      return { 
        eventSources: newEventSources, 
        runs: newRuns,
        activeRunId: runId,
      };
    });
  },

  unsubscribeFromRun: (runId: string) => {
    const { eventSources } = get();
    const eventSource = eventSources.get(runId);
    
    if (eventSource) {
      eventSource.close();
      set(state => {
        const newEventSources = new Map(state.eventSources);
        newEventSources.delete(runId);
        return { eventSources: newEventSources };
      });
      console.log(`[TraceStore] Disconnected from run ${runId}`);
    }
  },

  handleEvent: (event: TraceEvent) => {
    set(state => {
      const newRuns = new Map(state.runs);
      const run = newRuns.get(event.runId) || createEmptyRun(event.runId);
      
      const updatedRun = { ...run, events: [...run.events, event] };

      switch (event.event_type) {
        case 'task_start':
          updatedRun.status = 'planning';
          updatedRun.phase = 'planning';
          updatedRun.startedAt = event.timestamp;
          break;

        case 'plan_created':
          if (event.plan) {
            updatedRun.plan = event.plan;
            updatedRun.steps = event.plan.steps.map((s, i) => ({
              index: i,
              toolName: s.toolName,
              description: s.description,
              status: 'pending' as const,
              artifacts: [],
              events: [],
              isExpanded: i === 0,
            }));
          }
          break;

        case 'step_started':
          updatedRun.status = 'running';
          updatedRun.phase = 'executing';
          if (event.stepIndex !== undefined) {
            updatedRun.currentStepIndex = event.stepIndex;
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'running';
              step.startedAt = event.timestamp;
              step.events.push(event);
            }
          }
          break;

        case 'tool_call':
        case 'tool_output':
        case 'tool_chunk':
        case 'shell_output':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.events.push(event);
              if (event.output_snippet) {
                if (event.event_type === 'tool_chunk') {
                  step.output = (step.output || '') + event.output_snippet;
                } else {
                  step.output = event.output_snippet;
                }
              }
            }
          }
          break;

        case 'step_completed':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'completed';
              step.completedAt = event.timestamp;
              step.events.push(event);
            }
          }
          break;

        case 'step_failed':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'failed';
              step.completedAt = event.timestamp;
              step.error = event.error?.message;
              step.events.push(event);
            }
          }
          break;

        case 'step_retried':
          if (event.stepIndex !== undefined) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              step.status = 'retrying';
              step.events.push(event);
            }
          }
          break;

        case 'artifact_created':
          if (event.artifact) {
            const artifact: TraceArtifact = {
              type: event.artifact.type,
              name: event.artifact.name,
              url: event.artifact.url,
              data: event.artifact.data,
            };
            updatedRun.artifacts.push(artifact);
            if (event.stepIndex !== undefined) {
              const step = updatedRun.steps[event.stepIndex];
              if (step) {
                step.artifacts.push(artifact);
              }
            }
          }
          break;

        case 'verification':
          updatedRun.phase = 'verifying';
          updatedRun.status = 'verifying';
          break;

        case 'done':
          updatedRun.status = 'completed';
          updatedRun.phase = 'completed';
          updatedRun.completedAt = event.timestamp;
          updatedRun.summary = event.summary;
          break;

        case 'error':
          if (event.error) {
            updatedRun.error = event.error.message;
          }
          break;

        case 'cancelled':
          updatedRun.status = 'cancelled';
          updatedRun.phase = 'cancelled';
          updatedRun.completedAt = event.timestamp;
          break;
      }

      newRuns.set(event.runId, updatedRun);
      return { runs: newRuns };
    });
  },

  toggleStepExpanded: (runId: string, stepIndex: number) => {
    set(state => {
      const newRuns = new Map(state.runs);
      const run = newRuns.get(runId);
      if (run) {
        const updatedRun = { ...run };
        updatedRun.steps = updatedRun.steps.map((step, i) => 
          i === stepIndex ? { ...step, isExpanded: !step.isExpanded } : step
        );
        newRuns.set(runId, updatedRun);
      }
      return { runs: newRuns };
    });
  },

  setActiveRun: (runId: string | null) => {
    set({ activeRunId: runId });
  },

  getActiveRun: () => {
    const { runs, activeRunId } = get();
    return activeRunId ? runs.get(activeRunId) || null : null;
  },

  clearRun: (runId: string) => {
    const { unsubscribeFromRun } = get();
    unsubscribeFromRun(runId);
    set(state => {
      const newRuns = new Map(state.runs);
      newRuns.delete(runId);
      return { 
        runs: newRuns,
        activeRunId: state.activeRunId === runId ? null : state.activeRunId,
      };
    });
  },
}));
