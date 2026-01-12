import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Activity, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  FileSpreadsheet,
  Search,
  Shield,
  FileOutput,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Download,
  Zap
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { 
  RunStreamClient, 
  RunStreamState, 
  TraceEvent, 
  SpanNode 
} from "@/lib/runStreamClient";

interface LiveExecutionConsoleProps {
  runId: string | null;
  onComplete?: (artifacts: RunStreamState["artifacts"]) => void;
  onError?: (error: string) => void;
  className?: string;
}

const phaseIcons: Record<string, React.ReactNode> = {
  planning: <Zap className="w-4 h-4" />,
  signals: <Search className="w-4 h-4" />,
  verification: <Shield className="w-4 h-4" />,
  enrichment: <Activity className="w-4 h-4" />,
  export: <FileOutput className="w-4 h-4" />,
  finalization: <CheckCircle2 className="w-4 h-4" />,
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

function TimelineEvent({ event, isLast }: { event: TraceEvent; isLast: boolean }) {
  const getEventIcon = () => {
    switch (event.event_type) {
      case "run_started":
      case "phase_started":
        return <Loader2 className="w-3 h-3 animate-spin text-blue-500" />;
      case "run_completed":
      case "phase_completed":
      case "tool_end":
      case "source_verified":
        return <CheckCircle2 className="w-3 h-3 text-green-500" />;
      case "run_failed":
      case "phase_failed":
      case "tool_error":
      case "contract_violation":
        return <XCircle className="w-3 h-3 text-red-500" />;
      case "source_collected":
        return <Search className="w-3 h-3 text-blue-400" />;
      case "artifact_created":
        return <FileSpreadsheet className="w-3 h-3 text-emerald-500" />;
      case "checkpoint":
      case "progress_update":
        return <Activity className="w-3 h-3 text-purple-500" />;
      default:
        return <Clock className="w-3 h-3 text-muted-foreground" />;
    }
  };

  if (event.event_type === "heartbeat") return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex gap-2 items-start text-xs"
    >
      <div className="flex flex-col items-center">
        <div className="p-1 rounded-full bg-muted">
          {getEventIcon()}
        </div>
        {!isLast && <div className="w-px h-4 bg-border" />}
      </div>
      <div className="flex-1 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground/90">
            {event.agent}
          </span>
          <span className="text-muted-foreground">
            {new Date(event.ts).toLocaleTimeString()}
          </span>
        </div>
        <p className="text-muted-foreground truncate max-w-[300px]">
          {event.message}
        </p>
      </div>
    </motion.div>
  );
}

function SpanTreeNode({ node, depth = 0 }: { node: SpanNode; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  const statusColor = {
    pending: "text-muted-foreground",
    running: "text-blue-500",
    success: "text-green-500",
    failed: "text-red-500",
  }[node.status];

  return (
    <div className="text-xs">
      <div 
        className={cn(
          "flex items-center gap-1 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer",
          depth > 0 && "ml-4"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
        ) : (
          <div className="w-3" />
        )}
        
        {node.status === "running" ? (
          <Loader2 className={cn("w-3 h-3 animate-spin", statusColor)} />
        ) : node.status === "success" ? (
          <CheckCircle2 className={cn("w-3 h-3", statusColor)} />
        ) : node.status === "failed" ? (
          <XCircle className={cn("w-3 h-3", statusColor)} />
        ) : (
          <Clock className={cn("w-3 h-3", statusColor)} />
        )}
        
        <span className="font-medium">{node.agent}</span>
        <span className="text-muted-foreground truncate flex-1">
          {node.message.substring(0, 50)}...
        </span>
        {node.latency_ms && (
          <span className="text-muted-foreground">
            {node.latency_ms}ms
          </span>
        )}
      </div>
      
      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            {node.children.map((child) => (
              <SpanTreeNode key={child.span_id} node={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LiveExecutionConsole({ 
  runId, 
  onComplete, 
  onError,
  className 
}: LiveExecutionConsoleProps) {
  const [state, setState] = useState<RunStreamState | null>(null);
  const [client, setClient] = useState<RunStreamClient | null>(null);
  const [showTimeline, setShowTimeline] = useState(true);

  useEffect(() => {
    if (!runId) return;

    const streamClient = new RunStreamClient(runId);
    setClient(streamClient);

    const unsubscribe = streamClient.subscribe((newState) => {
      setState(newState);
      
      if (newState.status === "completed" && onComplete) {
        onComplete(newState.artifacts);
      }
      
      if (newState.status === "failed" && onError && newState.error) {
        onError(newState.error);
      }
    });

    streamClient.connect();

    return () => {
      unsubscribe();
      streamClient.destroy();
    };
  }, [runId, onComplete, onError]);

  const recentEvents = useMemo(() => {
    if (!state) return [];
    return state.events
      .filter(e => e.event_type !== "heartbeat")
      .slice(-20);
  }, [state?.events]);

  if (!runId) {
    return null;
  }

  if (!state) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl border border-border/50 shadow-lg overflow-hidden p-6",
          className
        )}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Iniciando búsqueda académica</h3>
            <p className="text-xs text-muted-foreground">Conectando con el agente de investigación...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  const isComplete = state.status === "completed" || state.status === "failed";
  const hasViolations = state.violations.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl border border-border/50 shadow-lg overflow-hidden",
        className
      )}
    >
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {state.status === "running" ? (
              <div className="relative">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
              </div>
            ) : state.status === "completed" ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : state.status === "failed" ? (
              <XCircle className="w-5 h-5 text-red-500" />
            ) : (
              <Clock className="w-5 h-5 text-muted-foreground" />
            )}
            
            <div>
              <h3 className="font-semibold text-sm">
                {isComplete 
                  ? (state.status === "completed" ? "Búsqueda completada" : "Error en la búsqueda")
                  : "Ejecutando búsqueda académica"
                }
              </h3>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                {phaseIcons[state.phase] || <Activity className="w-3 h-3" />}
                {phaseLabels[state.phase] || state.phase}
              </p>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">
              {Math.round(state.progress)}%
            </div>
            <div className="text-xs text-muted-foreground">
              {state.connected ? "Conectado" : "Reconectando..."}
            </div>
          </div>
        </div>
        
        <Progress value={state.progress} className="h-2" />
        
        <div className="flex gap-4 mt-3 text-xs">
          <div className="flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-muted-foreground">Recolectados:</span>
            <span className="font-medium">{state.metrics.articles_collected}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-muted-foreground">Verificados:</span>
            <span className="font-medium">{state.metrics.articles_verified}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span className="text-muted-foreground">Aceptados:</span>
            <span className="font-medium">{state.metrics.articles_accepted}</span>
          </div>
        </div>
      </div>
      
      {hasViolations && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="font-medium">
              {state.violations.length} advertencia{state.violations.length > 1 ? "s" : ""} de validación
            </span>
          </div>
        </div>
      )}
      
      {state.artifacts.length > 0 && (
        <div className="px-4 py-3 bg-emerald-500/10 border-b border-emerald-500/20">
          {state.artifacts.map((artifact) => (
            <a
              key={artifact.id}
              href={artifact.url}
              download
              className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
              data-testid="artifact-download-link"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="font-medium">{artifact.name}</span>
              <Download className="w-3.5 h-3.5 ml-auto" />
            </a>
          ))}
        </div>
      )}
      
      <div className="max-h-[200px] overflow-y-auto p-3">
        <button
          onClick={() => setShowTimeline(!showTimeline)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
        >
          {showTimeline ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Línea de tiempo ({recentEvents.length} eventos)
        </button>
        
        <AnimatePresence>
          {showTimeline && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-0"
            >
              {recentEvents.map((event, idx) => (
                <TimelineEvent 
                  key={`${event.run_id}-${event.seq}`} 
                  event={event} 
                  isLast={idx === recentEvents.length - 1}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
