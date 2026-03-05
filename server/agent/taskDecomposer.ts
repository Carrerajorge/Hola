/**
 * Task Decomposition Engine - ILIAGPT PRO 3.0
 * 
 * Automatically decomposes complex tasks into manageable sub-tasks
 * with dependency detection and optimal execution ordering via LLM.
 */

import OpenAI from "openai";
import { AgentGoal } from "./autonomousAgentBrain";
import { globalRegistry } from "./capabilities/registry";

export interface TaskStep {
    id: string;
    description: string;
    expectedOutcome: string;
    dependencies: string[]; // IDs of tasks that must complete first
}

export type AgentType = "planner" | "researcher" | "coder" | "reviewer" | "browser" | "communicator" | "general";

export interface SubTask {
    id: string;
    description: string;
    agentType: AgentType;
    dependencies: string[];
    status: "pending" | "running" | "completed" | "failed";
    output?: any;
    error?: string;
}

export interface TaskPlan {
    id: string;
    goal: string;
    tasks: SubTask[];
    status: "pending" | "executing" | "completed" | "failed";
    progress: number;
}

export function getExecutionOrder(plan: TaskPlan): SubTask[][] {
    const completed = new Set(plan.tasks.filter(t => t.status === "completed").map(t => t.id));
    const waves: SubTask[][] = [];
    const remaining = plan.tasks.filter(t => t.status !== "completed" && t.status !== "failed");

    let changed = true;
    while (remaining.length > 0 && changed) {
        changed = false;
        const wave = remaining.filter(t =>
            t.dependencies.every(dep => completed.has(dep))
        );
        if (wave.length > 0) {
            waves.push(wave);
            wave.forEach(t => {
                completed.add(t.id);
                const idx = remaining.indexOf(t);
                if (idx >= 0) remaining.splice(idx, 1);
            });
            changed = true;
        }
    }
    return waves;
}

export function updateSubtaskStatus(
    plan: TaskPlan,
    taskId: string,
    status: SubTask["status"],
    output?: any,
    error?: string
): TaskPlan {
    return {
        ...plan,
        tasks: plan.tasks.map(t =>
            t.id === taskId ? { ...t, status, output, error } : t
        ),
    };
}

export function calculateProgress(plan: TaskPlan): number {
    if (plan.tasks.length === 0) return 0;
    const completed = plan.tasks.filter(t => t.status === "completed").length;
    return completed / plan.tasks.length;
}

export class TaskDecomposer {
    private llm: OpenAI;

    constructor() {
        this.llm = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || "missing",
        });
    }

    async decomposeGoal(goal: AgentGoal): Promise<TaskStep[]> {
        const activeCapabilities = globalRegistry.getAllRaw().map((c: any) => c.name).join(', ');

        const prompt = `
Eres el Orquestador Ejecutivo del Sistema MICHAT.
Tu tarea es descomponer el siguiente objetivo en una secuencia lineal de pasos accionables de muy alto nivel.
Los pasos serán evaluados por un árbol Monte Carlo Tree Search (MCTS) que ejecutará las sub-acciones.

OBJETIVO: "${goal.description}"
RESTRICCIONES: Máximo ${goal.constraints.maxActions} acciones.
CAPACIDADES DISPONIBLES EN EL SISTEMA: [${activeCapabilities}]

REGLAS:
- Genera entre 2 y ${goal.constraints.maxActions} pasos concretos.
- Responde ÚNICAMENTE con un JSON Array exacto de objetos con este formato:
[
  {
    "id": "step_1",
    "description": "Qué hacer",
    "expectedOutcome": "Qué debe ser cierto al terminar",
    "dependencies": [] 
  }
]
No incluyas markdown, solo el JSON puro.
`;

        try {
            const response = await this.llm.chat.completions.create({
                model: "gemini-2.5-flash",
                messages: [{ role: "system", content: prompt }],
                temperature: 0.1
            });

            let contentStr = response.choices[0]?.message?.content || "[]";
            if (contentStr.startsWith('\`\`\`json')) contentStr = contentStr.replace(/\`\`\`json\n?/, '').replace(/\`\`\`\n?$/, '');
            else if (contentStr.startsWith('\`\`\`')) contentStr = contentStr.replace(/\`\`\`\n?/, '').replace(/\`\`\`\n?$/, '');

            return JSON.parse(contentStr.trim()) as TaskStep[];
        } catch (e) {
            console.error("[TaskDecomposer] Error al descomponer goal:", e);
            // Fallback gracefully
            return [{
                id: "step_1",
                description: goal.description,
                expectedOutcome: "Goal achieved.",
                dependencies: []
            }];
        }
    }
}

export const taskDecomposer = new TaskDecomposer();
