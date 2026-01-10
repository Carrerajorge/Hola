import { z } from "zod";
import { randomUUID } from "crypto";

export const IntentTypeSchema = z.enum([
  "chat",
  "research",
  "document_analysis",
  "document_generation",
  "data_analysis",
  "code_generation",
  "web_automation",
  "image_generation",
  "presentation_creation",
  "spreadsheet_creation",
  "multi_step_task",
  "unknown"
]);
export type IntentType = z.infer<typeof IntentTypeSchema>;

export const DeliverableTypeSchema = z.enum([
  "text_response",
  "pptx",
  "docx",
  "xlsx",
  "pdf",
  "image",
  "chart",
  "code",
  "app",
  "research_report",
  "data_export",
  "multiple"
]);
export type DeliverableType = z.infer<typeof DeliverableTypeSchema>;

export const SpecializedAgentSchema = z.enum([
  "orchestrator",
  "research",
  "code",
  "data",
  "content",
  "communication",
  "browser",
  "document",
  "qa",
  "security"
]);
export type SpecializedAgent = z.infer<typeof SpecializedAgentSchema>;

export const AttachmentSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  storagePath: z.string().optional(),
  size: z.number().optional(),
  extractedContent: z.string().optional(),
  metadata: z.record(z.any()).optional()
});
export type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;

export const SessionStateSchema = z.object({
  conversationId: z.string(),
  turnNumber: z.number().int().nonnegative(),
  previousIntents: z.array(IntentTypeSchema).default([]),
  previousDeliverables: z.array(z.string()).default([]),
  workingContext: z.record(z.any()).default({}),
  memoryKeys: z.array(z.string()).default([]),
  lastUpdated: z.date()
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const QualityConstraintsSchema = z.object({
  maxExecutionTimeMs: z.number().int().positive().default(120000),
  requireVerification: z.boolean().default(true),
  minConfidenceScore: z.number().min(0).max(1).default(0.7),
  allowFallback: z.boolean().default(true),
  requireCitations: z.boolean().default(false),
  outputFormat: z.enum(["streaming", "batch"]).default("streaming")
});
export type QualityConstraints = z.infer<typeof QualityConstraintsSchema>;

export const RequestSpecSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string(),
  messageId: z.string().optional(),
  userId: z.string(),
  
  rawMessage: z.string(),
  intent: IntentTypeSchema,
  intentConfidence: z.number().min(0).max(1),
  
  deliverableType: DeliverableTypeSchema,
  deliverableSpec: z.record(z.any()).optional(),
  
  targetAgents: z.array(SpecializedAgentSchema).min(1),
  primaryAgent: SpecializedAgentSchema,
  
  attachments: z.array(AttachmentSpecSchema).default([]),
  sessionState: SessionStateSchema.optional(),
  
  constraints: QualityConstraintsSchema.default({}),
  
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  validatedAt: z.date().optional()
});
export type RequestSpec = z.infer<typeof RequestSpecSchema>;

export const RequestSpecResultSchema = z.object({
  spec: RequestSpecSchema,
  routingDecision: z.object({
    route: z.string(),
    confidence: z.number(),
    reasoning: z.string().optional()
  }),
  executionPlan: z.object({
    estimatedSteps: z.number().int().positive(),
    estimatedTimeMs: z.number().int().positive(),
    requiredTools: z.array(z.string())
  }).optional()
});
export type RequestSpecResult = z.infer<typeof RequestSpecResultSchema>;

const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  research: [
    /\b(investiga|busca|encuentra|search|find|research|look up|investigar)\b/i,
    /\b(qué es|what is|cuál es|who is|quién es)\b/i,
    /\b(información sobre|info about|datos de)\b/i
  ],
  document_analysis: [
    /\b(analiza|analyze|revisa|review|examina|examine)\b.*\b(documento|document|archivo|file|pdf|excel|word)\b/i,
    /\b(resume|summarize|extrae|extract)\b.*\b(de|from)\b/i
  ],
  document_generation: [
    /\b(crea|create|genera|generate|escribe|write|redacta|draft)\b.*\b(documento|document|informe|report|carta|letter)\b/i,
    /\b(hazme|make me|prepara|prepare)\b.*\b(un|a)\b/i
  ],
  presentation_creation: [
    /\b(crea|create|genera|generate|hazme|make)\b.*\b(presentación|presentation|ppt|powerpoint|slides|diapositivas)\b/i
  ],
  spreadsheet_creation: [
    /\b(crea|create|genera|generate|hazme|make)\b.*\b(excel|spreadsheet|hoja de cálculo|tabla|table)\b/i
  ],
  data_analysis: [
    /\b(analiza|analyze|procesa|process)\b.*\b(datos|data|números|numbers|estadísticas|statistics)\b/i,
    /\b(gráfico|chart|graph|visualiza|visualize)\b/i
  ],
  code_generation: [
    /\b(código|code|programa|program|script|función|function|app|aplicación|application)\b/i,
    /\b(implementa|implement|desarrolla|develop|crea|create)\b.*\b(en|in)\b.*\b(python|javascript|typescript|java|c\+\+)\b/i
  ],
  web_automation: [
    /\b(navega|navigate|abre|open|visita|visit|scrape|extrae de)\b.*\b(web|página|page|sitio|site|url)\b/i,
    /\b(automatiza|automate)\b.*\b(browser|navegador)\b/i
  ],
  image_generation: [
    /\b(genera|generate|crea|create|dibuja|draw|hazme|make)\b.*\b(imagen|image|foto|photo|ilustración|illustration)\b/i
  ],
  multi_step_task: [
    /\b(paso a paso|step by step|primero.*luego|first.*then)\b/i,
    /\b(complejo|complex|múltiples|multiple)\b.*\b(pasos|steps|tareas|tasks)\b/i
  ],
  chat: [],
  unknown: []
};

const DELIVERABLE_MAPPING: Record<IntentType, DeliverableType> = {
  chat: "text_response",
  research: "research_report",
  document_analysis: "text_response",
  document_generation: "docx",
  data_analysis: "chart",
  code_generation: "code",
  web_automation: "text_response",
  image_generation: "image",
  presentation_creation: "pptx",
  spreadsheet_creation: "xlsx",
  multi_step_task: "multiple",
  unknown: "text_response"
};

const AGENT_MAPPING: Record<IntentType, SpecializedAgent[]> = {
  chat: ["content"],
  research: ["research", "browser"],
  document_analysis: ["document", "data"],
  document_generation: ["content", "document"],
  data_analysis: ["data", "code"],
  code_generation: ["code", "qa"],
  web_automation: ["browser", "research"],
  image_generation: ["content"],
  presentation_creation: ["content", "document"],
  spreadsheet_creation: ["data", "document"],
  multi_step_task: ["orchestrator"],
  unknown: ["content"]
};

export function detectIntent(message: string, attachments: AttachmentSpec[] = []): { intent: IntentType; confidence: number } {
  const lowerMessage = message.toLowerCase();
  
  if (attachments.length > 0) {
    const hasDocuments = attachments.some(a => 
      /\.(pdf|docx?|xlsx?|pptx?|csv|txt)$/i.test(a.name) ||
      a.mimeType.includes("pdf") ||
      a.mimeType.includes("document") ||
      a.mimeType.includes("spreadsheet")
    );
    if (hasDocuments) {
      return { intent: "document_analysis", confidence: 0.85 };
    }
  }
  
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [IntentType, RegExp[]][]) {
    if (intent === "chat" || intent === "unknown") continue;
    for (const pattern of patterns) {
      if (pattern.test(lowerMessage)) {
        return { intent, confidence: 0.8 };
      }
    }
  }
  
  if (message.length < 50 && !message.includes("?")) {
    return { intent: "chat", confidence: 0.6 };
  }
  
  return { intent: "chat", confidence: 0.5 };
}

export function createRequestSpec(params: {
  chatId: string;
  messageId?: string;
  userId: string;
  rawMessage: string;
  attachments?: AttachmentSpec[];
  sessionState?: SessionState;
  constraints?: Partial<QualityConstraints>;
}): RequestSpec {
  const { intent, confidence } = detectIntent(params.rawMessage, params.attachments);
  const deliverableType = DELIVERABLE_MAPPING[intent];
  const targetAgents = AGENT_MAPPING[intent];
  
  return {
    id: randomUUID(),
    chatId: params.chatId,
    messageId: params.messageId,
    userId: params.userId,
    rawMessage: params.rawMessage,
    intent,
    intentConfidence: confidence,
    deliverableType,
    targetAgents,
    primaryAgent: targetAgents[0],
    attachments: params.attachments || [],
    sessionState: params.sessionState,
    constraints: QualityConstraintsSchema.parse(params.constraints || {}),
    createdAt: new Date()
  };
}

export function validateRequestSpec(spec: unknown): RequestSpec {
  return RequestSpecSchema.parse(spec);
}
