/**
 * Active Inference Brain v2 - Self-Initiative Decision Making
 *
 * This refactored "brain" implements a Free Energy Principle model:
 * 1. PREDICT: Generar predicción de lo que debería verse en pantalla
 * 2. OBSERVE: Capturar el estado real del desktop (via Vision Pipeline)
 * 3. COMPARE: Calcular "surprise" (divergencia predicción vs realidad)
 * 4. PLAN: Si hay surprise, generar plan para resolverla
 * 5. ACT: Ejecutar la acción que minimice surprise
 * 6. VERIFY: Confirmar que la acción redujo surprise
 * 7. UPDATE: Actualizar el modelo generativo con lo aprendido
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import OpenAI from "openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { accessibilityFusion, UnifiedUIState } from "../vision/accessibilityFusion";
import { stateTracker } from "../vision/stateTracker";
import { PolicyTree, BeliefState } from "./policyTree";

// ============================================
// Types
// ============================================

export type AgentState = "idle" | "predicting" | "observing" | "planning" | "acting" | "verifying" | "updating" | "completed" | "error";

export interface AgentGoal {
  id: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  category: "research" | "browser_control" | "document_creation" | "data_analysis" | "communication" | "system_control" | "mixed";
  constraints: GoalConstraints;
  successCriteria: string[];
}

export interface GoalConstraints {
  maxDuration: number;
  maxActions: number;
  maxCost: number;
  requireConfirmation: boolean;
  allowedTools: string[];
  blockedTools: string[];
}

export interface ExecutionResult {
  success: boolean;
  iterations: number;
  reason?: string;
  result?: any;
  summary?: string;
}

export interface ExpectedState {
  description: string;
  uiElementsExpected: string[];
  windowsExpected: string[];
}

// ============================================
// Core Brain
// ============================================
import { globalRegistry } from "./capabilities/registry";
import { crossrefSearchCapability } from "./capabilities/academic/crossrefSearch";
import { citationFormatterCapability } from "./capabilities/academic/citationFormatter";
import { gitOperationsCapability } from "./capabilities/code/gitOperations";
import { astAnalyzerCapability } from "./capabilities/code/astAnalyzer";
import { pythonSandboxBridgeCapability } from "./capabilities/data/pythonSandbox";
import { pm2OrchestrationCapability } from "./capabilities/system/pm2Orchestration";
import { webScraperCapability } from "./capabilities/browser/webScraper";
import { excelGeneratorCapability } from "./capabilities/office/excelGenerator";
import { wordGeneratorCapability } from "./capabilities/office/wordGenerator";
import { fileManagerCapability } from "./capabilities/system/fileManager";

export class AutonomousAgentBrain extends EventEmitter {
  private id: string;
  private state: AgentState = "idle";
  private memory: any[] = []; // Episodic Memory DB Array
  private llm: OpenAI;
  private embeddings: OpenAIEmbeddings;
  private toolExecutors: Map<string, (params: any) => Promise<any>> = new Map();
  private dynamicToolsLoaded: boolean = false;

  constructor(apiKey?: string) {
    super();
    this.id = randomUUID();
    const key = apiKey || process.env.OPENAI_API_KEY;
    this.llm = new OpenAI({
      apiKey: key,
      dangerouslyAllowBrowser: false
    });
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: key,
      modelName: "text-embedding-3-small"
    });

    // Cargar los Primeros Módulos de la Fase 8 (1000 Capabilities Roadmap)
    globalRegistry.registerModule([
      crossrefSearchCapability,
      citationFormatterCapability,
      gitOperationsCapability,
      astAnalyzerCapability,
      pythonSandboxBridgeCapability,
      pm2OrchestrationCapability,

      // Módulos Fase 9 (Core Expansion)
      webScraperCapability,
      excelGeneratorCapability,
      wordGeneratorCapability,
      fileManagerCapability
    ]);
  }

  registerTool(name: string, executor: (params: any) => Promise<any>): void {
    this.toolExecutors.set(name, executor);
  }

  private setState(state: AgentState) {
    this.state = state;
    this.emit("state_changed", state);
  }

  async executionLoop(goal: AgentGoal): Promise<ExecutionResult> {
    if (!this.dynamicToolsLoaded) {
      console.log("[ActiveInference] Bootstrapping Phase 7 Dynamic Suites globally...");
      await globalRegistry.loadDynamicSuites();
      this.dynamicToolsLoaded = true;
    }

    let iteration = 0;
    const MAX_ITERATIONS = goal.constraints.maxActions;
    const startTime = Date.now();

    try {
      while (iteration < MAX_ITERATIONS) {
        if (Date.now() - startTime > goal.constraints.maxDuration) {
          return { success: false, iterations: iteration, reason: 'timeout' };
        }

        // 1. Predict
        this.setState("predicting");
        const prediction = await this.predictExpectedState(goal);

        // 2. Observe
        this.setState("observing");
        const observation = await accessibilityFusion.getUnifiedUIState("mock_base64_screenshot"); // Stub
        await stateTracker.updateFromAnalysis(observation);

        // 3. Compare (Calculate Free Energy / Surprise)
        const surprise = await this.calculateFreeEnergy(prediction, observation);

        // If Surprise is effectively zero mapped against the goal, we are done
        if (surprise < 0.1) {
          this.setState("completed");
          return { success: true, iterations: iteration, reason: 'goal_achieved', summary: "Zero surprise reached." };
        }

        // 4. Plan
        this.setState("planning");
        // Aqui delegariamos al PolicyTree (Fase 3.2), usaremos un fallback local en este commit
        const plan = await this.generateNextAction(goal, observation, surprise);

        if (!plan) {
          return { success: false, iterations: iteration, reason: 'no_viable_plan' };
        }

        // 5. Act
        this.setState("acting");
        await this.executeAction(plan);

        // 6. Verify (Observe again)
        this.setState("verifying");
        await new Promise(r => setTimeout(r, 1000)); // UI delay
        const postObservation = await accessibilityFusion.getUnifiedUIState("mock");
        const newSurprise = await this.calculateFreeEnergy(prediction, postObservation);

        // 7. Update Model
        this.setState("updating");
        // Update generative model (learning)
        await this.updateGenerativeModel(plan, surprise - newSurprise);

        iteration++;
      }

      return { success: false, iterations: iteration, reason: 'max_iterations' };
    } catch (e: any) {
      this.setState("error");
      return { success: false, iterations: iteration, reason: `error: ${e.message}` };
    }
  }

  private async predictExpectedState(goal: AgentGoal): Promise<ExpectedState> {
    // En una neuro-arquitectura real, esto deduce desde un StateGraph o LLM qué veríamos en pantalla
    // si la "meta" estuviera completada.
    return {
      description: goal.description,
      uiElementsExpected: [],
      windowsExpected: []
    };
  }

  private async calculateFreeEnergy(prediction: ExpectedState, observation: UnifiedUIState): Promise<number> {
    if (!observation || !observation.semanticState) return 1.0;

    const semState = observation.semanticState.toUpperCase();
    if (semState.includes('ERROR') || semState.includes('FAIL')) return 0.95;
    if (semState === 'IDLE' && prediction.description) return 0.8;

    try {
      const [targetEmb, obsEmb] = await this.embeddings.embedDocuments([
        prediction.description,
        observation.semanticState
      ]);

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < targetEmb.length; i++) {
        dotProduct += targetEmb[i] * obsEmb[i];
        normA += targetEmb[i] * targetEmb[i];
        normB += obsEmb[i] * obsEmb[i];
      }

      const cosineSimilarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

      // Free Energy here is defined as 1 - cosine Similarity (Distance)
      // Cosine Sim ranges from -1 to 1. We normalize it.
      const distance = 1.0 - Math.max(0, cosineSimilarity);
      return parseFloat(Math.max(0.01, Math.min(1.0, distance)).toFixed(3));

    } catch (e) {
      console.error("[ActiveInference] Embedding calculation failed", e);
      return 0.5; // Neutral fail-safe
    }
  }

  private async generateNextAction(goal: AgentGoal, obs: UnifiedUIState, surpriseFactor: number): Promise<any> {
    // Fase 3.2: Delegacion al MCTS PolicyTree real 
    const tree = new PolicyTree();
    const belief = new BeliefState(obs);

    console.log(`[ActiveInference] Generating Policies via MCTS branching factor...`);
    const policies = await tree.generatePolicies(belief, obs, goal, {
      maxDepth: 3,
      branchFactor: 3
    });

    if (policies.length === 0 || policies[0].actions.length === 0) {
      return null;
    }

    // Retorna la mejor accion inicial mapeada a mano con un "tool"
    const bestAction = policies[0].actions[0];
    return {
      action: bestAction.tool,
      params: bestAction.params
    };
  }

  private async executeAction(action: any): Promise<void> {
    const rawCapability = globalRegistry.get(action.action);

    if (rawCapability) {
      console.log(`[ActiveInference Executor] Disparando Capability: ${action.action}`);
      try {
        const result = await rawCapability.execute(action.params);
        console.log(`[ActiveInference Executor] Result:`, result);
      } catch (err: any) {
        console.error(`[ActiveInference Executor] Capability Failed:`, err);
      }
    } else {
      console.warn(`[ActiveInference Executor] Capability not found or unregistered: ${action.action}`);
    }
  }

  private async updateGenerativeModel(action: any, surpriseDelta: number) {
    // Phase 3.4: Episodic Memory Local Array
    this.memory.push({
      action: action.action || action.tool,
      params: action.params,
      surpriseDelta,
      timestamp: Date.now()
    });

    if (surpriseDelta > 0.8) {
      console.log(`[ActiveInference] CRITICAL HIGH SURPRISE: ${surpriseDelta}. Action ${action.action || action.tool} failed or behaved unexpectedly.`);

      // Auto-recovery: If the last 3 actions generated > 0.8 surprise, trigger Fail-Fast Rethink
      const recentFails = this.memory.slice(-3).filter(m => m.surpriseDelta > 0.8);
      if (recentFails.length >= 3) {
        console.warn(`[ActiveInference] TRIPLE FAILURE DETECTED: Triggering "Fail-Fast Rethink". Forcefully aborting current Expected State assumption.`);
        throw new Error("FAIL-FAST: The generative model has collapsed. MCTS must backtrack significantly.");
      }
    } else {
      console.log(`[ActiveInference] Learned delta ${surpriseDelta}, updating prior probabilities.`);
    }
  }

  // Placeholder para la rama MCTS Verify
  private async evaluateAction(action: any, newState: UnifiedUIState): Promise<number> {
    return 0.5; // Surprise heurística
  }
}
