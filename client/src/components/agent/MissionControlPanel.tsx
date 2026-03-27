import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  createRunEventSource,
  fetchRun,
  fetchRunEvents,
  postRunAction,
  type RunEventFrame,
  type RunResponse,
} from "@/services/runProgress";
import {
  fetchSubagentRuns,
  type CodexSubagentRun,
} from "@/services/codexRuntime";

type MissionEventSeverity = "info" | "success" | "warning" | "error";

interface MissionEvent {
  id: string;
  runId: string;
  eventType: string;
  payload: Record<string, any>;
  metadata?: Record<string, any> | null;
  timestamp: number;
  stepIndex: number | null;
  title: string;
  severity: MissionEventSeverity;
}

interface AgentMissionControlProps {
  runId: string;
  className?: string;
  openHref?: string;
  showActions?: boolean;
  maxVisibleSteps?: number;
}

const ACTIVE_EVENT_TYPES = [
  "run_created",
  "plan_generated",
  "tool_call_started",
  "tool_call_succeeded",
  "tool_call_failed",
  "agent_delegated",
  "artifact_created",
  "qa_passed",
  "qa_failed",
  "run_completed",
  "run_failed",
] as const;

const ACTIVE_RUN_STATUSES = new Set(["queued", "planning", "running", "verifying"]);
const TERMINAL_STEP_STATUSES = new Set(["succeeded", "completed", "skipped"]);
const IGNORED_EVENT_TYPES = new Set(["heartbeat", "subscribed", "shutdown"]);

function formatBudget(ms?: number | null): string {
  if (!ms || ms <= 0) return "Sin dato";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function formatTimestamp(value?: number | string | null): string {
  if (!value) return "–";
  const parsed = typeof value === "number" ? value : Number(Date.parse(String(value)));
  if (!Number.isFinite(parsed)) return "–";
  return new Intl.DateTimeFormat("es-BO", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function getExecutionProfileLabel(profile?: string | null): string {
  if (profile === "marathon_24h") return "Cadena 24h";
  if (profile === "marathon_12h") return "Cadena 12h";
  return "Estándar";
}

function getRunStatusLabel(status?: string | null): string {
  if (status === "completed") return "Completado";
  if (status === "failed") return "Fallido";
  if (status === "paused") return "Pausado";
  if (status === "verifying") return "Verificando";
  if (status === "running") return "En ejecución";
  if (status === "planning") return "Planificando";
  if (status === "queued") return "En cola";
  if (status === "cancelled") return "Cancelado";
  return "Listo";
}

function getRunStatusTone(status?: string | null): string {
  if (status === "completed") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "failed" || status === "cancelled") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  if (status === "paused") return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "verifying") return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  if (status === "running" || status === "planning" || status === "queued") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  return "border-border bg-muted/60 text-muted-foreground";
}

function getStepTone(status?: string | null): string {
  if (status === "succeeded" || status === "completed") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "failed") return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (status === "running" || status === "in_progress") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  return "border-border bg-muted/60 text-muted-foreground";
}

function severityFromPayload(
  payload: Record<string, any>,
  eventType: string,
): MissionEventSeverity {
  if (payload?.status === "failed" || payload?.error) return "error";
  if (eventType.endsWith("failed")) return "error";
  if (payload?.status === "succeeded" || eventType.endsWith("succeeded")) return "success";
  if (eventType === "qa_passed" || eventType === "run_completed") return "success";
  return "info";
}

function normalizeEventFrame(frame: RunEventFrame): MissionEvent {
  const timestamp =
    typeof frame.timestamp === "number"
      ? frame.timestamp
      : frame.timestamp
        ? Date.parse(String(frame.timestamp))
        : Date.now();

  return {
    id: frame.id,
    runId: frame.runId,
    eventType: frame.eventType,
    payload: frame.payload || {},
    metadata: frame.metadata,
    timestamp,
    stepIndex: frame.stepIndex ?? null,
    title: frame.payload?.title || frame.payload?.summary || frame.payload?.message || frame.eventType,
    severity: severityFromPayload(frame.payload || {}, frame.eventType),
  };
}

function normalizeActivityEvent(event: Record<string, any>, type: string): MissionEvent {
  const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();

  return {
    id: event.id || `${type}-${timestamp}`,
    runId: event.runId || event.payload?.runId,
    eventType: type,
    payload: event.payload || {},
    metadata: event.metadata,
    timestamp,
    stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : null,
    title: event.payload?.title || event.payload?.summary || event.payload?.message || type,
    severity: severityFromPayload(event.payload || {}, type),
  };
}

function summarizeEvent(event?: MissionEvent | null): string {
  if (!event) return "Sin checkpoint registrado todavía.";
  if (event.eventType === "artifact_created") {
    return `Artifact listo: ${event.payload?.name || event.title}`;
  }
  if (event.eventType === "qa_passed") {
    return event.payload?.message || "Verificación aprobada.";
  }
  if (event.eventType === "run_completed") {
    return event.payload?.summary || event.title || "Run completado.";
  }
  if (event.eventType === "tool_call_succeeded") {
    return `${event.payload?.toolName || "Paso"} completado.`;
  }
  if (event.eventType === "tool_call_failed") {
    return event.payload?.error || event.title || "Paso fallido.";
  }
  return event.payload?.message || event.title || event.eventType;
}

function extractSubagentRole(planHint?: string[] | null): string {
  const roleValue = planHint?.find((hint) => hint.startsWith("role:"))?.split(":")[1]?.trim();
  if (roleValue === "coder") return "Implementador";
  if (roleValue === "reviewer") return "Revisor";
  if (roleValue === "improver") return "Mejorador";
  return "Agente auxiliar";
}

function extractBranch(planHint?: string[] | null): string | null {
  const branch = planHint?.find((hint) => hint.startsWith("branch:"))?.slice("branch:".length).trim();
  return branch || null;
}

function getSubagentTone(status: CodexSubagentRun["status"]): string {
  if (status === "completed") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "failed" || status === "cancelled") return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (status === "running") return "border-primary/20 bg-primary/10 text-primary";
  return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function pickVisibleSteps(
  steps: RunResponse["steps"],
  maxVisibleSteps: number,
): RunResponse["steps"] {
  if (steps.length <= maxVisibleSteps) return steps;

  const activeIndex = steps.findIndex(
    (step) => step.status === "running" || step.status === "in_progress",
  );
  const pivot = activeIndex >= 0 ? activeIndex : steps.findIndex((step) => !TERMINAL_STEP_STATUSES.has(step.status));
  const safePivot = pivot >= 0 ? pivot : steps.length - 1;
  const maxStart = Math.max(steps.length - maxVisibleSteps, 0);
  const start = Math.min(Math.max(safePivot - 2, 0), maxStart);

  return steps.slice(start, start + maxVisibleSteps);
}

export function MissionControlPanel({
  runId,
  className,
  openHref,
  showActions = true,
  maxVisibleSteps = 6,
}: AgentMissionControlProps) {
  const [run, setRun] = useState<RunResponse | null>(null);
  const [events, setEvents] = useState<Record<string, MissionEvent>>({});
  const [subagents, setSubagents] = useState<CodexSubagentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [subagentError, setSubagentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const refreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshRun = useCallback(
    async (quiet = true) => {
      try {
        const nextRun = await fetchRun(runId);
        if (!mountedRef.current) return;
        startTransition(() => {
          setRun(nextRun);
          setError(null);
          if (!quiet) setLoading(false);
        });
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "No se pudo cargar el run.");
        if (!quiet) setLoading(false);
      }
    },
    [runId],
  );

  const refreshSubagents = useCallback(async () => {
    try {
      const nextSubagents = await fetchSubagentRuns(runId);
      if (!mountedRef.current) return;
      startTransition(() => {
        setSubagents(nextSubagents);
        setSubagentError(null);
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setSubagentError(
        err instanceof Error ? err.message : "No se pudieron cargar los subagentes.",
      );
    }
  }, [runId]);

  const queueRunRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      void refreshRun();
    }, 280);
  }, [refreshRun]);

  useEffect(() => {
    setLoading(true);
    setEvents({});

    let cancelled = false;

    void (async () => {
      try {
        const [nextRun, eventsPage] = await Promise.all([
          fetchRun(runId),
          fetchRunEvents(runId, { limit: 200, page: 1, order: "asc" }),
        ]);
        if (cancelled || !mountedRef.current) return;

        startTransition(() => {
          setRun(nextRun);
          setEvents(() => {
            const next: Record<string, MissionEvent> = {};
            for (const frame of eventsPage.events) {
              const normalized = normalizeEventFrame(frame);
              next[normalized.id] = normalized;
            }
            return next;
          });
          setError(null);
          setLoading(false);
        });
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "No se pudo cargar Mission Control.",
        );
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    void refreshSubagents();
  }, [refreshSubagents]);

  useEffect(() => {
    setStreamStatus("connecting");
    const source = createRunEventSource(runId);

    const handleIncoming = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data);
        const normalized = normalizeActivityEvent(payload, evt.type);
        startTransition(() => {
          setEvents((current) => {
            if (current[normalized.id]) return current;
            return { ...current, [normalized.id]: normalized };
          });
        });

        if (!IGNORED_EVENT_TYPES.has(evt.type)) {
          queueRunRefresh();
          if (evt.type === "agent_delegated" || evt.type === "run_failed" || evt.type === "run_completed") {
            void refreshSubagents();
          }
        }
      } catch (err) {
        console.error("Mission Control SSE parse error:", err);
      }
    };

    source.onopen = () => setStreamStatus("connected");
    source.onerror = () => setStreamStatus("error");
    source.onmessage = handleIncoming;
    ACTIVE_EVENT_TYPES.forEach((eventType) => {
      source.addEventListener(eventType, handleIncoming);
    });
    source.addEventListener("heartbeat", handleIncoming);
    source.addEventListener("subscribed", handleIncoming);
    source.addEventListener("shutdown", handleIncoming);

    return () => {
      source.close();
    };
  }, [queueRunRefresh, refreshSubagents, runId]);

  useEffect(() => {
    if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) return;
    const intervalId = window.setInterval(() => {
      void refreshRun();
      void refreshSubagents();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshRun, refreshSubagents, run]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  const handleAction = useCallback(
    async (action: "cancel" | "retry" | "resume") => {
      setActionLoading(action);
      setError(null);
      try {
        await postRunAction(runId, action);
        await refreshRun(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo ejecutar la acción.");
      } finally {
        setActionLoading(null);
      }
    },
    [refreshRun, runId],
  );

  const sortedEvents = useMemo(() => {
    return Object.values(events).sort((left, right) => left.timestamp - right.timestamp);
  }, [events]);

  const progressPercent = useMemo(() => {
    if (!run) return 0;
    const total = run.totalSteps || run.steps?.length || 0;
    if (total === 0) return 0;
    return Math.round(((run.completedSteps ?? 0) / total) * 100);
  }, [run]);

  const eventsByStep = useMemo(() => {
    return sortedEvents.reduce<Record<number, MissionEvent[]>>((acc, event) => {
      const key = event.stepIndex ?? -1;
      const existing = acc[key] || [];
      existing.push(event);
      acc[key] = existing;
      return acc;
    }, {});
  }, [sortedEvents]);

  const visibleSteps = useMemo(() => {
    return pickVisibleSteps(run?.steps || [], maxVisibleSteps);
  }, [maxVisibleSteps, run?.steps]);

  const checkpointSummary = useMemo(() => {
    if (!run) return null;

    const meaningfulEvents = sortedEvents.filter(
      (event) => !IGNORED_EVENT_TYPES.has(event.eventType),
    );
    const latestEvent = meaningfulEvents[meaningfulEvents.length - 1] || null;
    const latestCheckpoint =
      [...meaningfulEvents].reverse().find((event) =>
        ["tool_call_succeeded", "artifact_created", "qa_passed", "run_completed"].includes(event.eventType),
      ) || latestEvent;
    const latestFailure =
      [...meaningfulEvents].reverse().find((event) => event.severity === "error") || null;
    const latestVerification =
      [...meaningfulEvents].reverse().find((event) => event.eventType === "qa_passed") || null;
    const activeStep =
      run.steps.find((step) => step.status === "running" || step.status === "in_progress") || null;
    const nextPendingStep =
      activeStep ||
      run.steps.find((step) => !TERMINAL_STEP_STATUSES.has(step.status) && step.status !== "failed") ||
      null;
    const phases = Array.isArray(run.plan?.phases) ? run.plan.phases : [];
    const currentPhase =
      typeof run.plan?.currentPhaseIndex === "number"
        ? phases[run.plan.currentPhaseIndex] || null
        : phases.find((phase: any) => phase?.status === "in_progress") || null;
    const failedSubagents = subagents.filter(
      (subagent) => subagent.status === "failed" || subagent.status === "cancelled",
    );
    const artifactsLabel =
      (run.artifacts || []).length > 0
        ? `Artifacts listos: ${(run.artifacts || [])
            .slice(0, 2)
            .map((artifact) => artifact.name || artifact.type || "artifact")
            .join(", ")}`
        : "Sin artifact verificable todavía.";

    const current = [
      getRunStatusLabel(run.status),
      currentPhase?.name ? `Fase: ${currentPhase.name}` : null,
      activeStep?.description || activeStep?.toolName
        ? `Paso: ${activeStep?.description || activeStep?.toolName}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    let risk = "Sin riesgo fuerte detectado.";
    if (run.status === "failed") {
      risk = run.error || summarizeEvent(latestFailure) || "El run terminó con error.";
    } else if (latestFailure) {
      risk = summarizeEvent(latestFailure);
    } else if (failedSubagents.length > 0) {
      risk = `${failedSubagents.length} subagente(s) quedaron con error o cancelados.`;
    } else if (
      typeof run.runtimeRemainingMs === "number" &&
      typeof run.runtimeBudgetMs === "number" &&
      run.runtimeRemainingMs <= Math.max(15 * 60 * 1000, run.runtimeBudgetMs * 0.12)
    ) {
      risk = `Presupuesto restante bajo: ${formatBudget(run.runtimeRemainingMs)}.`;
    }

    return {
      current: current || getRunStatusLabel(run.status),
      latestCheckpoint: summarizeEvent(latestCheckpoint),
      nextStep:
        run.status === "completed"
          ? "Sin siguientes pasos pendientes."
          : nextPendingStep?.description || nextPendingStep?.toolName || "Esperando el próximo bloque del plan.",
      risk,
      verification: latestVerification ? summarizeEvent(latestVerification) : artifactsLabel,
      updatedAt:
        latestEvent?.timestamp ||
        Number(new Date(run.completedAt || run.startedAt || run.createdAt).getTime()) ||
        Date.now(),
    };
  }, [run, sortedEvents, subagents]);

  const activeSubagents = subagents.filter(
    (subagent) => subagent.status === "queued" || subagent.status === "running",
  );

  if (loading && !run) {
    return (
      <section
        className={cn(
          "overflow-hidden rounded-[30px] border border-border/60 bg-background/90 shadow-sm",
          className,
        )}
      >
        <div className="flex min-h-[220px] items-center justify-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Cargando Mission Control…</span>
        </div>
      </section>
    );
  }

  if (!run) {
    return (
      <section
        className={cn(
          "overflow-hidden rounded-[30px] border border-border/60 bg-background/90 shadow-sm",
          className,
        )}
      >
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            {error || "No se pudo hidratar el run para Mission Control."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[30px] border border-border/60 bg-background/90 shadow-sm",
        className,
      )}
      data-testid="agent-mission-control"
    >
      <div className="border-b border-border/60 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("gap-1.5 border", getRunStatusTone(run.status))}>
                {ACTIVE_RUN_STATUSES.has(run.status) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : run.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : run.status === "failed" || run.status === "cancelled" ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <PauseCircle className="h-3.5 w-3.5" />
                )}
                {getRunStatusLabel(run.status)}
              </Badge>
              <Badge variant="outline" className="gap-1.5 border-border/70 bg-muted/60 text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                {getExecutionProfileLabel(run.executionProfile)}
              </Badge>
              <Badge variant="outline" className="gap-1.5 border-border/70 bg-muted/60 text-muted-foreground">
                <TerminalSquare className="h-3.5 w-3.5" />
                Stream {streamStatus}
              </Badge>
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Mission Control</p>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {run.summary || "Run activo"}
              </h2>
              <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
                {run.plan?.objective || "Sin objetivo detallado para este run."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {openHref ? (
              <Button variant="outline" className="rounded-full" asChild>
                <a href={openHref}>
                  Abrir progreso
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            ) : null}
            {showActions && ["queued", "planning", "running", "verifying"].includes(run.status) ? (
              <Button
                variant="destructive"
                className="rounded-full"
                disabled={actionLoading !== null}
                onClick={() => void handleAction("cancel")}
              >
                Cancelar
              </Button>
            ) : null}
            {showActions && run.status === "failed" ? (
              <Button
                variant="secondary"
                className="rounded-full"
                disabled={actionLoading !== null}
                onClick={() => void handleAction("retry")}
              >
                Reintentar
              </Button>
            ) : null}
            {showActions && run.status === "paused" ? (
              <Button
                variant="outline"
                className="rounded-full"
                disabled={actionLoading !== null}
                onClick={() => void handleAction("resume")}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                Reanudar
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Progreso operacional</span>
            <span className="font-semibold text-foreground">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} />
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-border/60 bg-muted/40 px-3 py-3">
              <p>Pasos cerrados</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {run.completedSteps ?? 0} / {run.totalSteps ?? run.steps.length}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-muted/40 px-3 py-3">
              <p>Presupuesto restante</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {formatBudget(run.runtimeRemainingMs ?? run.runtimeBudgetMs)}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-muted/40 px-3 py-3">
              <p>Artifacts</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{run.artifacts.length}</p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-muted/40 px-3 py-3">
              <p>Subagentes activos</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {activeSubagents.length} / {subagents.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="px-5 py-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[24px] border border-border/60 bg-muted/40 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Estado actual</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {checkpointSummary?.current || getRunStatusLabel(run.status)}
              </p>
            </div>
            <div className="rounded-[24px] border border-border/60 bg-muted/40 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Último checkpoint</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {checkpointSummary?.latestCheckpoint || "Sin checkpoint todavía."}
              </p>
            </div>
            <div className="rounded-[24px] border border-border/60 bg-muted/40 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Siguiente paso seguro</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {checkpointSummary?.nextStep || "Esperando planificación."}
              </p>
            </div>
            <div className="rounded-[24px] border border-border/60 bg-muted/40 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Verificación y riesgo</p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {checkpointSummary?.verification || "Sin verificación todavía."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {checkpointSummary?.risk || "Sin riesgo fuerte detectado."}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Timeline operativo</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Última actualización {formatTimestamp(checkpointSummary?.updatedAt || run.startedAt || run.createdAt)}
                </p>
              </div>
              {run.steps.length > visibleSteps.length ? (
                <Badge variant="outline" className="border-border/70 bg-muted/60 text-muted-foreground">
                  {run.steps.length - visibleSteps.length} pasos más
                </Badge>
              ) : null}
            </div>

            <ScrollArea className="mt-4 h-[320px] pr-3">
              <div className="space-y-3">
                {visibleSteps.map((step) => {
                  const stepEvents = eventsByStep[step.stepIndex] || [];
                  const latestStepEvent = stepEvents[stepEvents.length - 1];
                  const isLive = step.status === "running" || step.status === "in_progress";

                  return (
                    <div
                      key={`${run.id}-${step.stepIndex}`}
                      className={cn(
                        "rounded-[24px] border px-4 py-4 transition-colors",
                        isLive ? "border-primary/30 bg-primary/5" : "border-border/60 bg-background/70",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={cn("border", getStepTone(step.status))}>
                              Paso {step.stepIndex + 1}
                            </Badge>
                            <p className="text-sm font-semibold text-foreground">
                              {step.toolName || "Paso sin nombre"}
                            </p>
                            {isLive ? (
                              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                Ejecutando
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {step.description || "Sin descripción registrada."}
                          </p>
                          {latestStepEvent ? (
                            <p className="mt-3 text-sm text-foreground">
                              {summarizeEvent(latestStepEvent)}
                            </p>
                          ) : null}
                          {step.error ? (
                            <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{step.error}</p>
                          ) : null}
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>{formatTimestamp(step.startedAt)}</p>
                          {step.completedAt ? <p className="mt-1">{formatTimestamp(step.completedAt)}</p> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="border-t border-border/60 px-5 py-5 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Subagentes</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {subagents.length > 0 ? `${subagents.length} agentes asociados al run` : "Sin delegación adicional"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-border/70 bg-muted/60 text-muted-foreground">
                <Bot className="mr-1 h-3.5 w-3.5" />
                {activeSubagents.length} activos
              </Badge>
              <Badge variant="outline" className="border-border/70 bg-muted/60 text-muted-foreground">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                {run.artifacts.length} outputs
              </Badge>
            </div>
          </div>

          {subagentError ? (
            <div className="mt-4 rounded-[22px] border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              {subagentError}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {subagents.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                Este run está trabajando sin subagentes delegados por ahora.
              </div>
            ) : (
              subagents.map((subagent) => {
                const branch = extractBranch(subagent.planHint);
                return (
                  <div
                    key={subagent.id}
                    className="rounded-[24px] border border-border/60 bg-muted/40 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={cn("border", getSubagentTone(subagent.status))}>
                            {extractSubagentRole(subagent.planHint)}
                          </Badge>
                          <p className="text-sm font-semibold text-foreground">
                            {subagent.objective}
                          </p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {branch ? (
                            <span className="rounded-full border border-border/70 px-2.5 py-1">
                              Rama {branch}
                            </span>
                          ) : null}
                          <span className="rounded-full border border-border/70 px-2.5 py-1">
                            Creado {formatTimestamp(subagent.createdAt)}
                          </span>
                        </div>
                        {typeof subagent.result === "string" ? (
                          <p className="mt-3 text-sm text-foreground">{subagent.result}</p>
                        ) : null}
                        {subagent.error ? (
                          <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{subagent.error}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <Separator className="my-5" />

          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Artifacts y cierre</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Salida disponible para revisar o descargar.
                </p>
              </div>
              {run.status === "completed" ? (
                <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Run cerrado
                </Badge>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {run.summary ? (
                <div className="rounded-[24px] border border-border/60 bg-background/80 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Resumen</p>
                  <p className="mt-2 text-sm leading-7 text-foreground">{run.summary}</p>
                </div>
              ) : null}

              {run.artifacts.length > 0 ? (
                <div className="space-y-2">
                  {run.artifacts.slice(0, 4).map((artifact, index) => (
                    <div
                      key={`${artifact.name || artifact.type || "artifact"}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-border/60 bg-background/80 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {artifact.name || artifact.type || "Artifact"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{artifact.type || "output"}</p>
                      </div>
                      {artifact.url ? (
                        <Button variant="outline" size="sm" className="rounded-full" asChild>
                          <a href={artifact.url} target="_blank" rel="noreferrer">
                            Ver
                            <ArrowUpRight className="ml-2 h-4 w-4" />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[22px] border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                  Los artifacts aparecerán aquí cuando el run entregue un output verificable.
                </div>
              )}
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-[22px] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default MissionControlPanel;
