import React, { useState, memo, useCallback } from "react";
import { 
  ChevronDown, 
  ChevronRight, 
  Download, 
  CheckCircle2, 
  Loader2, 
  XCircle, 
  Clock,
  Search,
  Globe,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Code,
  Database,
  Terminal,
  Zap,
  Eye,
  Wrench,
  Bot,
  Presentation
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AgentStep, AgentEvent } from "@/stores/agent-store";
import { getFileTheme, getFileCategory, type FileCategory } from "@/lib/fileTypeTheme";

export interface AgentArtifact {
  id: string;
  type: string;
  name: string;
  url?: string;
  data?: any;
  mimeType?: string;
}

interface AgentStepsDisplayProps {
  steps: AgentStep[];
  summary?: string | null;
  artifacts?: AgentArtifact[];
  isRunning?: boolean;
  onDocumentClick?: (artifact: AgentArtifact) => void;
  onDownload?: (artifact: AgentArtifact) => void;
  className?: string;
}

interface StepGroupProps {
  steps: AgentStep[];
  isRunning?: boolean;
  defaultOpen?: boolean;
}

interface DocumentCardProps {
  artifact: AgentArtifact;
  onClick?: () => void;
  onDownload?: () => void;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  search_web: Search,
  web_search: Search,
  browse_url: Globe,
  web_navigate: Globe,
  generate_document: FileText,
  generate_file: FileText,
  extract_content: FileText,
  analyze_spreadsheet: FileSpreadsheet,
  analyze_data: FileSpreadsheet,
  transform_data: FileSpreadsheet,
  generate_image: ImageIcon,
  generate_code: Code,
  shell_execute: Terminal,
  shell_command: Terminal,
  read_file: FileText,
  write_file: FileText,
  file_operations: FileText,
  respond: Bot,
  slides_generate: Presentation,
  webdev_scaffold: Code,
};

function getToolIcon(toolName: string): React.ElementType {
  return TOOL_ICONS[toolName] || Wrench;
}

function getToolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    search_web: "Búsqueda web",
    web_search: "Búsqueda web",
    browse_url: "Navegando sitio",
    web_navigate: "Navegando sitio",
    generate_document: "Generando documento",
    generate_file: "Generando archivo",
    extract_content: "Extrayendo contenido",
    analyze_spreadsheet: "Analizando datos",
    analyze_data: "Analizando datos",
    transform_data: "Transformando datos",
    generate_image: "Generando imagen",
    generate_code: "Generando código",
    shell_execute: "Ejecutando comando",
    shell_command: "Ejecutando comando",
    read_file: "Leyendo archivo",
    write_file: "Escribiendo archivo",
    file_operations: "Operaciones de archivo",
    respond: "Respondiendo",
    slides_generate: "Generando presentación",
    webdev_scaffold: "Creando proyecto",
  };
  return names[toolName] || toolName.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function getDocumentIcon(category: FileCategory): React.ElementType {
  const icons: Record<FileCategory, React.ElementType> = {
    word: FileText,
    excel: FileSpreadsheet,
    ppt: Presentation,
    pdf: FileText,
    image: ImageIcon,
    text: FileText,
    code: Code,
    archive: Database,
    unknown: FileText,
  };
  return icons[category] || FileText;
}

function StepStatusIcon({ status, className }: { status: AgentStep["status"]; className?: string }) {
  switch (status) {
    case "pending":
      return <Clock className={cn("h-3.5 w-3.5 text-muted-foreground", className)} />;
    case "running":
      return <Loader2 className={cn("h-3.5 w-3.5 text-amber-500 animate-spin", className)} />;
    case "succeeded":
      return <CheckCircle2 className={cn("h-3.5 w-3.5 text-green-600", className)} />;
    case "failed":
      return <XCircle className={cn("h-3.5 w-3.5 text-red-500", className)} />;
    default:
      return <Clock className={cn("h-3.5 w-3.5 text-muted-foreground", className)} />;
  }
}

function getResultCount(step: AgentStep): number | null {
  if (!step.output) return null;
  if (Array.isArray(step.output)) return step.output.length;
  if (typeof step.output === "object") {
    if (step.output.results) return Array.isArray(step.output.results) ? step.output.results.length : null;
    if (step.output.items) return Array.isArray(step.output.items) ? step.output.items.length : null;
    if (step.output.count) return step.output.count;
  }
  return null;
}

const StepItem = memo(function StepItem({ step }: { step: AgentStep }) {
  const [isOpen, setIsOpen] = useState(false);
  const IconComponent = getToolIcon(step.toolName);
  const resultCount = getResultCount(step);
  const hasDetails = step.output || step.error;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 py-2 px-1 rounded-md transition-colors",
        step.status === "running" && "bg-amber-50 dark:bg-amber-950/20"
      )}
      data-testid={`agent-step-${step.stepIndex}`}
    >
      <StepStatusIcon status={step.status} className="mt-0.5 shrink-0" />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <IconComponent className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm text-foreground truncate">
            {getToolDisplayName(step.toolName)}
          </span>
          {resultCount !== null && resultCount > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {resultCount} {resultCount === 1 ? "resultado" : "resultados"}
            </span>
          )}
        </div>
        
        {step.error && (
          <p className="text-xs text-red-500 mt-1 line-clamp-2">{step.error}</p>
        )}

        {hasDetails && step.status === "succeeded" && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 transition-colors"
                data-testid={`toggle-step-details-${step.stepIndex}`}
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>{isOpen ? "Ocultar detalles" : "Ver detalles"}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="text-xs bg-muted/50 rounded-md p-2 max-h-32 overflow-auto">
                <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                  {typeof step.output === "string" 
                    ? step.output 
                    : JSON.stringify(step.output, null, 2)?.slice(0, 500)}
                </pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
});

export const StepGroup = memo(function StepGroup({ 
  steps, 
  isRunning = false,
  defaultOpen = false 
}: StepGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen || isRunning);
  
  const completedCount = steps.filter(s => s.status === "succeeded").length;
  const failedCount = steps.filter(s => s.status === "failed").length;
  const runningCount = steps.filter(s => s.status === "running").length;
  const totalSteps = steps.length;

  const getStatusLabel = () => {
    if (runningCount > 0) return "En progreso...";
    if (failedCount > 0 && completedCount === 0) return "Error";
    if (failedCount > 0) return `${completedCount} completados, ${failedCount} errores`;
    if (completedCount === totalSteps) return "Completado";
    return `${completedCount}/${totalSteps}`;
  };

  if (steps.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
            "bg-[#f5f1e8] dark:bg-stone-900/50 hover:bg-[#ebe7de] dark:hover:bg-stone-900/70",
            "border border-[#e5e0d5] dark:border-stone-800",
            "text-left group"
          )}
          data-testid="step-group-trigger"
        >
          <div className="flex items-center gap-1.5 text-muted-foreground group-hover:text-foreground transition-colors">
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>
          
          <span className="text-sm font-medium text-foreground">
            {totalSteps} {totalSteps === 1 ? "paso" : "pasos"}
          </span>
          
          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1.5">
            {runningCount > 0 && (
              <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
            )}
            {getStatusLabel()}
          </span>
        </button>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div 
          className={cn(
            "mt-1 px-3 py-2 rounded-lg",
            "bg-[#faf8f4] dark:bg-stone-950/30",
            "border border-[#e5e0d5] dark:border-stone-800"
          )}
        >
          <div className="space-y-0.5">
            {steps.map((step, index) => (
              <StepItem key={step.stepIndex ?? index} step={step} />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export const DocumentCard = memo(function DocumentCard({ 
  artifact, 
  onClick, 
  onDownload 
}: DocumentCardProps) {
  const category = getFileCategory(artifact.name, artifact.mimeType);
  const theme = getFileTheme(artifact.name, artifact.mimeType);
  const IconComponent = getDocumentIcon(category);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  }, [onClick]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload?.();
  }, [onDownload]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer",
        "bg-card hover:bg-accent/50 border-border hover:border-border/80",
        "hover:shadow-sm group"
      )}
      onClick={handleClick}
      data-testid={`document-card-${artifact.id}`}
    >
      <div 
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg shrink-0",
          "bg-gradient-to-br",
          theme.gradientFrom,
          theme.gradientTo
        )}
      >
        <IconComponent className="h-5 w-5 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">
          {artifact.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge 
            variant="outline" 
            className="text-[10px] px-1.5 py-0 h-4 font-normal"
          >
            {theme.label}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleClick}
          data-testid={`preview-document-${artifact.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleDownload}
          data-testid={`download-document-${artifact.id}`}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

export const AgentStepsDisplay = memo(function AgentStepsDisplay({
  steps,
  summary,
  artifacts = [],
  isRunning = false,
  onDocumentClick,
  onDownload,
  className
}: AgentStepsDisplayProps) {
  const hasSteps = steps.length > 0;
  const hasArtifacts = artifacts.length > 0;
  const hasSummary = summary && summary.trim().length > 0;

  const handleDocumentClick = useCallback((artifact: AgentArtifact) => {
    onDocumentClick?.(artifact);
  }, [onDocumentClick]);

  const handleDownload = useCallback((artifact: AgentArtifact) => {
    if (onDownload) {
      onDownload(artifact);
    } else if (artifact.url) {
      const link = document.createElement("a");
      link.href = artifact.url;
      link.download = artifact.name;
      link.click();
    }
  }, [onDownload]);

  if (!hasSteps && !hasArtifacts && !hasSummary) {
    return null;
  }

  return (
    <div 
      className={cn("space-y-3", className)} 
      data-testid="agent-steps-display"
    >
      {hasSteps && (
        <StepGroup 
          steps={steps} 
          isRunning={isRunning}
          defaultOpen={isRunning}
        />
      )}

      {hasSummary && !isRunning && (
        <div 
          className="text-sm text-foreground leading-relaxed"
          data-testid="agent-summary"
        >
          {summary}
        </div>
      )}

      {hasArtifacts && !isRunning && (
        <div className="space-y-2" data-testid="agent-artifacts">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Documentos generados
          </p>
          <div className="grid gap-2">
            {artifacts.map((artifact) => (
              <DocumentCard
                key={artifact.id}
                artifact={artifact}
                onClick={() => handleDocumentClick(artifact)}
                onDownload={() => handleDownload(artifact)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default AgentStepsDisplay;
