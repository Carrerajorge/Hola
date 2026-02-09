import { randomUUID } from "crypto";
import { agentEventBus } from "./eventBus";
import { PAREOrchestrator, RobustRouteResult } from "../services/pare/orchestrator";
import { plannerAgent, PlanningContext } from "./roles/plannerAgent";
import { executorAgent, StepResult } from "./roles/executorAgent";
import type { ExecutionContext } from "./roles/executorAgent";
import { verifierAgent } from "./roles/verifierAgent";
import type { RunResultPackage } from "./roles/verifierAgent";
import type { AgentPlan } from "./contracts";
import type { TraceEventType } from "@shared/schema";
import { db } from "../db";
import { agentModeRuns, agentModeSteps } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface PipelineRequest {
  chatId: string;
  messageId: string;
  userId: string;
  message: string;
  attachments?: { name?: string; type?: string; path?: string; url?: string }[];
  conversationHistory?: { role: string; content: string }[];
  modelId?: string;
}

export interface PipelineResult {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  route: "chat" | "agent";
  plan?: AgentPlan;
  steps: StepResult[];
  artifacts: ArtifactOutput[];
  summary: string;
  error?: string;
  metrics: PipelineMetrics;
}

export interface ArtifactOutput {
  type: string;
  name: string;
  url?: string;
  data?: any;
}

export interface PipelineMetrics {
  totalDurationMs: number;
  routingDurationMs: number;
  planningDurationMs: number;
  executionDurationMs: number;
  verificationDurationMs: number;
  toolCallCount: number;
  retryCount: number;
}

type PipelinePhase = "idle" | "routing" | "planning" | "executing" | "verifying" | "completed" | "failed" | "cancelled";

interface PipelineState {
  runId: string;
  phase: PipelinePhase;
  routeResult?: RobustRouteResult;
  plan?: AgentPlan;
  steps: StepResult[];
  artifacts: ArtifactOutput[];
  currentStepIndex: number;
  error?: string;
  metrics: PipelineMetrics;
  startTime: number;
}

const PREMIUM_INTRO_TEMPLATE = (stepCount: number, tools: string[]) =>
  `Entendido. Voy a trabajar en esto en ${stepCount} pasos:\n\n` +
  `1. **Analizar** tu solicitud y confirmar requisitos\n` +
  `2. **Ejecutar** las herramientas necesarias (${tools.slice(0, 3).join(", ")}${tools.length > 3 ? "..." : ""})\n` +
  `3. **Verificar** que el resultado sea correcto\n` +
  `4. **Entregarte** el resultado final\n\n` +
  `Ahora mismo estoy en la fase de planificación. Te iré mostrando el progreso en tiempo real.`;

export class AgentPipeline {
  private pareOrchestrator: PAREOrchestrator;
  private activeRuns: Map<string, PipelineState> = new Map();

  constructor() {
    this.pareOrchestrator = new PAREOrchestrator();
  }

  private async persistRun(runId: string, request: PipelineRequest, status: string): Promise<void> {
    try {
      await db.insert(agentModeRuns).values({
        id: runId,
        chatId: request.chatId,
        messageId: request.messageId || null,
        userId: request.userId || null,
        status,
        plan: null,
        artifacts: null,
        summary: null,
        error: null,
        totalSteps: 0,
        completedSteps: 0,
        currentStepIndex: 0,
        startedAt: new Date(),
        completedAt: null,
        idempotencyKey: null,
      }).onConflictDoUpdate({
        target: agentModeRuns.id,
        set: { status, startedAt: new Date() },
      });
    } catch (error) {
      console.error(`[Pipeline] Failed to persist run ${runId}:`, error);
    }
  }

  private async updateRunStatus(
    runId: string,
    updates: {
      status?: string;
      plan?: any;
      totalSteps?: number;
      completedSteps?: number;
      currentStepIndex?: number;
      summary?: string;
      error?: string;
      artifacts?: any[];
      completedAt?: Date;
    }
  ): Promise<void> {
    try {
      await db.update(agentModeRuns)
        .set(updates)
        .where(eq(agentModeRuns.id, runId));
    } catch (error) {
      console.error(`[Pipeline] Failed to update run ${runId}:`, error);
    }
  }

  private async persistStep(
    runId: string,
    stepIndex: number,
    toolName: string,
    input: any,
    status: string
  ): Promise<string> {
    const stepId = randomUUID();
    try {
      await db.insert(agentModeSteps).values({
        id: stepId,
        runId,
        stepIndex,
        toolName,
        toolInput: input || {},
        status,
        startedAt: new Date(),
      }).onConflictDoNothing();
    } catch (error) {
      console.error(`[Pipeline] Failed to persist step ${stepIndex} for run ${runId}:`, error);
    }
    return stepId;
  }

  private async updateStepStatus(
    runId: string,
    stepIndex: number,
    updates: {
      status?: string;
      toolOutput?: any;
      error?: string;
      completedAt?: Date;
    }
  ): Promise<void> {
    try {
      await db.update(agentModeSteps)
        .set(updates)
        .where(and(
          eq(agentModeSteps.runId, runId),
          eq(agentModeSteps.stepIndex, stepIndex)
        ));
    } catch (error) {
      console.error(`[Pipeline] Failed to update step ${stepIndex} for run ${runId}:`, error);
    }
  }

  async execute(request: PipelineRequest): Promise<PipelineResult> {
    const runId = randomUUID();
    const startTime = Date.now();

    const state: PipelineState = {
      runId,
      phase: "idle",
      steps: [],
      artifacts: [],
      currentStepIndex: 0,
      metrics: {
        totalDurationMs: 0,
        routingDurationMs: 0,
        planningDurationMs: 0,
        executionDurationMs: 0,
        verificationDurationMs: 0,
        toolCallCount: 0,
        retryCount: 0,
      },
      startTime,
    };

    this.activeRuns.set(runId, state);

    try {
      await this.persistRun(runId, request, "planning");

      await this.emitEvent(runId, "task_start", {
        metadata: {
          chatId: request.chatId,
          userId: request.userId,
          message: request.message.slice(0, 200),
        },
      });

      state.phase = "routing";
      const routingStart = Date.now();
      const routeResult = await this.routeRequest(runId, request);
      state.routeResult = routeResult;
      state.metrics.routingDurationMs = Date.now() - routingStart;

      if (routeResult.route === "chat") {
        state.phase = "completed";
        state.metrics.totalDurationMs = Date.now() - startTime;

        await this.emitEvent(runId, "done", {
          summary: "Procesado como chat directo",
          metadata: { route: "chat" },
        });

        return {
          runId,
          status: "completed",
          route: "chat",
          steps: [],
          artifacts: [],
          summary: "Respuesta directa de chat",
          metrics: state.metrics,
        };
      }

      state.phase = "planning";
      const planningStart = Date.now();
      const plan = await this.createPlan(runId, request, routeResult);
      state.plan = plan;
      state.metrics.planningDurationMs = Date.now() - planningStart;

      await this.updateRunStatus(runId, {
        status: "running",
        plan: {
          objective: plan.objective,
          steps: plan.steps.map((s: any, i: number) => ({
            index: i,
            toolName: s.toolName || s.tool,
            description: s.description,
          })),
        },
        totalSteps: plan.steps.length,
      });

      await this.emitEvent(runId, "plan_created", {
        plan: {
          objective: plan.objective,
          steps: plan.steps.map((s: any, i: number) => ({
            index: i,
            toolName: s.toolName || s.tool,
            description: s.description,
          })),
          estimatedTime: `${plan.steps.length * 5}s`,
        },
      });

      const introMessage = PREMIUM_INTRO_TEMPLATE(
        plan.steps.length,
        plan.steps.map((s: any) => s.toolName || s.tool)
      );

      await this.emitEvent(runId, "thinking", {
        output_snippet: introMessage,
        metadata: { type: "premium_intro" },
      });

      state.phase = "executing";
      const executionStart = Date.now();
      const executionResult = await this.executeSteps(runId, state, request);
      state.steps = executionResult.steps;
      state.artifacts = executionResult.artifacts;
      state.metrics.executionDurationMs = Date.now() - executionStart;
      state.metrics.toolCallCount = executionResult.toolCallCount;
      state.metrics.retryCount = executionResult.retryCount;

      if (executionResult.failed) {
        state.phase = "failed";
        state.error = executionResult.error;
        state.metrics.totalDurationMs = Date.now() - startTime;

        await this.updateRunStatus(runId, {
          status: "failed",
          error: executionResult.error || "Unknown error",
          completedSteps: state.steps.filter(s => s.success).length,
          completedAt: new Date(),
        });

        await this.emitEvent(runId, "error", {
          error: { message: executionResult.error || "Unknown error", code: "EXECUTION_FAILED" },
        });

        return {
          runId,
          status: "failed",
          route: "agent",
          plan,
          steps: state.steps,
          artifacts: state.artifacts,
          summary: `Falló durante la ejecución: ${executionResult.error}`,
          error: executionResult.error,
          metrics: state.metrics,
        };
      }

      state.phase = "verifying";
      const verificationStart = Date.now();
      const verificationResult = await this.verifyResult(runId, state, request);
      state.metrics.verificationDurationMs = Date.now() - verificationStart;

      await this.emitEvent(runId, "verification", {
        status: verificationResult.passed ? "passed" : "failed",
        confidence: verificationResult.confidence,
        summary: verificationResult.summary,
      });

      if (!verificationResult.passed && verificationResult.canRetry) {
        state.metrics.retryCount++;
        console.log(`[Pipeline] Verification failed, attempting recovery for run ${runId}`);
      }

      state.phase = "completed";
      state.metrics.totalDurationMs = Date.now() - startTime;

      const finalSummary = this.generatePremiumSummary(state, verificationResult);

      await this.updateRunStatus(runId, {
        status: "completed",
        summary: finalSummary,
        completedSteps: state.steps.filter(s => s.success).length,
        artifacts: state.artifacts,
        completedAt: new Date(),
      });

      await this.emitEvent(runId, "done", {
        summary: finalSummary,
        metadata: {
          stepsCompleted: state.steps.filter(s => s.success).length,
          totalSteps: state.steps.length,
          artifactsGenerated: state.artifacts.length,
          durationMs: state.metrics.totalDurationMs,
        },
      });

      return {
        runId,
        status: "completed",
        route: "agent",
        plan,
        steps: state.steps,
        artifacts: state.artifacts,
        summary: finalSummary,
        metrics: state.metrics,
      };

    } catch (error) {
      state.phase = "failed";
      state.error = error instanceof Error ? error.message : String(error);
      state.metrics.totalDurationMs = Date.now() - startTime;

      await this.updateRunStatus(runId, {
        status: "failed",
        error: state.error,
        completedAt: new Date(),
      });

      await this.emitEvent(runId, "error", {
        error: { message: state.error, code: "PIPELINE_ERROR" },
      });

      return {
        runId,
        status: "failed",
        route: "agent",
        plan: state.plan,
        steps: state.steps,
        artifacts: state.artifacts,
        summary: `Error en el pipeline: ${state.error}`,
        error: state.error,
        metrics: state.metrics,
      };
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private async routeRequest(runId: string, request: PipelineRequest): Promise<RobustRouteResult> {
    const attachments = (request.attachments || []).map(a => ({
      name: a.name,
      type: a.type,
      path: a.path || a.url,
    }));

    const result = this.pareOrchestrator.robustRoute(request.message, attachments);

    await this.emitEvent(runId, "thinking", {
      output_snippet: `Analizando solicitud... Detectado: ${result.intent} (confianza: ${(result.confidence * 100).toFixed(0)}%)`,
      metadata: {
        intent: result.intent,
        route: result.route,
        tools: result.tools,
      },
    });

    return result;
  }

  private async createPlan(
    runId: string,
    request: PipelineRequest,
    routeResult: RobustRouteResult
  ): Promise<AgentPlan> {
    await this.emitEvent(runId, "thinking", {
      output_snippet: "Creando plan de ejecución...",
    });

    const planningContext: PlanningContext = {
      runId,
      userId: request.userId,
      userPlan: "pro" as const,
      chatId: request.chatId,
      correlationId: runId,
      conversationHistory: request.conversationHistory?.map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })) || [],
      availableTools: routeResult.tools,
      maxSteps: 10,
      requireCitations: false,
      constraints: {
        maxTimeMs: 60000,
        allowedCapabilities: routeResult.tools,
      },
    };

    const plan = await plannerAgent.generatePlan(request.message, planningContext);

    return plan;
  }

  private async executeSteps(
    runId: string,
    state: PipelineState,
    request: PipelineRequest
  ): Promise<{
    steps: StepResult[];
    artifacts: ArtifactOutput[];
    toolCallCount: number;
    retryCount: number;
    failed: boolean;
    error?: string;
  }> {
    const steps: StepResult[] = [];
    const artifacts: ArtifactOutput[] = [];
    let toolCallCount = 0;
    let retryCount = 0;

    if (!state.plan) {
      return { steps, artifacts, toolCallCount, retryCount, failed: true, error: "No plan available" };
    }

    for (let i = 0; i < state.plan.steps.length; i++) {
      const planStep = state.plan.steps[i];
      state.currentStepIndex = i;

      await this.persistStep(runId, i, planStep.toolName, planStep.input, "running");

      await this.updateRunStatus(runId, { currentStepIndex: i });

      await this.emitEvent(runId, "step_started", {
        stepIndex: i,
        tool_name: planStep.toolName,
        command: planStep.description,
      });

      await this.emitEvent(runId, "tool_call", {
        stepIndex: i,
        tool_name: planStep.toolName,
        command: planStep.description,
        metadata: { inputs: planStep.input, agentName: (planStep as any).agent || "ExecutorAgent" },
      });

      toolCallCount++;

      try {
        const executionContext: ExecutionContext = {
          runId,
          userId: request.userId,
          userPlan: "pro" as const,
          chatId: request.chatId,
          correlationId: runId,
        };

        const result = await executorAgent.executeStep(planStep, executionContext);
        steps.push(result);

        if (result.artifacts) {
          for (const artifact of result.artifacts) {
            artifacts.push({
              type: artifact.type,
              name: artifact.name,
              url: artifact.url,
              data: artifact.data,
            });

            await this.emitEvent(runId, "artifact_created", {
              stepIndex: i,
              artifact: {
                type: artifact.type,
                name: artifact.name,
                url: artifact.url,
              },
            });
          }
        }

        await this.emitEvent(runId, "tool_output", {
          stepIndex: i,
          tool_name: planStep.toolName,
          output_snippet: typeof result.output === "string" 
            ? result.output.slice(0, 500) 
            : JSON.stringify(result.output).slice(0, 500),
          status: result.success ? "completed" : "failed",
        });

        if (result.success) {
          await this.updateStepStatus(runId, i, {
            status: "succeeded",
            toolOutput: result.output,
            completedAt: new Date(),
          });

          await this.emitEvent(runId, "step_completed", {
            stepIndex: i,
            tool_name: planStep.toolName,
          });
        } else {
          const errorMsg = typeof result.error === 'string' ? result.error : result.error?.message || "Unknown error";
          await this.updateStepStatus(runId, i, {
            status: "failed",
            error: errorMsg,
            completedAt: new Date(),
          });

          await this.emitEvent(runId, "step_failed", {
            stepIndex: i,
            tool_name: planStep.toolName,
            error: { message: errorMsg },
          });

          if (i < state.plan.steps.length - 1 && !planStep.optional) {
            retryCount++;
            await this.emitEvent(runId, "step_retried", {
              stepIndex: i,
              tool_name: planStep.toolName,
              metadata: { retryCount, reason: errorMsg },
            });
            continue;
          }

          return {
            steps,
            artifacts,
            toolCallCount,
            retryCount,
            failed: true,
            error: errorMsg,
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        steps.push({
          stepIndex: i,
          toolName: planStep.toolName,
          success: false,
          error: { code: "EXCEPTION", message: errorMessage, retryable: false },
          output: null,
          durationMs: 0,
          retryCount: 0,
          artifacts: [],
          citations: [],
        });

        await this.updateStepStatus(runId, i, {
          status: "failed",
          error: errorMessage,
          completedAt: new Date(),
        });

        await this.emitEvent(runId, "step_failed", {
          stepIndex: i,
          tool_name: planStep.toolName,
          error: { message: errorMessage },
        });

        return {
          steps,
          artifacts,
          toolCallCount,
          retryCount,
          failed: true,
          error: errorMessage,
        };
      }
    }

    return { steps, artifacts, toolCallCount, retryCount, failed: false };
  }

  private async verifyResult(
    runId: string,
    state: PipelineState,
    request: PipelineRequest
  ): Promise<{
    passed: boolean;
    confidence: number;
    summary: string;
    canRetry: boolean;
    issues: string[];
  }> {
    await this.emitEvent(runId, "thinking", {
      output_snippet: "Verificando resultado...",
    });

    if (!state.plan) {
      return {
        passed: true,
        confidence: 0.5,
        summary: "No hay plan para verificar",
        canRetry: false,
        issues: [],
      };
    }

    const successfulSteps = state.steps.filter(s => s.success).length;
    const totalSteps = state.steps.length;
    const successRate = totalSteps > 0 ? successfulSteps / totalSteps : 0;

    const verificationPackage: RunResultPackage = {
      runId,
      correlationId: runId,
      objective: state.plan?.objective || "",
      stepResults: state.steps,
      artifacts: state.artifacts.map(a => ({
        id: randomUUID(),
        type: a.type as any,
        name: a.name,
        path: a.url || "",
        createdAt: new Date(),
      })),
      citations: [],
    };

    try {
      const verificationResult = await verifierAgent.verify(verificationPackage);

      return {
        passed: verificationResult.passed,
        confidence: verificationResult.score,
        summary: `Verificación completada: score=${verificationResult.score.toFixed(2)}`,
        canRetry: !verificationResult.passed && successRate > 0.5,
        issues: verificationResult.issues.map(iss => iss.description),
      };
    } catch (error) {
      console.error(`[Pipeline] Verification error for run ${runId}:`, error);
      return {
        passed: successRate >= 0.8,
        confidence: successRate,
        summary: `Verificación parcial: ${successfulSteps}/${totalSteps} pasos exitosos`,
        canRetry: false,
        issues: [],
      };
    }
  }

  private generatePremiumSummary(
    state: PipelineState,
    verificationResult: { passed: boolean; summary: string }
  ): string {
    const successfulSteps = state.steps.filter(s => s.success).length;
    const totalSteps = state.steps.length;
    const durationSec = (state.metrics.totalDurationMs / 1000).toFixed(1);

    let summary = "";

    if (verificationResult.passed) {
      summary = `✅ **Completado exitosamente** en ${durationSec}s\n\n`;
      summary += `He ejecutado ${successfulSteps} pasos para completar tu solicitud.\n\n`;

      if (state.artifacts.length > 0) {
        summary += `**Artefactos generados:**\n`;
        for (const artifact of state.artifacts) {
          summary += `- ${artifact.name} (${artifact.type})\n`;
        }
        summary += `\n`;
      }

      summary += verificationResult.summary;
    } else {
      summary = `⚠️ **Completado con observaciones** en ${durationSec}s\n\n`;
      summary += `Se ejecutaron ${successfulSteps}/${totalSteps} pasos correctamente.\n\n`;
      summary += verificationResult.summary;
    }

    return summary;
  }

  private async emitEvent(
    runId: string,
    eventType: TraceEventType,
    options: {
      stepIndex?: number;
      tool_name?: string;
      command?: string;
      output_snippet?: string;
      status?: string;
      phase?: string;
      error?: { message: string; code?: string };
      artifact?: { type: string; name: string; url?: string };
      plan?: { objective: string; steps: { index: number; toolName: string; description: string }[]; estimatedTime?: string };
      summary?: string;
      confidence?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      await agentEventBus.emit(runId, eventType, options as any);
    } catch (error) {
      console.error(`[Pipeline] Failed to emit event ${eventType} for run ${runId}:`, error);
    }
  }

  getActiveRun(runId: string): PipelineState | undefined {
    return this.activeRuns.get(runId);
  }

  async cancelRun(runId: string, reason?: string): Promise<boolean> {
    const state = this.activeRuns.get(runId);
    if (!state) {
      return false;
    }

    state.phase = "cancelled";
    state.error = reason || "Cancelled by user";

    await this.emitEvent(runId, "cancelled", {
      summary: reason || "Cancelled by user",
    });

    return true;
  }
}

export const agentPipeline = new AgentPipeline();
