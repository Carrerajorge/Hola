/**
 * SuperAgent Router — Unified intelligent task dispatch system.
 *
 * Central routing layer that analyzes incoming tasks and dispatches them
 * to the correct execution engine:
 * - ComputerUseEngine → desktop/browser automation
 * - WorkflowEngine → multi-step chainable workflows
 * - SuperAgent (Academic) → research pipelines
 * - Core Orchestrator → general tool-calling agent
 * - ParallelResearchEngine → web search + synthesis
 * - BackgroundTaskManager → persistent recurring tasks
 *
 * Uses LLM-based intent detection + pattern matching for routing.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { agentEventBus } from "./eventBus";
import { llmGateway } from "../lib/llmGateway";

// ============================================
// Types
// ============================================

export type AgentCapability =
  | "research"
  | "computer_use"
  | "browser_automation"
  | "workflow"
  | "document_creation"
  | "code_generation"
  | "data_analysis"
  | "communication"
  | "image_generation"
  | "video_generation"
  | "background_task"
  | "tool_integration"
  | "general";

export interface RouteDecision {
  id: string;
  engine: EngineType;
  capability: AgentCapability;
  confidence: number;
  reasoning: string;
  suggestedModel: ModelTarget;
  subTasks?: SubTaskRoute[];
  isParallel: boolean;
  requiresApproval: boolean;
  estimatedDuration: number;
  metadata: Record<string, any>;
}

export type EngineType =
  | "orchestrator"
  | "computer_use"
  | "workflow"
  | "research_pipeline"
  | "parallel_research"
  | "background_task"
  | "multi_engine";

export type ModelTarget =
  | "opus"        // Claude Opus 4.6 — main brain, complex reasoning
  | "gemini"      // Gemini — deep research, long context
  | "grok"        // Grok — fast responses, real-time data
  | "chatgpt"     // ChatGPT 5.2 — broad search, long-term memory
  | "nano_banana" // Nano Banana — image generation
  | "veo"         // Veo 3.1 — video generation
  | "auto";       // Auto-select best model

export interface SubTaskRoute {
  id: string;
  description: string;
  engine: EngineType;
  model: ModelTarget;
  dependencies: string[];
  priority: number;
}

export interface RouterConfig {
  enableLLMRouting: boolean;
  confidenceThreshold: number;
  maxParallelTasks: number;
  defaultModel: ModelTarget;
  modelPreferences: Record<AgentCapability, ModelTarget>;
}

// ============================================
// Intent Patterns
// ============================================

interface IntentPattern {
  capability: AgentCapability;
  engine: EngineType;
  model: ModelTarget;
  patterns: RegExp[];
  keywords: string[];
  confidence: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // Computer Use / Browser Automation
  {
    capability: "computer_use",
    engine: "computer_use",
    model: "opus",
    patterns: [
      /abr[ei]\s+(el|la|un)\s+(navegador|app|aplicaci[oó]n|programa)/i,
      /haz\s+clic|click\s+on|navega\s+a|go\s+to/i,
      /captura\s+de\s+pantalla|screenshot|toma\s+captura/i,
      /controla?\s+(el|mi)\s+(escritorio|computador|desktop)/i,
      /open\s+(the\s+)?(browser|app|application|program)/i,
      /automat(iza|e)\s+(el|the)\s+(navegador|browser)/i,
    ],
    keywords: ["click", "browser", "desktop", "screenshot", "navigate", "open app", "mouse", "keyboard"],
    confidence: 0.9,
  },
  // Browser Automation (web scraping, extraction)
  {
    capability: "browser_automation",
    engine: "computer_use",
    model: "opus",
    patterns: [
      /extrae\s+(datos|informaci[oó]n)\s+(de|del|desde)/i,
      /scrape|scraping|web\s+scraping/i,
      /descarga\s+(de|desde|el|la)\s+(p[aá]gina|sitio|web)/i,
      /extract\s+(data|info|information)\s+from/i,
      /automate\s+(the\s+)?(web|browser)/i,
      /fill\s+(in|out)\s+(the\s+)?form/i,
      /llena\s+(el|los)\s+formulario/i,
    ],
    keywords: ["scrape", "extract", "form", "login", "automate web", "fill form"],
    confidence: 0.85,
  },
  // Research Pipeline (academic)
  {
    capability: "research",
    engine: "research_pipeline",
    model: "gemini",
    patterns: [
      /investiga(ci[oó]n|r)\s+(acad[eé]mica|cient[ií]fica)/i,
      /busca\s+(art[ií]culos|papers|publicaciones)/i,
      /academic\s+research|scientific\s+paper/i,
      /revisi[oó]n\s+(de\s+)?literatura|literature\s+review/i,
      /estado\s+del\s+arte|state\s+of\s+the\s+art/i,
      /cita(s|ci[oó]n|ciones)|citation|bibliography/i,
      /scopus|pubmed|web\s+of\s+science/i,
    ],
    keywords: ["academic", "research", "paper", "citation", "scopus", "pubmed", "literature review"],
    confidence: 0.92,
  },
  // Parallel Research (web search + synthesis)
  {
    capability: "research",
    engine: "parallel_research",
    model: "gemini",
    patterns: [
      /investiga\s+(sobre|acerca|de)\s+/i,
      /busca\s+(en\s+)?(internet|la\s+web|varias?\s+fuentes)/i,
      /compara\s+(informaci[oó]n|datos|fuentes)/i,
      /an[aá]lisis\s+(comparativo|exhaustivo|profundo)/i,
      /research\s+(about|on|into)\s+/i,
      /search\s+(the\s+)?(web|internet)\s+for/i,
      /find\s+and\s+(compare|analyze|summarize)/i,
    ],
    keywords: ["investigate", "research", "compare", "analyze sources", "web search", "synthesize"],
    confidence: 0.8,
  },
  // Document Creation
  {
    capability: "document_creation",
    engine: "orchestrator",
    model: "opus",
    patterns: [
      /crea\s+(un|una|el|la)\s+(documento|informe|reporte|presentaci[oó]n)/i,
      /genera\s+(un|una)\s+(pdf|word|excel|powerpoint|pptx|xlsx|docx)/i,
      /create\s+(a|the)\s+(document|report|presentation|spreadsheet)/i,
      /generate\s+(a|the)\s+(pdf|word|excel|powerpoint)/i,
      /escribe\s+(un|una)\s+(ensayo|art[ií]culo|carta|email)/i,
    ],
    keywords: ["document", "report", "presentation", "spreadsheet", "pdf", "word", "excel"],
    confidence: 0.88,
  },
  // Code Generation
  {
    capability: "code_generation",
    engine: "orchestrator",
    model: "opus",
    patterns: [
      /crea\s+(un|una|el|la)\s+(app|aplicaci[oó]n|sitio|p[aá]gina|api|servidor)/i,
      /programa\s+(un|una|en)/i,
      /genera\s+c[oó]digo/i,
      /build\s+(a|an|the)\s+(app|application|website|api|server)/i,
      /create\s+(a|an|the)\s+(react|vue|angular|next|node)\s+(app|project)/i,
      /write\s+(a|the)\s+(function|class|module|component)/i,
      /implementa\s+(la|el|un|una)/i,
    ],
    keywords: ["code", "program", "build app", "create website", "develop", "implement"],
    confidence: 0.85,
  },
  // Image Generation
  {
    capability: "image_generation",
    engine: "orchestrator",
    model: "nano_banana",
    patterns: [
      /genera\s+(una?\s+)?imagen/i,
      /crea\s+(una?\s+)?(imagen|ilustraci[oó]n|logo|banner)/i,
      /generate\s+(an?\s+)?image/i,
      /create\s+(an?\s+)?(image|illustration|logo|banner|artwork)/i,
      /dibuja|draw|design\s+(a|an)/i,
    ],
    keywords: ["image", "picture", "illustration", "logo", "draw", "generate image"],
    confidence: 0.9,
  },
  // Video Generation
  {
    capability: "video_generation",
    engine: "orchestrator",
    model: "veo",
    patterns: [
      /genera\s+(un\s+)?video/i,
      /crea\s+(un\s+)?video/i,
      /generate\s+(a\s+)?video/i,
      /create\s+(a\s+)?video/i,
      /anima(ci[oó]n|tion)/i,
    ],
    keywords: ["video", "animation", "clip", "generate video"],
    confidence: 0.9,
  },
  // Workflow (multi-step automation)
  {
    capability: "workflow",
    engine: "workflow",
    model: "opus",
    patterns: [
      /automat(iza|e)\s+(el|la|un|una|the|a)\s+(proceso|flujo|tarea|workflow)/i,
      /cuando\s+.+\s+entonces\s+/i,
      /cada\s+(d[ií]a|hora|semana|lunes|martes)/i,
      /if\s+.+\s+then\s+/i,
      /every\s+(day|hour|week|monday|tuesday)/i,
      /schedule\s+(a|the)\s+(task|job|workflow)/i,
      /programa\s+(una?\s+)?(tarea|proceso)/i,
    ],
    keywords: ["automate", "workflow", "schedule", "recurring", "if then", "when then"],
    confidence: 0.85,
  },
  // Background Tasks
  {
    capability: "background_task",
    engine: "background_task",
    model: "opus",
    patterns: [
      /monitorea|supervisa|vigila|watch|monitor/i,
      /en\s+segundo\s+plano|background/i,
      /tarea\s+(recurrente|peri[oó]dica|continua)/i,
      /notif[ií]came\s+cuando|alert\s+me\s+when/i,
      /revisa\s+(cada|peri[oó]dicamente)/i,
      /keep\s+(checking|watching|monitoring)/i,
      /run\s+in\s+(the\s+)?background/i,
    ],
    keywords: ["monitor", "background", "recurring", "continuous", "watch", "alert when"],
    confidence: 0.88,
  },
  // Communication / Tool Integration
  {
    capability: "communication",
    engine: "orchestrator",
    model: "grok",
    patterns: [
      /env[ií]a\s+(un\s+)?(email|correo|mensaje)/i,
      /send\s+(an?\s+)?(email|message)/i,
      /publica\s+en\s+(slack|discord|telegram)/i,
      /post\s+(to|on|in)\s+(slack|discord|telegram)/i,
      /conecta\s+(con|a)\s+(gmail|slack|notion|calendar)/i,
      /connect\s+to\s+(gmail|slack|notion|calendar)/i,
    ],
    keywords: ["email", "slack", "discord", "telegram", "notify", "send message", "gmail", "notion"],
    confidence: 0.85,
  },
  // Data Analysis
  {
    capability: "data_analysis",
    engine: "orchestrator",
    model: "gemini",
    patterns: [
      /analiza\s+(los|la|el|estos?|estas?)\s+(datos|data|archivo|csv|excel)/i,
      /analyze\s+(the|this|these)\s+(data|file|csv|excel|spreadsheet)/i,
      /gr[aá]fica|chart|plot|graph|visualiz/i,
      /estad[ií]stica|statistic|trend|pattern/i,
    ],
    keywords: ["analyze", "data", "chart", "graph", "statistics", "csv", "excel", "visualize"],
    confidence: 0.85,
  },
];

// ============================================
// SuperAgentRouter Class
// ============================================

export class SuperAgentRouter extends EventEmitter {
  private config: RouterConfig;
  private routeHistory: Map<string, RouteDecision[]> = new Map();
  private activeRoutes: Map<string, RouteDecision> = new Map();

  constructor(config?: Partial<RouterConfig>) {
    super();
    this.config = {
      enableLLMRouting: true,
      confidenceThreshold: 0.7,
      maxParallelTasks: 5,
      defaultModel: "opus",
      modelPreferences: {
        research: "gemini",
        computer_use: "opus",
        browser_automation: "opus",
        workflow: "opus",
        document_creation: "opus",
        code_generation: "opus",
        data_analysis: "gemini",
        communication: "grok",
        image_generation: "nano_banana",
        video_generation: "veo",
        background_task: "opus",
        tool_integration: "grok",
        general: "opus",
      },
      ...config,
    };
  }

  /**
   * Analyze user input and determine the best execution route.
   */
  async route(
    input: string,
    userId: string,
    context?: {
      chatHistory?: Array<{ role: string; content: string }>;
      attachments?: any[];
      availableTools?: string[];
      userPlan?: string;
    }
  ): Promise<RouteDecision> {
    const routeId = randomUUID();

    // Phase 1: Pattern-based intent detection
    const patternResult = this.detectIntentByPattern(input);

    // Phase 2: If confidence is low, use LLM for deeper analysis
    let decision: RouteDecision;

    if (patternResult.confidence >= this.config.confidenceThreshold) {
      decision = {
        id: routeId,
        engine: patternResult.engine,
        capability: patternResult.capability,
        confidence: patternResult.confidence,
        reasoning: `Pattern match: ${patternResult.matchedPattern}`,
        suggestedModel: patternResult.model,
        isParallel: false,
        requiresApproval: patternResult.confidence < 0.8,
        estimatedDuration: this.estimateDuration(patternResult.engine),
        metadata: { method: "pattern", matchedKeywords: patternResult.matchedKeywords },
      };
    } else if (this.config.enableLLMRouting) {
      decision = await this.routeWithLLM(routeId, input, userId, context);
    } else {
      decision = {
        id: routeId,
        engine: "orchestrator",
        capability: "general",
        confidence: 0.5,
        reasoning: "Fallback to general orchestrator",
        suggestedModel: this.config.defaultModel,
        isParallel: false,
        requiresApproval: false,
        estimatedDuration: 30000,
        metadata: { method: "fallback" },
      };
    }

    // Check for compound tasks that need parallel execution
    decision = await this.detectCompoundTask(decision, input);

    // Track route
    this.activeRoutes.set(routeId, decision);
    const history = this.routeHistory.get(userId) || [];
    history.push(decision);
    if (history.length > 100) history.shift();
    this.routeHistory.set(userId, history);

    this.emit("route_decided", decision);
    return decision;
  }

  /**
   * Pattern-based intent detection.
   */
  private detectIntentByPattern(input: string): {
    capability: AgentCapability;
    engine: EngineType;
    model: ModelTarget;
    confidence: number;
    matchedPattern: string;
    matchedKeywords: string[];
  } {
    let bestMatch = {
      capability: "general" as AgentCapability,
      engine: "orchestrator" as EngineType,
      model: this.config.defaultModel as ModelTarget,
      confidence: 0,
      matchedPattern: "",
      matchedKeywords: [] as string[],
    };

    const inputLower = input.toLowerCase();

    for (const intent of INTENT_PATTERNS) {
      let score = 0;
      let matchedPattern = "";
      const matchedKeywords: string[] = [];

      // Check regex patterns
      for (const pattern of intent.patterns) {
        if (pattern.test(input)) {
          score = Math.max(score, intent.confidence);
          matchedPattern = pattern.source;
          break;
        }
      }

      // Check keywords
      for (const keyword of intent.keywords) {
        if (inputLower.includes(keyword.toLowerCase())) {
          matchedKeywords.push(keyword);
          score = Math.max(score, intent.confidence * 0.8);
        }
      }

      // Boost score for multiple keyword matches
      if (matchedKeywords.length > 1) {
        score = Math.min(1, score + matchedKeywords.length * 0.05);
      }

      if (score > bestMatch.confidence) {
        bestMatch = {
          capability: intent.capability,
          engine: intent.engine,
          model: intent.model,
          confidence: score,
          matchedPattern,
          matchedKeywords,
        };
      }
    }

    return bestMatch;
  }

  /**
   * Use LLM for intelligent routing when patterns aren't confident enough.
   */
  private async routeWithLLM(
    routeId: string,
    input: string,
    userId: string,
    context?: any
  ): Promise<RouteDecision> {
    try {
      const systemPrompt = `You are a task router for an AI super agent system. Analyze the user's request and determine:
1. Which engine should handle it (orchestrator, computer_use, workflow, research_pipeline, parallel_research, background_task, multi_engine)
2. Which AI model is best suited (opus for complex reasoning, gemini for research, grok for speed, chatgpt for broad search, nano_banana for images, veo for video)
3. Your confidence level (0-1)
4. Whether the task has multiple parallel sub-tasks

Respond in JSON format:
{
  "engine": "...",
  "capability": "...",
  "model": "...",
  "confidence": 0.0,
  "reasoning": "...",
  "isParallel": false,
  "subTasks": []
}

Engines:
- orchestrator: general tool-calling agent (documents, code, analysis, communication)
- computer_use: desktop/browser automation requiring screen interaction
- workflow: multi-step automation with conditions and loops
- research_pipeline: academic/scientific research with citations
- parallel_research: web research across multiple sources with synthesis
- background_task: persistent monitoring and recurring tasks
- multi_engine: compound tasks requiring multiple engines

Capabilities: research, computer_use, browser_automation, workflow, document_creation, code_generation, data_analysis, communication, image_generation, video_generation, background_task, tool_integration, general`;

      const response = await llmGateway.chat(
        [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: `Route this task: "${input}"` },
        ],
        { model: "claude-opus-4-6", temperature: 0, maxTokens: 500 }
      );

      const parsed = JSON.parse(typeof response === "string" ? response : response?.content || "{}");

      return {
        id: routeId,
        engine: parsed.engine || "orchestrator",
        capability: parsed.capability || "general",
        confidence: parsed.confidence || 0.6,
        reasoning: parsed.reasoning || "LLM routing",
        suggestedModel: parsed.model || this.config.defaultModel,
        subTasks: parsed.subTasks,
        isParallel: parsed.isParallel || false,
        requiresApproval: (parsed.confidence || 0.6) < 0.7,
        estimatedDuration: this.estimateDuration(parsed.engine || "orchestrator"),
        metadata: { method: "llm" },
      };
    } catch (err) {
      console.warn("[SuperAgentRouter] LLM routing failed, using fallback:", err);
      return {
        id: routeId,
        engine: "orchestrator",
        capability: "general",
        confidence: 0.5,
        reasoning: "LLM routing failed, fallback to orchestrator",
        suggestedModel: this.config.defaultModel,
        isParallel: false,
        requiresApproval: false,
        estimatedDuration: 30000,
        metadata: { method: "fallback" },
      };
    }
  }

  /**
   * Detect compound tasks that need multiple engines working in parallel.
   */
  private async detectCompoundTask(
    decision: RouteDecision,
    input: string
  ): Promise<RouteDecision> {
    // Check for multi-intent signals
    const compoundSignals = [
      /y\s+(tambi[eé]n|luego|despu[eé]s|adem[aá]s)/i,
      /and\s+(also|then|additionally)/i,
      /primero\s+.+\s+(luego|despu[eé]s)/i,
      /first\s+.+\s+then/i,
    ];

    const isCompound = compoundSignals.some((p) => p.test(input));

    if (isCompound) {
      decision.isParallel = true;
      decision.engine = "multi_engine";
    }

    return decision;
  }

  /**
   * Get the optimal model for a given capability.
   */
  getModelForCapability(capability: AgentCapability): ModelTarget {
    return this.config.modelPreferences[capability] || this.config.defaultModel;
  }

  /**
   * Estimate execution duration by engine type.
   */
  private estimateDuration(engine: EngineType): number {
    const estimates: Record<EngineType, number> = {
      orchestrator: 30000,
      computer_use: 60000,
      workflow: 120000,
      research_pipeline: 180000,
      parallel_research: 90000,
      background_task: 0, // Runs indefinitely
      multi_engine: 120000,
    };
    return estimates[engine] || 30000;
  }

  /**
   * Get routing statistics for a user.
   */
  getRouteStats(userId: string) {
    const history = this.routeHistory.get(userId) || [];
    const engineCounts: Record<string, number> = {};
    const modelCounts: Record<string, number> = {};

    for (const route of history) {
      engineCounts[route.engine] = (engineCounts[route.engine] || 0) + 1;
      modelCounts[route.suggestedModel] = (modelCounts[route.suggestedModel] || 0) + 1;
    }

    return { totalRoutes: history.length, engineCounts, modelCounts };
  }

  /**
   * Complete a route (mark as finished).
   */
  completeRoute(routeId: string): void {
    this.activeRoutes.delete(routeId);
    this.emit("route_completed", routeId);
  }
}

// Singleton instance
export const superAgentRouter = new SuperAgentRouter();
