import {
  PromptAnalysisResult,
  PAREConfig,
  DEFAULT_PARE_CONFIG,
  SessionContext,
  RoutingDecision,
  ExecutionPlan,
  TaskNode,
} from "./types";
import { IntentClassifier } from "./intentClassifier";
import { EntityExtractor } from "./entityExtractor";
import { ToolRouter } from "./toolRouter";
import { PlanGenerator } from "./planGenerator";
import { v4 as uuidv4 } from "uuid";

export class PAREOrchestrator {
  private config: PAREConfig;
  private intentClassifier: IntentClassifier;
  private entityExtractor: EntityExtractor;
  private toolRouter: ToolRouter;
  private planGenerator: PlanGenerator;
  private enabled: boolean;

  constructor(config: Partial<PAREConfig> = {}) {
    this.config = { ...DEFAULT_PARE_CONFIG, ...config };
    this.enabled = process.env.PARE_ENABLED === "true";

    this.intentClassifier = new IntentClassifier({
      confidenceThreshold: this.config.intentConfidenceThreshold,
      useLLMFallback: this.config.useLLMFallback,
    });

    this.entityExtractor = new EntityExtractor();

    this.toolRouter = new ToolRouter({
      similarityThreshold: this.config.similarityThreshold,
    });

    this.planGenerator = new PlanGenerator();

    console.log(`[PARE] Orchestrator initialized (enabled=${this.enabled})`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[PARE] Orchestrator ${enabled ? "enabled" : "disabled"}`);
  }

  async analyze(prompt: string, context?: SessionContext): Promise<PromptAnalysisResult> {
    const startTime = Date.now();
    console.log(`[PARE] Analyzing prompt: ${prompt.slice(0, 100)}...`);

    const normalized = this.normalizePrompt(prompt);

    const [intents, entities] = await Promise.all([
      this.intentClassifier.classify(normalized, context),
      this.entityExtractor.extract(normalized),
    ]);

    console.log(`[PARE] Classified intents: ${intents.map((i) => i.category).join(", ")}`);
    console.log(`[PARE] Extracted entities: ${entities.map((e) => e.type).join(", ")}`);

    if (this.needsClarification(intents, entities)) {
      const questions = await this.generateClarificationQuestions(prompt, intents, entities);

      return {
        originalPrompt: prompt,
        normalizedPrompt: normalized,
        intents,
        entities,
        toolCandidates: [],
        executionPlan: this.createEmptyPlan(prompt),
        requiresClarification: true,
        clarificationQuestions: questions,
        contextUsed: context || {},
        analysisMetadata: {
          durationMs: Date.now() - startTime,
          primaryIntent: intents[0]?.category || null,
        },
      };
    }

    const toolCandidates = await this.toolRouter.route(
      normalized,
      intents,
      entities,
      this.config.maxToolCandidates
    );

    console.log(`[PARE] Tool candidates: ${toolCandidates.map((t) => t.toolName).join(", ")}`);

    const executionPlan = await this.planGenerator.generate(
      prompt,
      intents,
      entities,
      toolCandidates,
      context
    );

    console.log(`[PARE] Generated plan with ${executionPlan.nodes.length} tasks (${Date.now() - startTime}ms)`);

    return {
      originalPrompt: prompt,
      normalizedPrompt: normalized,
      intents,
      entities,
      toolCandidates,
      executionPlan,
      requiresClarification: false,
      clarificationQuestions: [],
      contextUsed: context || {},
      analysisMetadata: {
        durationMs: Date.now() - startTime,
        primaryIntent: intents[0]?.category || null,
        entityCount: entities.length,
        toolCount: toolCandidates.length,
        planTaskCount: executionPlan.nodes.length,
      },
    };
  }

  async route(prompt: string, hasAttachments: boolean = false, context?: SessionContext): Promise<RoutingDecision> {
    if (!this.enabled) {
      return this.legacyRoute(prompt, hasAttachments);
    }

    try {
      const analysis = await this.analyze(prompt, context);

      if (analysis.requiresClarification) {
        return {
          route: "chat",
          confidence: 0.9,
          reasons: ["Necesita clarificación"],
          toolNeeds: [],
          planHint: analysis.clarificationQuestions,
          analysisResult: analysis,
        };
      }

      const primaryIntent = analysis.intents[0];
      const hasExternalToolNeeds = analysis.toolCandidates.some((t) =>
        ["web_search", "fetch_url", "code_execute", "file_write", "doc_create"].includes(t.toolName)
      );

      if (primaryIntent?.category === "conversation" && !hasExternalToolNeeds) {
        return {
          route: "chat",
          confidence: primaryIntent.confidence,
          reasons: ["Conversación general"],
          toolNeeds: [],
          planHint: [],
          analysisResult: analysis,
        };
      }

      if (hasExternalToolNeeds || ["command", "creation", "automation", "research"].includes(primaryIntent?.category || "")) {
        return {
          route: "agent",
          confidence: primaryIntent?.confidence || 0.7,
          reasons: analysis.toolCandidates.map((t) => `Requiere: ${t.toolName}`),
          toolNeeds: analysis.toolCandidates.map((t) => t.toolName),
          planHint: analysis.executionPlan.nodes.map((n) => `${n.tool}: ${JSON.stringify(n.inputs).slice(0, 50)}`),
          analysisResult: analysis,
        };
      }

      return {
        route: "chat",
        confidence: 0.7,
        reasons: ["Consulta manejable por chat"],
        toolNeeds: [],
        planHint: [],
        analysisResult: analysis,
      };
    } catch (error) {
      console.error("[PARE] Analysis failed, falling back to legacy router:", error);
      return this.legacyRoute(prompt, hasAttachments);
    }
  }

  private async legacyRoute(prompt: string, hasAttachments: boolean): Promise<RoutingDecision> {
    const { router } = await import("../router");
    const decision = await router.decide(prompt, hasAttachments);

    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: decision.reasons,
      toolNeeds: decision.tool_needs,
      planHint: decision.plan_hint,
    };
  }

  private normalizePrompt(prompt: string): string {
    let normalized = prompt.split(/\s+/).join(" ").trim();
    normalized = normalized.replace(/[\x00-\x1F\x7F]/g, "");
    return normalized;
  }

  private needsClarification(intents: { category: string; confidence: number }[], entities: unknown[]): boolean {
    if (intents.length === 0 || intents[0].confidence < 0.4) {
      return true;
    }

    if (intents[0].category === "clarification") {
      return true;
    }

    if (["command", "creation", "automation"].includes(intents[0].category) && entities.length === 0) {
      return true;
    }

    return false;
  }

  private async generateClarificationQuestions(
    prompt: string,
    intents: { category: string; confidence: number }[],
    entities: { type: string; value: string }[]
  ): Promise<string[]> {
    try {
      const { geminiChat } = await import("../../lib/gemini");

      const systemPrompt = `Genera 1-2 preguntas breves para clarificar la intención del usuario.
Responde SOLO con JSON: {"questions":["pregunta1","pregunta2"]}`;

      const intentsStr = intents.slice(0, 3).map((i) => i.category).join(", ");
      const entitiesStr = entities.slice(0, 5).map((e) => `${e.type}:${e.value}`).join(", ");

      const result = await geminiChat(
        [{ role: "user", parts: [{ text: `${systemPrompt}\n\nPrompt: ${prompt}\nIntenciones: ${intentsStr}\nEntidades: ${entitiesStr}` }] }],
        { model: "gemini-2.0-flash", maxOutputTokens: 150, temperature: 0.3 }
      );

      const responseText = result.content?.trim() || "";
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.questions || [];
      }
    } catch (error) {
      console.warn("[PARE] Failed to generate clarification questions:", error);
    }

    return ["¿Podrías dar más detalles sobre lo que necesitas?"];
  }

  private createEmptyPlan(objective: string): ExecutionPlan {
    return {
      planId: `plan_empty_${uuidv4().slice(0, 8)}`,
      objective,
      nodes: [
        {
          id: "clarify",
          tool: "clarify",
          inputs: { originalPrompt: objective },
          dependencies: [],
          priority: 10,
          canFail: false,
          timeoutMs: 0,
          retryCount: 0,
        },
      ],
      edges: [],
      estimatedDurationMs: 0,
      parallelGroups: [],
    };
  }
}

export const pareOrchestrator = new PAREOrchestrator();
