import { useQuery } from "@tanstack/react-query";
import { X, FileSpreadsheet, Globe, Image, FileText, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Square, Bot, Sparkles, FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import "@/components/ui/glass-effects.css";

interface AgentStep {
  stepIndex: number;
  toolName: string;
  status: "pending" | "running" | "succeeded" | "failed";
  description?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  output?: any;
}

interface AgentArtifact {
  id: string;
  type: string;
  name: string;
  url?: string;
  data?: any;
}

interface AgentRunData {
  id: string;
  chatId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  plan?: AgentStep[];
  steps?: AgentStep[];
  artifacts?: AgentArtifact[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
  summary?: string;
}

interface AgentPanelProps {
  runId: string | null;
  chatId: string;
  onClose: () => void;
  isOpen: boolean;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  analyze_spreadsheet: FileSpreadsheet,
  web_search: Globe,
  generate_image: Image,
  browse_url: Globe,
  generate_document: FileText,
  extract_content: FileText,
  transform_data: FileSpreadsheet,
  respond: Bot,
};

function getToolIcon(stepType: string): React.ElementType {
  return TOOL_ICONS[stepType] || FileIcon;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function StepStatusIcon({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />;
    case "succeeded":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function calculateDuration(startedAt?: string, completedAt?: string): number | null {
  if (!startedAt || !completedAt) return null;
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function StepItem({ step, index }: { step: AgentStep; index: number }) {
  const IconComponent = getToolIcon(step.toolName);
  const isRunning = step.status === "running";
  const duration = calculateDuration(step.startedAt, step.completedAt);
  
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border transition-all duration-200",
        isRunning && "border-purple-500/50 bg-purple-500/5 shadow-sm shadow-purple-500/10",
        step.status === "succeeded" && "border-green-500/30 bg-green-500/5",
        step.status === "failed" && "border-red-500/30 bg-red-500/5",
        step.status === "pending" && "border-border bg-muted/30"
      )}
      data-testid={`step-item-${step.stepIndex}`}
    >
      <div className={cn(
        "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
        isRunning && "bg-purple-500/20",
        step.status === "succeeded" && "bg-green-500/20",
        step.status === "failed" && "bg-red-500/20",
        step.status === "pending" && "bg-muted"
      )}>
        <IconComponent className={cn(
          "h-4 w-4",
          isRunning && "text-purple-500",
          step.status === "succeeded" && "text-green-500",
          step.status === "failed" && "text-red-500",
          step.status === "pending" && "text-muted-foreground"
        )} />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Paso {index + 1}
          </span>
          <Badge 
            variant={
              step.status === "succeeded" ? "success" :
              step.status === "failed" ? "destructive" :
              step.status === "running" ? "default" : "outline"
            }
            className={cn(
              "text-[10px] px-1.5 py-0",
              isRunning && "bg-purple-600 hover:bg-purple-600"
            )}
          >
            {step.status === "pending" && "Pendiente"}
            {step.status === "running" && "Ejecutando"}
            {step.status === "succeeded" && "Completado"}
            {step.status === "failed" && "Error"}
          </Badge>
        </div>
        
        <p className="text-sm font-medium mt-1 truncate">
          {step.description || step.toolName.replace(/_/g, " ")}
        </p>
        
        {duration && step.status === "succeeded" && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDuration(duration)}
          </p>
        )}
        
        {step.error && (
          <p className="text-xs text-red-500 mt-1 line-clamp-2">
            {step.error}
          </p>
        )}
      </div>
      
      <StepStatusIcon status={step.status} />
    </div>
  );
}

function ArtifactItem({ artifact }: { artifact: AgentArtifact }) {
  const iconMap: Record<string, React.ElementType> = {
    spreadsheet: FileSpreadsheet,
    document: FileText,
    image: Image,
    file: FileIcon,
  };
  const IconComponent = iconMap[artifact.type] || FileIcon;
  
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
      data-testid={`artifact-item-${artifact.id}`}
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10">
        <IconComponent className="h-5 w-5 text-purple-500" />
      </div>
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{artifact.name}</p>
        <p className="text-xs text-muted-foreground capitalize">{artifact.type}</p>
      </div>
    </div>
  );
}

export function AgentPanel({ runId, chatId, onClose, isOpen }: AgentPanelProps) {
  const { data: runData, isLoading, refetch } = useQuery<AgentRunData>({
    queryKey: ["agent-run", runId],
    queryFn: async () => {
      if (!runId) throw new Error("No run ID");
      const response = await fetch(`/api/agent/runs/${runId}`);
      if (!response.ok) throw new Error("Failed to fetch run data");
      return response.json();
    },
    enabled: !!runId && isOpen,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "running" || data?.status === "pending") {
        return 2000;
      }
      return false;
    },
  });

  const handleCancel = async () => {
    if (!runId) return;
    try {
      await fetch(`/api/agent/runs/${runId}/cancel`, { method: "POST" });
      refetch();
    } catch (error) {
      console.error("Error cancelling run:", error);
    }
  };

  const handleRetry = async () => {
    if (!runId) return;
    try {
      await fetch(`/api/agent/runs/${runId}/retry`, { method: "POST" });
      refetch();
    } catch (error) {
      console.error("Error retrying run:", error);
    }
  };

  if (!isOpen) return null;

  const steps = runData?.steps || runData?.plan || [];
  const artifacts = runData?.artifacts || [];
  const completedSteps = steps.filter(s => s.status === "succeeded").length;
  const totalSteps = steps.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const isRunning = runData?.status === "running" || runData?.status === "pending";
  const isFailed = runData?.status === "failed";
  const isCompleted = runData?.status === "completed";

  return (
    <div 
      className={cn(
        "fixed right-0 top-0 h-full w-[400px] max-w-full z-50",
        "bg-background/95 backdrop-blur-xl border-l border-border",
        "shadow-2xl shadow-purple-500/5",
        "flex flex-col",
        "animate-in slide-in-from-right duration-300"
      )}
      data-testid="agent-panel"
    >
      <div className="flex items-center justify-between p-4 border-b border-border glass-menu-item">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 shadow-lg shadow-purple-500/25">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Agente</h2>
            <p className="text-xs text-muted-foreground">
              {isRunning && "Ejecutando..."}
              {isCompleted && "Completado"}
              {isFailed && "Error"}
              {!runData && "Sin ejecución activa"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          data-testid="button-close-agent-panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {runData && (
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progreso</span>
            <span className="text-sm text-muted-foreground">
              {completedSteps}/{totalSteps} pasos
            </span>
          </div>
          <Progress 
            value={progressPercent} 
            className="h-2 bg-purple-500/20 [&>div]:bg-gradient-to-r [&>div]:from-purple-500 [&>div]:to-purple-600"
            data-testid="agent-progress-bar"
          />
        </div>
      )}

      <Tabs defaultValue="progress" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 bg-muted/50">
          <TabsTrigger value="plan" className="flex-1 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600">
            Plan
          </TabsTrigger>
          <TabsTrigger value="progress" className="flex-1 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600">
            Progreso
          </TabsTrigger>
          <TabsTrigger value="artifacts" className="flex-1 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600">
            Artefactos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="flex-1 overflow-hidden m-0 mt-2">
          <ScrollArea className="h-full px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : steps.length > 0 ? (
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <StepItem key={`plan-${step.stepIndex}`} step={step} index={index} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bot className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No hay plan disponible
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="progress" className="flex-1 overflow-hidden m-0 mt-2">
          <ScrollArea className="h-full px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : runData?.summary && steps.length === 0 ? (
              <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/5">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex-shrink-0">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground mb-1">Respuesta</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{runData.summary}</p>
                  </div>
                </div>
              </div>
            ) : steps.length > 0 ? (
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <StepItem key={`progress-${step.stepIndex}`} step={step} index={index} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Esperando ejecución
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="artifacts" className="flex-1 overflow-hidden m-0 mt-2">
          <ScrollArea className="h-full px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : artifacts.length > 0 ? (
              <div className="space-y-2">
                {artifacts.map((artifact) => (
                  <ArtifactItem key={artifact.id} artifact={artifact} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileIcon className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Sin artefactos generados
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {runData && (
        <div className="p-4 border-t border-border flex gap-2">
          {isRunning && (
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleCancel}
              data-testid="button-cancel-agent"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              Cancelar
            </Button>
          )}
          {isFailed && (
            <Button
              variant="default"
              className="flex-1 bg-purple-600 hover:bg-purple-700"
              onClick={handleRetry}
              data-testid="button-retry-agent"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          )}
          {isCompleted && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              data-testid="button-done-agent"
            >
              <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              Listo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
