import { create } from 'zustand';
import type { TraceEvent, TraceEventType } from '@shared/schema';

export interface TraceCitation {
  source: string;
  text: string;
  page?: number;
  url?: string;
  favicon?: string;
}

export interface TraceProgress {
  current: number;
  total: number;
  percentage?: number;
  message?: string;
}

export interface TraceAgent {
  name: string;
  role?: string;
  status?: string;
}

export interface TraceMemoryEvent {
  type: 'loaded' | 'saved';
  keys?: string[];
  count?: number;
  timestamp: number;
}

export interface TraceVerification {
  passed: boolean;
  message?: string;
  timestamp: number;
}

export interface TraceToolCall {
  toolName: string;
  status: 'started' | 'running' | 'succeeded' | 'failed';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface TraceStep {
  index: number;
  toolName: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  output?: string;
  error?: string;
  artifacts: TraceArtifact[];
  events: TraceEvent[];
  toolCalls: TraceToolCall[];
  isExpanded: boolean;
}

export interface TraceArtifact {
  type: string;
  name: string;
  url?: string;
  data?: any;
  mimeType?: string;
  size?: number;
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
  citations: TraceCitation[];
  verifications: TraceVerification[];
  memoryEvents: TraceMemoryEvent[];
  activeAgent: TraceAgent | null;
  delegatedAgents: TraceAgent[];
  progress: TraceProgress | null;
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
  citations: [],
  verifications: [],
  memoryEvents: [],
  activeAgent: null,
  delegatedAgents: [],
  progress: null,
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
      'tool_call', 'tool_call_started', 'tool_call_succeeded', 'tool_call_failed',
      'tool_output', 'tool_chunk', 'observation',
      'verification', 'verification_passed', 'verification_failed',
      'step_completed', 'step_failed', 'step_retried',
      'replan', 'thinking', 'shell_output',
      'artifact_created', 'artifact_ready',
      'citations_added', 'memory_loaded', 'memory_saved',
      'agent_delegated', 'agent_completed', 'progress_update',
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
              toolCalls: [],
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

        case 'tool_call_started':
          if (event.stepIndex !== undefined && event.tool_name) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              const toolCall: TraceToolCall = {
                toolName: event.tool_name,
                status: 'started',
                startedAt: event.timestamp,
              };
              step.toolCalls.push(toolCall);
              const MAX_TOOL_CALLS = 50;
              if (step.toolCalls.length > MAX_TOOL_CALLS) {
                step.toolCalls = step.toolCalls.slice(-MAX_TOOL_CALLS);
              }
              step.events.push(event);
            }
          }
          break;

        case 'tool_call_succeeded':
          if (event.stepIndex !== undefined && event.tool_name) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              const toolCall = step.toolCalls.find(
                tc => tc.toolName === event.tool_name && tc.status !== 'succeeded' && tc.status !== 'failed'
              );
              if (toolCall) {
                toolCall.status = 'succeeded';
                toolCall.completedAt = event.timestamp;
                toolCall.durationMs = event.durationMs || (event.timestamp - toolCall.startedAt);
              }
              step.events.push(event);
            }
          }
          break;

        case 'tool_call_failed':
          if (event.stepIndex !== undefined && event.tool_name) {
            const step = updatedRun.steps[event.stepIndex];
            if (step) {
              const toolCall = step.toolCalls.find(
                tc => tc.toolName === event.tool_name && tc.status !== 'succeeded' && tc.status !== 'failed'
              );
              if (toolCall) {
                toolCall.status = 'failed';
                toolCall.completedAt = event.timestamp;
                toolCall.durationMs = event.durationMs || (event.timestamp - toolCall.startedAt);
                toolCall.error = event.error?.message;
              }
              step.events.push(event);
            }
          }
          break;

        case 'artifact_ready':
          if (event.artifact) {
            const artifact: TraceArtifact = {
              type: event.artifact.type,
              name: event.artifact.name,
              url: event.artifact.url,
              data: event.artifact.data,
              mimeType: event.artifact.mimeType,
              size: event.artifact.size,
            };
            const existing = updatedRun.artifacts.find(a => a.name === artifact.name);
            if (!existing) {
              updatedRun.artifacts.push(artifact);
            }
            if (event.stepIndex !== undefined) {
              const step = updatedRun.steps[event.stepIndex];
              if (step) {
                const stepExisting = step.artifacts.find(a => a.name === artifact.name);
                if (!stepExisting) {
                  step.artifacts.push(artifact);
                }
              }
            }
          }
          break;

        case 'citations_added':
          if (event.citations) {
            const newCitations: TraceCitation[] = event.citations.map(c => ({
              source: c.source,
              text: c.text,
              page: c.page,
              url: c.url,
            }));
            updatedRun.citations = [...updatedRun.citations, ...newCitations];
          }
          break;

        case 'verification_passed':
          updatedRun.verifications.push({
            passed: true,
            message: event.content,
            timestamp: event.timestamp,
          });
          break;

        case 'verification_failed':
          updatedRun.verifications.push({
            passed: false,
            message: event.error?.message || event.content,
            timestamp: event.timestamp,
          });
          break;

        case 'agent_delegated':
          if (event.agent) {
            const agent: TraceAgent = {
              name: event.agent.name,
              role: event.agent.role,
              status: 'active',
            };
            updatedRun.activeAgent = agent;
            updatedRun.delegatedAgents.push(agent);
          }
          break;

        case 'agent_completed':
          if (event.agent) {
            const agent = updatedRun.delegatedAgents.find(a => a.name === event.agent?.name);
            if (agent) {
              agent.status = 'completed';
            }
            if (updatedRun.activeAgent?.name === event.agent.name) {
              updatedRun.activeAgent = null;
            }
          }
          break;

        case 'progress_update':
          if (event.progress) {
            updatedRun.progress = {
              current: event.progress.current,
              total: event.progress.total,
              percentage: event.progress.percentage,
              message: event.progress.message,
            };
          }
          break;

        case 'memory_loaded':
          updatedRun.memoryEvents.push({
            type: 'loaded',
            keys: event.memory?.keys,
            count: event.memory?.loaded,
            timestamp: event.timestamp,
          });
          break;

        case 'memory_saved':
          updatedRun.memoryEvents.push({
            type: 'saved',
            keys: event.memory?.keys,
            count: event.memory?.saved,
            timestamp: event.timestamp,
          });
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
