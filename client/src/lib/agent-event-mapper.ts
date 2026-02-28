import type { AgentEvent as SharedAgentEvent, AgentEventKind, AgentEventStatus } from "@shared/schema";

export interface EventUIConfig {
  label: string;
  labelColor: string;
  bgColor: string;
  iconColor: string;
  icon: 'sparkles' | 'check' | 'alert' | 'clock' | 'list' | 'eye' | 'brain' | 'loader';
}

export interface MappedAgentEvent {
  id: string;
  kind: AgentEventKind;
  status: AgentEventStatus;
  title: string;
  summary?: string;
  timestamp: number;
  stepIndex?: number;
  confidence?: number;
  shouldRetry?: boolean;
  shouldReplan?: boolean;
  payload?: any;
  ui: EventUIConfig;
}

const kindToLabel: Record<AgentEventKind, string> = {
  action: 'Acción',
  observation: 'Resultado',
  result: 'Resultado',
  verification: 'Verificación',
  error: 'Error',
  plan: 'Plan',
  thinking: 'Pensando',
  progress: 'Progreso',
};

const kindToIcon: Record<AgentEventKind, EventUIConfig['icon']> = {
  action: 'sparkles',
  observation: 'check',
  result: 'check',
  verification: 'eye',
  error: 'alert',
  plan: 'list',
  thinking: 'brain',
  progress: 'loader',
};

function getColors(kind: AgentEventKind, status: AgentEventStatus): Pick<EventUIConfig, 'labelColor' | 'bgColor' | 'iconColor'> {
  if (status === 'fail') {
    return {
      labelColor: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-500/20',
      iconColor: 'text-red-500',
    };
  }
  
  if (status === 'warn') {
    return {
      labelColor: 'text-yellow-600 dark:text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      iconColor: 'text-yellow-500',
    };
  }
  
  switch (kind) {
    case 'action':
      return {
        labelColor: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-500/20',
        iconColor: 'text-blue-500',
      };
    case 'observation':
    case 'result':
      return {
        labelColor: 'text-green-600 dark:text-green-400',
        bgColor: 'bg-green-500/20',
        iconColor: 'text-green-500',
      };
    case 'verification':
      return {
        labelColor: 'text-purple-600 dark:text-purple-400',
        bgColor: 'bg-purple-500/20',
        iconColor: 'text-purple-500',
      };
    case 'plan':
      return {
        labelColor: 'text-indigo-600 dark:text-indigo-400',
        bgColor: 'bg-indigo-500/20',
        iconColor: 'text-indigo-500',
      };
    case 'thinking':
      return {
        labelColor: 'text-gray-600 dark:text-gray-400',
        bgColor: 'bg-gray-500/20',
        iconColor: 'text-gray-500',
      };
    case 'progress':
      return {
        labelColor: 'text-cyan-600 dark:text-cyan-400',
        bgColor: 'bg-cyan-500/20',
        iconColor: 'text-cyan-500',
      };
    default:
      return {
        labelColor: 'text-gray-600 dark:text-gray-400',
        bgColor: 'bg-gray-500/20',
        iconColor: 'text-gray-500',
      };
  }
}

export function normalizeAgentEvent(event: any): MappedAgentEvent {
  const kind: AgentEventKind = event.kind || mapLegacyType(event.type, event);
  const status: AgentEventStatus = event.status || inferStatusFromEvent(event, kind);
  const title = event.title || formatLegacyTitle(event, kind);
  const summary = event.summary || formatLegacySummary(event);
  
  const colors = getColors(kind, status);
  
  return {
    id: event.id || `${event.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
    kind,
    status,
    title,
    summary,
    timestamp: event.timestamp,
    stepIndex: event.stepIndex,
    confidence: event.confidence,
    shouldRetry: event.shouldRetry,
    shouldReplan: event.shouldReplan,
    payload: event.payload || event.content,
    ui: {
      label: kindToLabel[kind] || kind,
      icon: kindToIcon[kind] || 'clock',
      ...colors,
    },
  };
}

function getTraceType(event: any): string {
  return String(event?.content?.event_type || event?.event_type || event?.type || "").toLowerCase();
}

function mapLegacyType(type: string | undefined, event?: any): AgentEventKind {
  const traceType = getTraceType(event);

  switch (traceType) {
    case "task_start":
    case "plan_created":
    case "plan_step":
    case "task_created":
    case "skill_load_started":
    case "skill_load_done":
    case "replan":
      return "plan";
    case "task_started":
    case "step_started":
    case "tool_call":
    case "tool_call_started":
    case "tool_call_delta":
    case "shell_output":
    case "shell_chunk":
      return "action";
    case "verification":
    case "verification_passed":
    case "verification_failed":
    case "validation_passed":
    case "validation_failed":
      return "verification";
    case "step_completed":
    case "tool_call_done":
    case "tool_output":
    case "tool_call_succeeded":
    case "artifact_created":
    case "artifact_written":
    case "artifact_ready":
    case "final_ready":
    case "done":
      return "result";
    case "step_failed":
    case "tool_call_failed":
    case "retry_scheduled":
    case "error":
      return "error";
    case "thinking":
      return "thinking";
    case "progress_update":
      return "progress";
    default:
      break;
  }

  switch (type) {
    case 'action':
      return 'action';
    case 'observation':
      return 'observation';
    case 'error':
      return 'error';
    case 'thinking':
      return 'thinking';
    case 'plan':
      return 'plan';
    case 'verification':
      return 'verification';
    default:
      return 'observation';
  }
}

function inferStatusFromEvent(event: any, kind: AgentEventKind): AgentEventStatus {
  if (kind === 'error') {
    return 'fail';
  }
  
  const traceType = getTraceType(event);
  const content = event.content || event.payload || {};

  if (["validation_failed", "step_failed", "tool_call_failed", "error"].includes(traceType)) {
    return "fail";
  }

  if (["retry_scheduled"].includes(traceType)) {
    return "warn";
  }

  if (content.success === true || content.status === 'completed' || content.status === 'succeeded') {
    return 'ok';
  }
  
  if (content.shouldRetry || content.shouldReplan) {
    return 'warn';
  }
  
  if (content.success === false || content.status === 'failed' || content.error) {
    return 'fail';
  }
  
  return 'ok';
}

function formatLegacyTitle(event: any, kind: AgentEventKind): string {
  const content = event.content || {};
  const traceType = getTraceType(event);

  if (traceType === "task_start") {
    return "Iniciando ejecución";
  }

  if (traceType === "plan_created") {
    return "Plan creado";
  }

  if (traceType === "task_created") {
    return "Tarea creada";
  }

  if (traceType === "task_started") {
    return "Tarea en ejecución";
  }

  if (traceType === "skill_load_started") {
    return "Cargando skill";
  }

  if (traceType === "skill_load_done") {
    return "Skill listo";
  }

  if (traceType === "step_started" || traceType === "tool_call_started") {
    const tool = content.tool_name || content.toolName || content.tool;
    if (typeof tool === "string" && tool.trim().length > 0) {
      return getToolDisplayName(tool);
    }
    return "Ejecutando paso";
  }

  if (traceType === "tool_call_delta") {
    return "Ejecutando herramienta";
  }

  if (traceType === "validation_passed") {
    return "Validación aprobada";
  }

  if (traceType === "validation_failed") {
    return "Validación fallida";
  }

  if (traceType === "artifact_written") {
    return "Artefacto generado";
  }

  if (traceType === "retry_scheduled") {
    return "Reintento programado";
  }

  if (traceType === "final_ready") {
    return "Resultado final listo";
  }
  
  if (content.toolName) {
    return getToolDisplayName(content.toolName);
  }
  
  if (content.type) {
    return getToolDisplayName(content.type);
  }
  
  if (content.message && typeof content.message === 'string') {
    return content.message.substring(0, 60) + (content.message.length > 60 ? '...' : '');
  }
  
  if (content.userMessage) {
    return `Analizando solicitud`;
  }
  
  if (content.feedback) {
    return content.feedback.substring(0, 60) + (content.feedback.length > 60 ? '...' : '');
  }
  
  return kindToLabel[kind] || 'Evento';
}

function formatLegacySummary(event: any): string | undefined {
  const content = event.content || {};
  const traceType = getTraceType(event);

  if (traceType === "task_start") {
    return (
      content?.summary ||
      content?.plan?.objective ||
      content?.objective ||
      "Preparando la ejecución."
    );
  }

  if (traceType === "plan_created") {
    const planSteps = Array.isArray(content?.plan?.steps)
      ? content.plan.steps
      : Array.isArray(content?.steps)
        ? content.steps
        : [];
    if (planSteps.length > 0) {
      return `Se definieron ${planSteps.length} paso(s).`;
    }
    return "Plan preparado para esta solicitud.";
  }

  if (traceType === "skill_load_started") {
    const skill = content?.metadata?.skill || content?.tool_name;
    return skill ? `Loading skill ${skill}` : "Cargando skill...";
  }

  if (traceType === "skill_load_done") {
    const skill = content?.metadata?.skill || content?.tool_name;
    return skill ? `Skill listo: ${skill}` : "Skill cargado.";
  }

  if (traceType === "task_created") {
    const deps = Array.isArray(content?.metadata?.dependencies) ? content.metadata.dependencies : [];
    return deps.length > 0
      ? `Depende de: ${deps.join(", ")}`
      : "Tarea agregada al DAG.";
  }

  if (traceType === "task_started" || traceType === "step_started") {
    if (content?.stepIndex !== undefined) {
      return `Paso ${Number(content.stepIndex) + 1} en ejecución.`;
    }
    return "Ejecutando tarea.";
  }

  if (traceType === "retry_scheduled") {
    const delay = content?.metadata?.delayMs;
    if (typeof delay === "number") {
      return `Se reintentará en ${delay} ms.`;
    }
    return "Se programó un reintento.";
  }

  if (traceType === "final_ready") {
    if (typeof content?.summary === "string" && content.summary.trim().length > 0) {
      return content.summary;
    }
    return "DoD validado y pack de entrega listo.";
  }

  if (traceType === "validation_passed" || traceType === "validation_failed") {
    if (typeof content?.summary === "string" && content.summary.trim().length > 0) {
      return content.summary;
    }
    return traceType === "validation_passed"
      ? "Validación completada correctamente."
      : "La validación no pasó.";
  }
  
  if (content.feedback && typeof content.feedback === 'string') {
    return content.feedback;
  }
  
  if (content.description && typeof content.description === 'string') {
    return content.description;
  }
  
  if (content.userMessage) {
    return content.userMessage.substring(0, 150) + (content.userMessage.length > 150 ? '...' : '');
  }
  
  if (typeof content === 'string') {
    return content;
  }
  
  return undefined;
}

function getToolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    web_search: 'Búsqueda web',
    browse_url: 'Navegación web',
    generate_document: 'Generando documento',
    analyze_spreadsheet: 'Analizando hoja de cálculo',
    generate_image: 'Generando imagen',
    read_file: 'Leyendo archivo',
    write_file: 'Escribiendo archivo',
    shell_command: 'Ejecutando comando',
    list_files: 'Listando archivos',
    task_created: 'Tarea creada',
    task_started: 'Tarea en ejecución',
    skill_load_started: 'Cargando skill',
    skill_load_done: 'Skill listo',
    tool_call_delta: 'Streaming de herramienta',
    tool_call_done: 'Herramienta completada',
    validation_passed: 'Validación aprobada',
    validation_failed: 'Validación fallida',
    retry_scheduled: 'Reintento programado',
    artifact_written: 'Artefacto generado',
    final_ready: 'Resultado final listo',
    plan_created: 'Plan creado',
    step_started: 'Iniciando paso',
    step_completed: 'Paso completado',
    step_failed: 'Paso fallido',
    verification_started: 'Iniciando verificación',
    verification_completed: 'Verificación completada',
    todo_update: 'Actualización de tareas',
    execute_step: 'Ejecutando paso',
    step_result: 'Resultado del paso',
  };
  
  return names[toolName] || toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function hasPayloadDetails(event: MappedAgentEvent): boolean {
  if (!event.payload) return false;
  if (typeof event.payload === 'string') return event.payload.length > 0;
  if (typeof event.payload === 'object') {
    const keys = Object.keys(event.payload);
    const ignoredKeys = ['success', 'shouldRetry', 'shouldReplan', 'confidence', 'feedback', 'message', 'type', 'toolName'];
    return keys.some(k => !ignoredKeys.includes(k));
  }
  return false;
}
