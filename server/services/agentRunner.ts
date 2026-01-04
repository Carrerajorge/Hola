import { EventEmitter } from "events";

export interface AgentState {
  objective: string;
  plan: string[];
  history: AgentStep[];
  observations: string[];
  toolsUsed: string[];
  currentStep: number;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
}

export interface AgentStep {
  stepIndex: number;
  action: string;
  tool: string;
  input: Record<string, any>;
  output?: any;
  success: boolean;
  error?: string;
  duration: number;
  timestamp: Date;
}

export interface AgentRunnerConfig {
  maxSteps: number;
  stepTimeoutMs: number;
  enableLogging: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

const DEFAULT_CONFIG: AgentRunnerConfig = {
  maxSteps: parseInt(process.env.MAX_AGENT_STEPS || "8", 10),
  stepTimeoutMs: 60000,
  enableLogging: true,
};

export class AgentRunner extends EventEmitter {
  private config: AgentRunnerConfig;
  private state: AgentState | null = null;
  private abortController: AbortController | null = null;

  constructor(config: Partial<AgentRunnerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log(`AgentRunner initialized with maxSteps=${this.config.maxSteps}`);
  }

  async run(objective: string, planHint: string[] = []): Promise<{ success: boolean; result: any; state: AgentState }> {
    this.abortController = new AbortController();
    
    this.state = {
      objective,
      plan: planHint.length > 0 ? planHint : await this.generatePlan(objective),
      history: [],
      observations: [],
      toolsUsed: [],
      currentStep: 0,
      status: "running",
    };

    this.log(`Starting agent run for objective: "${objective}"`);
    this.log(`Plan: ${this.state.plan.join(" → ")}`);
    this.emit("started", { objective, plan: this.state.plan });

    try {
      while (this.state.currentStep < this.config.maxSteps && this.state.status === "running") {
        if (this.abortController.signal.aborted) {
          this.state.status = "cancelled";
          this.log("Agent run cancelled");
          break;
        }

        const stepResult = await this.executeStep();
        
        if (stepResult.action === "final_answer") {
          this.state.status = "completed";
          this.log(`Agent completed with final answer`);
          this.emit("completed", { result: stepResult.output, state: this.state });
          return { success: true, result: stepResult.output, state: this.state };
        }

        if (!stepResult.success) {
          this.log(`Step ${this.state.currentStep} failed: ${stepResult.error}`);
          if (this.state.history.filter(h => !h.success).length >= 3) {
            this.state.status = "failed";
            this.emit("failed", { error: "Too many step failures", state: this.state });
            return { success: false, result: { error: "Too many step failures" }, state: this.state };
          }
        }

        this.state.currentStep++;
      }

      if (this.state.currentStep >= this.config.maxSteps) {
        this.log(`Max steps (${this.config.maxSteps}) reached`);
        const summaryResult = await this.generateSummary();
        this.state.status = "completed";
        this.emit("completed", { result: summaryResult, state: this.state });
        return { success: true, result: summaryResult, state: this.state };
      }

      return { success: this.state.status === "completed", result: this.state.observations, state: this.state };
    } catch (error: any) {
      this.state.status = "failed";
      this.log(`Agent run failed: ${error.message}`);
      this.emit("failed", { error: error.message, state: this.state });
      return { success: false, result: { error: error.message }, state: this.state };
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private async executeStep(): Promise<AgentStep> {
    const startTime = Date.now();
    const stepIndex = this.state!.currentStep;

    const nextAction = await this.decideNextAction();
    
    this.log(`Step ${stepIndex}: ${nextAction.tool}(${JSON.stringify(nextAction.input)})`);
    this.emit("step_started", { stepIndex, action: nextAction });

    let result: ToolResult;
    
    try {
      result = await this.executeTool(nextAction.tool, nextAction.input);
    } catch (error: any) {
      result = { success: false, error: error.message };
    }

    const step: AgentStep = {
      stepIndex,
      action: nextAction.action,
      tool: nextAction.tool,
      input: nextAction.input,
      output: result.data,
      success: result.success,
      error: result.error,
      duration: Date.now() - startTime,
      timestamp: new Date(),
    };

    this.state!.history.push(step);
    
    if (!this.state!.toolsUsed.includes(nextAction.tool)) {
      this.state!.toolsUsed.push(nextAction.tool);
    }

    if (result.success && result.data) {
      const observation = typeof result.data === "string" 
        ? result.data.slice(0, 2000) 
        : JSON.stringify(result.data).slice(0, 2000);
      this.state!.observations.push(observation);
    }

    this.emit("step_completed", { step, state: this.state });
    this.log(`Step ${stepIndex} completed: success=${result.success}, duration=${step.duration}ms`);

    return step;
  }

  private async decideNextAction(): Promise<{ action: string; tool: string; input: Record<string, any> }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.log("GEMINI_API_KEY not configured, using heuristic action");
      return this.heuristicNextAction();
    }

    try {
      const { geminiChat } = await import("../lib/gemini");

      const context = {
        objective: this.state!.objective,
        plan: this.state!.plan,
        currentStep: this.state!.currentStep,
        previousActions: this.state!.history.slice(-3).map(h => ({
          tool: h.tool,
          success: h.success,
          output: h.output?.toString().slice(0, 500),
        })),
        observations: this.state!.observations.slice(-3),
      };

      const prompt = `Eres un agente autónomo ejecutando una tarea.

Objetivo: ${context.objective}
Plan: ${context.plan.join(" → ")}
Paso actual: ${context.currentStep + 1}/${this.config.maxSteps}
Acciones previas: ${JSON.stringify(context.previousActions)}
Observaciones: ${context.observations.join("\n---\n")}

Herramientas disponibles:
- web_search(query: string): Busca información en la web
- open_url(url: string): Navega a una URL y extrae contenido
- extract_text(content: string): Extrae y procesa texto
- final_answer(answer: string): Devuelve la respuesta final

Decide la siguiente acción. Responde SOLO con JSON (sin markdown):
{"action":"descripción","tool":"nombre_herramienta","input":{"param":"valor"}}

Si ya tienes suficiente información, usa final_answer.`;

      const result = await geminiChat(
        [{ role: "user", parts: [{ text: prompt }] }],
        { model: "gemini-2.0-flash", maxOutputTokens: 300, temperature: 0.2 }
      );

      const responseText = result.content?.trim() || "";
      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      
      if (!jsonMatch) {
        this.log("No valid JSON in LLM response, using heuristic");
        return this.heuristicNextAction();
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action || "execute",
        tool: parsed.tool || "final_answer",
        input: parsed.input || {},
      };
    } catch (error: any) {
      this.log(`LLM decision failed: ${error.message}, using heuristic`);
      return this.heuristicNextAction();
    }
  }

  private heuristicNextAction(): { action: string; tool: string; input: Record<string, any> } {
    const objective = this.state!.objective.toLowerCase();
    const hasObservations = this.state!.observations.length > 0;
    const currentStep = this.state!.currentStep;

    if (hasObservations && currentStep >= 2) {
      return { 
        action: "Generate final answer from observations", 
        tool: "final_answer", 
        input: { answer: this.state!.observations.join("\n\n") } 
      };
    }

    const urlMatch = objective.match(/https?:\/\/[^\s]+/);
    if (urlMatch && !this.state!.toolsUsed.includes("open_url")) {
      return { action: "Navigate to URL", tool: "open_url", input: { url: urlMatch[0] } };
    }

    if (!this.state!.toolsUsed.includes("web_search")) {
      const searchQuery = objective.replace(/busca|search|encuentra|find|investiga/gi, "").trim().slice(0, 100);
      return { action: "Search for information", tool: "web_search", input: { query: searchQuery || objective.slice(0, 100) } };
    }

    return { 
      action: "Complete task", 
      tool: "final_answer", 
      input: { answer: hasObservations ? this.state!.observations.join("\n\n") : "No se encontró información relevante." } 
    };
  }

  private async executeTool(toolName: string, input: Record<string, any>): Promise<ToolResult> {
    this.log(`Executing tool: ${toolName}`);

    switch (toolName) {
      case "web_search":
        return this.toolWebSearch(input.query);
      
      case "open_url":
        return this.toolOpenUrl(input.url);
      
      case "extract_text":
        return this.toolExtractText(input.content || input.html || input.markdown);
      
      case "final_answer":
        return { success: true, data: input.answer || input.response || "Tarea completada" };
      
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }

  private async toolWebSearch(query: string): Promise<ToolResult> {
    try {
      const { searchAdapter } = await import("../agent/webtool/searchAdapter");
      const results = await searchAdapter.search(query, { maxResults: 5 });
      
      return {
        success: true,
        data: results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolOpenUrl(url: string): Promise<ToolResult> {
    try {
      const { fetchAdapter } = await import("../agent/webtool/fetchAdapter");
      const result = await fetchAdapter.fetch(url);
      
      if (!result.success) {
        return { success: false, error: result.error || "Failed to fetch URL" };
      }

      const content = result.html?.slice(0, 10000) || result.text?.slice(0, 10000) || "";
      
      return {
        success: true,
        data: {
          url,
          title: result.title,
          content: content,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async toolExtractText(content: string): Promise<ToolResult> {
    if (!content) {
      return { success: false, error: "No content provided" };
    }

    const cleanText = content
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);

    return { success: true, data: cleanText };
  }

  private async generatePlan(objective: string): Promise<string[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return this.heuristicPlan(objective);
    }

    try {
      const { geminiChat } = await import("../lib/gemini");
      
      const result = await geminiChat(
        [{ role: "user", parts: [{ text: `Genera un plan de 3-5 pasos para: "${objective}". Responde SOLO con JSON: {"steps":["paso1","paso2"]}` }] }],
        { model: "gemini-2.0-flash", maxOutputTokens: 150, temperature: 0.3 }
      );

      const jsonMatch = result.content?.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.steps)) {
          return parsed.steps;
        }
      }
    } catch (error) {
      this.log(`Plan generation failed, using heuristic`);
    }

    return this.heuristicPlan(objective);
  }

  private heuristicPlan(objective: string): string[] {
    const lower = objective.toLowerCase();
    
    if (/https?:\/\//.test(objective)) {
      return ["Navegar a la URL", "Extraer contenido", "Analizar información", "Generar respuesta"];
    }
    
    if (/busca|search|investiga|research|encuentra|find/.test(lower)) {
      return ["Buscar información en la web", "Analizar resultados", "Generar respuesta"];
    }
    
    if (/analiza|analyze|procesa|process/.test(lower)) {
      return ["Obtener datos", "Procesar información", "Generar análisis"];
    }
    
    return ["Analizar objetivo", "Buscar información relevante", "Generar respuesta final"];
  }

  private async generateSummary(): Promise<string> {
    const observations = this.state!.observations.join("\n---\n");
    
    if (!observations) {
      return "No se pudo obtener información para completar la tarea.";
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return observations.slice(0, 2000);
    }

    try {
      const { geminiChat } = await import("../lib/gemini");
      
      const result = await geminiChat(
        [{ role: "user", parts: [{ text: `Objetivo: ${this.state!.objective}\n\nInformación recopilada:\n${observations}\n\nGenera una respuesta coherente y útil basada en esta información.` }] }],
        { model: "gemini-2.0-flash", maxOutputTokens: 1000, temperature: 0.3 }
      );

      return result.content || observations.slice(0, 2000);
    } catch (error) {
      return observations.slice(0, 2000);
    }
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      const timestamp = new Date().toISOString();
      console.log(`[AgentRunner ${timestamp}] ${message}`);
    }
  }
}

export const agentRunner = new AgentRunner();

export async function runAgent(objective: string, planHint: string[] = []): Promise<{ success: boolean; result: any; state: AgentState }> {
  const runner = new AgentRunner();
  return runner.run(objective, planHint);
}
