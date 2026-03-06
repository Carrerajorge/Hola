import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers3,
  Sparkles,
} from "lucide-react";

interface SuperAgentSummaryCardProps {
  metadata?: Record<string, any>;
}

const statusVariant = (success: boolean | null | undefined, failedTasks: number): "success" | "warning" | "secondary" => {
  if (success === true && failedTasks === 0) return "success";
  if (failedTasks > 0 || success === false) return "warning";
  return "secondary";
};

export function SuperAgentSummaryCard({ metadata }: SuperAgentSummaryCardProps) {
  const agenticMetadata = metadata?.agenticMetadata;
  if (!metadata?.wasAgentTask && agenticMetadata?.mode !== "orchestrated") {
    return null;
  }

  const [expanded, setExpanded] = useState(false);
  const complexity = String(agenticMetadata?.complexity || "unknown");
  const runId = String(metadata?.agentRunId || agenticMetadata?.runId || "").trim();
  const waveCount = Number(agenticMetadata?.waveCount || 0);
  const completedTasks = Number(agenticMetadata?.completedTasks || 0);
  const failedTasks = Number(agenticMetadata?.failedTasks || 0);
  const pipelineSteps = Number(metadata?.pipelineSteps || 0);
  const pipelineSuccess = typeof metadata?.pipelineSuccess === "boolean" ? metadata.pipelineSuccess : null;
  const suggestedAgents = Array.isArray(agenticMetadata?.suggestedAgents)
    ? agenticMetadata.suggestedAgents.filter(Boolean).slice(0, 6)
    : [];
  const subtasks = Array.isArray(agenticMetadata?.subtasks)
    ? agenticMetadata.subtasks.slice(0, expanded ? 12 : 5)
    : [];
  const artifactFiles = Array.isArray(agenticMetadata?.artifacts?.files)
    ? agenticMetadata.artifacts.files.slice(0, expanded ? 8 : 4)
    : [];

  return (
    <div className="w-full rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-4 shadow-sm dark:border-sky-900/60 dark:from-slate-950 dark:via-slate-950 dark:to-cyan-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Modo superagente</p>
                <Sparkles className="h-3.5 w-3.5 text-sky-600" />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Planificaci{String.fromCharCode(243)}n por fases, ejecuci{String.fromCharCode(243)}n multiagente y seguimiento del run.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="info">Complejidad: {complexity}</Badge>
            {waveCount > 0 && <Badge variant="secondary">{waveCount} fases</Badge>}
            {pipelineSteps > 0 && <Badge variant="secondary">{pipelineSteps} subtareas</Badge>}
            <Badge variant={statusVariant(pipelineSuccess, failedTasks)}>
              {failedTasks > 0 ? `${completedTasks} OK / ${failedTasks} fallidas` : "ejecuci\u00f3n estable"}
            </Badge>
          </div>
        </div>

        {runId && (
          <Button asChild size="sm" variant="outline" className="gap-2 border-sky-200 bg-white/70 hover:bg-sky-50 dark:border-sky-900 dark:bg-slate-950/50 dark:hover:bg-slate-900">
            <a href={`/runs/${runId}/progress`}>
              Ver run
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>

      {(suggestedAgents.length > 0 || runId) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
          {runId && (
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-500">
              run: {runId}
            </span>
          )}
          {suggestedAgents.length > 0 && (
            <span>
              agentes: <span className="font-medium text-slate-800 dark:text-slate-200">{suggestedAgents.join(", ")}</span>
            </span>
          )}
        </div>
      )}

      {(subtasks.length > 0 || artifactFiles.length > 0) && (
        <div className="mt-4 rounded-xl border border-sky-100 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setExpanded((current) => !current)}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              <Layers3 className="h-4 w-4 text-sky-600" />
              Plan operativo
            </div>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-slate-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-500" />
            )}
          </button>

          <div className="mt-3 space-y-3">
            {subtasks.length > 0 && (
              <div className="space-y-2">
                {subtasks.map((task: any) => {
                  const label = String(task?.description || task?.id || "Subtarea");
                  const lane = String(task?.lane || "brain");
                  const status = String(task?.status || "pending");
                  return (
                    <div
                      key={`${task?.id || label}-${lane}`}
                      className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-slate-900 dark:text-slate-100">{label}</p>
                        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{lane}</p>
                      </div>
                      <Badge
                        variant={status === "completed" ? "success" : status === "failed" ? "warning" : "secondary"}
                        className={cn("shrink-0", status === "failed" && "text-amber-950")}
                      >
                        {status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}

            {artifactFiles.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Artifacts
                </p>
                {artifactFiles.map((file: string) => (
                  <p key={file} className="truncate text-sm text-slate-700 dark:text-slate-300">
                    {file}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
