import crypto from "crypto";
import { storage } from "../../storage";
import { toolRegistry } from "./registry";
import { interpretIntent, createPlan, refinePlan } from "./planner";
import { pipelineExecutor, StepCallback } from "./executor";
import { registerBuiltinTools } from "./tools";
import {
  ExecutionPlan,
  PipelineResult,
  PipelineConfig,
  DEFAULT_PIPELINE_CONFIG,
  ProgressUpdate,
  StepResult,
  Artifact
} from "./types";

let initialized = false;

export function initializePipeline(): void {
  if (initialized) return;
  registerBuiltinTools();
  initialized = true;
  console.log("Pipeline engine initialized");
}

export interface PipelineRunOptions {
  objective: string;
  conversationId?: string;
  userId?: string;
  config?: Partial<PipelineConfig>;
  onProgress?: (update: ProgressUpdate) => void;
}

export async function runPipeline(options: PipelineRunOptions): Promise<PipelineResult> {
  const { objective, conversationId, userId, config, onProgress } = options;
  const startTime = Date.now();
  
  initializePipeline();
  
  const runId = crypto.randomUUID();
  
  try {
    const agentRun = await storage.createAgentRun({
      conversationId,
      status: "pending",
      routerDecision: "pipeline",
      objective
    });

    onProgress?.({
      runId,
      stepId: "init",
      status: "started",
      message: "Interpreting request..."
    });

    const intent = await interpretIntent(objective);
    
    onProgress?.({
      runId,
      stepId: "plan",
      status: "started",
      message: "Creating execution plan...",
      detail: { intent }
    });

    const plan = await createPlan(agentRun.id, objective, intent);
    
    onProgress?.({
      runId,
      stepId: "plan",
      status: "completed",
      message: `Plan created with ${plan.steps.length} steps`,
      detail: { 
        steps: plan.steps.map(s => ({ id: s.id, tool: s.toolId, description: s.description }))
      }
    });

    await storage.updateAgentRunStatus(agentRun.id, "running");

    const { results, artifacts } = await pipelineExecutor.execute(plan, onProgress);

    const successCount = results.filter(r => r.status === "completed").length;
    const failCount = results.filter(r => r.status === "failed").length;
    const success = failCount === 0 || successCount > 0;

    await storage.updateAgentRunStatus(
      agentRun.id, 
      success ? "completed" : "failed",
      success ? undefined : "Some steps failed"
    );

    const lastResult = results.filter(r => r.status === "completed").pop();
    let summary = "";
    
    if (lastResult?.output?.data?.response) {
      summary = lastResult.output.data.response;
    } else if (lastResult?.output?.data?.textContent) {
      summary = lastResult.output.data.textContent.slice(0, 5000);
    } else if (lastResult?.output?.data) {
      summary = JSON.stringify(lastResult.output.data).slice(0, 5000);
    }

    const totalDuration = Date.now() - startTime;

    onProgress?.({
      runId,
      stepId: "complete",
      status: "completed",
      message: `Pipeline completed: ${successCount}/${results.length} steps successful`,
      detail: { totalDuration, successCount, failCount }
    });

    return {
      runId: agentRun.id,
      planId: plan.id,
      success,
      summary,
      steps: results,
      artifacts,
      errors: results.filter(r => r.status === "failed").map(r => r.output?.error || "Unknown error"),
      totalDuration,
      metadata: {
        objective,
        intent,
        stepsPlanned: plan.steps.length,
        stepsExecuted: results.length
      }
    };
  } catch (error: any) {
    console.error("Pipeline execution error:", error);
    
    onProgress?.({
      runId,
      stepId: "error",
      status: "failed",
      message: error.message
    });

    return {
      runId,
      planId: "",
      success: false,
      summary: `Error: ${error.message}`,
      steps: [],
      artifacts: [],
      errors: [error.message],
      totalDuration: Date.now() - startTime
    };
  }
}

export function cancelPipeline(runId: string): boolean {
  pipelineExecutor.cancel(runId);
  return true;
}

export function getAvailableTools(): { id: string; name: string; description: string; category: string }[] {
  initializePipeline();
  return toolRegistry.getToolManifest();
}
