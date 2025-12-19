import { 
  MultiIntentDetection, 
  MultiIntentDetectionSchema,
  TaskPlan,
  IntentType,
  MULTI_INTENT_THRESHOLD 
} from "../../../shared/schemas/multiIntent";

interface ConversationContext {
  messages: Array<{ role: string; content: string }>;
  userPreferences?: Record<string, any>;
  recentTasks?: string[];
}

const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  search: [
    /\b(busca|buscar|encuentra|encontrar|search|find|look for|lookup)\b/i,
    /\b(qué es|what is|cuál es|which is|dime sobre|tell me about)\b/i
  ],
  analyze: [
    /\b(analiza|analyze|examina|examine|evalúa|evaluate|compara|compare)\b/i,
    /\b(analizar|análisis|analysis)\b/i
  ],
  generate: [
    /\b(genera|generate|crea|create|escribe|write|redacta|draft|haz|make)\b/i,
    /\b(diseña|design|construye|build)\b/i
  ],
  transform: [
    /\b(convierte|convert|transforma|transform|cambia|change|modifica|modify)\b/i,
    /\b(traduce|translate|reformatea|reformat)\b/i
  ],
  summarize: [
    /\b(resume|summarize|resumen|summary|sintetiza|synthesize)\b/i,
    /\b(breve|brief|conciso|concise|puntos clave|key points)\b/i
  ],
  extract: [
    /\b(extrae|extract|obtén|get|saca|pull out|identifica|identify)\b/i,
    /\b(lista|list|enumera|enumerate)\b/i
  ],
  navigate: [
    /\b(navega|navigate|ve a|go to|abre|open|visita|visit)\b/i,
    /\b(descarga|download|captura|capture|screenshot)\b/i
  ],
  chat: [
    /\b(hola|hello|hi|hey|gracias|thanks|oye|listen)\b/i
  ]
};

const SEPARATOR_PATTERNS = [
  /\b(y también|and also|además|also|luego|then|después|after that)\b/i,
  /\b(primero|first|segundo|second|tercero|third)\b/i,
  /\d+\s*[.)]\s*/,
  /[;]\s*/,
  /\n+/
];

export class MultiIntentManager {
  async detectMultiIntent(
    message: string,
    context?: ConversationContext
  ): Promise<MultiIntentDetection> {
    const detectedIntents = this.analyzeIntents(message);
    const hasSeparators = this.detectSeparators(message);
    const intentCount = detectedIntents.length;
    
    let confidence = 0;
    
    if (intentCount > 1) {
      confidence = 0.5 + (Math.min(intentCount, 4) * 0.1);
    }
    
    if (hasSeparators) {
      confidence += 0.2;
    }
    
    if (message.length > 200 && intentCount > 1) {
      confidence += 0.1;
    }
    
    if (context?.messages && context.messages.length > 0) {
      const recentContext = this.analyzeRecentContext(context);
      if (recentContext.suggestsComplexTask) {
        confidence += 0.1;
      }
    }
    
    confidence = Math.min(confidence, 1);
    
    const isMultiIntent = confidence >= MULTI_INTENT_THRESHOLD && intentCount > 1;
    
    let suggestedPlan: TaskPlan[] | undefined;
    if (isMultiIntent) {
      suggestedPlan = this.generateSuggestedPlan(message, detectedIntents);
    }
    
    return MultiIntentDetectionSchema.parse({
      isMultiIntent,
      confidence,
      detectedIntents,
      suggestedPlan
    });
  }
  
  private analyzeIntents(message: string): Array<{
    type: IntentType;
    description: string;
    keywords: string[];
  }> {
    const detected: Array<{
      type: IntentType;
      description: string;
      keywords: string[];
    }> = [];
    
    for (const [intentType, patterns] of Object.entries(INTENT_PATTERNS)) {
      const keywords: string[] = [];
      
      for (const pattern of patterns) {
        const matches = message.match(pattern);
        if (matches) {
          keywords.push(matches[0]);
        }
      }
      
      if (keywords.length > 0) {
        detected.push({
          type: intentType as IntentType,
          description: this.getIntentDescription(intentType as IntentType, message),
          keywords
        });
      }
    }
    
    return detected;
  }
  
  private detectSeparators(message: string): boolean {
    for (const pattern of SEPARATOR_PATTERNS) {
      if (pattern.test(message)) {
        return true;
      }
    }
    return false;
  }
  
  private analyzeRecentContext(context: ConversationContext): {
    suggestsComplexTask: boolean;
  } {
    const recentMessages = context.messages.slice(-3);
    const complexIndicators = [
      /\b(proyecto|project|tarea compleja|complex task)\b/i,
      /\b(varios pasos|multiple steps|proceso|process)\b/i
    ];
    
    for (const msg of recentMessages) {
      for (const indicator of complexIndicators) {
        if (indicator.test(msg.content)) {
          return { suggestsComplexTask: true };
        }
      }
    }
    
    return { suggestsComplexTask: false };
  }
  
  private getIntentDescription(type: IntentType, message: string): string {
    const descriptions: Record<IntentType, string> = {
      search: "Search for information",
      analyze: "Analyze data or content",
      generate: "Generate new content",
      transform: "Transform or convert content",
      summarize: "Summarize information",
      extract: "Extract specific data",
      navigate: "Navigate to web resources",
      chat: "General conversation"
    };
    return descriptions[type] || "Unknown intent";
  }
  
  private generateSuggestedPlan(
    message: string,
    intents: Array<{ type: IntentType; description: string; keywords: string[] }>
  ): TaskPlan[] {
    const plan: TaskPlan[] = [];
    
    intents.forEach((intent, index) => {
      const hasDependent = index > 0 && this.intentsDependOnPrevious(intents[index - 1].type, intent.type);
      
      plan.push({
        id: `task_${index + 1}`,
        title: intent.description,
        intentType: intent.type,
        description: `${intent.description} based on: ${intent.keywords.join(", ")}`,
        requiredContext: hasDependent ? [`task_${index}`] : [],
        executionMode: hasDependent ? "sequential" : "parallel",
        dependencies: hasDependent ? [`task_${index}`] : [],
        priority: intents.length - index
      });
    });
    
    return plan;
  }
  
  private intentsDependOnPrevious(prev: IntentType, current: IntentType): boolean {
    const dependencyMap: Record<IntentType, IntentType[]> = {
      summarize: ["search", "extract", "navigate"],
      analyze: ["search", "extract", "navigate"],
      transform: ["search", "extract", "generate"],
      generate: ["search", "analyze"],
      extract: ["search", "navigate"],
      search: [],
      navigate: [],
      chat: []
    };
    
    return dependencyMap[current]?.includes(prev) ?? false;
  }
}

export const multiIntentManager = new MultiIntentManager();
