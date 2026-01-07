import { Intent, IntentCategory, Entity, EntityType, ToolCandidate } from "./types";

interface ToolCapability {
  toolName: string;
  description: string;
  inputTypes: EntityType[];
  outputTypes: string[];
  intentAffinity: Partial<Record<IntentCategory, number>>;
  keywords: string[];
  embedding?: number[];
}

const INTENT_TO_TOOLS: Record<IntentCategory, string[]> = {
  query: [
    "search_web", "search_semantic", "memory_retrieve",
    "fetch_url", "file_read"
  ],
  command: [
    "shell", "code_execute", "file_manage", "email_manage",
    "calendar_manage", "api_call"
  ],
  creation: [
    "file_write", "doc_create", "slides_create", "spreadsheet_create",
    "generate_text", "generate_image", "code_generate"
  ],
  analysis: [
    "data_analyze", "data_visualize", "summarize", "reason",
    "vision_analyze", "verify"
  ],
  code: [
    "code_generate", "code_execute", "code_review", "code_debug",
    "code_test", "code_refactor", "shell", "git_manage"
  ],
  research: [
    "search_web", "fetch_url", "research_deep", "summarize",
    "memory_store", "verify"
  ],
  automation: [
    "schedule_cron", "schedule_once", "trigger_event",
    "workflow", "queue_manage", "webhook_send"
  ],
  conversation: ["message", "clarify", "summarize", "explain"],
  clarification: ["clarify", "context_manage"],
};

const ENTITY_TO_TOOLS: Record<EntityType, string[]> = {
  file_path: ["file_read", "file_write", "file_manage", "file_convert"],
  url: ["fetch_url", "browser_navigate", "search_web"],
  code_snippet: ["code_execute", "code_review", "code_debug"],
  date_time: ["schedule_cron", "schedule_once", "calendar_manage"],
  number: ["data_analyze", "spreadsheet_create"],
  person: ["email_manage", "calendar_manage"],
  organization: ["search_web", "research_deep"],
  tool_reference: [],
  data_format: ["file_convert", "data_transform", "file_read"],
  programming_language: ["code_generate", "code_execute", "code_review"],
  action_verb: [],
  domain_term: ["search_web", "research_deep"],
};

const STOPWORDS = new Set([
  "de", "la", "el", "en", "y", "a", "para", "con", "que", "del",
  "the", "a", "an", "and", "or", "for", "with", "to", "of", "in"
]);

export class ToolRouter {
  private similarityThreshold: number;
  private toolCapabilities: Map<string, ToolCapability> = new Map();
  private toolEmbeddings: Map<string, number[]> = new Map();
  private initialized: boolean = false;

  constructor(config: { similarityThreshold?: number } = {}) {
    this.similarityThreshold = config.similarityThreshold ?? 0.5;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { toolRegistry } = await import("../toolRegistry");
      const tools = toolRegistry.listTools();

      for (const tool of tools) {
        const capability: ToolCapability = {
          toolName: tool.name,
          description: tool.description,
          inputTypes: [],
          outputTypes: [],
          intentAffinity: this.computeIntentAffinity(tool.name, tool.category),
          keywords: this.extractKeywords(tool.description),
        };

        this.toolCapabilities.set(tool.name, capability);
      }

      this.initialized = true;
      console.log(`[ToolRouter] Initialized ${this.toolCapabilities.size} tool capabilities`);
    } catch (error) {
      console.warn("[ToolRouter] Failed to initialize from registry, using defaults:", error);
      this.initialized = true;
    }
  }

  async route(
    prompt: string,
    intents: Intent[],
    entities: Entity[],
    maxCandidates: number = 5
  ): Promise<ToolCandidate[]> {
    await this.initialize();

    const candidates = new Map<string, ToolCandidate>();

    const intentScores = this.scoreByIntent(intents);
    const entityScores = this.scoreByEntities(entities);
    const semanticScores = await this.scoreBySemantics(prompt);
    const keywordScores = this.scoreByKeywords(prompt);

    const allTools = new Set([
      ...Object.keys(intentScores),
      ...Object.keys(entityScores),
      ...Object.keys(semanticScores),
      ...Object.keys(keywordScores),
    ]);

    const intentWeight = 0.35;
    const entityWeight = 0.25;
    const semanticWeight = 0.25;
    const keywordWeight = 0.15;

    for (const toolName of allTools) {
      const combinedScore =
        (intentScores[toolName] || 0) * intentWeight +
        (entityScores[toolName] || 0) * entityWeight +
        (semanticScores[toolName] || 0) * semanticWeight +
        (keywordScores[toolName] || 0) * keywordWeight;

      if (combinedScore >= this.similarityThreshold) {
        candidates.set(toolName, {
          toolName,
          relevanceScore: combinedScore,
          capabilityMatch: semanticScores[toolName] || keywordScores[toolName] || 0,
          requiredParams: {},
          optionalParams: {},
          dependencies: this.getDependencies(toolName),
        });
      }
    }

    const sorted = Array.from(candidates.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    return sorted.slice(0, maxCandidates);
  }

  private scoreByIntent(intents: Intent[]): Record<string, number> {
    const scores: Record<string, number> = {};

    for (const intent of intents) {
      const tools = INTENT_TO_TOOLS[intent.category] || [];
      for (const tool of tools) {
        if (scores[tool] === undefined) {
          scores[tool] = 0;
        }
        scores[tool] += intent.confidence;
      }
    }

    if (Object.keys(scores).length > 0) {
      const maxScore = Math.max(...Object.values(scores));
      if (maxScore > 0) {
        for (const tool of Object.keys(scores)) {
          scores[tool] /= maxScore;
        }
      }
    }

    return scores;
  }

  private scoreByEntities(entities: Entity[]): Record<string, number> {
    const scores: Record<string, number> = {};

    for (const entity of entities) {
      const tools = ENTITY_TO_TOOLS[entity.type] || [];
      for (const tool of tools) {
        if (scores[tool] === undefined) {
          scores[tool] = 0;
        }
        scores[tool] += entity.confidence;
      }
    }

    if (Object.keys(scores).length > 0) {
      const maxScore = Math.max(...Object.values(scores));
      if (maxScore > 0) {
        for (const tool of Object.keys(scores)) {
          scores[tool] /= maxScore;
        }
      }
    }

    return scores;
  }

  private async scoreBySemantics(prompt: string): Promise<Record<string, number>> {
    const scores: Record<string, number> = {};

    if (this.toolEmbeddings.size === 0) {
      return this.scoreByKeywords(prompt);
    }

    try {
      const { generateEmbedding } = await import("../../lib/embeddings");
      const promptEmbedding = await generateEmbedding(prompt);

      for (const [toolName, toolEmbedding] of this.toolEmbeddings) {
        const similarity = this.cosineSimilarity(promptEmbedding, toolEmbedding);
        const normalizedSim = (similarity + 1) / 2;

        if (normalizedSim > this.similarityThreshold) {
          scores[toolName] = normalizedSim;
        }
      }
    } catch (error) {
      console.warn("[ToolRouter] Semantic scoring failed, using keyword fallback");
      return this.scoreByKeywords(prompt);
    }

    return scores;
  }

  private scoreByKeywords(prompt: string): Record<string, number> {
    const scores: Record<string, number> = {};
    const promptLower = prompt.toLowerCase();

    for (const [toolName, capability] of this.toolCapabilities) {
      if (capability.keywords.length === 0) continue;

      const matches = capability.keywords.filter(
        (keyword) => promptLower.includes(keyword.toLowerCase())
      ).length;

      if (matches > 0) {
        scores[toolName] = Math.min(matches / capability.keywords.length, 1.0);
      }
    }

    if (this.toolCapabilities.size === 0) {
      const defaultKeywords: Record<string, string[]> = {
        search_web: ["buscar", "search", "find", "investigar", "noticias", "news"],
        fetch_url: ["url", "página", "sitio", "website", "enlace", "link"],
        file_read: ["leer", "read", "archivo", "file", "documento"],
        file_write: ["escribir", "write", "guardar", "save", "crear archivo"],
        code_execute: ["ejecutar", "run", "correr", "código", "script"],
        code_generate: ["código", "code", "programar", "function", "clase"],
        generate_text: ["texto", "escribir", "redactar", "contenido"],
        generate_image: ["imagen", "image", "foto", "picture"],
        doc_create: ["documento", "word", "docx", "informe", "report"],
        slides_create: ["presentación", "slides", "powerpoint", "ppt"],
        spreadsheet_create: ["excel", "spreadsheet", "tabla", "hoja de cálculo"],
        data_analyze: ["analizar", "analyze", "datos", "data", "estadísticas"],
        summarize: ["resumir", "summarize", "resumen", "summary"],
        email_manage: ["email", "correo", "enviar mensaje"],
      };

      for (const [toolName, keywords] of Object.entries(defaultKeywords)) {
        const matches = keywords.filter((k) => promptLower.includes(k)).length;
        if (matches > 0) {
          scores[toolName] = Math.min(matches / keywords.length, 1.0);
        }
      }
    }

    return scores;
  }

  private computeIntentAffinity(
    toolName: string,
    category?: string
  ): Partial<Record<IntentCategory, number>> {
    const affinity: Partial<Record<IntentCategory, number>> = {};

    for (const [intentCat, tools] of Object.entries(INTENT_TO_TOOLS)) {
      if (tools.includes(toolName)) {
        affinity[intentCat as IntentCategory] = 1.0;
      } else if (category) {
        const categoryMapping: Record<string, IntentCategory[]> = {
          Orchestration: ["command"],
          Memory: ["query", "research"],
          Reasoning: ["analysis", "query"],
          Communication: ["conversation"],
          Development: ["command", "code"],
          Document: ["creation", "command"],
          Web: ["research", "query"],
          Generation: ["creation"],
          Data: ["analysis"],
          Automation: ["automation"],
        };

        const relatedIntents = categoryMapping[category] || [];
        if (relatedIntents.includes(intentCat as IntentCategory)) {
          affinity[intentCat as IntentCategory] = 0.5;
        }
      }
    }

    return affinity;
  }

  private extractKeywords(description: string): string[] {
    const words = description.toLowerCase().split(/\s+/);
    const keywords = words.filter(
      (w) => w.length > 3 && !STOPWORDS.has(w)
    );
    return [...new Set(keywords)];
  }

  private getDependencies(toolName: string): string[] {
    const dependencies: Record<string, string[]> = {
      code_execute: ["code_generate"],
      data_visualize: ["data_analyze"],
      email_manage: ["generate_text"],
      slides_create: ["generate_text"],
      research_deep: ["search_web"],
      verify: ["search_web"],
    };

    return dependencies[toolName] || [];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
