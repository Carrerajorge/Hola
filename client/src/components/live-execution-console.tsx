import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  CheckCircle2, 
  XCircle, 
  FileSpreadsheet,
  Search,
  Shield,
  FileOutput,
  Loader2,
  ChevronDown,
  ChevronRight,
  Download,
  Zap,
  Settings2,
  FileText,
  X as XIcon,
  MessageSquare
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { 
  RunStreamClient, 
  RunStreamState, 
  TraceEvent
} from "@/lib/runStreamClient";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NarrationAgent, NarrationState } from "@/lib/narrationAgent";

interface LiveExecutionConsoleProps {
  runId: string | null;
  forceShow?: boolean;
  onComplete?: (artifacts: RunStreamState["artifacts"]) => void;
  onError?: (error: string) => void;
  className?: string;
}

const phaseIcons: Record<string, React.ReactNode> = {
  planning: <Zap className="w-3.5 h-3.5" />,
  signals: <Search className="w-3.5 h-3.5" />,
  verification: <Shield className="w-3.5 h-3.5" />,
  enrichment: <FileText className="w-3.5 h-3.5" />,
  export: <FileOutput className="w-3.5 h-3.5" />,
  finalization: <CheckCircle2 className="w-3.5 h-3.5" />,
};

const phaseLabels: Record<string, string> = {
  planning: "Planificando búsqueda",
  signals: "Buscando artículos",
  verification: "Verificando DOIs",
  enrichment: "Enriqueciendo metadatos",
  export: "Generando Excel",
  finalization: "Finalizando",
  idle: "Iniciando...",
};

function ProgressChip({ 
  label, 
  value, 
  total, 
  variant = "default" 
}: { 
  label: string; 
  value: number; 
  total?: number; 
  variant?: "default" | "success" | "warning" | "muted";
}) {
  const variantClasses = {
    default: "bg-muted/80 text-foreground/80",
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    muted: "bg-muted/50 text-muted-foreground",
  };

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "text-[10px] font-medium px-1.5 py-0.5 border-0",
        variantClasses[variant]
      )}
    >
      {label} {total !== undefined ? `${value}/${total}` : value}
    </Badge>
  );
}

function MinimalEventFeed({ events }: { events: TraceEvent[] }) {
  const recentEvents = useMemo(() => {
    return events
      .filter(e => e.event_type !== "heartbeat" && e.event_type !== "progress_update")
      .slice(-3);
  }, [events]);

  if (recentEvents.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {recentEvents.map((event, idx) => (
        <div 
          key={`${event.run_id}-${event.seq}`}
          className={cn(
            "text-[11px] text-muted-foreground truncate",
            idx === recentEvents.length - 1 && "text-foreground/70"
          )}
        >
          <span className="font-medium">{event.agent}:</span>{" "}
          <span>{event.message}</span>
        </div>
      ))}
    </div>
  );
}

function InlineArtifact({ artifact }: { artifact: RunStreamState["artifacts"][0] }) {
  if (artifact.generating) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        <span>Generando {artifact.name}...</span>
      </div>
    );
  }

  return (
    <a
      href={artifact.url}
      download
      className="flex items-center gap-2 text-xs py-1 text-emerald-600 dark:text-emerald-400 hover:underline"
      data-testid="artifact-download-link"
    >
      <FileSpreadsheet className="w-3.5 h-3.5" />
      <span className="font-medium flex-1 truncate">{artifact.name}</span>
      <Download className="w-3.5 h-3.5" />
    </a>
  );
}

export function LiveExecutionConsole({ 
  runId,
  forceShow = false,
  onComplete, 
  onError,
  className 
}: LiveExecutionConsoleProps) {
  const [state, setState] = useState<RunStreamState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [narrationText, setNarrationText] = useState<string>("");
  const narrationAgentRef = useRef<NarrationAgent | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('[LiveExecutionConsole] Mounted with runId=', runId);
  }, [runId]);

  useEffect(() => {
    if (!runId) return;

    console.log(`[LiveExecutionConsole] Connecting to run: ${runId}`);
    const streamClient = new RunStreamClient(runId);

    narrationAgentRef.current = new NarrationAgent();
    processedEventsRef.current = new Set();
    setNarrationText("Iniciando agente de búsqueda…");

    const unsubscribe = streamClient.subscribe((newState) => {
      console.log(`[LiveExecutionConsole] State update:`, newState.connectionMode, newState.phase, newState.status);
      setState(newState);
      
      // Process only new events
      for (const event of newState.events) {
        const eventKey = `${event.run_id}-${event.seq}`;
        if (processedEventsRef.current.has(eventKey)) continue;
        processedEventsRef.current.add(eventKey);
        
        const newNarration = narrationAgentRef.current!.processEvent(event);
        if (newNarration.currentNarration) {
          setNarrationText(newNarration.currentNarration);
          console.log(`[NarrationAgent] ${newNarration.phase}: ${newNarration.currentNarration}`);
        }
      }
      
      // Also generate narration from state if no events yet
      if (newState.events.length === 0 || processedEventsRef.current.size === 0) {
        const stateNarration = generateNarrationFromState(newState);
        if (stateNarration) {
          setNarrationText(stateNarration);
        }
      }
      
      if (newState.status === "completed" && onComplete) {
        onComplete(newState.artifacts);
      }
      
      if (newState.status === "failed" && onError && newState.error) {
        onError(newState.error);
      }
    });

    streamClient.connect();

    return () => {
      console.log(`[LiveExecutionConsole] Unmounting for run: ${runId}`);
      unsubscribe();
      streamClient.destroy();
    };
  }, [runId, onComplete, onError]);

  // Generate narration directly from RunStreamState when events are missing
  function generateNarrationFromState(s: RunStreamState): string {
    const { phase, target, queries_current, queries_total, candidates_found, metrics, rules } = s;
    
    switch (phase) {
      case "planning":
        if (rules?.yearStart || rules?.yearEnd || target > 0) {
          return `Estoy preparando el plan: años ${rules?.yearStart || "?"}-${rules?.yearEnd || "?"}, objetivo ${target} artículos.`;
        }
        return "Planificando búsqueda…";
      
      case "signals":
        if (queries_current > 0 || candidates_found > 0) {
          return `Buscando artículos: consulta ${queries_current}/${queries_total || "?"}, encontrados ${candidates_found} candidatos.`;
        }
        return "Buscando artículos en fuentes académicas…";
      
      case "verification":
        if (metrics.articles_verified > 0) {
          return `Verificando enlaces/DOI: ${metrics.articles_verified} verificados, ${metrics.articles_accepted} aceptados.`;
        }
        return "Verificando enlaces y DOIs…";
      
      case "enrichment":
        return "Enriqueciendo metadatos de artículos…";
      
      case "export":
        if (metrics.articles_accepted > 0) {
          return `Generando Excel con ${metrics.articles_accepted} artículos…`;
        }
        return "Generando archivo Excel…";
      
      case "finalization":
        return `Finalizando: ${metrics.articles_accepted}/${target} artículos exportados.`;
      
      default:
        return "Procesando solicitud…";
    }
  }

  if (!runId) {
    return null;
  }

  if (!state || state.connectionMode === "connecting") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        data-testid="live-execution-console"
        className={cn(
          "bg-card/80 backdrop-blur-sm rounded-lg border border-border/60 shadow-sm p-3",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
          <span className="text-sm font-medium">Conectando...</span>
        </div>
      </motion.div>
    );
  }

  const isComplete = state.status === "completed" || state.status === "failed";
  const progressDisplay = state.target > 0 
    ? `${state.metrics.articles_accepted}/${state.target}` 
    : `${Math.round(state.progress)}%`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="live-execution-console"
      className={cn(
        "bg-card/80 backdrop-blur-sm rounded-lg border border-border/60 shadow-sm overflow-hidden",
        className
      )}
    >
      {narrationText && (
        <div className="relative px-4 py-3 bg-muted/30 border-b border-border/40 overflow-hidden">
          {state.status === 'running' && (
            <div className="absolute inset-0 animate-shimmer" />
          )}
          <div className="relative z-10">
            <p className="text-sm font-medium text-foreground leading-relaxed">{narrationText}</p>
          </div>
        </div>
      )}
      <div className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {state.status === "running" ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
            ) : state.status === "completed" ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : state.status === "failed" ? (
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">
                {isComplete 
                  ? (state.status === "completed" ? "Completado" : "Error")
                  : state.run_title
                }
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {phaseIcons[state.phase]}
                <span>{phaseLabels[state.phase] || state.phase}</span>
              </div>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-lg font-semibold text-primary">
              {progressDisplay}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {state.queries_total > 0 && (
            <ProgressChip 
              label="Consultas" 
              value={state.queries_current} 
              total={state.queries_total} 
            />
          )}
          {state.pages_searched > 0 && (
            <ProgressChip label="Páginas" value={state.pages_searched} />
          )}
          {state.candidates_found > 0 && (
            <ProgressChip label="Candidatos" value={state.candidates_found} />
          )}
          {state.metrics.articles_verified > 0 && (
            <ProgressChip 
              label="Verificados" 
              value={state.metrics.articles_verified} 
              variant="default"
            />
          )}
          <ProgressChip 
            label="Aceptados" 
            value={state.metrics.articles_accepted} 
            total={state.target > 0 ? state.target : undefined}
            variant="success"
          />
          {state.reject_count > 0 && (
            <ProgressChip 
              label="Descartes" 
              value={state.reject_count} 
              variant="warning"
            />
          )}
        </div>

        <MinimalEventFeed events={state.events} />

        {state.artifacts.length > 0 && (
          <div className="pt-1 border-t border-border/40">
            {state.artifacts.map((artifact) => (
              <InlineArtifact key={artifact.id} artifact={artifact} />
            ))}
          </div>
        )}

        {state.rules && (state.rules.yearStart || state.rules.yearEnd || state.rules.regions?.length) && (
          <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground w-full pt-1 border-t border-border/40">
              <Settings2 className="w-3 h-3" />
              <span>Reglas activas</span>
              {rulesOpen ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                {(state.rules.yearStart || state.rules.yearEnd) && (
                  <div>
                    <span className="font-medium">Años:</span> {state.rules.yearStart || "?"}-{state.rules.yearEnd || "?"}
                  </div>
                )}
                {state.rules.regions && state.rules.regions.length > 0 && (
                  <div>
                    <span className="font-medium">Regiones:</span> {state.rules.regions.join(", ")}
                  </div>
                )}
                {state.rules.output && (
                  <div>
                    <span className="font-medium">Output:</span> {state.rules.output}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </motion.div>
  );
}
