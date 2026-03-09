import type { ComplexityLevel } from "../agent/orchestration";
import type {
  CombinedOrchestrationResult,
  OrchestrationExecutionResult,
  OrchestrationPlan,
  OrchestrationSubtask,
} from "./orchestrationEngine";

export interface SuperAgentContext {
  hasAttachments: boolean;
  hasActiveDocuments: boolean;
  conversationLength: number;
}

export interface SuperAgentAnalysis {
  complexity: ComplexityLevel;
  intent?: string;
  deliverables?: Array<{ type?: string }>;
  suggestedAgents?: string[];
}

const SIMPLE_MESSAGE_PATTERNS = [
  /^(hola|hello|hi|hey|buenos?\s+d[ií]as?|buenas?\s+tardes?|buenas?\s+noches?)$/i,
  /^(gracias|thanks|ok|sí|si|no|claro|vale|perfecto)$/i,
];

const SUPER_AGENT_KEYWORDS = [
  /\b(super\s*agente|superagent|aut[oó]nomo|autonomous)\b/i,
  /\b(planifica|plan|orquesta|orchestrate|coordina|coordinate)\b/i,
  /\b(monitorea|monitor|supervisa|supervise|background|segundo\s+plano)\b/i,
  /\b(workflow|flujo|automatiza|automatizar|automation)\b/i,
  /\b(investiga|research|deep\s+dive|analiza\s+a\s+fondo)\b/i,
  /\b(conecta|integrate|gmail|slack|notion|calendar)\b/i,
  /\b(navegador|browser|scrape|extrae|extract)\b/i,
];

const COMPLEX_SEQUENCE_PATTERNS = [
  /\b(primero|segundo|tercero|luego|despu[eé]s|then|after)\b/i,
  /\b(y|and)\b.*\b(luego|then|despu[eé]s|finally)\b/i,
  /\b(multi-?step|múltiples?\s+pasos?|varias?\s+tareas?)\b/i,
];

const ORCHESTRATION_INTENTS = new Set([
  "multi_step_task",
  "research",
  "data_analysis",
  "code_generation",
  "presentation_creation",
  "spreadsheet_creation",
  "web_automation",
]);

const RESULT_SUMMARY_KEYS = ["summary", "message", "content", "result", "status", "title"] as const;

export function looksLikeSuperAgentRequest(
  message: string,
  context: SuperAgentContext,
): boolean {
  const normalized = String(message || "").trim();
  if (!normalized) {
    return false;
  }
  if (SIMPLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  if (context.hasAttachments && context.hasActiveDocuments) {
    return false;
  }
  if (SUPER_AGENT_KEYWORDS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (COMPLEX_SEQUENCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const clauseCount = (normalized.match(/[,;:]/g) || []).length;
  return wordCount >= 20 && (clauseCount >= 2 || context.conversationLength >= 6);
}

export function shouldUseSuperAgentOrchestration(params: {
  message: string;
  context: SuperAgentContext;
  analysis: SuperAgentAnalysis;
}): boolean {
  if (!looksLikeSuperAgentRequest(params.message, params.context)) {
    return false;
  }

  const deliverableCount = params.analysis.deliverables?.length ?? 0;
  const suggestedAgentCount = params.analysis.suggestedAgents?.length ?? 0;
  const normalizedIntent = String(params.analysis.intent || "").trim().toLowerCase();

  if (params.analysis.complexity === "complex" || params.analysis.complexity === "expert") {
    return true;
  }
  if (ORCHESTRATION_INTENTS.has(normalizedIntent) && params.analysis.complexity !== "simple") {
    return true;
  }
  if (deliverableCount >= 2) {
    return true;
  }
  if (suggestedAgentCount >= 3) {
    return true;
  }
  return (
    params.analysis.complexity === "moderate" &&
    (deliverableCount >= 1 || suggestedAgentCount >= 2)
  );
}

export function mapComplexityToOrchestrationLevel(level: ComplexityLevel): number {
  switch (level) {
    case "trivial":
      return 1;
    case "simple":
      return 2;
    case "moderate":
      return 4;
    case "complex":
      return 7;
    case "expert":
      return 9;
    default:
      return 3;
  }
}

function summarizeTask(task: OrchestrationSubtask): string {
  const status =
    task.status === "completed"
      ? "completada"
      : task.status === "failed"
        ? "fallida"
        : task.status === "running"
          ? "en ejecución"
          : task.status;
  return `${task.description} (${status})`;
}

function summarizeResultValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().slice(0, 220);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} elemento(s)`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of RESULT_SUMMARY_KEYS) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim().slice(0, 220);
      }
    }
    if (record.scheduled === true) {
      return "programado correctamente";
    }
    const keys = Object.keys(record).slice(0, 4);
    return keys.length > 0 ? `resultado estructurado (${keys.join(", ")})` : "resultado estructurado";
  }
  return "sin detalle textual";
}

export function formatSuperAgentResponse(params: {
  objective: string;
  plan: OrchestrationPlan;
  execution: OrchestrationExecutionResult;
  combined: CombinedOrchestrationResult;
  analysis: SuperAgentAnalysis;
}): string {
  const waveLines = params.plan.waves
    .slice(0, 4)
    .map((wave, index) => `- Fase ${index + 1}: ${wave.map((task) => task.description).join("; ")}`)
    .join("\n");

  const resultLines = Object.entries(params.combined.results)
    .slice(0, 4)
    .map(([taskId, value]) => `- ${taskId}: ${summarizeResultValue(value)}`)
    .join("\n");

  const failedLines =
    params.execution.subtasks
      ?.filter((task) => task.status === "failed")
      .slice(0, 3)
      .map((task) => `- ${summarizeTask(task)}${task.error ? `: ${task.error}` : ""}`)
      .join("\n") ?? "";

  const artifactLines =
    params.combined.artifacts?.files?.slice(0, 5).map((file) => `- ${file}`).join("\n") ?? "";

  const suggestedAgents = params.analysis.suggestedAgents?.slice(0, 5).join(", ") || "n/a";
  const outcomeLine =
    params.combined.status === "completed"
      ? "Ejecución completada."
      : params.combined.status === "partial"
        ? "Ejecución parcial: hay resultados útiles y algunas tareas fallaron."
        : "Ejecución fallida.";

  return [
    "Ejecuté esta solicitud en modo superagente con planificación y ejecución por fases.",
    "",
    `Objetivo: ${params.objective}`,
    `Complejidad: ${params.analysis.complexity}`,
    `Agentes sugeridos: ${suggestedAgents}`,
    `Run ID: ${params.execution.runId ?? "n/a"}`,
    outcomeLine,
    "",
    "Plan:",
    waveLines || "- Sin fases planificadas.",
    "",
    "Resultados clave:",
    resultLines || "- Sin resultados resumibles.",
    failedLines ? "" : "",
    failedLines ? "Fallos:" : "",
    failedLines || "",
    artifactLines ? "" : "",
    artifactLines ? "Artifacts:" : "",
    artifactLines || "",
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}
