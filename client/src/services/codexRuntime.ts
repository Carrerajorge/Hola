import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@/hooks/use-projects";
import {
  type OpenClawWorkspaceContext,
  normalizeOpenClawWorkspaceContext,
} from "@shared/openclawWorkspaceContext";

export type CodexExecutionProfile = "standard" | "marathon_12h" | "marathon_24h";
export type CodexAgentRole = "coder" | "reviewer" | "improver";
export type CodexSubagentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface CodexExecutionProfileOption {
  value: CodexExecutionProfile;
  label: string;
  shortLabel: string;
  runtimeLabel: string;
  checkpointLabel: string;
  resilienceLabel: string;
  promptDirective: string;
  subagentDirective: string;
}

export const CODEX_EXECUTION_PROFILE_OPTIONS: readonly CodexExecutionProfileOption[] = [
  {
    value: "standard",
    label: "Estándar",
    shortLabel: "Normal",
    runtimeLabel: "Ventana estándar",
    checkpointLabel: "Cierre único al final",
    resilienceLabel: "Sin cadena prolongada",
    promptDirective: "Perfil operativo: ejecución estándar con foco en completar la tarea de punta a punta.",
    subagentDirective: "Trabaja con autonomía normal y foco en entregar una contribución técnica útil.",
  },
  {
    value: "marathon_12h",
    label: "Marathon 12h",
    shortLabel: "12h",
    runtimeLabel: "Cadena 12h",
    checkpointLabel: "Checkpoint cada entrega",
    resilienceLabel: "Replanificación extendida",
    promptDirective:
      "Perfil operativo: modo intensivo de 12 horas. Trabaja por lotes, valida tus cambios y deja continuidad clara para el siguiente ciclo.",
    subagentDirective:
      "Trabaja con mentalidad de ventana intensiva de 12 horas: autonomía alta, verificación frecuente y entregables parciales claros.",
  },
  {
    value: "marathon_24h",
    label: "Marathon 24h",
    shortLabel: "24h",
    runtimeLabel: "Cadena 24h",
    checkpointLabel: "Checkpoint cada 60-90 min",
    resilienceLabel: "Auto-recuperación y handoff",
    promptDirective:
      "Perfil operativo: cadena continua de 24 horas para programación extrema. Divide el trabajo en fases, deja checkpoints verificables, genera handoff notes al cerrar cada bloque y prioriza recuperación automática ante fallos.",
    subagentDirective:
      "Trabaja como parte de una cadena de 24 horas: entrega avances verificables, deja contexto reanudable, registra riesgos y prepara el siguiente tramo si no puedes cerrar todo en este ciclo.",
  },
] as const;

export interface CodexSubagentRun {
  id: string;
  requesterUserId: string;
  objective: string;
  planHint: string[];
  parentRunId?: string;
  executionProfile?: CodexExecutionProfile;
  workspaceContext?: OpenClawWorkspaceContext;
  status: CodexSubagentStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: unknown;
  error?: string;
}

interface CreateCodexRunParams {
  chatId?: string | null;
  message: string;
  project?: Project | null;
  executionProfile?: CodexExecutionProfile;
  marathonMode?: boolean;
  branchName?: string | null;
}

interface SpawnCodexSubagentsParams {
  runId: string;
  message: string;
  project?: Project | null;
  executionProfile?: CodexExecutionProfile;
  marathonMode?: boolean;
  maxSubagents?: number;
  branchName?: string | null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveExecutionProfile(
  executionProfile?: CodexExecutionProfile,
  marathonMode?: boolean,
): CodexExecutionProfile {
  if (executionProfile) return executionProfile;
  return marathonMode ? "marathon_12h" : "standard";
}

export function getCodexExecutionProfileOption(
  profile?: CodexExecutionProfile | null,
): CodexExecutionProfileOption {
  return CODEX_EXECUTION_PROFILE_OPTIONS.find((option) => option.value === profile) || CODEX_EXECUTION_PROFILE_OPTIONS[0];
}

function buildWorkspaceSummary(project?: Project | null, branchName?: string | null): string {
  if (!project) return "";

  const lines = [
    `Proyecto: ${project.name}`,
    project.repositoryPath ? `Repositorio: ${project.repositoryPath}` : null,
    branchName ? `Rama activa: ${branchName}` : null,
    project.defaultCodeFolder ? `Carpeta base: ${project.defaultCodeFolder}` : null,
    project.systemPrompt ? `Prompt base del workspace: ${project.systemPrompt}` : null,
    project.files.length > 0
      ? `Archivos de contexto: ${project.files
          .slice(0, 8)
          .map((file) => file.name)
          .join(", ")}`
      : null,
  ];

  return lines.filter(Boolean).join("\n");
}

function buildOpenClawWorkspaceContext(
  project?: Project | null,
  branchName?: string | null,
): OpenClawWorkspaceContext | undefined {
  if (!project?.repositoryPath) return undefined;

  return normalizeOpenClawWorkspaceContext({
    projectId: project.id,
    projectName: project.name,
    repositoryPath: project.repositoryPath,
    selectedFolder: project.defaultCodeFolder || ".",
    codingAgents: project.codingAgents || ["coder"],
    runtimeTarget: "Local",
    executionAccess: "Full access",
    branch: branchName || undefined,
  });
}

async function registerOpenClawSessionContext(
  runId: string,
  workspaceContext?: OpenClawWorkspaceContext,
): Promise<void> {
  if (!workspaceContext) return;

  try {
    await apiRequest("POST", `/api/openclaw/runtime/session-context/${encodeURIComponent(runId)}`, {
      workspaceContext,
    });
  } catch (error) {
    console.warn("[codexRuntime] Failed to register OpenClaw session context", error);
  }
}

export function buildCodexPrompt(params: {
  message: string;
  project?: Project | null;
  executionProfile?: CodexExecutionProfile;
  marathonMode?: boolean;
  branchName?: string | null;
}): string {
  const profile = resolveExecutionProfile(params.executionProfile, params.marathonMode);
  const profileOption = getCodexExecutionProfileOption(profile);
  const workspaceSummary = buildWorkspaceSummary(params.project, params.branchName);
  const operationalRules =
    profile === "marathon_24h"
      ? [
          "Mantén una cadena operativa de hasta 24 horas sin perder contexto.",
          "Después de cada bloque importante, deja checkpoint, estado actual, siguiente paso y comando de verificación sugerido.",
          "Si detectas riesgo o bloqueo, replantea el plan y conserva un handoff corto para retomar sin fricción.",
        ]
      : profile === "marathon_12h"
        ? [
            "Trabaja por bloques largos con validación frecuente.",
            "Deja continuidad clara para la siguiente iteración si no cierras toda la tarea.",
          ]
        : ["Prioriza completar la tarea con la menor complejidad operativa posible."];

  return [
    "Actúa como un agente de ingeniería tipo Codex de OpenAI, ejecutado de forma segura sobre OpenClaw dentro de ILIAGPT.",
    profileOption.promptDirective,
    workspaceSummary ? `Contexto del workspace:\n${workspaceSummary}` : null,
    `Reglas operativas:\n- ${operationalRules.join("\n- ")}`,
    "Objetivo principal del usuario:",
    params.message.trim(),
    "Si modificas código, termina con un resumen corto, riesgos detectados y verificación ejecutada.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function resolveAgentRoles(project?: Project | null, maxSubagents = 3): CodexAgentRole[] {
  const roles = (project?.codingAgents?.length ? project.codingAgents : ["coder", "reviewer"]) as CodexAgentRole[];
  return Array.from(new Set(roles)).slice(0, Math.max(1, maxSubagents));
}

function buildSubagentObjective(params: {
  role: CodexAgentRole;
  message: string;
  project?: Project | null;
  executionProfile?: CodexExecutionProfile;
  marathonMode?: boolean;
  branchName?: string | null;
}): string {
  const profile = resolveExecutionProfile(params.executionProfile, params.marathonMode);
  const profileOption = getCodexExecutionProfileOption(profile);
  const workspaceSummary = buildWorkspaceSummary(params.project, params.branchName);

  const roleInstruction =
    params.role === "coder"
      ? "Rol: Implementador. Propón y ejecuta la solución principal, priorizando cambios completos y funcionales."
      : params.role === "reviewer"
        ? "Rol: Revisor. Busca bugs, regresiones, riesgos de diseño, deuda técnica y pruebas faltantes."
        : "Rol: Mejorador. Identifica mejoras de DX, legibilidad, rendimiento y simplificación del flujo.";

  const extraProfileRule =
    profile === "marathon_24h"
      ? "Antes de cerrar, deja una nota breve con checkpoint, estado del código y siguiente movimiento más seguro."
      : "Devuelve hallazgos accionables o una propuesta concreta de cambio.";

  return [
    roleInstruction,
    profileOption.subagentDirective,
    workspaceSummary ? `Workspace:\n${workspaceSummary}` : null,
    "Objetivo base del usuario:",
    params.message.trim(),
    extraProfileRule,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createChatForCodex(message: string): Promise<string> {
  const response = await apiRequest("POST", "/api/chats", {
    title: truncate(message.trim() || "Nueva sesión Codex", 56),
    model: "gemini-3-flash-preview",
    provider: "google",
  });
  const payload = await response.json();
  return String(payload.id);
}

export async function createCodexRun(params: CreateCodexRunParams): Promise<{
  runId: string;
  chatId: string;
  prompt: string;
}> {
  const trimmedMessage = params.message.trim();
  if (!trimmedMessage) {
    throw new Error("Describe la tarea antes de lanzar el agente Codex.");
  }

  const executionProfile = resolveExecutionProfile(params.executionProfile, params.marathonMode);
  const chatId = params.chatId?.trim() ? params.chatId.trim() : await createChatForCodex(trimmedMessage);
  const workspaceContext = buildOpenClawWorkspaceContext(params.project, params.branchName);
  const prompt = buildCodexPrompt({
    message: trimmedMessage,
    project: params.project,
    executionProfile,
    branchName: params.branchName,
  });

  const response = await apiRequest("POST", "/api/agent/runs", {
    chatId,
    message: prompt,
    executionProfile,
  });
  const payload = await response.json();
  const runId = String(payload.id);

  await registerOpenClawSessionContext(runId, workspaceContext);

  return {
    runId,
    chatId,
    prompt,
  };
}

export async function spawnCodexSubagents(params: SpawnCodexSubagentsParams): Promise<CodexSubagentRun[]> {
  const roles = resolveAgentRoles(params.project, params.maxSubagents);
  if (roles.length === 0) return [];

  const executionProfile = resolveExecutionProfile(params.executionProfile, params.marathonMode);
  const workspaceContext = buildOpenClawWorkspaceContext(params.project, params.branchName);
  const responses = await Promise.all(
    roles.map(async (role) => {
      const response = await apiRequest("POST", "/api/openclaw/runtime/subagents", {
        objective: buildSubagentObjective({
          role,
          message: params.message,
          project: params.project,
          executionProfile,
          branchName: params.branchName,
        }),
        planHint: [
          `role:${role}`,
          `profile:${executionProfile}`,
          ...(params.project?.repositoryPath ? [`repo:${params.project.repositoryPath}`] : []),
          ...(params.branchName ? [`branch:${params.branchName}`] : []),
        ],
        parentRunId: params.runId,
        executionProfile,
        workspaceContext,
      });

      return response.json() as Promise<CodexSubagentRun>;
    }),
  );

  return responses;
}

export async function fetchSubagentRuns(parentRunId: string): Promise<CodexSubagentRun[]> {
  const query = new URLSearchParams({
    parentRunId,
    limit: "24",
  });

  const response = await fetch(`/api/openclaw/runtime/subagents?${query.toString()}`, {
    credentials: "include",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || "No se pudieron cargar los subagentes.");
  }

  const payload = await response.json();
  return Array.isArray(payload?.runs) ? payload.runs : [];
}
