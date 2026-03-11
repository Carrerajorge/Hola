
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
    Target,
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
        status: "idle" | "starting" | "running" | "completed" | "failed" | "cancelled" | "queued" | "planning" | "verifying" | "paused" | "cancelling" | "replanning" | "awaiting_confirmation";
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
    onRetry,
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
    const [viewMode, setViewMode] = useState<"steps" | "plan">("steps");
    const eventsEndRef = useRef<HTMLDivElement>(null);

    const isAwaitingConfirmation = agentRun.status === "awaiting_confirmation";
    const isCancellable = ["starting", "running", "queued", "planning", "verifying", "paused", "replanning", "awaiting_confirmation"].includes(agentRun.status);
    const isActive = ["starting", "running", "queued", "planning", "verifying", "cancelling", "replanning", "awaiting_confirmation"].includes(agentRun.status);
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
            case "awaiting_confirmation":
                return <AlertCircle className="h-4 w-4 text-amber-500" />;
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
            case "awaiting_confirmation": return "Esperando confirmaci?n";
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

    return (
        <div className="flex flex-col gap-2 w-full animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="agent-run-content">
            {/* Header with cancel button prominently displayed */}
            <div className="flex items-start gap-2">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-border/60 bg-background/70 hover:bg-muted/30 transition-all text-left"
                >
                    <Bot className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Modo agente</span>
                    <div className="flex-1" />
                    {showVerboseAgentInternals && agentRun.runId && (
                        <div className="flex bg-background/50 rounded-md p-0.5 mr-2" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setViewMode("steps")}
                                className={cn(
                                    "px-2 py-0.5 text-xs rounded transition-colors",
                                    viewMode === "steps" ? "bg-white dark:bg-zinc-700 shadow-sm font-medium" : "text-muted-foreground hover:bg-white/50 dark:hover:bg-zinc-700/50"
                                )}
                            >
                                Pasos
                            </button>
                            <button
                                onClick={() => setViewMode("plan")}
                                className={cn(
                                    "px-2 py-0.5 text-xs rounded transition-colors",
                                    viewMode === "plan" ? "bg-white dark:bg-zinc-700 shadow-sm font-medium" : "text-muted-foreground hover:bg-white/50 dark:hover:bg-zinc-700/50"
                                )}
                            >
                                Plan
                            </button>
                        </div>
                    )}
                    {getStatusIcon()}
                    <span className="text-xs text-muted-foreground">{getStatusText()}</span>
                    <ChevronDown className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        isExpanded && "rotate-180"
                    )} />
                </button>

                {/* Prominent Cancel Button - always visible when active */}
                {isCancellable && onCancel && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                        disabled={isCancelling}
                        className={cn(
                            "shrink-0 h-10 px-3 border border-border/60",
                            isCancelling
                                ? "text-red-400 bg-red-50/50 dark:bg-red-900/20 cursor-not-allowed"
                                : "text-muted-foreground hover:text-red-500 hover:bg-red-50/50 dark:hover:bg-red-900/20"
                        )}
                        data-testid="button-cancel-agent-header"
                    >
                        {isCancelling ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                Cancelando
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4 mr-1.5" />
                                Cancelar
                            </>
                        )}
                    </Button>
                )}
            </div>

            {/* Objective display - show what the agent is working on */}
            {objective && isActive && showVerboseAgentInternals && (
                <div className="px-3 py-2 bg-purple-500/5 rounded-lg border border-purple-500/10">
                    <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400 font-medium uppercase tracking-wide mb-1">
                        <Target className="h-3 w-3" />
                        Objetivo
                    </div>
                    <p className="text-sm text-foreground line-clamp-2">{objective}</p>
                    {stepProgress.total > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-purple-500/20 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500 w-[var(--step-width)]"
                                    ref={(el) => { if (el) el.style.setProperty('--step-width', `${Math.min(100, (stepProgress.completed / stepProgress.total) * 100)}%`); }}
                                />
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                                {stepProgress.completed}/{stepProgress.total}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {isExpanded && (
                <div className="space-y-3">
                    {isAwaitingConfirmation && (onToolConfirm || onToolDeny) && (
                        <div className="rounded-lg border border-amber-300/40 bg-amber-50/70 px-3 py-3 dark:border-amber-500/30 dark:bg-amber-950/20">
                            <div className="flex items-start gap-2">
                                <AlertCircle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground">Confirmaci?n requerida</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Esta acci?n necesita tu aprobaci?n antes de que el agente siga con el control del navegador o del equipo.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-3 flex gap-2">
                                {onToolConfirm && (
                                    <Button size="sm" onClick={() => onToolConfirm('pending_confirmation', -1)} className="h-8">
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                        Confirmar
                                    </Button>
                                )}
                                {onToolDeny && (
                                    <Button size="sm" variant="outline" onClick={() => onToolDeny('pending_confirmation', -1)} className="h-8">
                                        <XCircle className="h-3.5 w-3.5 mr-1.5" />
                                        Rechazar
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}

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

                    {/* Event timeline - Claude style with grouped human-readable cards */}
                    {mappedEvents.length > 0 && viewMode === "steps" && (
                        <div className="relative mt-2" data-testid="agent-event-timeline">
                            <Collapsible defaultOpen={true} className="w-full">
                                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors py-2 w-full text-left group">
                                    <div className="w-5 h-5 rounded flex items-center justify-center bg-muted/50 text-muted-foreground">
                                        <List className="h-3.5 w-3.5" />
                                    </div>
                                    <span>Ejecutando tareas en paralelo</span>
                                    <ChevronDown className="h-3.5 w-3.5 ml-1 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                                </CollapsibleTrigger>
                                <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
                                    {hiddenEventsCount > 0 && !showAllEvents && (
                                        <button
                                            onClick={() => setShowAllEvents(true)}
                                            className="text-xs text-muted-foreground hover:text-foreground mb-3 ml-7 flex items-center gap-1"
                                            data-testid="button-show-all-events"
                                        >
                                            <ChevronDown className="h-3 w-3" />
                                            Ver {hiddenEventsCount} eventos anteriores
                                        </button>
                                    )}
                                    <div className="space-y-2.5 pl-7 ml-2.5 border-l-2 border-border/40 mt-2 pb-2">
                                        {visibleEvents.map((event, idx) => {
                                            const isLast = idx === visibleEvents.length - 1;
                                            const showDetails = hasPayloadDetails(event);
                                            const isShellCommand = event.payload?.toolName === 'shell_command' || event.payload?.tool === 'shell_command' || event.payload?.type === 'shell_command' || event.title?.toLowerCase().includes('comando');

                                            return (
                                                <div
                                                    key={event.id}
                                                    className={cn(
                                                        "flex items-start gap-3 text-sm py-1 transition-all",
                                                        isLast && isActive && "opacity-100",
                                                        !isLast && "opacity-80 hover:opacity-100"
                                                    )}
                                                    data-testid={`agent-event-${event.kind}-${event.status}`}
                                                >
                                                    <div className={cn(
                                                        "w-[18px] h-[18px] mt-0.5 flex items-center justify-center flex-shrink-0",
                                                        event.ui.iconColor
                                                    )}>
                                                        {getEventIcon(event)}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <p className="text-foreground text-[13px] break-words leading-relaxed font-medium">
                                                                {event.title}
                                                            </p>
                                                            {event.status === 'ok' && event.kind !== 'action' && (
                                                                <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
                                                            )}
                                                            {isLast && isActive && (
                                                                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                                            )}
                                                        </div>
                                                        {event.summary && !isShellCommand && (
                                                            <p className="text-muted-foreground text-xs mt-0.5 break-words leading-relaxed">
                                                                {event.summary}
                                                            </p>
                                                        )}

                                                        {/* Specialized blocks for Shell/Terminal output styled like the UI mockup */}
                                                        {isShellCommand && event.payload?.command && (
                                                            <div className="mt-2 text-xs">
                                                                <span className="text-muted-foreground mb-1 block">Running command:</span>
                                                                <div className="bg-[#F8F9FA] dark:bg-zinc-900 border border-border/40 rounded-md p-3 font-mono text-xs overflow-x-auto text-foreground/80">
                                                                    {event.payload.command}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {showDetails && !isShellCommand && (
                                                            <Collapsible className="mt-1" defaultOpen={isLast && isActive}>
                                                                <CollapsibleTrigger className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 py-1">
                                                                    <ChevronDown className="h-3 w-3" />
                                                                    Detalles
                                                                </CollapsibleTrigger>
                                                                <CollapsibleContent>
                                                                    <div className="mt-1.5">
                                                                        <JsonArgumentsViewer
                                                                            args={event.payload}
                                                                            title=""
                                                                            defaultExpanded={true}
                                                                            className="bg-[#F8F9FA] dark:bg-zinc-900 border border-border/40 shadow-none rounded-md"
                                                                        />
                                                                    </div>
                                                                </CollapsibleContent>
                                                            </Collapsible>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        <div ref={eventsEndRef} />
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>
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

                    {/* Claude-style steps display for completed runs */}
                    {agentRun.status === "completed" && agentRun.steps && agentRun.steps.length > 0 && (
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

                    {/* Summary/Response - show when completed but no steps */}
                    {agentRun.summary && agentRun.status === "completed" && (!agentRun.steps || agentRun.steps.length === 0) && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                            <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                                <MarkdownErrorBoundary key={`agent-summary-${agentRun.summary.length}`} fallbackContent={agentRun.summary}>
                                    <MarkdownRenderer content={agentRun.summary} />
                                </MarkdownErrorBoundary>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    // Only re-render if deep equality check fails or if visible state changes
    // Simplified comparison for performance
    return JSON.stringify(prevProps.agentRun) === JSON.stringify(nextProps.agentRun);
});
