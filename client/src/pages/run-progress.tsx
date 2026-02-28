import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agent-store";
import {
  fetchRun,
  fetchRunEvents,
  createRunEventSource,
  postRunAction,
  RunResponse,
  RunEventFrame,
} from "@/services/runProgress";

type RunEventSeverity = "info" | "success" | "warning" | "error";

interface RunEvent {
  id: string;
  runId: string;
  eventType: string;
  payload: Record<string, any>;
  metadata?: Record<string, any> | null;
  timestamp: number;
  stepIndex: number | null;
  title: string;
  severity: RunEventSeverity;
}

const ACTIVITY_EVENT_TYPES = [
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

const severityFromPayload = (payload: Record<string, any>, eventType: string): RunEventSeverity => {
  if (payload?.status === "failed" || payload?.error) return "error";
  if (payload?.status === "failed" || eventType.endsWith("failed")) return "error";
  if (payload?.status === "succeeded" || eventType.endsWith("succeeded")) return "success";
  if (payload?.status === "running" || payload?.status === "started") return "info";
  if (eventType === "run_failed") return "error";
  if (eventType === "run_completed") return "success";
  return "info";
};

const normalizeEventFrame = (frame: RunEventFrame): RunEvent => {
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
    title: frame.payload?.title || frame.payload?.summary || frame.eventType,
    severity: severityFromPayload(frame.payload || {}, frame.eventType),
  };
};

const normalizeActivityEvent = (event: Record<string, any>, type: string): RunEvent => {
  const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
  return {
    id: event.id || `${type}-${timestamp}`,
    runId: event.runId || event.payload?.runId,
    eventType: type,
    payload: event.payload || {},
    metadata: event.metadata,
    timestamp,
    stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : null,
    title: event.payload?.message || event.payload?.status || type,
    severity: severityFromPayload(event.payload || {}, type),
  };
};

const formatDuration = (start?: string | null, end?: string | null): string => {
  if (!start) return "Sin datos";
  const started = new Date(start).getTime();
  const finished = end ? new Date(end).getTime() : Date.now();
  const delta = Math.max(finished - started, 0);
  const seconds = Math.round(delta / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
};

const formatTimestamp = (value?: number | string | null): string => {
  if (!value) return "–";
  const parsed = typeof value === "number" ? value : Number(Date.parse(String(value)));
  if (!Number.isFinite(parsed)) return "–";
  return new Date(parsed).toLocaleString();
};

const RunProgressPage = () => {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const runId = params.id;
  const [run, setRun] = useState<RunResponse | null>(null);
  const [events, setEvents] = useState<Record<string, RunEvent>>({});
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const runningAgentRuns = useAgentStore((state) =>
    Object.values(state.runs)
      .filter((candidate) => ["running", "planning", "queued"].includes(candidate.status) && candidate.runId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4)
  );

  const sortedEvents = useMemo(() => {
    return Object.values(events).sort((a, b) => a.timestamp - b.timestamp);
  }, [events]);

  const eventsByStep = useMemo(() => {
    return sortedEvents.reduce<Record<number, RunEvent[]>>((acc, event) => {
      const key = event.stepIndex ?? -1;
      acc[key] = acc[key] || [];
      acc[key].push(event);
      return acc;
    }, {});
  }, [sortedEvents]);

  useEffect(() => {
    if (!runId) return;
    let aborted = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [runData, eventsPage] = await Promise.all([
          fetchRun(runId),
          fetchRunEvents(runId, { limit: 200, page: 1, order: "asc" }),
        ]);
        if (aborted) return;
        setRun(runData);
        setEvents((prev) => {
          const next = { ...prev };
          for (const frame of eventsPage.events) {
            next[frame.id] = normalizeEventFrame(frame);
          }
          return next;
        });
      } catch (err) {
        if (aborted) return;
        setError(
          err instanceof Error ? err.message : "No se pudo cargar el estado de ejecución"
        );
      } finally {
        if (!aborted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      aborted = true;
    };
  }, [runId]);

  const pushEvent = useCallback((event: RunEvent) => {
    setEvents((prev) => {
      if (prev[event.id]) return prev;
      return { ...prev, [event.id]: event };
    });
  }, []);

  useEffect(() => {
    if (!runId) return;
    setStreamStatus("connecting");
    const source = createRunEventSource(runId);
    const handleIncoming = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data);
        pushEvent(normalizeActivityEvent(payload, evt.type));
      } catch (err) {
        console.error("No se pudo leer evento SSE:", err);
      }
    };
    source.onopen = () => setStreamStatus("connected");
    source.onerror = () => setStreamStatus("error");
    source.onmessage = handleIncoming;
    ACTIVITY_EVENT_TYPES.forEach((eventType) => {
      source.addEventListener(eventType, handleIncoming);
    });
    source.addEventListener("heartbeat", handleIncoming);
    source.addEventListener("subscribed", handleIncoming);
    source.addEventListener("shutdown", handleIncoming);
    return () => {
      source.close();
    };
  }, [runId, pushEvent]);

  const handleAction = useCallback(
    async (action: "cancel" | "retry" | "resume") => {
      if (!runId) return;
      setActionLoading(action);
      setError(null);
      try {
        await postRunAction(runId, action);
        const refreshed = await fetchRun(runId);
        setRun(refreshed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo ejecutar la acción");
      } finally {
        setActionLoading(null);
      }
    },
    [runId]
  );

  const progressPercent = useMemo(() => {
    if (!run) return 0;
    const total = run.totalSteps || run.steps?.length || 0;
    const completed = run.completedSteps ?? 0;
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  }, [run]);

  if (!runId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Alert>
          <AlertTitle>No se encontró el ID de ejecución</AlertTitle>
          <AlertDescription>
            Revisa que la URL esté completa o regresa al listado de runs para abrir uno nuevo.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Run / Progreso</h1>
          <p className="text-sm text-muted-foreground">
            Monitorea los estados, logs y artifacts en tiempo real para el run <strong>{runId}</strong>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={streamStatus === "connected" ? "default" : "outline"}>
            Streaming: {streamStatus}
          </Badge>
          {run && (
            <Badge variant="outline">
              Estado: <span className="ml-1">{run.status}</span>
            </Badge>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Algo falló</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <CardTitle>{run?.summary || "Plan de ejecución"}</CardTitle>
              <CardDescription>
                {run?.plan?.objective || "Sin objetivo específico"}
              </CardDescription>
            </div>
            <div className="text-sm text-muted-foreground">
              Inicio: {formatTimestamp(run?.startedAt)} · {run?.steps?.length ?? 0} pasos
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Progreso</p>
                <span className="text-sm font-semibold">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} />
              <p className="text-sm text-muted-foreground">
                {run?.completedSteps ?? 0} / {run?.totalSteps ?? run?.steps?.length ?? 0} pasos completados
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {["queued", "planning", "running", "verifying"].includes(run?.status || "") && (
              <Button
                variant="destructive"
                size="sm"
                disabled={actionLoading !== null}
                onClick={() => void handleAction("cancel")}
              >
                Cancelar ejecución
              </Button>
            )}
            {run?.status === "failed" && (
              <Button
                variant="secondary"
                size="sm"
                disabled={actionLoading !== null}
                onClick={() => void handleAction("retry")}
              >
                Reintentar desde paso fallido
              </Button>
            )}
            {run?.status === "paused" && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading !== null}
                onClick={() => void handleAction("resume")}
              >
                Reanudar
              </Button>
            )}
            {actionLoading && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Ejecutando acción...
              </div>
            )}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runs paralelos</CardTitle>
            <CardDescription>Ejecutándose en el workspace</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {runningAgentRuns.length === 0 && (
              <p className="text-sm text-muted-foreground">No hay runs activos ahora mismo.</p>
            )}
            <div className="space-y-2">
              {runningAgentRuns.map((candidate) => (
                <div
                  key={candidate.runId}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold">{candidate.chatId}</p>
                    <p className="text-xs text-muted-foreground">
                      {candidate.status} · {candidate.steps?.length ?? 0} pasos
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => setLocation(`/runs/${candidate.runId}/progress`)}
                  >
                    Abrir
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {(run?.steps || []).map((step) => {
              const stepEvents = eventsByStep[step.stepIndex] || [];
              const statusVariant =
                step.status === "succeeded"
                  ? "success"
                  : step.status === "failed"
                    ? "destructive"
                    : "default";
              const progressValue =
                step.status === "succeeded"
                  ? 100
                  : step.status === "running"
                    ? 60
                    : step.status === "pending"
                      ? 10
                      : 0;
              return (
                <Card key={step.stepIndex}>
                  <CardHeader className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>{step.toolName}</CardTitle>
                      <CardDescription>{step.description || "Paso automático"}</CardDescription>
                    </div>
                    <Badge variant={statusVariant}>
                      {step.status}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>Duración: {formatDuration(step.startedAt, step.completedAt)}</span>
                      <span>Inicio: {formatTimestamp(step.startedAt)}</span>
                    </div>
                    <Progress value={progressValue} />
                    {stepEvents.length > 0 && (
                      <ScrollArea className="max-h-48 rounded-lg border border-border p-3">
                        <div className="flex flex-col gap-2">
                          {stepEvents.map((event) => (
                            <div
                              key={event.id}
                              className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2"
                            >
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{event.eventType}</span>
                                <span>{formatTimestamp(event.timestamp)}</span>
                              </div>
                              <p className="text-sm">{event.title}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                    {step.error && (
                      <Alert variant="destructive">
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{step.error}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Actividad del run</CardTitle>
                <CardDescription>Eventos ordenados por timestamp</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {eventsByStep[-1]?.length ? (
                  <ScrollArea className="max-h-96 rounded-lg border border-border p-3">
                    <div className="space-y-3">
                      {eventsByStep[-1].map((event) => (
                        <div
                          key={event.id}
                          className={cn(
                            "flex flex-col gap-1 rounded-lg border px-3 py-2",
                            event.severity === "error" ? "border-destructive/60 bg-destructive/5" : "border-border"
                          )}
                        >
                          <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-wide text-muted-foreground">
                            <span>{event.eventType}</span>
                            <span>{formatTimestamp(event.timestamp)}</span>
                          </div>
                          <p className="text-sm">{event.title}</p>
                          {event.payload?.message && (
                            <p className="text-xs text-muted-foreground">{event.payload.message}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No hay eventos globales disponibles aun.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Artifacts</CardTitle>
                <CardDescription>Descargas / links generados</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {(run?.artifacts || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay artifacts todavía.</p>
                ) : (
                  <ul className="space-y-3">
                    {run?.artifacts.map((artifact, index) => (
                      <li key={`${artifact.name}-${index}`} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">{artifact.name || "Artifact sin nombre"}</p>
                            <p className="text-xs text-muted-foreground">{artifact.type || "Tipo desconocido"}</p>
                          </div>
                          {artifact.url && (
                            <a
                              href={artifact.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-semibold text-primary"
                            >
                              Descargar
                            </a>
                          )}
                        </div>
                        {artifact.metadata && (
                          <p className="text-xs text-muted-foreground">{JSON.stringify(artifact.metadata)}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default RunProgressPage;
