import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@/hooks/use-projects";

export type CodexExecutionProfile = "standard" | "marathon_12h";
export type CodexAgentRole = "coder" | "reviewer" | "improver";
export type CodexSubagentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface CodexSubagentRun {
  id: string;
  requesterUserId: string;
  objective: string;
  planHint: string[];
  parentRunId?: string;
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
  marathonMode?: boolean;
}

interface SpawnCodexSubagentsParams {
  runId: string;
  message: string;
  project?: Project | null;
  marathonMode?: boolean;
  maxSubagents?: number;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildWorkspaceSummary(project?: Project | null): string {
  if (!project) return "";

  const lines = [
    `Proyecto: ${project.name}`,
    project.repositoryPath ? `Repositorio: ${project.repositoryPath}` : null,
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

export function buildCodexPrompt(params: {
  message: string;
  project?: Project | null;
  marathonMode?: boolean;
}): string {
  const { message, project, marathonMode } = params;
  const workspaceSummary = buildWorkspaceSummary(project);
  const executionProfile = marathonMode
    ? "Perfil operativo: modo intensivo de 12 horas. Trabaja por lotes, valida tus cambios y deja continuidad clara para el siguiente ciclo."
    : "Perfil operativo: ejecución estándar con foco en completar la tarea de punta a punta.";

  return [
    "Actúa como un agente OpenClaw integrado de forma segura dentro de ILIAGPT.",
    executionProfile,
    workspaceSummary ? `Contexto del workspace:\n${workspaceSummary}` : null,
    "Objetivo principal del usuario:",
    message.trim(),
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
  marathonMode?: boolean;
}): string {
  const { role, message, project, marathonMode } = params;
  const workspaceSummary = buildWorkspaceSummary(project);
  const profileLine = marathonMode
    ? "Trabaja con mentalidad de ventana intensiva de 12 horas: autonomía alta, verificación frecuente y entregables parciales claros."
    : "Trabaja con autonomía normal y foco en entregar una contribución técnica útil.";

  const roleInstruction =
    role === "coder"
      ? "Rol: Implementador. Propón y ejecuta la solución principal, priorizando cambios completos y funcionales."
      : role === "reviewer"
        ? "Rol: Revisor. Busca bugs, regresiones, riesgos de diseño, deuda técnica y pruebas faltantes."
        : "Rol: Mejorador. Identifica mejoras de DX, legibilidad, rendimiento y simplificación del flujo.";

  return [
    roleInstruction,
    profileLine,
    workspaceSummary ? `Workspace:\n${workspaceSummary}` : null,
    "Objetivo base del usuario:",
    message.trim(),
    "Devuelve hallazgos accionables o una propuesta concreta de cambio.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createChatForCodex(message: string): Promise<string> {
  const response = await apiRequest("POST", "/api/chats", {
    title: truncate(message.trim() || "Nueva sesión OpenClaw", 56),
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
    throw new Error("Describe la tarea antes de lanzar OpenClaw.");
  }

  const chatId = params.chatId?.trim() ? params.chatId.trim() : await createChatForCodex(trimmedMessage);
  const prompt = buildCodexPrompt({
    message: trimmedMessage,
    project: params.project,
    marathonMode: params.marathonMode,
  });

  const response = await apiRequest("POST", "/api/agent/runs", {
    chatId,
    message: prompt,
  });
  const payload = await response.json();

  return {
    runId: String(payload.id),
    chatId,
    prompt,
  };
}

export async function spawnCodexSubagents(params: SpawnCodexSubagentsParams): Promise<CodexSubagentRun[]> {
  const roles = resolveAgentRoles(params.project, params.maxSubagents);
  if (roles.length === 0) return [];

  const responses = await Promise.all(
    roles.map(async (role) => {
      const response = await apiRequest("POST", "/api/openclaw/runtime/subagents", {
        objective: buildSubagentObjective({
          role,
          message: params.message,
          project: params.project,
          marathonMode: params.marathonMode,
        }),
        planHint: [
          `role:${role}`,
          `profile:${params.marathonMode ? "marathon_12h" : "standard"}`,
          ...(params.project?.repositoryPath ? [`repo:${params.project.repositoryPath}`] : []),
        ],
        parentRunId: params.runId,
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
