import { toolRegistry, type ToolResult, type ToolArtifact } from "./toolRegistry";
import { geminiChat, type GeminiChatMessage } from "../lib/gemini";
import type { User } from "@shared/schema";
import { EventEmitter } from "events";

export interface PlanStep {
  index: number;
  toolName: string;
  description: string;
  input: any;
  expectedOutput: string;
}

export interface AgentPlan {
  objective: string;
  steps: PlanStep[];
  estimatedTime: string;
}

export type AgentStatus = 
  | "queued"
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StepResult {
  stepIndex: number;
  toolName: string;
  success: boolean;
  output: any;
  artifacts: ToolArtifact[];
  error?: string;
  startedAt: number;
  completedAt: number;
}

export interface AgentProgress {
  runId: string;
  status: AgentStatus;
  currentStepIndex: number;
  totalSteps: number;
  plan: AgentPlan | null;
  stepResults: StepResult[];
  artifacts: ToolArtifact[];
  error?: string;
}

const AVAILABLE_TOOLS = [
  {
    name: "analyze_spreadsheet",
    description: "Analyze Excel or CSV spreadsheet files. Performs data analysis, generates insights, charts, and summaries.",
    inputSchema: "{ uploadId: string, scope: 'active'|'selected'|'all', analysisMode: 'full'|'summary'|'extract_tasks'|'text_only'|'custom', userPrompt?: string }",
  },
  {
    name: "web_search",
    description: "Search the web for information. Can search general web or academic sources.",
    inputSchema: "{ query: string, maxResults: number (1-20), academic: boolean }",
  },
  {
    name: "generate_image",
    description: "Generate an image using AI based on a text description.",
    inputSchema: "{ prompt: string }",
  },
  {
    name: "browse_url",
    description: "Navigate to a URL using a headless browser. Returns page content and optionally a screenshot.",
    inputSchema: "{ url: string, takeScreenshot: boolean }",
  },
  {
    name: "generate_document",
    description: "Generate Office documents (Word, Excel, PowerPoint).",
    inputSchema: "{ type: 'word'|'excel'|'ppt', title: string, content: string }",
  },
];

export class AgentOrchestrator extends EventEmitter {
  public runId: string;
  public chatId: string;
  public userId: string;
  public userPlan: "free" | "pro" | "admin";
  public status: AgentStatus;
  public plan: AgentPlan | null;
  public currentStepIndex: number;
  public artifacts: ToolArtifact[];
  public stepResults: StepResult[];
  
  private isCancelled: boolean;
  private userMessage: string;
  private attachments: any[];

  constructor(runId: string, chatId: string, userId: string, userPlan: "free" | "pro" | "admin" = "free") {
    super();
    this.runId = runId;
    this.chatId = chatId;
    this.userId = userId;
    this.userPlan = userPlan;
    this.status = "queued";
    this.plan = null;
    this.currentStepIndex = 0;
    this.artifacts = [];
    this.stepResults = [];
    this.isCancelled = false;
    this.userMessage = "";
    this.attachments = [];
  }

  private emitProgress(): void {
    const progress: AgentProgress = {
      runId: this.runId,
      status: this.status,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.plan?.steps.length || 0,
      plan: this.plan,
      stepResults: this.stepResults,
      artifacts: this.artifacts,
    };
    this.emit("progress", progress);
  }

  private async checkIfConversational(message: string): Promise<boolean> {
    const conversationalPatterns = [
      /^(hola|hi|hey|hello|buenos?\s*(días?|tardes?|noches?)|saludos?|qué\s*tal|cómo\s*estás?|qué\s*onda)/i,
      /^(gracias|thank|thanks|ok|okay|vale|entendido|perfecto|genial|excelente)/i,
      /^(adiós|bye|chao|hasta\s*(luego|pronto|mañana)|nos\s*vemos)/i,
      /^(quién\s*eres|qué\s*eres|cómo\s*te\s*llamas|cuál\s*es\s*tu\s*nombre)/i,
      /^(ayuda|help|qué\s*puedes\s*hacer|para\s*qué\s*sirves)/i,
    ];
    
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 50) {
      for (const pattern of conversationalPatterns) {
        if (pattern.test(trimmedMessage)) {
          return true;
        }
      }
    }
    return false;
  }

  private async generateConversationalResponse(message: string): Promise<string> {
    const messages: GeminiChatMessage[] = [
      {
        role: "user",
        parts: [{ text: message }],
      },
    ];

    try {
      const response = await geminiChat(messages, {
        systemInstruction: `Eres Sira, un asistente de IA amigable y servicial. Responde de manera natural y conversacional en español. Si el usuario te saluda, salúdalo de vuelta. Si te pregunta quién eres, explica que eres un asistente de IA que puede ayudar con búsquedas web, análisis de documentos, generación de imágenes y más. Mantén tus respuestas concisas y amigables.`,
        temperature: 0.7,
        maxOutputTokens: 500,
      });
      return response.content;
    } catch (error: any) {
      console.error(`[AgentOrchestrator] Failed to generate conversational response:`, error.message);
      return "¡Hola! Soy Sira, tu asistente de IA. ¿En qué puedo ayudarte hoy?";
    }
  }

  async generatePlan(userMessage: string, attachments?: any[]): Promise<AgentPlan> {
    this.userMessage = userMessage;
    this.attachments = attachments || [];
    this.status = "planning";
    this.emitProgress();

    // Check if message is conversational (doesn't need tools)
    const isConversational = await this.checkIfConversational(userMessage);
    if (isConversational && (!attachments || attachments.length === 0)) {
      // For conversational messages, respond directly without tools
      const response = await this.generateConversationalResponse(userMessage);
      this.plan = {
        objective: "Respond to conversational message",
        steps: [],
        estimatedTime: "0 seconds",
        conversationalResponse: response
      } as AgentPlan & { conversationalResponse?: string };
      this.status = "completed";
      this.emitProgress();
      return this.plan;
    }

    const toolDescriptions = AVAILABLE_TOOLS.map(
      (t) => `- ${t.name}: ${t.description}\n  Input: ${t.inputSchema}`
    ).join("\n");

    const attachmentInfo = this.attachments.length > 0
      ? `\nUser has attached ${this.attachments.length} file(s): ${this.attachments.map((a: any) => a.name || a.filename || "file").join(", ")}`
      : "";

    const systemPrompt = `You are an AI agent planner. Your job is to analyze the user's request and create a step-by-step execution plan using the available tools.

Available tools:
${toolDescriptions}

Rules:
1. Create a plan with 3-8 steps maximum
2. Each step should use exactly one tool
3. Steps should be logically ordered with dependencies considered
4. Include realistic input parameters for each tool
5. Estimate the total execution time

Respond with ONLY valid JSON in this exact format:
{
  "objective": "Brief description of what the user wants to accomplish",
  "steps": [
    {
      "index": 0,
      "toolName": "tool_name",
      "description": "What this step accomplishes",
      "input": { ... tool-specific input ... },
      "expectedOutput": "What we expect to get from this step"
    }
  ],
  "estimatedTime": "X minutes"
}`;

    const messages: GeminiChatMessage[] = [
      {
        role: "user",
        parts: [{ text: `User request: ${userMessage}${attachmentInfo}\n\nCreate an execution plan.` }],
      },
    ];

    try {
      const response = await geminiChat(messages, {
        systemInstruction: systemPrompt,
        temperature: 0.3,
        maxOutputTokens: 2000,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Failed to parse plan JSON from LLM response");
      }

      const plan: AgentPlan = JSON.parse(jsonMatch[0]);

      if (!plan.objective || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error("Invalid plan structure");
      }

      plan.steps = plan.steps.slice(0, 8);

      for (let i = 0; i < plan.steps.length; i++) {
        plan.steps[i].index = i;
      }

      this.plan = plan;
      this.emitProgress();

      console.log(`[AgentOrchestrator] Generated plan with ${plan.steps.length} steps for run ${this.runId}`);
      return plan;
    } catch (error: any) {
      console.error(`[AgentOrchestrator] Failed to generate plan:`, error.message);
      
      this.plan = {
        objective: userMessage,
        steps: [
          {
            index: 0,
            toolName: "web_search",
            description: "Search for relevant information",
            input: { query: userMessage, maxResults: 5, academic: false },
            expectedOutput: "Search results with relevant information",
          },
        ],
        estimatedTime: "1 minute",
      };
      
      this.emitProgress();
      return this.plan;
    }
  }

  async executeStep(stepIndex: number): Promise<ToolResult> {
    if (!this.plan) {
      throw new Error("No plan available. Call generatePlan first.");
    }

    if (stepIndex < 0 || stepIndex >= this.plan.steps.length) {
      throw new Error(`Invalid step index: ${stepIndex}`);
    }

    const step = this.plan.steps[stepIndex];
    this.currentStepIndex = stepIndex;
    this.emitProgress();

    const startedAt = Date.now();

    console.log(`[AgentOrchestrator] Executing step ${stepIndex}: ${step.toolName}`);

    try {
      const result = await toolRegistry.execute(step.toolName, step.input, {
        userId: this.userId,
        chatId: this.chatId,
        runId: this.runId,
        userPlan: this.userPlan,
      });

      const completedAt = Date.now();

      const stepResult: StepResult = {
        stepIndex,
        toolName: step.toolName,
        success: result.success,
        output: result.output,
        artifacts: result.artifacts || [],
        error: result.error,
        startedAt,
        completedAt,
      };

      this.stepResults.push(stepResult);

      if (result.artifacts) {
        this.artifacts.push(...result.artifacts);
      }

      this.emitProgress();

      return result;
    } catch (error: any) {
      const completedAt = Date.now();

      const stepResult: StepResult = {
        stepIndex,
        toolName: step.toolName,
        success: false,
        output: null,
        artifacts: [],
        error: error.message,
        startedAt,
        completedAt,
      };

      this.stepResults.push(stepResult);
      this.emitProgress();

      return {
        success: false,
        output: null,
        error: error.message,
      };
    }
  }

  async run(): Promise<void> {
    if (this.status !== "queued" && this.status !== "planning") {
      throw new Error(`Cannot start run in status: ${this.status}`);
    }

    try {
      if (!this.plan) {
        throw new Error("No plan available. Call generatePlan first.");
      }

      this.status = "running";
      this.emitProgress();

      for (let i = 0; i < this.plan.steps.length; i++) {
        if (this.isCancelled) {
          this.status = "cancelled";
          this.emitProgress();
          console.log(`[AgentOrchestrator] Run ${this.runId} cancelled at step ${i}`);
          return;
        }

        const result = await this.executeStep(i);

        if (!result.success) {
          console.warn(`[AgentOrchestrator] Step ${i} failed: ${result.error}`);
        }
      }

      this.status = "completed";
      this.emitProgress();

      console.log(`[AgentOrchestrator] Run ${this.runId} completed successfully`);
    } catch (error: any) {
      this.status = "failed";
      this.emit("error", error);
      this.emitProgress();
      console.error(`[AgentOrchestrator] Run ${this.runId} failed:`, error.message);
      throw error;
    }
  }

  async cancel(): Promise<void> {
    this.isCancelled = true;
    this.status = "cancelled";
    this.emitProgress();
    console.log(`[AgentOrchestrator] Run ${this.runId} cancellation requested`);
  }

  async generateSummary(): Promise<string> {
    if (!this.plan) {
      return "No plan was executed.";
    }

    const completedSteps = this.stepResults.filter((r) => r.success);
    const failedSteps = this.stepResults.filter((r) => !r.success);

    const stepSummaries = this.stepResults.map((result) => {
      const step = this.plan!.steps[result.stepIndex];
      const status = result.success ? "✓" : "✗";
      const artifactCount = result.artifacts.length;
      return `${status} Step ${result.stepIndex + 1}: ${step.description}${
        artifactCount > 0 ? ` (${artifactCount} artifacts)` : ""
      }${result.error ? ` - Error: ${result.error}` : ""}`;
    }).join("\n");

    const artifactSummary = this.artifacts.length > 0
      ? `\n\nArtifacts generated:\n${this.artifacts.map((a) => `- ${a.name} (${a.type})`).join("\n")}`
      : "";

    const systemPrompt = `You are summarizing the results of an AI agent execution. Be concise and focus on what was accomplished.`;

    const messages: GeminiChatMessage[] = [
      {
        role: "user",
        parts: [{
          text: `Summarize this agent execution:

Objective: ${this.plan.objective}

Original user request: ${this.userMessage}

Step Results:
${stepSummaries}
${artifactSummary}

Status: ${this.status}
Completed: ${completedSteps.length}/${this.plan.steps.length} steps
${failedSteps.length > 0 ? `Failed: ${failedSteps.length} steps` : ""}

Provide a brief, user-friendly summary (2-4 sentences) of what was accomplished.`,
        }],
      },
    ];

    try {
      const response = await geminiChat(messages, {
        systemInstruction: systemPrompt,
        temperature: 0.5,
        maxOutputTokens: 500,
      });

      return response.content;
    } catch (error: any) {
      console.error(`[AgentOrchestrator] Failed to generate summary:`, error.message);
      
      return `Completed ${completedSteps.length} of ${this.plan.steps.length} steps for: ${this.plan.objective}. ${
        this.artifacts.length > 0 ? `Generated ${this.artifacts.length} artifact(s).` : ""
      }`;
    }
  }

  getProgress(): AgentProgress {
    return {
      runId: this.runId,
      status: this.status,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.plan?.steps.length || 0,
      plan: this.plan,
      stepResults: this.stepResults,
      artifacts: this.artifacts,
    };
  }
}

export class AgentManager {
  private activeRuns: Map<string, AgentOrchestrator> = new Map();
  private cleanupIntervalMs = 30 * 60 * 1000; // 30 minutes
  private maxRunAgeMs = 2 * 60 * 60 * 1000; // 2 hours

  constructor() {
    setInterval(() => this.cleanupOldRuns(), this.cleanupIntervalMs);
  }

  async startRun(
    runId: string,
    chatId: string,
    userId: string,
    message: string,
    attachments?: any[],
    userPlan: "free" | "pro" | "admin" = "free"
  ): Promise<AgentOrchestrator> {
    if (this.activeRuns.has(runId)) {
      throw new Error(`Run ${runId} already exists`);
    }

    const orchestrator = new AgentOrchestrator(runId, chatId, userId, userPlan);
    this.activeRuns.set(runId, orchestrator);

    await orchestrator.generatePlan(message, attachments);

    orchestrator.run().catch((error) => {
      console.error(`[AgentManager] Run ${runId} failed:`, error.message);
    });

    return orchestrator;
  }

  getRunStatus(runId: string): AgentProgress | null {
    const orchestrator = this.activeRuns.get(runId);
    if (!orchestrator) {
      return null;
    }
    return orchestrator.getProgress();
  }

  getOrchestrator(runId: string): AgentOrchestrator | undefined {
    return this.activeRuns.get(runId);
  }

  async cancelRun(runId: string): Promise<boolean> {
    const orchestrator = this.activeRuns.get(runId);
    if (!orchestrator) {
      return false;
    }
    await orchestrator.cancel();
    return true;
  }

  private cleanupOldRuns(): void {
    const now = Date.now();
    const runIds = Array.from(this.activeRuns.keys());

    for (const runId of runIds) {
      const orchestrator = this.activeRuns.get(runId);
      if (!orchestrator) continue;

      const isCompleted = ["completed", "failed", "cancelled"].includes(orchestrator.status);
      
      const lastResult = orchestrator.stepResults[orchestrator.stepResults.length - 1];
      const lastActivity = lastResult?.completedAt || 0;
      const age = now - lastActivity;

      if (isCompleted && age > this.maxRunAgeMs) {
        this.activeRuns.delete(runId);
        console.log(`[AgentManager] Cleaned up old run: ${runId}`);
      }
    }
  }

  getActiveRunCount(): number {
    return this.activeRuns.size;
  }

  listActiveRuns(): string[] {
    return Array.from(this.activeRuns.keys());
  }

  getActiveRunsForChat(chatId: string): AgentProgress[] {
    const runs: AgentProgress[] = [];
    for (const orchestrator of this.activeRuns.values()) {
      if (orchestrator.chatId === chatId) {
        runs.push(orchestrator.getProgress());
      }
    }
    // Sort by most recent first (based on step results)
    runs.sort((a, b) => {
      const aTime = a.stepResults.length > 0 ? a.stepResults[a.stepResults.length - 1].startedAt : 0;
      const bTime = b.stepResults.length > 0 ? b.stepResults[b.stepResults.length - 1].startedAt : 0;
      return bTime - aTime;
    });
    return runs;
  }
}

export const agentManager = new AgentManager();
