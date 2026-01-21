/**
 * Task Decomposition Engine - MICHAT PRO 3.0
 * 
 * Automatically decomposes complex tasks into manageable sub-tasks
 * with dependency detection and optimal execution ordering.
 */

import { z } from "zod";

// ============== Types ==============

export interface SubTask {
    id: string;
    title: string;
    description: string;
    agentType: AgentType;
    dependencies: string[]; // IDs of tasks that must complete first
    priority: "high" | "medium" | "low";
    estimatedDuration: number; // seconds
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    result?: any;
    error?: string;
}

export interface TaskPlan {
    id: string;
    originalQuery: string;
    goal: string;
    subtasks: SubTask[];
    createdAt: Date;
    status: "planning" | "executing" | "completed" | "failed";
    progress: number; // 0-100
}

export type AgentType =
    | "research"
    | "code"
    | "document"
    | "data"
    | "browser"
    | "qa"
    | "content"
    | "communication"
    | "security"
    | "orchestrator";

// ============== Decomposition Logic ==============

const TASK_PATTERNS: Record<string, {
    keywords: string[];
    subtasks: Partial<SubTask>[];
}> = {
    research: {
        keywords: ["investigar", "buscar", "encontrar", "analizar", "research", "find", "analyze"],
        subtasks: [
            { agentType: "research", title: "Búsqueda inicial", priority: "high" },
            { agentType: "data", title: "Análisis de datos", priority: "medium" },
            { agentType: "content", title: "Síntesis de resultados", priority: "low" },
        ]
    },
    development: {
        keywords: ["crear", "desarrollar", "programar", "código", "build", "develop", "code", "implement"],
        subtasks: [
            { agentType: "research", title: "Investigar requisitos", priority: "high" },
            { agentType: "code", title: "Diseñar arquitectura", priority: "high" },
            { agentType: "code", title: "Implementar código", priority: "high" },
            { agentType: "qa", title: "Verificar y testar", priority: "medium" },
        ]
    },
    document: {
        keywords: ["documento", "escribir", "redactar", "informe", "report", "write", "draft"],
        subtasks: [
            { agentType: "research", title: "Investigar tema", priority: "high" },
            { agentType: "content", title: "Crear estructura", priority: "medium" },
            { agentType: "document", title: "Redactar contenido", priority: "high" },
            { agentType: "qa", title: "Revisar y editar", priority: "low" },
        ]
    },
    analysis: {
        keywords: ["analizar", "evaluar", "comparar", "analyze", "evaluate", "compare", "assess"],
        subtasks: [
            { agentType: "data", title: "Recopilar datos", priority: "high" },
            { agentType: "data", title: "Procesar información", priority: "medium" },
            { agentType: "content", title: "Generar insights", priority: "medium" },
            { agentType: "document", title: "Crear reporte", priority: "low" },
        ]
    },
    automation: {
        keywords: ["automatizar", "workflow", "proceso", "automate", "schedule", "batch"],
        subtasks: [
            { agentType: "orchestrator", title: "Analizar proceso", priority: "high" },
            { agentType: "code", title: "Diseñar automatización", priority: "high" },
            { agentType: "code", title: "Implementar scripts", priority: "medium" },
            { agentType: "qa", title: "Probar workflow", priority: "medium" },
        ]
    }
};

/**
 * Generate unique ID for subtasks
 */
function generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detect task type from query
 */
export function detectTaskType(query: string): string {
    const lowerQuery = query.toLowerCase();

    for (const [type, pattern] of Object.entries(TASK_PATTERNS)) {
        if (pattern.keywords.some(kw => lowerQuery.includes(kw))) {
            return type;
        }
    }

    return "general";
}

/**
 * Decompose a complex task into subtasks
 */
export function decomposeTask(query: string, context?: {
    hasFiles?: boolean;
    hasCode?: boolean;
    preferredAgents?: AgentType[];
}): TaskPlan {
    const taskType = detectTaskType(query);
    const pattern = TASK_PATTERNS[taskType];

    const subtasks: SubTask[] = [];
    const planId = generateId();

    if (pattern) {
        let prevId: string | null = null;

        for (const template of pattern.subtasks) {
            const id = generateId();
            subtasks.push({
                id,
                title: template.title || "Sub-tarea",
                description: `${template.title} para: ${query.slice(0, 100)}`,
                agentType: template.agentType || "orchestrator",
                dependencies: prevId ? [prevId] : [],
                priority: template.priority || "medium",
                estimatedDuration: template.priority === "high" ? 30 : 15,
                status: "pending",
            });
            prevId = id;
        }
    } else {
        // Default single-task plan
        subtasks.push({
            id: generateId(),
            title: "Procesar solicitud",
            description: query,
            agentType: "orchestrator",
            dependencies: [],
            priority: "high",
            estimatedDuration: 30,
            status: "pending",
        });
    }

    // Add context-specific tasks
    if (context?.hasFiles) {
        subtasks.unshift({
            id: generateId(),
            title: "Analizar archivos adjuntos",
            description: "Procesar y extraer información de archivos",
            agentType: "document",
            dependencies: [],
            priority: "high",
            estimatedDuration: 10,
            status: "pending",
        });
    }

    if (context?.hasCode) {
        const qaTask: SubTask = {
            id: generateId(),
            title: "Revisar código",
            description: "Verificar calidad y errores del código",
            agentType: "qa",
            dependencies: subtasks.filter(t => t.agentType === "code").map(t => t.id),
            priority: "medium",
            estimatedDuration: 15,
            status: "pending",
        };
        subtasks.push(qaTask);
    }

    return {
        id: planId,
        originalQuery: query,
        goal: extractGoal(query),
        subtasks,
        createdAt: new Date(),
        status: "planning",
        progress: 0,
    };
}

/**
 * Extract main goal from query
 */
function extractGoal(query: string): string {
    // Simple extraction - take first sentence or truncate
    const firstSentence = query.split(/[.!?]/)[0];
    return firstSentence.length > 100
        ? firstSentence.slice(0, 100) + "..."
        : firstSentence;
}

/**
 * Get execution order respecting dependencies
 */
export function getExecutionOrder(plan: TaskPlan): SubTask[][] {
    const completed = new Set<string>();
    const waves: SubTask[][] = [];
    const remaining = [...plan.subtasks];

    while (remaining.length > 0) {
        const wave: SubTask[] = [];

        for (let i = remaining.length - 1; i >= 0; i--) {
            const task = remaining[i];
            const depsCompleted = task.dependencies.every(d => completed.has(d));

            if (depsCompleted) {
                wave.push(task);
                remaining.splice(i, 1);
            }
        }

        if (wave.length === 0 && remaining.length > 0) {
            // Circular dependency - break by adding remaining
            wave.push(...remaining);
            remaining.length = 0;
        }

        wave.forEach(t => completed.add(t.id));
        waves.push(wave);
    }

    return waves;
}

/**
 * Calculate plan progress
 */
export function calculateProgress(plan: TaskPlan): number {
    if (plan.subtasks.length === 0) return 100;

    const completed = plan.subtasks.filter(t =>
        t.status === "completed" || t.status === "skipped"
    ).length;

    return Math.round((completed / plan.subtasks.length) * 100);
}

/**
 * Update subtask status
 */
export function updateSubtaskStatus(
    plan: TaskPlan,
    taskId: string,
    status: SubTask["status"],
    result?: any,
    error?: string
): TaskPlan {
    const subtasks = plan.subtasks.map(t =>
        t.id === taskId
            ? { ...t, status, result, error }
            : t
    );

    const progress = calculateProgress({ ...plan, subtasks });
    const allDone = subtasks.every(t =>
        t.status === "completed" || t.status === "failed" || t.status === "skipped"
    );
    const anyFailed = subtasks.some(t => t.status === "failed");

    return {
        ...plan,
        subtasks,
        progress,
        status: allDone
            ? (anyFailed ? "failed" : "completed")
            : "executing",
    };
}

// ============== Schema for validation ==============

export const SubTaskSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    agentType: z.enum([
        "research", "code", "document", "data", "browser",
        "qa", "content", "communication", "security", "orchestrator"
    ]),
    dependencies: z.array(z.string()),
    priority: z.enum(["high", "medium", "low"]),
    estimatedDuration: z.number(),
    status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
    result: z.any().optional(),
    error: z.string().optional(),
});

export const TaskPlanSchema = z.object({
    id: z.string(),
    originalQuery: z.string(),
    goal: z.string(),
    subtasks: z.array(SubTaskSchema),
    createdAt: z.date(),
    status: z.enum(["planning", "executing", "completed", "failed"]),
    progress: z.number().min(0).max(100),
});

export default {
    decomposeTask,
    detectTaskType,
    getExecutionOrder,
    calculateProgress,
    updateSubtaskStatus,
};
