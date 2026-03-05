/**
 * Super Agent Controller — Unified Entry Point
 *
 * The central brain that coordinates ALL agent subsystems:
 * - SuperAgentRouter: Intelligent task routing
 * - MultiModelOrchestrator: Multi-AI model dispatch
 * - BackgroundTaskManager: Persistent autonomous tasks
 * - ParallelResearchEngine: Web research + synthesis
 * - ToolConnectorHub: External tool integrations
 * - ComputerUseEngine: Desktop/browser automation
 * - WorkflowEngine: Multi-step workflow execution
 * - AgenticStateGraph: Formal state machine
 * - AgentOrchestrator: Core tool-calling agent
 *
 * This is the single point of entry for all super agent operations.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { agentEventBus } from "./eventBus";
import { superAgentRouter, type RouteDecision, type EngineType, type ModelTarget } from "./superAgentRouter";
import { orchestrator as multiModelOrchestrator } from "./multiModelOrchestrator";
import { backgroundTaskManager, type BackgroundTaskDefinition } from "./backgroundTaskManager";
import { parallelResearchEngine, type ResearchQuery } from "./parallelResearchEngine";
import { toolConnectorHub, type ConnectorAction } from "./toolConnectorHub";

// ============================================
// Types
// ============================================

export interface SuperAgentRequest {
  id?: string;
  userId: string;
  chatId: string;
  message: string;
  attachments?: any[];
  context?: {
    chatHistory?: Array<{ role: string; content: string }>;
    userPlan?: "free" | "pro" | "admin";
    modelOverride?: string;
    enableBackgroundTasks?: boolean;
    enableParallelResearch?: boolean;
    enableToolConnectors?: boolean;
    enableComputerUse?: boolean;
  };
}

export interface SuperAgentResponse {
  id: string;
  routeDecision: RouteDecision;
  result: any;
  engine: EngineType;
  model: string;
  durationMs: number;
  artifacts?: any[];
  backgroundTaskIds?: string[];
  metadata: Record<string, any>;
}

export type SuperAgentStatus = {
  activeRequests: number;
  backgroundTasks: number;
  connectedTools: number;
  modelsAvailable: string[];
  uptime: number;
};

// ============================================
// Super Agent Controller
// ============================================

export class SuperAgentController extends EventEmitter {
  private activeRequests: Map<string, { request: SuperAgentRequest; startTime: number; abort: AbortController }> = new Map();
  private startTime: number = Date.now();

  constructor() {
    super();
    this.setMaxListeners(50);

    // Wire up event forwarding
    backgroundTaskManager.on("notification", (data) => this.emit("notification", data));
    parallelResearchEngine.on("research_progress", (data) => this.emit("research_progress", data));
    superAgentRouter.on("route_decided", (data) => this.emit("route_decided", data));
  }

  /**
   * Main entry point — process a user request through the super agent system.
   */
  async process(request: SuperAgentRequest): Promise<SuperAgentResponse> {
    const requestId = request.id || randomUUID();
    const startTime = Date.now();
    const abort = new AbortController();

    this.activeRequests.set(requestId, { request, startTime, abort });
    this.emit("request_started", { requestId, message: request.message });

    try {
      // Step 1: Route the request
      const routeDecision = await superAgentRouter.route(
        request.message,
        request.userId,
        {
          chatHistory: request.context?.chatHistory,
          attachments: request.attachments,
          userPlan: request.context?.userPlan,
        }
      );

      this.emit("route_decided", { requestId, routeDecision });

      // Step 2: Execute based on routing decision
      const result = await this.executeRoute(requestId, request, routeDecision);

      // Step 3: Build response
      const response: SuperAgentResponse = {
        id: requestId,
        routeDecision,
        result,
        engine: routeDecision.engine,
        model: routeDecision.suggestedModel,
        durationMs: Date.now() - startTime,
        artifacts: result?.artifacts,
        backgroundTaskIds: result?.backgroundTaskIds,
        metadata: {
          routeConfidence: routeDecision.confidence,
          routeMethod: routeDecision.metadata?.method,
        },
      };

      superAgentRouter.completeRoute(routeDecision.id);
      this.emit("request_completed", { requestId, response });
      return response;

    } catch (err: any) {
      this.emit("request_failed", { requestId, error: err.message });
      throw err;
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Execute based on the routing decision.
   */
  private async executeRoute(
    requestId: string,
    request: SuperAgentRequest,
    route: RouteDecision
  ): Promise<any> {
    switch (route.engine) {
      case "orchestrator":
        return this.executeOrchestrator(request, route);

      case "computer_use":
        return this.executeComputerUse(request, route);

      case "workflow":
        return this.executeWorkflow(request, route);

      case "research_pipeline":
        return this.executeResearchPipeline(request, route);

      case "parallel_research":
        return this.executeParallelResearch(request, route);

      case "background_task":
        return this.executeBackgroundTask(request, route);

      case "multi_engine":
        return this.executeMultiEngine(requestId, request, route);

      default:
        return this.executeOrchestrator(request, route);
    }
  }

  /**
   * Execute via the core agent orchestrator.
   */
  private async executeOrchestrator(request: SuperAgentRequest, route: RouteDecision): Promise<any> {
    const { AgentOrchestrator } = await import("./agentOrchestrator");
    const orchestrator = new AgentOrchestrator(
      randomUUID(),
      request.chatId,
      request.userId,
      request.context?.userPlan || "free",
      request.context?.modelOverride
    );

    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const artifacts: any[] = [];

      orchestrator.on("event", (data: any) => {
        this.emit("agent_event", { requestId: request.id, ...data });
      });

      orchestrator.on("progress", (data: any) => {
        this.emit("agent_progress", { requestId: request.id, ...data });
      });

      orchestrator.on("completed", () => {
        resolve({
          type: "orchestrator",
          results,
          artifacts,
          summary: orchestrator.summary,
        });
      });

      orchestrator.on("failed", (data: any) => {
        reject(new Error(data?.error || "Orchestrator execution failed"));
      });

      orchestrator.generatePlan(request.message, request.attachments || [])
        .then(() => orchestrator.run())
        .catch(reject);
    });
  }

  /**
   * Execute via the computer use engine.
   */
  private async executeComputerUse(request: SuperAgentRequest, route: RouteDecision): Promise<any> {
    try {
      const { ComputerUseEngine } = await import("./computerUseEngine");
      const engine = new ComputerUseEngine();

      const sessionId = await engine.createSession("browser");
      const result = await engine.executeTask(sessionId, {
        description: request.message,
        steps: [],
        successCriteria: [],
        maxAttempts: 3,
        timeout: 120000,
      }, (step, screenshot) => {
        this.emit("agent_progress", { requestId: request.id, step, screenshot });
      });

      return { type: "computer_use", ...result };
    } catch (err: any) {
      // Fallback to orchestrator if computer use fails
      console.warn("[SuperAgent] Computer use failed, falling back to orchestrator:", err.message);
      return this.executeOrchestrator(request, route);
    }
  }

  /**
   * Execute via the workflow engine.
   */
  private async executeWorkflow(request: SuperAgentRequest, route: RouteDecision): Promise<any> {
    try {
      const { workflowEngine } = await import("./workflowEngine");
      const { llmGateway } = await import("../lib/llmGateway");

      // Use LLM to convert natural language to workflow definition
      const response = await llmGateway.chat(
        [
          {
            role: "system" as const,
            content: `Convert the user's request into a workflow definition JSON. The workflow has steps with types: action, condition, loop, parallel. Action steps have tools: browser, terminal, http, transform, notify. Return valid JSON only.`,
          },
          { role: "user" as const, content: request.message },
        ],
        { model: "claude-opus-4-6", temperature: 0, maxTokens: 2000 }
      );

      const definition = JSON.parse(typeof response === "string" ? response : response?.content || "{}");
      const result = await workflowEngine.executeWorkflow(definition);

      return { type: "workflow", ...result };
    } catch (err: any) {
      console.warn("[SuperAgent] Workflow execution failed, falling back:", err.message);
      return this.executeOrchestrator(request, route);
    }
  }

  /**
   * Execute via the academic research pipeline.
   */
  private async executeResearchPipeline(request: SuperAgentRequest, route: RouteDecision): Promise<any> {
    try {
      const { createSuperAgent } = await import("./superAgent/orchestrator");

      const agent = createSuperAgent(randomUUID(), {
        maxIterations: 20,
      });

      agent.on("sse", (event: any) => {
        this.emit("research_progress", { requestId: request.id, ...event });
      });

      return await agent.execute(request.message);
    } catch (err: any) {
      // Fallback to parallel research
      return this.executeParallelResearch(request, route);
    }
  }

  /**
   * Execute via the parallel research engine.
   */
  private async executeParallelResearch(request: SuperAgentRequest, route: RouteDecision): Promise<any> {
    const query: ResearchQuery = {
      topic: request.message,
      depth: "deep",
      sources: ["web_search", "news", "academic", "github"],
      language: /[áéíóúñ]/i.test(request.message) ? "es" : "en",
      requireCitations: true,
      userId: request.userId,
      outputFormat: "report",
    };

    parallelResearchEngine.on("research_progress", (progress) => {
      this.emit("agent_progress", { requestId: request.id, ...progress });
    });

    const result = await parallelResearchEngine.research(query);

    return { type: "parallel_research", ...result };
  }

  /**
   * Create a background task.
   */
  private async executeBackgroundTask(request: SuperAgentRequest, route: RouteDecision): Promise<any> {
    const { llmGateway } = await import("../lib/llmGateway");

    // Use LLM to parse the background task definition
    const response = await llmGateway.chat(
      [
        {
          role: "system" as const,
          content: `Parse the user's request into a background task definition. Return JSON with:
{
  "name": "task name",
  "description": "what it does",
  "type": "recurring|monitor|pipeline|one_shot",
  "action": { "type": "llm_query|web_search|web_scrape|api_call", "config": {} },
  "schedule": { "intervalMs": number, "maxRuns": number },
  "monitor": { "condition": { "type": "url_change|price_threshold|keyword_alert", "target": "url", "operator": "changed|greater_than", "value": any }, "checkIntervalMs": number, "alertOnChange": true },
  "notify": { "channels": ["in_app"], "onComplete": true, "onConditionMet": true }
}`,
        },
        { role: "user" as const, content: request.message },
      ],
      { model: "claude-opus-4-6", temperature: 0, maxTokens: 1500 }
    );

    const definition = JSON.parse(typeof response === "string" ? response : response?.content || "{}");

    const task = await backgroundTaskManager.registerTask({
      ...definition,
      userId: request.userId,
    } as BackgroundTaskDefinition);

    return {
      type: "background_task",
      taskId: task.id,
      name: task.name,
      state: task.state,
      message: `Background task "${task.name}" created and started. ID: ${task.id}`,
      backgroundTaskIds: [task.id],
    };
  }

  /**
   * Execute multiple engines in parallel for compound tasks.
   */
  private async executeMultiEngine(
    requestId: string,
    request: SuperAgentRequest,
    route: RouteDecision
  ): Promise<any> {
    if (!route.subTasks || route.subTasks.length === 0) {
      // Fallback to orchestrator for compound tasks without explicit sub-tasks
      return this.executeOrchestrator(request, route);
    }

    const results = await Promise.all(
      route.subTasks.map(async (subTask) => {
        const subRequest: SuperAgentRequest = {
          ...request,
          id: subTask.id,
          message: subTask.description,
        };

        const subRoute: RouteDecision = {
          ...route,
          id: subTask.id,
          engine: subTask.engine,
          suggestedModel: subTask.model,
        };

        return this.executeRoute(subTask.id, subRequest, subRoute);
      })
    );

    return {
      type: "multi_engine",
      subResults: results,
      message: `Completed ${results.length} parallel sub-tasks`,
    };
  }

  // ============================================
  // Tool Connector Actions
  // ============================================

  /**
   * Execute a tool connector action directly.
   */
  async executeConnectorAction(action: ConnectorAction): Promise<any> {
    return toolConnectorHub.execute(action);
  }

  // ============================================
  // Background Task Management
  // ============================================

  /**
   * List background tasks for a user.
   */
  listBackgroundTasks(userId: string) {
    return backgroundTaskManager.listTasks(userId);
  }

  /**
   * Pause a background task.
   */
  pauseBackgroundTask(taskId: string) {
    backgroundTaskManager.pauseTask(taskId);
  }

  /**
   * Resume a background task.
   */
  resumeBackgroundTask(taskId: string) {
    return backgroundTaskManager.resumeTask(taskId);
  }

  /**
   * Cancel a background task.
   */
  cancelBackgroundTask(taskId: string) {
    backgroundTaskManager.cancelTask(taskId);
  }

  // ============================================
  // Status & Monitoring
  // ============================================

  /**
   * Get overall system status.
   */
  getStatus(): SuperAgentStatus {
    return {
      activeRequests: this.activeRequests.size,
      backgroundTasks: backgroundTaskManager.getActiveCount(),
      connectedTools: toolConnectorHub.listConnectors().filter((c) => c.enabled).length,
      modelsAvailable: ["opus", "gemini", "grok", "chatgpt", "nano_banana", "veo"],
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Get connected tools status.
   */
  getConnectedTools() {
    return toolConnectorHub.listConnectors();
  }

  /**
   * Get model cost report.
   */
  getCostReport() {
    return multiModelOrchestrator.getCostReport();
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    // Cancel all active requests
    for (const [, { abort }] of this.activeRequests) {
      abort.abort();
    }

    await backgroundTaskManager.shutdown();
    this.emit("shutdown");
  }
}

// Singleton
export const superAgentController = new SuperAgentController();
