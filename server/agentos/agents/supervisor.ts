import { AgentOS } from "../index";
import { AGENT_PRESETS } from "./presets";
import { llmGateway } from "../../lib/llmGateway";

interface SubTask {
  id: string;
  description: string;
  assignedAgentId: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
}

export class SupervisorAgent {
  private os: AgentOS;

  constructor() {
    this.os = AgentOS.getInstance();
  }

  // Analiza una tarea compleja y la descompone en subtareas asignadas a expertos
  async planAndExecute(userId: string, complexGoal: string) {
    console.log(`[Supervisor] 🧠 Planning task: "${complexGoal}"`);

    // 1. Planificación (Thinking Phase)
    const plan = await this.createPlan(complexGoal);
    console.log(`[Supervisor] 📋 Created plan with ${plan.length} steps.`);

    // 2. Ejecución Secuencial (podría ser paralela en v2)
    const results = [];
    for (const task of plan) {
        console.log(`[Supervisor] ▶️ Executing step: ${task.description} (Agent: ${task.assignedAgentId})`);
        
        try {
            const result = await this.delegateTask(userId, task);
            task.status = "completed";
            task.result = result;
            results.push({ step: task.id, output: result });
        } catch (error: any) {
            console.error(`[Supervisor] ❌ Step failed: ${error.message}`);
            task.status = "failed";
            // Simple recovery: continue best effort or abort? Abort for now.
            throw new Error(`Orchestration failed at step ${task.id}: ${error.message}`);
        }
    }

    // 3. Síntesis Final
    return await this.synthesizeResults(complexGoal, results);
  }

  private async createPlan(goal: string): Promise<SubTask[]> {
    // Usamos el LLM para descomponer la tarea y asignar agentes del registro
    const availableAgents = AGENT_PRESETS.map(p => `- ${p.id}: ${p.description}`).join("\n");
    
    const prompt = `
    You are a Supervisor Agent. Your goal is to break down a complex user request into atomic subtasks.
    
    User Request: "${goal}"
    
    Available Agents:
    ${availableAgents}
    
    Output JSON array of subtasks. Format:
    [
      { "id": "step1", "description": "detailed instruction", "assignedAgentId": "agent_id" }
    ]
    `;

    const response = await llmGateway.chat([
        { role: "system", content: "You are a JSON-only planner." },
        { role: "user", content: prompt }
    ], { 
        model: "gpt-4o",
        _fromRouter: true 
    });

    try {
        const cleanJson = (response.content || "").replace(/```json|```/g, "").trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        console.error("Failed to parse plan JSON");
        return []; // Fail gracefully or retry
    }
  }

  private async delegateTask(userId: string, task: SubTask): Promise<string> {
    const preset = AGENT_PRESETS.find(p => p.id === task.assignedAgentId);
    if (!preset) throw new Error(`Unknown agent: ${task.assignedAgentId}`);

    // Construimos el contexto para el sub-agente
    const systemPrompt = `${preset.systemPrompt}\n\n[TASK CONTEXT]: You are working as part of a larger team. Focus ONLY on your specific task.`;
    
    const response = await llmGateway.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: task.description }
    ], {
        model: preset.recommendedModels[0],
        userId,
        _fromRouter: true // Bypass para evitar recursión infinita de políticas si las hubiera
    });

    return response.content || "No output";
  }

  private async synthesizeResults(goal: string, results: any[]): Promise<string> {
    const context = results.map(r => `Step ${r.step} Output:\n${r.output}`).join("\n\n---\n\n");
    
    const response = await llmGateway.chat([
        { role: "system", content: "You are the project manager. Summarize the results of the team's work for the client." },
        { role: "user", content: `Original Goal: "${goal}"\n\nTeam Results:\n${context}` }
    ], {
        model: "gpt-4o-mini",
        _fromRouter: true
    });

    return response.content || "Final synthesis failed.";
  }
}
