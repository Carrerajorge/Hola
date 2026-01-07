import { Intent, IntentCategory, Entity, EntityType, ToolCandidate } from "./types";

const INTENT_TO_TOOLS: Record<IntentCategory, string[]> = {
  query: ["web_search", "search_semantic", "memory_retrieve", "fetch_url", "file_read"],
  command: ["shell_command", "code_execute", "file_manage", "email_send", "api_call"],
  creation: ["file_write", "doc_create", "slides_create", "spreadsheet_create", "generate_text", "generate_image", "code_generate"],
  analysis: ["data_analyze", "data_visualize", "summarize", "vision_analyze", "verify"],
  code: ["code_generate", "code_execute", "code_review", "code_debug", "code_test", "shell_command"],
  research: ["web_search", "fetch_url", "research_deep", "summarize", "verify"],
  automation: ["schedule_cron", "workflow_create", "trigger_event", "webhook_send"],
  conversation: ["message", "clarify", "summarize", "explain"],
  clarification: ["clarify", "context_manage"],
};

const ENTITY_TO_TOOLS: Record<EntityType, string[]> = {
  file_path: ["file_read", "file_write", "file_manage", "file_convert"],
  url: ["fetch_url", "browser_navigate", "web_search"],
  code_snippet: ["code_execute", "code_review", "code_debug"],
  date_time: ["schedule_cron", "calendar_create"],
  number: ["data_analyze", "spreadsheet_create"],
  person: ["email_send", "calendar_create"],
  organization: ["web_search", "research_deep"],
  tool_reference: [],
  data_format: ["file_convert", "data_transform", "file_read"],
  programming_language: ["code_generate", "code_execute", "code_review"],
  action_verb: [],
  domain_term: ["web_search", "research_deep"],
};

const TOOL_KEYWORDS: Record<string, string[]> = {
  web_search: ["buscar", "search", "find", "investigar", "noticias", "news", "información"],
  fetch_url: ["url", "página", "sitio", "website", "enlace", "link"],
  file_read: ["leer", "read", "archivo", "file", "documento"],
  file_write: ["escribir", "write", "guardar", "save", "crear archivo"],
  code_execute: ["ejecutar", "run", "correr", "código", "script"],
  code_generate: ["código", "code", "programar", "function", "clase", "class"],
  generate_text: ["texto", "escribir", "redactar", "contenido"],
  generate_image: ["imagen", "image", "foto", "picture", "ilustración"],
  doc_create: ["documento", "word", "docx", "informe", "report"],
  slides_create: ["presentación", "slides", "powerpoint", "ppt", "diapositivas"],
  spreadsheet_create: ["excel", "spreadsheet", "tabla", "hoja de cálculo"],
  data_analyze: ["analizar", "analyze", "datos", "data", "estadísticas"],
  summarize: ["resumir", "summarize", "resumen", "summary"],
  email_send: ["email", "correo", "enviar mensaje"],
};

export class ToolRouter {
  private similarityThreshold: number;

  constructor(config: { similarityThreshold?: number } = {}) {
    this.similarityThreshold = config.similarityThreshold ?? 0.5;
  }

  async route(
    prompt: string,
    intents: Intent[],
    entities: Entity[],
    maxCandidates: number = 5
  ): Promise<ToolCandidate[]> {
    const candidates = new Map<string, ToolCandidate>();

    const intentScores = this.scoreByIntent(intents);
    const entityScores = this.scoreByEntities(entities);
    const keywordScores = this.scoreByKeywords(prompt);

    const allTools = new Set([
      ...Object.keys(intentScores),
      ...Object.keys(entityScores),
      ...Object.keys(keywordScores),
    ]);

    const intentWeight = 0.4;
    const entityWeight = 0.3;
    const keywordWeight = 0.3;

    for (const toolName of allTools) {
      const combinedScore =
        (intentScores[toolName] || 0) * intentWeight +
        (entityScores[toolName] || 0) * entityWeight +
        (keywordScores[toolName] || 0) * keywordWeight;

      if (combinedScore >= this.similarityThreshold) {
        candidates.set(toolName, {
          toolName,
          relevanceScore: combinedScore,
          capabilityMatch: keywordScores[toolName] || 0,
          requiredParams: {},
          optionalParams: {},
          dependencies: this.getToolDependencies(toolName),
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
        scores[tool] = (scores[tool] || 0) + intent.confidence;
      }
    }

    const maxScore = Math.max(...Object.values(scores), 1);
    for (const tool of Object.keys(scores)) {
      scores[tool] /= maxScore;
    }

    return scores;
  }

  private scoreByEntities(entities: Entity[]): Record<string, number> {
    const scores: Record<string, number> = {};

    for (const entity of entities) {
      const tools = ENTITY_TO_TOOLS[entity.type] || [];
      for (const tool of tools) {
        scores[tool] = (scores[tool] || 0) + entity.confidence;
      }
    }

    const maxScore = Math.max(...Object.values(scores), 1);
    for (const tool of Object.keys(scores)) {
      scores[tool] /= maxScore;
    }

    return scores;
  }

  private scoreByKeywords(prompt: string): Record<string, number> {
    const scores: Record<string, number> = {};
    const promptLower = prompt.toLowerCase();

    for (const [toolName, keywords] of Object.entries(TOOL_KEYWORDS)) {
      let matches = 0;
      for (const keyword of keywords) {
        if (promptLower.includes(keyword.toLowerCase())) {
          matches++;
        }
      }
      if (matches > 0) {
        scores[toolName] = Math.min(matches / keywords.length, 1.0);
      }
    }

    return scores;
  }

  private getToolDependencies(toolName: string): string[] {
    const dependencies: Record<string, string[]> = {
      code_execute: ["code_generate"],
      data_visualize: ["data_analyze"],
      email_send: ["generate_text"],
      slides_create: ["generate_text"],
      research_deep: ["web_search"],
    };

    return dependencies[toolName] || [];
  }
}
