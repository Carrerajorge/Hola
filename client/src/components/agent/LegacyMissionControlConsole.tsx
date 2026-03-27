import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileOutput,
  Loader2,
  Network,
  Orbit,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  RunStreamClient,
  type RunStreamState,
  type TraceEvent,
} from "@/lib/runStreamClient";

interface LegacyMissionControlConsoleProps {
  runId: string;
  className?: string;
}

function formatPhaseLabel(phase?: string | null): string {
  const normalized = String(phase || "idle").replace(/[_-]+/g, " ").trim();
  if (!normalized) return "Idle";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatStatusLabel(status?: string | null): string {
  if (status === "completed") return "Completado";
  if (status === "failed") return "Fallido";
  if (status === "cancelled") return "Cancelado";
  if (status === "running") return "En ejecución";
  return "Conectando";
}

function getStatusTone(status?: string | null): string {
  if (status === "completed") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "failed" || status === "cancelled") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  if (status === "running") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted/60 text-muted-foreground";
}

function getConnectionTone(mode: RunStreamState["connectionMode"] | undefined): string {
  if (mode === "sse_active") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (mode === "polling") return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (mode === "failed") return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  return "border-border bg-muted/60 text-muted-foreground";
}

function describeEvent(event: TraceEvent): string {
  if (event.message) return event.message;
  if (event.phase) return `Fase ${formatPhaseLabel(event.phase)}`;
  return event.event_type;
}

export function LegacyMissionControlConsole({
  runId,
  className,
}: LegacyMissionControlConsoleProps) {
  const [state, setState] = useState<RunStreamState | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const streamClient = new RunStreamClient(runId);
    const unsubscribe = streamClient.subscribe((nextState) => {
      if (!mountedRef.current) return;
      startTransition(() => {
        setState({ ...nextState, events: [...nextState.events], artifacts: [...nextState.artifacts] });
      });
    });

    streamClient.connect();

    return () => {
      mountedRef.current = false;
      unsubscribe();
      streamClient.destroy();
    };
  }, [runId]);

  const recentEvents = useMemo(() => {
    return (state?.events || [])
      .filter((event) => !["heartbeat", "connected", "progress_update", "progress"].includes(event.event_type))
      .slice(-6)
      .reverse();
  }, [state?.events]);

  const metricItems = useMemo(() => {
    if (!state) return [];

    return [
      state.queries_total > 0
        ? { label: "Consultas", value: `${state.queries_current}/${state.queries_total}`, icon: Search }
        : null,
      state.candidates_found > 0
        ? { label: "Candidatos", value: `${state.candidates_found}`, icon: Orbit }
        : null,
      state.metrics.articles_accepted > 0
        ? { label: "Aceptados", value: `${state.metrics.articles_accepted}`, icon: CheckCircle2 }
        : null,
      state.reject_count > 0
        ? { label: "Descartes", value: `${state.reject_count}`, icon: XCircle }
        : null,
    ].filter(Boolean) as Array<{ label: string; value: string; icon: typeof Search }>;
  }, [state]);

  if (!state) {
    return (
      <section
        className={cn(
          "overflow-hidden rounded-[28px] border border-border/60 bg-background/90 shadow-sm",
          className,
        )}
      >
        <div className="flex min-h-[220px] items-center justify-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Conectando Mission Control…</span>
        </div>
      </section>
    );
  }

  const isRunning = state.status === "running";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[28px] border border-border/60 bg-background/90 shadow-sm",
        className,
      )}
      data-testid="legacy-mission-control"
    >
      <div className="border-b border-border/60 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("gap-1.5 border", getStatusTone(state.status))}>
                {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {formatStatusLabel(state.status)}
              </Badge>
              <Badge variant="outline" className={cn("gap-1.5 border", getConnectionTone(state.connectionMode))}>
                <Network className="h-3.5 w-3.5" />
                {state.connectionMode}
              </Badge>
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Mission Control</p>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                {state.run_title || "Super run activo"}
              </h3>
              <p className="text-sm leading-7 text-muted-foreground">
                Fase actual: <span className="font-medium text-foreground">{formatPhaseLabel(state.phase)}</span>
              </p>
            </div>
          </div>

          <div className="rounded-[22px] border border-border/60 bg-muted/40 px-4 py-3 text-right">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Run</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{runId.slice(-12)}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Progreso del flujo</span>
            <span className="font-semibold text-foreground">
              {state.target > 0 ? `${state.metrics.articles_accepted}/${state.target}` : `${Math.round(state.progress)}%`}
            </span>
          </div>
          <Progress value={Math.max(0, Math.min(100, Math.round(state.progress)))} />
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="px-5 py-5">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Lectura rápida</p>
          <div className="mt-4 grid gap-2">
            <div className="rounded-[22px] border border-border/60 bg-muted/40 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Estado de conexión</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{state.connected ? "Activo" : "Reintentando"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{state.connectionMode}</p>
            </div>
            <div className="rounded-[22px] border border-border/60 bg-muted/40 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Artifacts</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{state.artifacts.length}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {state.artifacts.some((artifact) => artifact.generating)
                  ? "Hay entregables en generación."
                  : "Outputs listos para revisar."}
              </p>
            </div>
            {metricItems.length > 0 ? (
              <div className="rounded-[22px] border border-border/60 bg-muted/40 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Señales vivas</p>
                <div className="mt-3 grid gap-2">
                  {metricItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl bg-background/80 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </div>
                        <span className="text-sm font-semibold text-foreground">{item.value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {state.error ? (
              <div className="rounded-[22px] border border-rose-500/20 bg-rose-500/10 px-4 py-4 text-sm text-rose-700 dark:text-rose-300">
                {state.error}
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border/60 px-5 py-5 lg:border-l lg:border-t-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Actividad reciente</p>
          <ScrollArea className="mt-4 h-[250px] pr-3">
            <div className="space-y-3">
              {recentEvents.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                  Esperando eventos de ejecución.
                </div>
              ) : (
                recentEvents.map((event) => (
                  <div
                    key={`${event.run_id}-${event.seq}`}
                    className="rounded-[22px] border border-border/60 bg-background/80 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <Orbit className="h-4 w-4 text-primary" />
                          <span>{formatPhaseLabel(event.phase || state.phase)}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{describeEvent(event)}</p>
                      </div>
                      <Badge variant="outline" className="border-border/70 bg-muted/60 text-muted-foreground">
                        {event.agent}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          <Separator className="my-5" />

          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Artifacts</p>
          <div className="mt-4 space-y-2">
            {state.artifacts.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                Los outputs aparecerán aquí cuando el flujo cierre una entrega.
              </div>
            ) : (
              state.artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-border/60 bg-background/80 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <FileOutput className="h-4 w-4 text-primary" />
                      <span>{artifact.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{artifact.type}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border",
                      artifact.generating
                        ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                    )}
                  >
                    {artifact.generating ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="mr-1 h-3.5 w-3.5" />
                    )}
                    {artifact.generating ? "Generando" : "Listo"}
                  </Badge>
                  {!artifact.generating && artifact.url ? (
                    <a
                      href={artifact.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
                    >
                      Abrir
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>

          {!state.connected && state.connectionMode === "failed" ? (
            <div className="mt-5 flex items-start gap-3 rounded-[22px] border border-amber-500/20 bg-amber-500/10 px-4 py-4 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>La conexión de Mission Control se cayó. El cliente seguirá intentando recuperar el stream.</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default LegacyMissionControlConsole;
