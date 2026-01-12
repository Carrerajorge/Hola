import React, { useState, memo, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Download,
  CheckCircle2,
  Loader2,
  XCircle,
  Search,
  Globe,
  FileText,
  FileSpreadsheet,
  Eye,
  Brain,
  ShieldCheck,
  PartyPopper,
  RefreshCw,
  AlertTriangle,
  Copy,
  WifiOff,
  ServerCrash,
  Ban,
  AlertCircle,
  ExternalLink,
  Zap,
  Presentation,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type {
  SuperAgentState,
  SuperAgentPhase,
  SuperAgentSource,
  SuperAgentArtifact,
} from "@/hooks/use-super-agent";

const PHASE_LABELS: Record<SuperAgentPhase, string> = {
  idle: "Listo",
  planning: "Analizando solicitud",
  signals: "Buscando fuentes",
  deep: "Extrayendo contenido",
  creating: "Generando documentos",
  verifying: "Verificando calidad",
  finalizing: "Finalizando",
  completed: "Completado",
  error: "Error",
};

const PHASE_ICONS: Record<SuperAgentPhase, React.ElementType> = {
  idle: Zap,
  planning: Brain,
  signals: Search,
  deep: Eye,
  creating: FileText,
  verifying: ShieldCheck,
  finalizing: CheckCircle2,
  completed: PartyPopper,
  error: XCircle,
};

interface PhaseIndicatorProps {
  phase: SuperAgentPhase;
  isRunning: boolean;
}

const PhaseIndicator = memo(function PhaseIndicator({
  phase,
  isRunning,
}: PhaseIndicatorProps) {
  const Icon = PHASE_ICONS[phase];
  const label = PHASE_LABELS[phase];

  const isActive = isRunning && phase !== "completed" && phase !== "error";
  const isSuccess = phase === "completed";
  const isError = phase === "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border",
        isActive && "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
        isSuccess && "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
        isError && "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
        !isActive && !isSuccess && !isError && "bg-muted/30 border-border"
      )}
      data-testid="super-agent-phase-indicator"
    >
      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-full",
          isActive && "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400",
          isSuccess && "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400",
          isError && "bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400",
          !isActive && !isSuccess && !isError && "bg-muted text-muted-foreground"
        )}
      >
        {isActive ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>
      <div className="flex-1">
        <p
          className={cn(
            "font-medium",
            isActive && "text-blue-700 dark:text-blue-300",
            isSuccess && "text-green-700 dark:text-green-300",
            isError && "text-red-700 dark:text-red-300"
          )}
        >
          {label}
        </p>
        {isActive && (
          <p className="text-sm text-muted-foreground">
            Procesando tu solicitud...
          </p>
        )}
      </div>
    </motion.div>
  );
});

interface SourcesProgressProps {
  collected: number;
  target: number;
  phase: SuperAgentPhase;
}

const SourcesProgress = memo(function SourcesProgress({
  collected,
  target,
  phase,
}: SourcesProgressProps) {
  const percentage = Math.min((collected / target) * 100, 100);
  const isSearching = phase === "signals" || phase === "deep";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-2"
      data-testid="super-agent-sources-progress"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Globe className="h-4 w-4" />
          Fuentes recopiladas
        </span>
        <span className="font-medium">
          {collected}/{target} fuentes
        </span>
      </div>
      <Progress value={percentage} className="h-2" />
      {isSearching && collected > 0 && (
        <p className="text-xs text-muted-foreground animate-pulse">
          {phase === "signals" ? "Buscando en la web..." : "Extrayendo contenido..."}
        </p>
      )}
    </motion.div>
  );
});

interface SourceCardProps {
  source: SuperAgentSource;
  index: number;
}

const SourceCard = memo(function SourceCard({ source, index }: SourceCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.02 }}
      className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
      data-testid={`source-card-${source.id}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {source.fetched ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <Globe className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm hover:underline truncate flex-1"
            data-testid={`source-link-${source.id}`}
          >
            {source.title || "Sin título"}
          </a>
          <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {source.domain}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {(source.score * 100).toFixed(0)}% relevancia
          </span>
        </div>
        {source.snippet && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {source.snippet}
          </p>
        )}
      </div>
    </motion.div>
  );
});

interface SourcesListProps {
  sources: SuperAgentSource[];
  phase: SuperAgentPhase;
  target: number;
}

const SourcesList = memo(function SourcesList({
  sources,
  phase,
  target,
}: SourcesListProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const displayedSources = useMemo(() => {
    const sorted = [...sources].sort((a, b) => b.score - a.score);
    return showAll ? sorted : sorted.slice(0, 10);
  }, [sources, showAll]);

  const fetchedCount = sources.filter((s) => s.fetched).length;

  if (sources.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between p-3 h-auto"
          data-testid="sources-list-toggle"
        >
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            <span className="font-medium">Fuentes encontradas</span>
            <Badge variant="secondary">{sources.length}</Badge>
            {fetchedCount > 0 && (
              <Badge variant="success" className="ml-1">
                {fetchedCount} procesadas
              </Badge>
            )}
          </div>
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2 pt-2"
        >
          <SourcesProgress
            collected={sources.length}
            target={target}
            phase={phase}
          />
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            <AnimatePresence>
              {displayedSources.map((source, index) => (
                <SourceCard key={source.id} source={source} index={index} />
              ))}
            </AnimatePresence>
          </div>
          {sources.length > 10 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="w-full text-muted-foreground"
              data-testid="sources-show-more"
            >
              {showAll
                ? "Mostrar menos"
                : `Ver ${sources.length - 10} fuentes más`}
            </Button>
          )}
        </motion.div>
      </CollapsibleContent>
    </Collapsible>
  );
});

interface ArtifactCardProps {
  artifact: SuperAgentArtifact;
}

const ARTIFACT_ICONS: Record<string, React.ElementType> = {
  xlsx: FileSpreadsheet,
  docx: FileText,
  pptx: Presentation,
};

const ARTIFACT_COLORS: Record<string, string> = {
  xlsx: "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900",
  docx: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900",
  pptx: "text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900",
};

const ArtifactCard = memo(function ArtifactCard({ artifact }: ArtifactCardProps) {
  const Icon = ARTIFACT_ICONS[artifact.type] || FileText;
  const colorClass = ARTIFACT_COLORS[artifact.type] || "text-gray-600 bg-gray-100";

  const handleDownload = useCallback(() => {
    const downloadUrl = artifact.downloadUrl || `/api/super/artifacts/${artifact.id}/download`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = artifact.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Descargando ${artifact.name}`);
  }, [artifact]);

  const formatSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-4 p-4 rounded-lg border bg-card shadow-sm"
      data-testid={`artifact-card-${artifact.id}`}
    >
      <div className={cn("flex items-center justify-center w-12 h-12 rounded-lg", colorClass)}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{artifact.name}</p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className="uppercase text-xs">
            {artifact.type}
          </Badge>
          {artifact.size && (
            <span>{formatSize(artifact.size)}</span>
          )}
        </div>
      </div>
      <Button
        onClick={handleDownload}
        className="flex-shrink-0"
        data-testid={`download-artifact-${artifact.id}`}
      >
        <Download className="h-4 w-4 mr-2" />
        Descargar
      </Button>
    </motion.div>
  );
});

interface ArtifactsListProps {
  artifacts: SuperAgentArtifact[];
}

const ArtifactsList = memo(function ArtifactsList({ artifacts }: ArtifactsListProps) {
  if (artifacts.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="artifacts-list">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Documentos generados</span>
        <Badge variant="success">{artifacts.length}</Badge>
      </div>
      <div className="space-y-2">
        <AnimatePresence>
          {artifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
});

type ErrorType = "transient" | "permanent" | "unknown";

interface ClassifiedError {
  type: ErrorType;
  isRetryable: boolean;
  userMessage: string;
  technicalDetails: string;
  icon: React.ElementType;
}

const TRANSIENT_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /connection/i,
  /rate limit/i,
  /too many requests/i,
  /429/,
  /503/,
  /502/,
  /504/,
  /temporarily unavailable/i,
  /service unavailable/i,
];

const PERMANENT_ERROR_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /not found/i,
  /invalid.*key/i,
  /permission denied/i,
  /401/,
  /403/,
  /404/,
];

function classifyError(error: string | null): ClassifiedError {
  const errorText = error || "";

  if (!errorText) {
    return {
      type: "unknown",
      isRetryable: true,
      userMessage: "Ocurrió un error inesperado",
      technicalDetails: "No hay detalles disponibles",
      icon: AlertCircle,
    };
  }

  const isTransient = TRANSIENT_ERROR_PATTERNS.some((p) => p.test(errorText));
  const isPermanent = PERMANENT_ERROR_PATTERNS.some((p) => p.test(errorText));

  if (isTransient && !isPermanent) {
    let userMessage = "Problema de conexión temporal";
    let icon: React.ElementType = WifiOff;

    if (/rate limit|too many requests|429/i.test(errorText)) {
      userMessage = "Límite de solicitudes alcanzado";
    } else if (/timeout/i.test(errorText)) {
      userMessage = "La solicitud tardó demasiado";
    } else if (/503|502|504|service unavailable/i.test(errorText)) {
      userMessage = "El servidor está temporalmente ocupado";
      icon = ServerCrash;
    }

    return {
      type: "transient",
      isRetryable: true,
      userMessage,
      technicalDetails: errorText,
      icon,
    };
  }

  if (isPermanent) {
    let userMessage = "Error de configuración o permisos";
    let icon: React.ElementType = Ban;

    if (/unauthorized|401|invalid.*key/i.test(errorText)) {
      userMessage = "Error de autenticación";
    } else if (/forbidden|403|permission denied/i.test(errorText)) {
      userMessage = "No tienes permiso para esta acción";
    } else if (/not found|404/i.test(errorText)) {
      userMessage = "Recurso no encontrado";
      icon = AlertCircle;
    }

    return {
      type: "permanent",
      isRetryable: false,
      userMessage,
      technicalDetails: errorText,
      icon,
    };
  }

  return {
    type: "unknown",
    isRetryable: true,
    userMessage: "Ocurrió un error durante la ejecución",
    technicalDetails: errorText,
    icon: AlertCircle,
  };
}

interface SuperAgentErrorBannerProps {
  error: string | null;
  onRetry?: () => void;
}

const SuperAgentErrorBanner = memo(function SuperAgentErrorBanner({
  error,
  onRetry,
}: SuperAgentErrorBannerProps) {
  const [isCopied, setIsCopied] = useState(false);
  const classifiedError = useMemo(() => classifyError(error), [error]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(classifiedError.technicalDetails);
      setIsCopied(true);
      toast.success("Error copiado al portapapeles");
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }, [classifiedError.technicalDetails]);

  if (!error) return null;

  const Icon = classifiedError.icon;
  const isTransient = classifiedError.type === "transient";

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-lg border p-4 space-y-3",
        isTransient
          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
          : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
      )}
      data-testid="super-agent-error-banner"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0",
            isTransient
              ? "bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400"
              : "bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "font-medium",
              isTransient
                ? "text-amber-700 dark:text-amber-300"
                : "text-red-700 dark:text-red-300"
            )}
          >
            {classifiedError.userMessage}
          </p>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {classifiedError.technicalDetails}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {classifiedError.isRetryable && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} data-testid="error-retry-btn">
            <RefreshCw className="h-4 w-4 mr-1" />
            Reintentar
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          data-testid="error-copy-btn"
        >
          {isCopied ? (
            <CheckCircle2 className="h-4 w-4 mr-1" />
          ) : (
            <Copy className="h-4 w-4 mr-1" />
          )}
          {isCopied ? "Copiado" : "Copiar error"}
        </Button>
      </div>
    </motion.div>
  );
});

interface VerifyResultProps {
  verify: NonNullable<SuperAgentState["verify"]>;
}

const VerifyResult = memo(function VerifyResult({ verify }: VerifyResultProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-between p-3 h-auto",
            verify.passed
              ? "text-green-700 dark:text-green-300"
              : "text-amber-700 dark:text-amber-300"
          )}
          data-testid="verify-toggle"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span className="font-medium">
              Verificación de calidad
            </span>
            <Badge variant={verify.passed ? "success" : "warning"}>
              {verify.passed ? "Aprobado" : "Advertencias"}
            </Badge>
          </div>
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2 pt-2 px-3"
        >
          {verify.checks.map((check) => (
            <div
              key={check.id}
              className="flex items-center gap-2 text-sm"
            >
              {check.passed ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              )}
              <span className="text-muted-foreground">{check.condition}</span>
            </div>
          ))}
          {verify.blockers.length > 0 && (
            <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-950/30">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                Bloqueadores:
              </p>
              <ul className="text-sm text-red-600 dark:text-red-400 list-disc pl-4">
                {verify.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export interface SuperAgentDisplayProps {
  state: SuperAgentState;
  onRetry?: () => void;
  onCancel?: () => void;
  className?: string;
}

export const SuperAgentDisplay = memo(function SuperAgentDisplay({
  state,
  onRetry,
  onCancel,
  className,
}: SuperAgentDisplayProps) {
  const { isRunning, phase, sources, sourcesTarget, artifacts, verify, error } = state;

  const isActive = isRunning && phase !== "completed" && phase !== "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("space-y-4", className)}
      data-testid="super-agent-display"
    >
      <PhaseIndicator phase={phase} isRunning={isRunning} />

      {isActive && onCancel && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            data-testid="super-agent-cancel"
          >
            <XCircle className="h-4 w-4 mr-1" />
            Cancelar
          </Button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {error && (
          <SuperAgentErrorBanner error={error} onRetry={onRetry} />
        )}
      </AnimatePresence>

      {(phase === "signals" || phase === "deep" || sources.length > 0) && (
        <SourcesList sources={sources} phase={phase} target={sourcesTarget} />
      )}

      {verify && <VerifyResult verify={verify} />}

      {artifacts.length > 0 && <ArtifactsList artifacts={artifacts} />}

      {phase === "completed" && state.final && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
          data-testid="super-agent-final"
        >
          <div className="flex items-center gap-2 mb-2">
            <PartyPopper className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="font-medium text-green-700 dark:text-green-300">
              Investigación completada
            </span>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <strong>{state.final.sources_count}</strong> fuentes analizadas
            </p>
            <p>
              <strong>{state.final.artifacts.length}</strong> documentos generados
            </p>
            <p>
              Completado en{" "}
              <strong>{(state.final.duration_ms / 1000).toFixed(1)}s</strong>
            </p>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
});

export default SuperAgentDisplay;
