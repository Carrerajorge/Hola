// AgentOS Run Console - Real-time agent run visualization
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  RunState,
  RunStatus,
  TimelineEvent,
  StreamMessage,
  EvidenceCard,
  PlanDiff,
  BudgetSnapshot,
  DAGState,
} from "../types";
import { EventStreamClient, type ConnectionState } from "../streaming/event-stream";

// --- State management ---

interface ConsoleState {
  status: RunStatus;
  timeline: TimelineEvent[];
  dag: DAGState;
  budget: BudgetSnapshot | null;
  currentStepId: string | null;
  connectionState: ConnectionState;
  error: string | null;
}

type ConsoleAction =
  | { type: "SET_CONNECTION"; state: ConnectionState }
  | { type: "INIT_RUN"; run: RunState }
  | { type: "TIMELINE_EVENT"; event: TimelineEvent }
  | { type: "STATUS_CHANGE"; status: RunStatus }
  | { type: "DAG_UPDATE"; dag: DAGState }
  | { type: "BUDGET_UPDATE"; budget: BudgetSnapshot }
  | { type: "STEP_CHANGE"; stepId: string | null }
  | { type: "ERROR"; error: string };

function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case "SET_CONNECTION":
      return { ...state, connectionState: action.state };
    case "INIT_RUN":
      return {
        ...state,
        status: action.run.status,
        timeline: action.run.timeline,
        dag: action.run.dag,
        budget: action.run.budget,
        currentStepId: action.run.currentStepId,
      };
    case "TIMELINE_EVENT":
      return { ...state, timeline: [...state.timeline, action.event] };
    case "STATUS_CHANGE":
      return { ...state, status: action.status };
    case "DAG_UPDATE":
      return { ...state, dag: action.dag };
    case "BUDGET_UPDATE":
      return { ...state, budget: action.budget };
    case "STEP_CHANGE":
      return { ...state, currentStepId: action.stepId };
    case "ERROR":
      return { ...state, error: action.error };
    default:
      return state;
  }
}

const initialState: ConsoleState = {
  status: "pending",
  timeline: [],
  dag: { nodes: [], edges: [], revision: 0 },
  budget: null,
  currentStepId: null,
  connectionState: "disconnected",
  error: null,
};

// --- Hooks ---

function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const shouldScroll = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (ref.current && shouldScroll.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!ref.current) return;
    const { scrollTop, scrollHeight, clientHeight } = ref.current;
    shouldScroll.current = scrollHeight - scrollTop - clientHeight < 60;
  }, []);

  return { ref, scrollToBottom, handleScroll };
}

// --- Sub-components ---

const StatusBadge: React.FC<{ status: RunStatus }> = ({ status }) => {
  const colors: Record<RunStatus, string> = {
    pending: "bg-slate-100 text-slate-700",
    planning: "bg-blue-100 text-blue-700",
    running: "bg-emerald-100 text-emerald-700",
    paused: "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    cancelled: "bg-gray-100 text-gray-600",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status === "running" && <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

const TimelineEntry: React.FC<{ event: TimelineEvent; isActive: boolean }> = ({ event, isActive }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border-l-2 pl-4 py-2 ${isActive ? "border-blue-500" : "border-slate-200"}`}
      role="listitem"
    >
      <button className="w-full text-left" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-900">{event.title}</span>
          <time className="text-xs text-slate-500">
            {new Date(event.timestamp).toLocaleTimeString()}
          </time>
        </div>
      </button>
      {expanded && event.detail && (
        <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{event.detail}</p>
      )}
      {expanded && event.evidence && event.evidence.length > 0 && (
        <div className="mt-2 space-y-1">
          {event.evidence.map((ev) => (
            <div key={ev.id} className="rounded bg-slate-50 px-2 py-1 text-xs">
              <span className="font-medium">{ev.claim}</span>
              <span className="ml-2 text-slate-500">({Math.round(ev.confidence * 100)}%)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ConnectionIndicator: React.FC<{ state: ConnectionState }> = ({ state }) => {
  const dotColor =
    state === "connected" ? "bg-green-500" :
    state === "connecting" || state === "reconnecting" ? "bg-amber-500 animate-pulse" :
    "bg-red-500";

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      {state}
    </div>
  );
};

// --- Main component ---

export interface RunConsoleProps {
  runId: string;
  baseUrl: string;
  authToken?: string;
  className?: string;
  onRunComplete?: (state: ConsoleState) => void;
}

export const RunConsole: React.FC<RunConsoleProps> = ({
  runId,
  baseUrl,
  authToken,
  className = "",
  onRunComplete,
}) => {
  const [state, dispatch] = useReducer(consoleReducer, initialState);
  const clientRef = useRef<EventStreamClient | null>(null);
  const { ref: scrollRef, scrollToBottom, handleScroll } = useAutoScroll<HTMLDivElement>();

  useEffect(() => {
    const client = new EventStreamClient({
      baseUrl,
      runId,
      authToken,
      onStateChange: (connState) => dispatch({ type: "SET_CONNECTION", state: connState }),
      onMessage: (msg: StreamMessage) => {
        switch (msg.event) {
          case "step_started":
            dispatch({ type: "STEP_CHANGE", stepId: (msg.payload as { stepId: string }).stepId });
            dispatch({ type: "TIMELINE_EVENT", event: msg.payload as TimelineEvent });
            break;
          case "step_completed":
          case "step_failed":
          case "evidence_collected":
          case "plan_created":
          case "plan_revised":
            dispatch({ type: "TIMELINE_EVENT", event: msg.payload as TimelineEvent });
            break;
          case "budget_update":
            dispatch({ type: "BUDGET_UPDATE", budget: msg.payload as BudgetSnapshot });
            break;
          case "mission_complete":
            dispatch({ type: "STATUS_CHANGE", status: "completed" });
            dispatch({ type: "TIMELINE_EVENT", event: msg.payload as TimelineEvent });
            break;
          case "error":
            dispatch({ type: "ERROR", error: (msg.payload as { message: string }).message });
            break;
        }
      },
      onError: (err) => dispatch({ type: "ERROR", error: err.message }),
    });

    clientRef.current = client;
    client.connect();

    return () => client.dispose();
  }, [runId, baseUrl, authToken]);

  useEffect(() => {
    scrollToBottom();
  }, [state.timeline.length, scrollToBottom]);

  useEffect(() => {
    if (state.status === "completed" || state.status === "failed") {
      onRunComplete?.(state);
    }
  }, [state.status, onRunComplete, state]);

  const budgetPercent = useMemo(() => {
    if (!state.budget) return 0;
    return Math.round((state.budget.usedTokens / state.budget.totalTokens) * 100);
  }, [state.budget]);

  return (
    <div className={`flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Run {runId.slice(0, 8)}</h2>
          <StatusBadge status={state.status} />
        </div>
        <div className="flex items-center gap-4">
          {state.budget && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${budgetPercent}%` }}
                />
              </div>
              <span className="text-xs text-slate-500">{budgetPercent}% tokens</span>
            </div>
          )}
          <ConnectionIndicator state={state.connectionState} />
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
        role="list"
        aria-label="Run timeline"
        style={{ maxHeight: 480 }}
      >
        {state.timeline.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">Waiting for events...</p>
        )}
        {state.timeline.map((event) => (
          <TimelineEntry
            key={event.id}
            event={event}
            isActive={event.stepId === state.currentStepId}
          />
        ))}
      </div>

      {/* Footer */}
      {state.error && (
        <div className="border-t bg-red-50 px-4 py-2 text-xs text-red-700">{state.error}</div>
      )}
    </div>
  );
};

export default RunConsole;
