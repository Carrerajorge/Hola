// AgentOS Mission Timeline - Full history with expandable steps and replay
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { TimelineEvent, ReplayState, EventKind } from "../types";

// --- Types ---

export interface MissionTimelineProps {
  events: TimelineEvent[];
  onReplayStateChange?: (state: ReplayState) => void;
  onEventSelect?: (event: TimelineEvent) => void;
  className?: string;
}

interface TimelineGroup {
  stepId: string;
  label: string;
  events: TimelineEvent[];
  startedAt: number;
  completedAt?: number;
  status: "running" | "complete" | "failed";
}

// --- Replay hook ---

function useReplay(events: TimelineEvent[], onStateChange?: (state: ReplayState) => void) {
  const [replay, setReplay] = useState<ReplayState>({
    isReplaying: false,
    replaySpeed: 1,
    currentIndex: 0,
    totalEvents: events.length,
    isPaused: false,
    startTimestamp: 0,
    currentTimestamp: 0,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startReplay = useCallback(() => {
    if (events.length === 0) return;
    const newState: ReplayState = {
      isReplaying: true,
      replaySpeed: replay.replaySpeed,
      currentIndex: 0,
      totalEvents: events.length,
      isPaused: false,
      startTimestamp: events[0].timestamp,
      currentTimestamp: events[0].timestamp,
    };
    setReplay(newState);
    onStateChange?.(newState);
  }, [events, replay.replaySpeed, onStateChange]);

  const stopReplay = useCallback(() => {
    clearTimer();
    const newState: ReplayState = {
      ...replay,
      isReplaying: false,
      isPaused: false,
      currentIndex: 0,
    };
    setReplay(newState);
    onStateChange?.(newState);
  }, [clearTimer, replay, onStateChange]);

  const togglePause = useCallback(() => {
    setReplay((prev) => {
      const next = { ...prev, isPaused: !prev.isPaused };
      onStateChange?.(next);
      return next;
    });
  }, [onStateChange]);

  const setSpeed = useCallback((speed: number) => {
    setReplay((prev) => {
      const next = { ...prev, replaySpeed: speed };
      onStateChange?.(next);
      return next;
    });
  }, [onStateChange]);

  const seekTo = useCallback((index: number) => {
    if (index < 0 || index >= events.length) return;
    setReplay((prev) => {
      const next = { ...prev, currentIndex: index, currentTimestamp: events[index].timestamp };
      onStateChange?.(next);
      return next;
    });
  }, [events, onStateChange]);

  // Advance replay
  useEffect(() => {
    if (!replay.isReplaying || replay.isPaused) return;
    if (replay.currentIndex >= events.length - 1) {
      stopReplay();
      return;
    }

    const currentEvent = events[replay.currentIndex];
    const nextEvent = events[replay.currentIndex + 1];
    const delay = (nextEvent.timestamp - currentEvent.timestamp) / replay.replaySpeed;
    const clampedDelay = Math.max(50, Math.min(delay, 3000));

    timerRef.current = setTimeout(() => {
      setReplay((prev) => {
        const next = {
          ...prev,
          currentIndex: prev.currentIndex + 1,
          currentTimestamp: nextEvent.timestamp,
        };
        onStateChange?.(next);
        return next;
      });
    }, clampedDelay);

    return clearTimer;
  }, [replay.isReplaying, replay.isPaused, replay.currentIndex, replay.replaySpeed, events, clearTimer, onStateChange, stopReplay]);

  return { replay, startReplay, stopReplay, togglePause, setSpeed, seekTo };
}

// --- Sub-components ---

const eventKindColors: Record<EventKind, string> = {
  plan_created: "bg-purple-500",
  step_started: "bg-blue-500",
  step_completed: "bg-emerald-500",
  step_failed: "bg-red-500",
  evidence_collected: "bg-teal-500",
  budget_update: "bg-amber-500",
  plan_revised: "bg-violet-500",
  mission_complete: "bg-green-600",
  error: "bg-red-600",
};

const EventDot: React.FC<{ kind: EventKind; isActive: boolean }> = ({ kind, isActive }) => (
  <div className="relative flex items-center justify-center">
    <div className={`h-2.5 w-2.5 rounded-full ${eventKindColors[kind]} ${isActive ? "ring-2 ring-blue-300 ring-offset-1" : ""}`} />
    {isActive && (
      <div className={`absolute h-2.5 w-2.5 animate-ping rounded-full ${eventKindColors[kind]} opacity-50`} />
    )}
  </div>
);

const EventRow: React.FC<{
  event: TimelineEvent;
  isActive: boolean;
  isHighlighted: boolean;
  onSelect: (event: TimelineEvent) => void;
}> = ({ event, isActive, isHighlighted, onSelect }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`flex gap-3 px-3 py-2 transition-colors ${isHighlighted ? "bg-blue-50" : "hover:bg-slate-50"}`}
      role="listitem"
    >
      <div className="flex flex-col items-center pt-1">
        <EventDot kind={event.kind} isActive={isActive} />
        <div className="mt-1 w-px flex-1 bg-slate-200" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          className="flex w-full items-start justify-between text-left"
          onClick={() => {
            setExpanded(!expanded);
            onSelect(event);
          }}
        >
          <div>
            <p className="text-xs font-medium text-slate-900">{event.title}</p>
            <p className="text-[10px] text-slate-500">
              {event.kind.replace(/_/g, " ")}
              {event.stepId && ` \u00B7 ${event.stepId.slice(0, 8)}`}
            </p>
          </div>
          <time className="shrink-0 text-[10px] text-slate-400">
            {new Date(event.timestamp).toLocaleTimeString()}
          </time>
        </button>
        {expanded && event.detail && (
          <pre className="mt-1.5 whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-600">
            {event.detail}
          </pre>
        )}
        {expanded && event.evidence && event.evidence.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {event.evidence.map((ev) => (
              <div key={ev.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-700">{ev.claim}</span>
                <span className="rounded bg-emerald-50 px-1 text-emerald-700">
                  {Math.round(ev.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ReplayControls: React.FC<{
  replay: ReplayState;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
  onSetSpeed: (speed: number) => void;
  onSeek: (index: number) => void;
}> = ({ replay, onStart, onStop, onTogglePause, onSetSpeed, onSeek }) => {
  const progress = replay.totalEvents > 0
    ? Math.round((replay.currentIndex / (replay.totalEvents - 1)) * 100)
    : 0;

  return (
    <div className="flex items-center gap-3 border-t bg-slate-50 px-4 py-2">
      {!replay.isReplaying ? (
        <button onClick={onStart} className="rounded bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-700">
          Replay
        </button>
      ) : (
        <>
          <button onClick={onTogglePause} className="rounded bg-slate-200 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-300">
            {replay.isPaused ? "Resume" : "Pause"}
          </button>
          <button onClick={onStop} className="rounded bg-slate-200 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-300">
            Stop
          </button>
        </>
      )}

      <div className="flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(0, replay.totalEvents - 1)}
          value={replay.currentIndex}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-1 w-full accent-blue-500"
          disabled={!replay.isReplaying}
        />
      </div>
      <span className="text-[10px] text-slate-500">
        {replay.currentIndex + 1}/{replay.totalEvents}
      </span>

      <select
        value={replay.replaySpeed}
        onChange={(e) => onSetSpeed(Number(e.target.value))}
        className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px]"
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={5}>5x</option>
        <option value={10}>10x</option>
      </select>
    </div>
  );
};

// --- Main component ---

export const MissionTimeline: React.FC<MissionTimelineProps> = ({
  events,
  onReplayStateChange,
  onEventSelect,
  className = "",
}) => {
  const { replay, startReplay, stopReplay, togglePause, setSpeed, seekTo } =
    useReplay(events, onReplayStateChange);

  const [filterKind, setFilterKind] = useState<EventKind | "all">("all");

  const filteredEvents = useMemo(() => {
    if (filterKind === "all") return events;
    return events.filter((e) => e.kind === filterKind);
  }, [events, filterKind]);

  const visibleEvents = useMemo(() => {
    if (!replay.isReplaying) return filteredEvents;
    return filteredEvents.filter((_, i) => i <= replay.currentIndex);
  }, [filteredEvents, replay.isReplaying, replay.currentIndex]);

  const handleSelect = useCallback(
    (event: TimelineEvent) => onEventSelect?.(event),
    [onEventSelect]
  );

  const totalDuration = useMemo(() => {
    if (events.length < 2) return "0s";
    const ms = events[events.length - 1].timestamp - events[0].timestamp;
    if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
    return `${(ms / 1_000).toFixed(1)}s`;
  }, [events]);

  return (
    <div className={`flex flex-col rounded-lg border border-slate-200 bg-white ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Mission Timeline</h3>
          <p className="text-[11px] text-slate-500">
            {events.length} event{events.length !== 1 && "s"} \u00B7 {totalDuration}
          </p>
        </div>
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as EventKind | "all")}
          className="rounded border border-slate-200 px-2 py-1 text-[11px]"
        >
          <option value="all">All events</option>
          <option value="step_started">Steps started</option>
          <option value="step_completed">Steps completed</option>
          <option value="step_failed">Steps failed</option>
          <option value="evidence_collected">Evidence</option>
          <option value="plan_revised">Plan revisions</option>
        </select>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 480 }} role="list" aria-label="Timeline events">
        {visibleEvents.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-400">No events to display.</p>
        )}
        {visibleEvents.map((event, i) => (
          <EventRow
            key={event.id}
            event={event}
            isActive={replay.isReplaying && i === replay.currentIndex}
            isHighlighted={replay.isReplaying && i === replay.currentIndex}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Replay controls */}
      <ReplayControls
        replay={{ ...replay, totalEvents: events.length }}
        onStart={startReplay}
        onStop={stopReplay}
        onTogglePause={togglePause}
        onSetSpeed={setSpeed}
        onSeek={seekTo}
      />
    </div>
  );
};

export default MissionTimeline;
