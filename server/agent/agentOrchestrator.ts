import { toolRegistry, type ToolResult, type ToolArtifact } from "./toolRegistry";
import { geminiChat, type GeminiChatMessage } from "../lib/gemini";
import type { User } from "@shared/schema";
import { EventEmitter } from "events";
import { agentEventBus } from "./eventBus";

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
  | "verifying"
  | "replanning"
  | "paused"
  | "cancelling"
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

export type EventType = 'action' | 'observation' | 'plan' | 'verification' | 'error' | 'replan' | 'thinking' | 'progress' | 'result';
export type EventStatus = 'ok' | 'warn' | 'fail';

export interface AgentEvent {
  type: EventType;
  kind: EventType;
  status: EventStatus;
  content: any;
  timestamp: number;
  stepIndex?: number;
  title?: string;
  summary?: string;
  confidence?: number;
  shouldRetry?: boolean;
  shouldReplan?: boolean;
  metadata?: Record<string, any>;
}

export interface TodoItem {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  stepIndex?: number;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface VerificationResult {
  success: boolean;
  shouldRetry: boolean;
  shouldReplan: boolean;
  feedback: string;
  suggestedAction?: string;
  confidence: number;
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
  todoList?: TodoItem[];
  eventStream?: AgentEvent[];
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
  {
    name: "read_file",
    description: "Read contents of a file from the agent's workspace.",
    inputSchema: "{ filepath: string }",
  },
  {
    name: "write_file",
    description: "Write or create a file in the agent's workspace.",
    inputSchema: "{ filepath: string, content: string }",
  },
  {
    name: "shell_command",
    description: "Execute a shell command in the agent's sandbox. Limited to safe operations.",
    inputSchema: "{ command: string, timeout?: number (1000-60000, default 30000) }",
  },
  {
    name: "list_files",
    description: "List files and directories in the agent's workspace.",
    inputSchema: "{ directory?: string (default '.') }",
  },
];

const MAX_RETRY_ATTEMPTS = 2;
const MAX_REPLAN_ATTEMPTS = 2;

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
  
  private eventStream: AgentEvent[] = [];
  private todoList: TodoItem[] = [];
  private workspaceFiles: Map<string, string> = new Map();
  private replanAttempts: number = 0;
  private stepRetryCount: Map<number, number> = new Map();

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

  private logEvent(
    type: EventType, 
    content: any, 
    stepIndex?: number, 
    options?: {
      title?: string;
      summary?: string;
      status?: EventStatus;
      confidence?: number;
      shouldRetry?: boolean;
      shouldReplan?: boolean;
      metadata?: Record<string, any>;
    }
  ): void {
    const inferredStatus = this.inferEventStatus(type, content, options?.status);
    const inferredTitle = options?.title || this.inferEventTitle(type, content);
    
    const event: AgentEvent = {
      type,
      kind: type,
      status: inferredStatus,
      content,
      timestamp: Date.now(),
      stepIndex,
      title: inferredTitle,
      summary: options?.summary,
      confidence: options?.confidence,
      shouldRetry: options?.shouldRetry,
      shouldReplan: options?.shouldReplan,
      metadata: options?.metadata,
    };
    this.eventStream.push(event);
    this.emit("event", { runId: this.runId, event, eventStream: this.eventStream });
    console.log(`[AgentOrchestrator][${this.runId}] Event: ${type} [${inferredStatus}]`, 
      inferredTitle || (typeof content === 'string' ? content.substring(0, 100) : JSON.stringify(content).substring(0, 100)));
  }

  private async emitTraceEvent(
    eventType: 'task_start' | 'plan_created' | 'step_started' | 'tool_call' | 'tool_output' | 'tool_chunk' | 
               'step_completed' | 'step_failed' | 'step_retried' | 'artifact_created' | 'verification' | 
               'shell_output' | 'observation' | 'thinking' | 'replan' | 'error' | 'done' | 'cancelled',
    options?: {
      stepIndex?: number;
      stepId?: string;
      phase?: 'planning' | 'executing' | 'verifying' | 'completed' | 'failed' | 'cancelled';
      status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';
      tool_name?: string;
      command?: string;
      output_snippet?: string;
      chunk_sequence?: number;
      is_final_chunk?: boolean;
      artifact?: { type: string; name: string; url?: string; data?: any };
      plan?: { objective: string; steps: { index: number; toolName: string; description: string }[]; estimatedTime?: string };
      error?: { code?: string; message: string; retryable?: boolean };
      summary?: string;
      confidence?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      await agentEventBus.emit(this.runId, eventType, options);
    } catch (err) {
      console.error(`[AgentOrchestrator] Failed to emit trace event ${eventType}:`, err);
    }
  }

  private inferEventStatus(type: EventType, content: any, explicitStatus?: EventStatus): EventStatus {
    if (explicitStatus) return explicitStatus;
    
    if (type === 'error') return 'fail';
    
    if (content?.success === true || content?.passed === true) return 'ok';
    if (content?.success === false || content?.passed === false) return 'fail';
    if (content?.shouldRetry || content?.shouldReplan) return 'warn';
    
    return 'ok';
  }

  private inferEventTitle(type: EventType, content: any): string {
    const toolNames: Record<string, string> = {
      web_search: 'Búsqueda web',
      browse_url: 'Navegación web',
      generate_document: 'Generando documento',
      analyze_spreadsheet: 'Analizando hoja de cálculo',
      generate_image: 'Generando imagen',
      read_file: 'Leyendo archivo',
      write_file: 'Escribiendo archivo',
      shell_command: 'Ejecutando comando',
      list_files: 'Listando archivos',
      respond: 'Respuesta',
    };

    if (content?.toolName) {
      return toolNames[content.toolName] || content.toolName;
    }
    if (content?.type) {
      return toolNames[content.type] || content.type;
    }
    if (type === 'plan') return 'Plan creado';
    if (type === 'verification') return 'Verificación';
    if (type === 'replan') return 'Replanificación';
    if (type === 'thinking') return 'Analizando';
    if (type === 'progress') return 'Progreso';
    
    return type.charAt(0).toUpperCase() + type.slice(1);
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
      todoList: this.todoList,
      eventStream: this.eventStream,
    };
    this.emit("progress", progress);
  }

  private initializeTodoList(): void {
    if (!this.plan) return;

    this.todoList = this.plan.steps.map((step, index) => ({
      id: `step-${index}`,
      task: step.description,
      status: index === 0 ? 'in_progress' : 'pending',
      stepIndex: index,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    this.updateWorkspaceFile('todo.md', this.generateTodoMarkdown());
    this.logEvent('plan', { 
      objective: this.plan.objective, 
      totalSteps: this.plan.steps.length,
      todoList: this.todoList 
    });
    this.emitProgress();
  }

  private generateTodoMarkdown(): string {
    const statusEmoji: Record<TodoItem['status'], string> = {
      'pending': '⏳',
      'in_progress': '🔄',
      'completed': '✅',
      'failed': '❌',
      'skipped': '⏭️',
    };

    let md = `# Agent Task Progress\n\n`;
    md += `**Objective:** ${this.plan?.objective || 'N/A'}\n`;
    md += `**Status:** ${this.status}\n`;
    md += `**Run ID:** ${this.runId}\n\n`;
    md += `## Tasks\n\n`;

    for (const item of this.todoList) {
      const emoji = statusEmoji[item.status];
      md += `- ${emoji} ${item.task}`;
      if (item.attempts > 1) {
        md += ` (attempts: ${item.attempts})`;
      }
      if (item.lastError) {
        md += `\n  - ⚠️ Error: ${item.lastError}`;
      }
      md += '\n';
    }

    const completed = this.todoList.filter(t => t.status === 'completed').length;
    const failed = this.todoList.filter(t => t.status === 'failed').length;
    md += `\n## Summary\n`;
    md += `- Completed: ${completed}/${this.todoList.length}\n`;
    md += `- Failed: ${failed}\n`;
    md += `- Last updated: ${new Date().toISOString()}\n`;

    return md;
  }

  private updateWorkspaceFile(filename: string, content: string): void {
    this.workspaceFiles.set(filename, content);
  }

  updateTodoList(stepIndex: number, status: TodoItem['status'], error?: string): void {
    const todoItem = this.todoList.find(t => t.stepIndex === stepIndex);
    if (!todoItem) return;

    todoItem.status = status;
    todoItem.updatedAt = Date.now();
    todoItem.attempts++;
    
    if (error) {
      todoItem.lastError = error;
    }

    if (status === 'completed' || status === 'failed' || status === 'skipped') {
      const nextItem = this.todoList.find(t => t.stepIndex === stepIndex + 1);
      if (nextItem && nextItem.status === 'pending') {
        nextItem.status = 'in_progress';
        nextItem.updatedAt = Date.now();
      }
    }

    this.updateWorkspaceFile('todo.md', this.generateTodoMarkdown());
    this.logEvent('observation', {
      type: 'todo_update',
      stepIndex,
      status,
      error,
      todoList: this.todoList,
    }, stepIndex);
    this.emitProgress();
  }

  async verifyStepResult(stepIndex: number, result: ToolResult): Promise<VerificationResult> {
    if (!this.plan) {
      return { 
        success: false, 
        shouldRetry: false, 
        shouldReplan: false,
        feedback: "No plan available", 
        confidence: 0 
      };
    }

    const step = this.plan.steps[stepIndex];
    const retryCount = this.stepRetryCount.get(stepIndex) || 0;

    this.status = "verifying";
    this.emitProgress();

    if (!result.success) {
      const shouldRetry = retryCount < MAX_RETRY_ATTEMPTS;
      const shouldReplan = !shouldRetry && this.replanAttempts < MAX_REPLAN_ATTEMPTS;

      const verification: VerificationResult = {
        success: false,
        shouldRetry,
        shouldReplan,
        feedback: `Step failed: ${result.error || 'Unknown error'}`,
        suggestedAction: shouldRetry ? 'Retry with modified parameters' : 
                         shouldReplan ? 'Replan remaining steps' : 'Mark as failed and continue',
        confidence: 0.9,
      };

      this.logEvent('verification', verification, stepIndex, {
        title: 'Verificación fallida',
        summary: verification.feedback,
        status: 'fail',
        confidence: verification.confidence,
        shouldRetry: verification.shouldRetry,
        shouldReplan: verification.shouldReplan,
      });
      return verification;
    }

    try {
      const verificationPrompt = `You are a verification agent. Analyze if the following step achieved its goal.

Step: ${step.description}
Tool: ${step.toolName}
Expected Output: ${step.expectedOutput}

Actual Result:
${JSON.stringify(result.output, null, 2).substring(0, 2000)}

Artifacts Generated: ${result.artifacts?.length || 0}

Respond with ONLY valid JSON:
{
  "success": true/false,
  "shouldRetry": true/false,
  "shouldReplan": true/false,
  "feedback": "Brief explanation of the result",
  "confidence": 0.0-1.0
}`;

      const messages: GeminiChatMessage[] = [
        { role: "user", parts: [{ text: verificationPrompt }] },
      ];

      const response = await geminiChat(messages, {
        systemInstruction: "You are a verification agent that evaluates task completion. Be objective and thorough.",
        temperature: 0.2,
        maxOutputTokens: 500,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const verification: VerificationResult = {
          success: parsed.success ?? true,
          shouldRetry: parsed.shouldRetry ?? false,
          shouldReplan: parsed.shouldReplan ?? false,
          feedback: parsed.feedback ?? "Step completed",
          confidence: parsed.confidence ?? 0.8,
        };

        this.logEvent('verification', verification, stepIndex, {
          title: verification.success ? 'Verificación exitosa' : 'Verificación fallida',
          summary: verification.feedback,
          status: verification.success ? 'ok' : (verification.shouldRetry || verification.shouldReplan ? 'warn' : 'fail'),
          confidence: verification.confidence,
          shouldRetry: verification.shouldRetry,
          shouldReplan: verification.shouldReplan,
        });
        return verification;
      }
    } catch (error: any) {
      console.warn(`[AgentOrchestrator] Verification LLM call failed, using basic verification:`, error.message);
    }

    const hasOutput = result.output !== null && result.output !== undefined;
    const hasArtifacts = (result.artifacts?.length || 0) > 0;

    const verification: VerificationResult = {
      success: hasOutput || hasArtifacts,
      shouldRetry: false,
      shouldReplan: false,
      feedback: hasOutput || hasArtifacts 
        ? "Step produced output/artifacts" 
        : "Step completed but produced no visible output",
      confidence: 0.7,
    };

    this.logEvent('verification', verification, stepIndex, {
      title: verification.success ? 'Verificación exitosa' : 'Verificación completada',
      summary: verification.feedback,
      status: verification.success ? 'ok' : 'warn',
      confidence: verification.confidence,
    });
    return verification;
  }

  async replanRemainingSteps(fromStepIndex: number, failureContext: string): Promise<boolean> {
    if (this.replanAttempts >= MAX_REPLAN_ATTEMPTS) {
      console.warn(`[AgentOrchestrator] Max replan attempts (${MAX_REPLAN_ATTEMPTS}) reached`);
      return false;
    }

    this.replanAttempts++;
    this.status = "replanning";
    this.emitProgress();

    this.logEvent('replan', {
      fromStepIndex,
      failureContext,
      attempt: this.replanAttempts,
    }, fromStepIndex);

    const completedSteps = this.stepResults
      .filter(r => r.success)
      .map(r => {
        const step = this.plan!.steps[r.stepIndex];
        return `✓ Step ${r.stepIndex + 1}: ${step.description}`;
      }).join('\n');

    const failedSteps = this.stepResults
      .filter(r => !r.success)
      .map(r => {
        const step = this.plan!.steps[r.stepIndex];
        return `✗ Step ${r.stepIndex + 1}: ${step.description} - Error: ${r.error}`;
      }).join('\n');

    const toolDescriptions = AVAILABLE_TOOLS.map(
      (t) => `- ${t.name}: ${t.description}\n  Input: ${t.inputSchema}`
    ).join("\n");

    const replanPrompt = `You are an AI agent planner. A previous plan partially failed and needs replanning.

Original Objective: ${this.plan?.objective}
Original User Request: ${this.userMessage}

Progress so far:
${completedSteps || 'No steps completed'}

Failed steps:
${failedSteps || 'None'}

Failure context: ${failureContext}

Available tools:
${toolDescriptions}

Create a NEW plan to complete the remaining objective, considering what has already been accomplished and what failed.
Focus on alternative approaches that might succeed.

Respond with ONLY valid JSON:
{
  "objective": "Updated objective based on progress",
  "steps": [
    {
      "index": 0,
      "toolName": "tool_name",
      "description": "What this step accomplishes",
      "input": { ... },
      "expectedOutput": "Expected result"
    }
  ],
  "estimatedTime": "X minutes"
}`;

    try {
      const messages: GeminiChatMessage[] = [
        { role: "user", parts: [{ text: replanPrompt }] },
      ];

      const response = await geminiChat(messages, {
        systemInstruction: "You are an adaptive AI planner that creates recovery plans when initial plans fail.",
        temperature: 0.4,
        maxOutputTokens: 2000,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Failed to parse replan JSON");
      }

      const newPlan: AgentPlan = JSON.parse(jsonMatch[0]);

      if (!newPlan.objective || !Array.isArray(newPlan.steps) || newPlan.steps.length === 0) {
        throw new Error("Invalid replan structure");
      }

      newPlan.steps = newPlan.steps.slice(0, 6);
      for (let i = 0; i < newPlan.steps.length; i++) {
        newPlan.steps[i].index = i;
      }

      this.plan = newPlan;
      this.currentStepIndex = 0;
      this.stepRetryCount.clear();

      this.todoList = newPlan.steps.map((step, index) => ({
        id: `replan-step-${index}`,
        task: step.description,
        status: index === 0 ? 'in_progress' : 'pending',
        stepIndex: index,
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      this.updateWorkspaceFile('todo.md', this.generateTodoMarkdown());
      this.logEvent('plan', { 
        type: 'replan',
        objective: newPlan.objective, 
        totalSteps: newPlan.steps.length,
        todoList: this.todoList,
        previousAttempts: this.replanAttempts,
      });

      console.log(`[AgentOrchestrator] Replanned with ${newPlan.steps.length} new steps (attempt ${this.replanAttempts})`);
      return true;
    } catch (error: any) {
      console.error(`[AgentOrchestrator] Replanning failed:`, error.message);
      this.logEvent('error', {
        type: 'replan_failed',
        error: error.message,
      });
      return false;
    }
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

    this.logEvent('action', {
      type: 'start_planning',
      userMessage: userMessage.substring(0, 500),
      attachmentCount: this.attachments.length,
    });

    const isConversational = await this.checkIfConversational(userMessage);
    if (isConversational && (!attachments || attachments.length === 0)) {
      const response = await this.generateConversationalResponse(userMessage);
      this.plan = {
        objective: "Respond to conversational message",
        steps: [],
        estimatedTime: "0 seconds",
        conversationalResponse: response
      } as AgentPlan & { conversationalResponse?: string };
      this.status = "completed";
      this.logEvent('observation', { type: 'conversational_response', response: response.substring(0, 200) });
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
      this.logEvent('plan', { objective: plan.objective, steps: plan.steps.length, estimatedTime: plan.estimatedTime });
      this.emitProgress();

      console.log(`[AgentOrchestrator] Generated plan with ${plan.steps.length} steps for run ${this.runId}`);
      return plan;
    } catch (error: any) {
      console.error(`[AgentOrchestrator] Failed to generate plan:`, error.message);
      
      this.logEvent('error', { type: 'plan_generation_failed', error: error.message });

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

    this.logEvent('action', {
      type: 'execute_step',
      stepIndex,
      toolName: step.toolName,
      description: step.description,
      input: step.input,
    }, stepIndex);

    await this.emitTraceEvent('step_started', {
      stepIndex,
      stepId: `step-${stepIndex}`,
      phase: 'executing',
      status: 'running',
      tool_name: step.toolName,
      summary: step.description,
    });

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

      this.logEvent('observation', {
        type: 'step_result',
        stepIndex,
        success: result.success,
        hasOutput: result.output !== null,
        artifactCount: result.artifacts?.length || 0,
        duration: completedAt - startedAt,
        error: result.error,
      }, stepIndex);

      await this.emitTraceEvent('tool_output', {
        stepIndex,
        stepId: `step-${stepIndex}`,
        tool_name: step.toolName,
        output_snippet: typeof result.output === 'string' 
          ? result.output.substring(0, 500) 
          : JSON.stringify(result.output).substring(0, 500),
        is_final_chunk: true,
      });

      if (result.success) {
        await this.emitTraceEvent('step_completed', {
          stepIndex,
          stepId: `step-${stepIndex}`,
          status: 'completed',
          tool_name: step.toolName,
        });
      } else {
        await this.emitTraceEvent('step_failed', {
          stepIndex,
          stepId: `step-${stepIndex}`,
          status: 'failed',
          tool_name: step.toolName,
          error: { message: result.error || 'Unknown error', retryable: true },
        });
      }

      if (result.artifacts && result.artifacts.length > 0) {
        for (const artifact of result.artifacts) {
          await this.emitTraceEvent('artifact_created', {
            stepIndex,
            stepId: `step-${stepIndex}`,
            artifact: {
              type: artifact.type,
              name: artifact.name,
              url: artifact.url,
              data: artifact.data,
            },
          });
        }
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

      this.logEvent('error', {
        type: 'step_execution_error',
        stepIndex,
        toolName: step.toolName,
        error: error.message,
        stack: error.stack?.substring(0, 500),
        duration: completedAt - startedAt,
      }, stepIndex);

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

      await this.emitTraceEvent('task_start', {
        phase: 'executing',
        status: 'running',
        summary: this.plan.objective,
      });

      await this.emitTraceEvent('plan_created', {
        phase: 'planning',
        plan: {
          objective: this.plan.objective,
          steps: this.plan.steps.map(s => ({ index: s.index, toolName: s.toolName, description: s.description })),
          estimatedTime: this.plan.estimatedTime,
        },
      });

      this.status = "running";
      this.initializeTodoList();
      this.emitProgress();

      this.logEvent('action', {
        type: 'run_started',
        totalSteps: this.plan.steps.length,
        objective: this.plan.objective,
      });

      let i = 0;
      while (i < this.plan.steps.length) {
        if (this.isCancelled) {
          this.status = "cancelled";
          this.updateTodoList(i, 'skipped');
          this.logEvent('observation', { type: 'run_cancelled', atStep: i });
          
          await this.emitTraceEvent('cancelled', {
            phase: 'cancelled',
            status: 'cancelled',
            stepIndex: i,
            summary: `Run cancelled at step ${i + 1}`,
          });

          this.emitProgress();
          console.log(`[AgentOrchestrator] Run ${this.runId} cancelled at step ${i}`);
          return;
        }

        this.updateTodoList(i, 'in_progress');
        const result = await this.executeStep(i);

        const verification = await this.verifyStepResult(i, result);

        if (!verification.success) {
          const retryCount = this.stepRetryCount.get(i) || 0;

          if (verification.shouldRetry && retryCount < MAX_RETRY_ATTEMPTS) {
            this.stepRetryCount.set(i, retryCount + 1);
            console.log(`[AgentOrchestrator] Retrying step ${i} (attempt ${retryCount + 2})`);
            this.logEvent('action', {
              type: 'retry_step',
              stepIndex: i,
              attempt: retryCount + 2,
              reason: verification.feedback,
            }, i);
            continue;
          }

          this.updateTodoList(i, 'failed', result.error || verification.feedback);

          if (verification.shouldReplan) {
            console.log(`[AgentOrchestrator] Attempting replan after step ${i} failure`);
            const replanSuccess = await this.replanRemainingSteps(i, verification.feedback);
            
            if (replanSuccess) {
              this.status = "running";
              i = 0;
              continue;
            }
          }

          console.warn(`[AgentOrchestrator] Step ${i} failed (non-recoverable): ${result.error}`);
        } else {
          this.updateTodoList(i, 'completed');
        }

        this.status = "running";
        i++;
      }

      this.status = "completed";
      this.logEvent('observation', {
        type: 'run_completed',
        totalSteps: this.plan.steps.length,
        successfulSteps: this.stepResults.filter(r => r.success).length,
        failedSteps: this.stepResults.filter(r => !r.success).length,
        artifactCount: this.artifacts.length,
      });

      const summary = await this.generateSummary();
      await this.emitTraceEvent('done', {
        phase: 'completed',
        status: 'completed',
        summary,
        metadata: {
          totalSteps: this.plan.steps.length,
          successfulSteps: this.stepResults.filter(r => r.success).length,
          failedSteps: this.stepResults.filter(r => !r.success).length,
          artifactCount: this.artifacts.length,
        },
      });

      this.emitProgress();

      console.log(`[AgentOrchestrator] Run ${this.runId} completed successfully`);
    } catch (error: any) {
      this.status = "failed";
      this.logEvent('error', {
        type: 'run_failed',
        error: error.message,
        stack: error.stack?.substring(0, 1000),
      });

      await this.emitTraceEvent('error', {
        phase: 'failed',
        status: 'failed',
        error: { message: error.message, retryable: false },
      });

      this.emit("error", error);
      this.emitProgress();
      console.error(`[AgentOrchestrator] Run ${this.runId} failed:`, error.message);
      throw error;
    }
  }

  async cancel(): Promise<void> {
    this.isCancelled = true;
    this.status = "cancelled";
    this.logEvent('action', { type: 'cancel_requested' });
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

    const eventSummary = `\nTotal events logged: ${this.eventStream.length}`;
    const replanInfo = this.replanAttempts > 0 ? `\nReplan attempts: ${this.replanAttempts}` : "";

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
${eventSummary}
${replanInfo}

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
      }${failedSteps.length > 0 ? ` ${failedSteps.length} step(s) failed.` : ""}`;
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
      todoList: this.todoList,
      eventStream: this.eventStream,
    };
  }

  getEventStream(): AgentEvent[] {
    return [...this.eventStream];
  }

  getTodoList(): TodoItem[] {
    return [...this.todoList];
  }

  getWorkspaceFile(filename: string): string | undefined {
    return this.workspaceFiles.get(filename);
  }

  getWorkspaceFiles(): Map<string, string> {
    return new Map(this.workspaceFiles);
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
    runs.sort((a, b) => {
      const aTime = a.stepResults.length > 0 ? a.stepResults[a.stepResults.length - 1].startedAt : 0;
      const bTime = b.stepResults.length > 0 ? b.stepResults[b.stepResults.length - 1].startedAt : 0;
      return bTime - aTime;
    });
    return runs;
  }

  getEventStream(runId: string): AgentEvent[] | null {
    const orchestrator = this.activeRuns.get(runId);
    if (!orchestrator) {
      return null;
    }
    return orchestrator.getEventStream();
  }

  getTodoList(runId: string): TodoItem[] | null {
    const orchestrator = this.activeRuns.get(runId);
    if (!orchestrator) {
      return null;
    }
    return orchestrator.getTodoList();
  }
}

export const agentManager = new AgentManager();
