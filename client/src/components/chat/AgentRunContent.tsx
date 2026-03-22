
import React, { memo, useState, useRef, useEffect, useMemo } from "react";
import {
    Loader2,
    Sparkles,
    Eye,
    RefreshCw,
    Clock,
    CheckCircle2,
    XCircle,
    AlertCircle,
    List,
    ChevronDown,
    Brain,
    Bot
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";
import { normalizeAgentEvent, hasPayloadDetails, type MappedAgentEvent } from "@/lib/agent-event-mapper";
import { AgentStepsDisplay, type AgentArtifact } from "@/components/agent-steps-display";
import { PlanViewer } from "@/components/agent/PlanViewer";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { JsonArgumentsViewer } from "@/components/chat/JsonArgumentsViewer";
import { ToolInvocationCard, ToolStatus } from "@/components/chat/ToolInvocationCard";

interface AgentRunContentProps {
    agentRun: {
        runId: string | null;
        status: "idle" | "starting" | "running" | "completed" | "failed" | "cancelled" | "queued" | "planning" | "verifying" | "paused" | "cancelling" | "replanning";
        userMessage?: string;
        steps: Array<{
            stepIndex: number;
            toolName: string;
            status: string;
            output?: any;
            error?: string;
        }>;
        eventStream: Array<{
            type: string;
            content: any;
            timestamp: number;
        }>;
        summary: string | null;
        error: string | null;
    };
    onCancel?: () => void;
    onRetry?: () => void;
    onPause?: () => void;
    onResume?: () => void;
    onArtifactPreview?: (artifact: AgentArtifact) => void;
    onOpenLightbox?: (imageUrl: string) => void;
    onToolConfirm?: (toolName: string, stepIndex: number) => void;
    onToolDeny?: (toolName: string, stepIndex: number) => void;
}

export const AgentRunContent = memo(function AgentRunContent({
    agentRun,
    onCancel,
    onRetry: _onRetry,
    onPause,
    onResume,
    onArtifactPreview,
    onOpenLightbox,
    onToolConfirm,
    onToolDeny
}: AgentRunContentProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [showAllEvents, setShowAllEvents] = useState(false);
    const [isSlowConnection, setIsSlowConnection] = useState(false);
    const [waitingSeconds, setWaitingSeconds] = useState(0);
    const [viewMode] = useState<"steps" | "plan">("steps");
    const eventsEndRef = useRef<HTMLDivElement>(null);

    const isCancellable = ["starting", "running", "queued", "planning", "verifying", "paused", "replanning"].includes(agentRun.status);
    const isActive = ["starting", "running", "queued", "planning", "verifying", "cancelling", "replanning"].includes(agentRun.status);
    const isPaused = agentRun.status === "paused";
    const isCancelling = agentRun.status === "cancelling";
    const isWaitingForResponse = agentRun.status === "starting" || agentRun.status === "queued";
    const showVerboseAgentInternals = false;

    useEffect(() => {
        if (isActive && eventsEndRef.current) {
            eventsEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [agentRun.eventStream?.length, isActive]);

    useEffect(() => {
        if (!isWaitingForResponse) {
            setIsSlowConnection(false);
            setWaitingSeconds(0);
            return;
        }

        const interval = setInterval(() => {
            setWaitingSeconds(prev => {
                const newVal = prev + 1;
                if (newVal >= 10) {
                    setIsSlowConnection(true);
                }
                return newVal;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isWaitingForResponse]);

    const getStatusIcon = () => {
        switch (agentRun.status) {
            case "starting":
            case "queued":
                return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
            case "planning":
                return <Sparkles className="h-4 w-4 animate-pulse text-muted-foreground" />;
            case "running":
                return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
            case "verifying":
                return <Eye className="h-4 w-4 animate-pulse text-muted-foreground" />;
            case "replanning":
                return <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />;
            case "paused":
                return <Clock className="h-4 w-4 text-muted-foreground" />;
            case "cancelling":
                return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
            case "completed":
                return <CheckCircle2 className="h-4 w-4 text-green-500" />;
            case "failed":
                return <XCircle className="h-4 w-4 text-red-500" />;
            case "cancelled":
                return <AlertCircle className="h-4 w-4 text-yellow-500" />;
            default:
                return <Clock className="h-4 w-4 text-muted-foreground" />;
        }
    };

    const getStatusText = () => {
        switch (agentRun.status) {
            case "starting": return "Iniciando...";
            case "queued": return "En cola...";
            case "planning": return "Planificando...";
            case "running": return "Ejecutando...";
            case "verifying": return "Verificando...";
            case "replanning": return "Replanificando...";
            case "paused": return "Pausado";
            case "cancelling": return "Cancelando...";
            case "completed": return "Completado";
            case "failed": return "Error";
            case "cancelled": return "Cancelado";
            default: return agentRun.status;
        }
    };

    const getToolDisplayName = (toolName: string) => {
        const toolNames: Record<string, string> = {
            analyze_spreadsheet: "Analizando datos",
            web_search: "Buscando en web",
            web_search_retrieve: "Recuperando información",
            generate_image: "Generando imagen",
            browse_url: "Navegando URL",
            generate_document: "Generando documento",
            read_file: "Leyendo archivo",
            write_file: "Escribiendo archivo",
            shell_command: "Ejecutando comando",
            list_files: "Listando archivos",
            respond: "Respondiendo",
            start_planning: "Analizando solicitud",
            conversational_response: "Respuesta",
        };
        return toolNames[toolName] || toolName;
    };

    const mappedEvents = useMemo(() => {
        return (agentRun.eventStream || []).map(event => normalizeAgentEvent(event));
    }, [agentRun.eventStream]);

    const visibleEvents = showAllEvents
        ? mappedEvents
        : mappedEvents.slice(-5);
    const hiddenEventsCount = mappedEvents.length - visibleEvents.length;

    const getEventIcon = (event: MappedAgentEvent) => {
        const iconClass = cn("h-3 w-3", event.ui.iconColor);
        switch (event.ui.icon) {
            case 'sparkles': return <Sparkles className={iconClass} />;
            case 'check': return <CheckCircle2 className={iconClass} />;
            case 'alert': return <XCircle className={iconClass} />;
            case 'list': return <List className={iconClass} />;
            case 'eye': return <Eye className={iconClass} />;
            case 'brain': return <Brain className={iconClass} />;
            case 'loader': return <Loader2 className={cn(iconClass, "animate-spin")} />;
            default: return <Clock className={iconClass} />;
        }
    };

    // Extract objective from event stream
    const objective = useMemo(() => {
        const planEvent = (agentRun.eventStream || []).find(
            (e: any) => e.content?.plan?.objective || e.content?.objective
        );
        return planEvent?.content?.plan?.objective || planEvent?.content?.objective || agentRun.userMessage || null;
    }, [agentRun.eventStream, agentRun.userMessage]);

    // Count completed vs total steps
    const stepProgress = useMemo(() => {
        const completedEvents = mappedEvents.filter(e => e.status === 'ok' && (e.kind === 'observation' || e.kind === 'result')).length;
        const totalSteps = agentRun.steps?.length || mappedEvents.filter(e => e.kind === 'action').length || 0;
        return { completed: completedEvents, total: Math.max(totalSteps, completedEvents) };
    }, [mappedEvents, agentRun.steps]);

    // Extract subagent activity from event stream
    const subagents = useMemo(() => {
        const map = new Map<string, { id: string; objective: string; status: string; error?: string; elapsedMs?: number }>();
        for (const event of agentRun.eventStream || []) {
            const meta = event.content?.metadata;
            if (!meta?.subagentId) continue;
            const existing = map.get(meta.subagentId);
            map.set(meta.subagentId, {
                id: meta.subagentId,
                objective: meta.objective || existing?.objective || "Subagente",
                status: meta.status || existing?.status || "queued",
                error: meta.error || existing?.error,
                elapsedMs: meta.elapsedMs || existing?.elapsedMs,
            });
        }
        return Array.from(map.values());
    }, [agentRun.eventStream]);

    const plannedSteps = useMemo(() => {
        const fromEvents = [...(agentRun.eventStream || [])]
            .reverse()
            .find((event: any) => Array.isArray(event?.content?.plan?.steps) || Array.isArray(event?.content?.steps));

        const rawSteps = Array.isArray(fromEvents?.content?.plan?.steps)
            ? fromEvents?.content?.plan?.steps
            : Array.isArray(fromEvents?.content?.steps)
                ? fromEvents?.content?.steps
                : null;

        if (Array.isArray(rawSteps) && rawSteps.length > 0) {
            return rawSteps.map((step: any, idx: number) => ({
                index: typeof step?.index === "number" ? step.index : idx,
                toolName: String(step?.toolName || step?.tool_name || `step_${idx + 1}`),
                description: String(step?.description || ""),
            }));
        }

        if (Array.isArray(agentRun.steps) && agentRun.steps.length > 0) {
            return agentRun.steps.map((step, idx) => ({
                index: typeof step.stepIndex === "number" ? step.stepIndex : idx,
                toolName: String(step.toolName || `step_${idx + 1}`),
                description: "",
            }));
        }

        return [];
    }, [agentRun.eventStream, agentRun.steps]);

    const skillLoadSequence = useMemo(() => {
        const unique = new Set(
            plannedSteps
                .map((step) => String(step.toolName || "").trim())
                .filter(Boolean)
        );
        return Array.from(unique).map((tool) => tool.replace(/_/g, "-"));
    }, [plannedSteps]);

    const stepStatusByIndex = useMemo(() => {
        const map = new Map<number, string>();
        for (const step of agentRun.steps || []) {
            if (typeof step.stepIndex === "number") {
                map.set(step.stepIndex, String(step.status || ""));
            }
        }
        return map;
    }, [agentRun.steps]);

    const getPlannedStepVisualState = (stepIndex: number): "done" | "active" | "failed" | "pending" => {
        const status = (stepStatusByIndex.get(stepIndex) || "").toLowerCase();
        if (["succeeded", "success", "completed"].includes(status)) return "done";
        if (["failed", "error"].includes(status)) return "failed";
        if (["running", "in_progress"].includes(status)) return "active";

        if (isActive && stepIndex === agentRun.steps.find((s) => String(s.status).toLowerCase() === "running")?.stepIndex) {
            return "active";
        }
        return "pending";
    };

    const summaryText = typeof agentRun.summary === "string"
        ? agentRun.summary.trim()
        : "";

    const hasArtifacts = Array.isArray((agentRun as any).artifacts) && (agentRun as any).artifacts.length > 0;

    const progressPercentage = stepProgress.total > 0
        ? Math.min(100, (stepProgress.completed / stepProgress.total) * 100)
        : isActive
            ? 12
            : agentRun.status === "completed"
                ? 100
                : 0;

    const headerDescription = (() => {
        if (isCancelling) return "Cerrando la ejecución actual...";
        if (summaryText && agentRun.status === "completed") return summaryText;
        if (objective) return objective;
        if (isWaitingForResponse) return "Preparando el entorno y conectando herramientas.";
        if (isActive) return "Procesando la solicitud y actualizando el progreso en tiempo real.";
        if (agentRun.error) return agentRun.error;
        return "El agente organizó la solicitud y dejó un rastro compacto de ejecución.";
    })();

    const statusBadgeClass = (() => {
        switch (agentRun.status) {
            case "completed":
                return "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300";
            case "failed":
                return "border-red-200/80 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300";
            case "cancelled":
                return "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300";
            default:
                return "border-border/70 bg-muted/60 text-muted-foreground";
        }
    })();

    const progressBarClass = agentRun.status === "completed"
        ? "bg-emerald-500"
        : agentRun.status === "failed"
            ? "bg-red-500"
            : "bg-foreground";

    return (
        <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="agent-run-content">
            <div className="rounded-[22px] border border-border/60 bg-background/95 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.45)]">
                <div className="flex items-start gap-2 p-3 sm:p-4">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex-1 text-left transition-colors"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted/40">
                                <Bot className="h-4 w-4 text-foreground/70" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-foreground">
                                        Modo agente
                                    </span>
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                                            statusBadgeClass,
                                        )}
                                    >
                                        {getStatusIcon()}
                                        <span>{getStatusText()}</span>
                                    </span>
                                    {stepProgress.total > 0 && (
                                        <span className="text-[11px] text-muted-foreground">
                                            {stepProgress.completed}/{stepProgress.total} tareas
                                        </span>
                                    )}
                                </div>
                                <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                                    {headerDescription}
                                </p>
                                {(isActive || stepProgress.total > 0) && (
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                            <span>{isActive ? "Ejecución en curso" : "Ejecución finalizada"}</span>
                                            <span>{Math.round(progressPercentage)}%</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-muted/80 overflow-hidden">
                                            <div
                                                className={cn("h-full rounded-full transition-[width] duration-500", progressBarClass)}
                                                style={{ width: `${progressPercentage}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </button>

                    <div className="flex items-center gap-2 self-start">
                        {isCancellable && onCancel && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onCancel}
                                disabled={isCancelling}
                                className={cn(
                                    "h-9 rounded-full border border-border/60 px-3 text-xs",
                                    isCancelling
                                        ? "text-red-400 bg-red-50/60 dark:bg-red-950/30 cursor-not-allowed"
                                        : "text-muted-foreground hover:text-red-500 hover:bg-red-50/60 dark:hover:bg-red-950/30"
                                )}
                                data-testid="button-cancel-agent-header"
                            >
                                {isCancelling ? (
                                    <>
                                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        Cancelando
                                    </>
                                ) : (
                                    <>
                                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                        Cancelar
                                    </>
                                )}
                            </Button>
                        )}
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                            aria-label={isExpanded ? "Contraer modo agente" : "Expandir modo agente"}
                        >
                            <ChevronDown className={cn(
                                "h-4 w-4 transition-transform",
                                isExpanded && "rotate-180"
                            )} />
                        </button>
                    </div>
                </div>

                {isExpanded && (
                    <div className="space-y-4 px-3 pb-3 sm:px-4 sm:pb-4">
                    {/* Action buttons for runs */}
                    {showVerboseAgentInternals && (isCancellable || isPaused) && (
                        <div className="flex justify-end gap-2">
                            {isPaused && onResume && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onResume}
                                    className="text-xs text-muted-foreground hover:text-green-500"
                                    data-testid="button-resume-agent"
                                >
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Reanudar
                                </Button>
                            )}
                            {!isPaused && !isCancelling && isActive && onPause && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onPause}
                                    className="text-xs text-muted-foreground hover:text-yellow-500"
                                    data-testid="button-pause-agent"
                                >
                                    <Clock className="h-3 w-3 mr-1" />
                                    Pausar
                                </Button>
                            )}
                            {isCancellable && onCancel && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onCancel}
                                    disabled={isCancelling}
                                    className={cn(
                                        "text-xs",
                                        isCancelling
                                            ? "text-red-400 cursor-not-allowed"
                                            : "text-muted-foreground hover:text-red-500"
                                    )}
                                    data-testid="button-cancel-agent"
                                >
                                    {isCancelling ? (
                                        <>
                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                            Cancelando...
                                        </>
                                    ) : (
                                        <>
                                            <XCircle className="h-3 w-3 mr-1" />
                                            Cancelar
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    )}

                    {showVerboseAgentInternals && viewMode === "steps" && skillLoadSequence.length > 0 && (
                        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <Loader2 className={cn("h-3.5 w-3.5", isActive ? "animate-spin text-blue-500" : "text-muted-foreground")} />
                                Ejecutando tareas en paralelo
                            </div>
                            <div className="mt-2 space-y-1.5 border-l border-border/60 pl-3">
                                {skillLoadSequence.slice(0, 6).map((skill, idx) => {
                                    const isSkillDone = idx < stepProgress.completed;
                                    const isSkillActive = idx === stepProgress.completed && isActive;
                                    return (
                                        <div key={`${skill}-${idx}`} className="flex items-center gap-2 text-xs">
                                            {isSkillDone ? (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                            ) : isSkillActive ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                            ) : (
                                                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                            <span className="text-foreground/85">Loading skill {skill}</span>
                                        </div>
                                    );
                                })}
                                {skillLoadSequence.length > 6 && (
                                    <div className="text-[11px] text-muted-foreground">
                                        +{skillLoadSequence.length - 6} skills más
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Subagent Activity Panel */}
                    {subagents.length > 0 && (
                        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <Bot className="h-3.5 w-3.5 text-violet-500" />
                                Subagentes ({subagents.filter(s => s.status === "completed").length}/{subagents.length})
                            </div>
                            <div className="mt-2 space-y-1.5 border-l border-border/60 pl-3">
                                {subagents.map((sa) => {
                                    const isDone = sa.status === "completed";
                                    const isFailed = sa.status === "failed" || sa.status === "cancelled";
                                    const isRunning = sa.status === "running";
                                    return (
                                        <div key={sa.id} className="flex items-start gap-2 text-xs">
                                            {isDone ? (
                                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                                            ) : isFailed ? (
                                                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                                            ) : isRunning ? (
                                                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" />
                                            ) : (
                                                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <span className="text-foreground/85 line-clamp-1">{sa.objective}</span>
                                                {sa.error && (
                                                    <span className="text-red-500 line-clamp-1">{sa.error}</span>
                                                )}
                                                {sa.elapsedMs != null && isDone && (
                                                    <span className="text-muted-foreground"> ({Math.round(sa.elapsedMs / 1000)}s)</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {showVerboseAgentInternals && viewMode === "steps" && plannedSteps.length > 0 && (
                        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <List className="h-3.5 w-3.5 text-indigo-500" />
                                Configurando lista de tareas
                            </div>
                            <div className="mt-2 space-y-1.5 border-l border-border/60 pl-3">
                                {plannedSteps.slice(0, 10).map((step) => {
                                    const visualState = getPlannedStepVisualState(step.index);
                                    return (
                                        <div key={`${step.index}-${step.toolName}`} className="flex items-center gap-2 text-xs">
                                            {visualState === "done" ? (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                            ) : visualState === "active" ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                            ) : visualState === "failed" ? (
                                                <XCircle className="h-3.5 w-3.5 text-red-500" />
                                            ) : (
                                                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                            <span className="text-foreground/85 truncate">
                                                {step.description || getToolDisplayName(step.toolName)}
                                            </span>
                                        </div>
                                    );
                                })}
                                {plannedSteps.length > 10 && (
                                    <div className="text-[11px] text-muted-foreground">
                                        +{plannedSteps.length - 10} tareas más
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Plan Viewer */}
                    {viewMode === "plan" && agentRun.runId && (
                        <div className="border border-border/50 rounded-lg overflow-hidden">
                            <PlanViewer planId={agentRun.runId} />
                        </div>
                    )}

                    {/* Event timeline - compact and minimal */}
                    {mappedEvents.length > 0 && viewMode === "steps" && (
                        <div className="space-y-3" data-testid="agent-event-timeline">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
                                        <List className="h-3.5 w-3.5" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            Actividad reciente
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                            {mappedEvents.length} evento{mappedEvents.length === 1 ? "" : "s"} registrados
                                        </p>
                                    </div>
                                </div>
                                {hiddenEventsCount > 0 && !showAllEvents && (
                                    <button
                                        onClick={() => setShowAllEvents(true)}
                                        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                                        data-testid="button-show-all-events"
                                    >
                                        Ver {hiddenEventsCount} anteriores
                                    </button>
                                )}
                            </div>

                            <div className="relative pl-6">
                                <div className="absolute left-[9px] top-1 bottom-2 w-px bg-border/70" />
                                <div className="space-y-3">
                                    {visibleEvents.map((event, idx) => {
                                        const isLast = idx === visibleEvents.length - 1;
                                        const showDetails = hasPayloadDetails(event);
                                        const isShellCommand = event.payload?.toolName === 'shell_command' || event.payload?.tool === 'shell_command' || event.payload?.type === 'shell_command' || event.title?.toLowerCase().includes('comando');

                                        return (
                                            <div
                                                key={event.id}
                                                className="relative"
                                                data-testid={`agent-event-${event.kind}-${event.status}`}
                                            >
                                                <div className="absolute -left-6 top-3 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border/70 bg-background">
                                                    {getEventIcon(event)}
                                                </div>
                                                <div className={cn(
                                                    "rounded-2xl border px-3.5 py-3 shadow-sm transition-all",
                                                    isLast && isActive
                                                        ? "border-foreground/15 bg-muted/20"
                                                        : "border-border/60 bg-background/70"
                                                )}>
                                                    <div className="flex items-start gap-2">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <p className="text-[13px] font-medium leading-5 text-foreground">
                                                                    {event.title}
                                                                </p>
                                                                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                                                    {event.ui.label}
                                                                </span>
                                                                {isLast && isActive && (
                                                                    <Loader2 className="h-3 w-3 animate-spin text-foreground/70" />
                                                                )}
                                                            </div>
                                                            {event.summary && !isShellCommand && (
                                                                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                                                                    {event.summary}
                                                                </p>
                                                            )}

                                                            {isShellCommand && event.payload?.command && (
                                                                <div className="mt-2">
                                                                    <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                                                        Comando
                                                                    </span>
                                                                    <div className="overflow-x-auto rounded-xl border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs text-foreground/85">
                                                                        {event.payload.command}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {showDetails && !isShellCommand && (
                                                                <Collapsible className="mt-2" defaultOpen={isLast && isActive}>
                                                                    <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                                                                        <ChevronDown className="h-3 w-3" />
                                                                        Detalles
                                                                    </CollapsibleTrigger>
                                                                    <CollapsibleContent>
                                                                        <div className="mt-2">
                                                                            <JsonArgumentsViewer
                                                                                args={event.payload}
                                                                                title=""
                                                                                defaultExpanded={true}
                                                                                className="rounded-xl border border-border/60 bg-muted/20 shadow-none"
                                                                            />
                                                                        </div>
                                                                    </CollapsibleContent>
                                                                </Collapsible>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div ref={eventsEndRef} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Steps progress - fallback if no event stream */}
                    {(!agentRun.eventStream || agentRun.eventStream.length === 0) && agentRun.steps && agentRun.steps.length > 0 && (
                        <div className="space-y-3 pl-2 border-l-2 border-purple-500/20">
                            {agentRun.steps.map((step, idx) => {
                                let status: ToolStatus = "running";
                                if (step.status === "succeeded" || step.status === "completed" || step.status === "success") status = "succeeded";
                                else if (step.status === "failed" || step.status === "error") status = "failed";
                                else if (step.status === "requires_confirmation" || step.status === "pending_approval") status = "requires_confirmation";

                                return (
                                    <ToolInvocationCard
                                        key={idx}
                                        toolName={step.toolName}
                                        status={status}
                                        input={step.output?.input || step.output /* fallback depending on structure */}
                                        output={step.status === "succeeded" ? step.output : undefined}
                                        error={step.error}
                                        onConfirm={() => onToolConfirm?.(step.toolName, step.stepIndex)}
                                        onDeny={() => onToolDeny?.(step.toolName, step.stepIndex)}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {/* Loading skeleton for starting state */}
                    {isActive && (!agentRun.eventStream || agentRun.eventStream.length === 0) && (!agentRun.steps || agentRun.steps.length === 0) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border/50 rounded-md px-3 py-2 bg-background/70">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>
                                {agentRun.status === "starting" && "Conectando con IA..."}
                                {agentRun.status === "queued" && "En cola..."}
                                {agentRun.status === "planning" && "Planificando..."}
                                {agentRun.status === "running" && "Ejecutando..."}
                                {agentRun.status === "verifying" && "Verificando..."}
                                {agentRun.status === "replanning" && "Ajustando plan..."}
                                {!["starting", "queued", "planning", "running", "verifying", "replanning"].includes(agentRun.status) && "Procesando..."}
                            </span>
                            {isSlowConnection && (
                                <span className="text-yellow-600 dark:text-yellow-400">
                                    ({waitingSeconds}s)
                                </span>
                            )}
                        </div>
                    )}

                    {/* Rich artifacts display only when a run actually produced artifacts */}
                    {agentRun.status === "completed" && hasArtifacts && agentRun.steps && agentRun.steps.length > 0 && (
                        <div className="mt-3">
                            <AgentStepsDisplay
                                steps={agentRun.steps.map(step => ({
                                    ...step,
                                    status: (step.status === 'completed' || step.status === 'succeeded' || step.status === 'success')
                                        ? 'succeeded' as const
                                        : (step.status === 'failed' || step.status === 'error')
                                            ? 'failed' as const
                                            : (step.status === 'running' || step.status === 'in_progress')
                                                ? 'running' as const
                                                : 'pending' as const
                                }))}
                                summary={agentRun.summary}
                                artifacts={(agentRun as any).artifacts}
                                isRunning={false}
                                onDocumentClick={(artifact) => {
                                    if (onArtifactPreview) {
                                        onArtifactPreview(artifact);
                                    }
                                }}
                                onImageExpand={(imageUrl) => {
                                    onOpenLightbox?.(imageUrl);
                                }}
                                onDownload={(artifact) => {
                                    if (artifact.data?.base64) {
                                        const byteCharacters = atob(artifact.data.base64);
                                        const byteNumbers = new Array(byteCharacters.length);
                                        for (let i = 0; i < byteCharacters.length; i++) {
                                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                                        }
                                        const byteArray = new Uint8Array(byteNumbers);
                                        const blob = new Blob([byteArray], { type: artifact.mimeType || 'application/octet-stream' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = artifact.name;
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                        URL.revokeObjectURL(url);
                                    }
                                }}
                            />
                        </div>
                    )}

                    {/* Summary/Response - keep it clean and readable after completion */}
                    {summaryText && agentRun.status === "completed" && (
                        <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3">
                            <div className="mb-2 flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    Resultado final
                                </span>
                            </div>
                            <div className="prose prose-sm max-w-none leading-relaxed dark:prose-invert">
                                <MarkdownErrorBoundary key={`agent-summary-${summaryText.length}`} fallbackContent={summaryText}>
                                    <MarkdownRenderer content={summaryText} />
                                </MarkdownErrorBoundary>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Only re-render if deep equality check fails or if visible state changes
    // Simplified comparison for performance
    return JSON.stringify(prevProps.agentRun) === JSON.stringify(nextProps.agentRun);
});
