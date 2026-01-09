export type RobustIntent = "chat" | "analysis" | "nav" | "artifact" | "code" | "automation";

export interface IntentResult {
  intent: RobustIntent;
  confidence: number;
  matchedKeywords: string[];
  reason: string;
}

const INTENT_KEYWORDS: Record<RobustIntent, string[]> = {
  analysis: [
    "resume", "resumen", "analiza", "análisis", "analisis", "extrae", "extraer",
    "sintetiza", "sintetizar", "conclusiones", "insights", "hallazgos",
    "comparar", "compara", "evalúa", "evalua", "evaluar",
    "summarize", "summary", "analyze", "analysis", "extract", "extraction",
    "synthesize", "findings", "compare", "evaluate", "evaluation",
    "interpreta", "interpret", "diagnóstico", "diagnostico", "diagnosis"
  ],
  nav: [
    "encuentra", "buscar", "búscame", "buscame", "localiza", "dónde está",
    "donde esta", "link", "enlace", "enlaces",
    "search", "find", "browse", "locate", "where is", "look for", "lookup",
    "navega", "navigate", "url", "página", "pagina", "page", "sitio", "site"
  ],
  artifact: [
    "excel", "xlsx", "xls", "word", "docx", "doc", "ppt", "pptx", "powerpoint",
    "reporte", "informe", "documento", "crear archivo", "generar archivo",
    "report", "document", "create file", "generate file", "spreadsheet",
    "hoja de cálculo", "hoja de calculo", "presentación", "presentacion",
    "presentation", "slides", "diapositivas", "pdf", "csv"
  ],
  code: [
    "código", "codigo", "programar", "programa", "script", "función", "funcion",
    "function", "debug", "debuggear", "error", "fix", "arregla", "arreglar",
    "refactor", "refactorizar", "compile", "compilar", "ejecuta", "ejecutar",
    "code", "program", "develop", "development", "bug", "issue",
    "python", "javascript", "typescript", "java", "sql", "html", "css",
    "api", "endpoint", "clase", "class", "método", "metodo", "method"
  ],
  automation: [
    "automatizar", "automatiza", "schedule", "programar tarea", "cron",
    "workflow", "flujo", "repetir", "cada día", "cada dia", "diario",
    "daily", "weekly", "semanal", "mensual", "monthly", "automate",
    "trigger", "webhook", "recurring", "recurrente", "batch", "pipeline"
  ],
  chat: [
    "hola", "hello", "hi", "hey", "gracias", "thanks", "ok", "sí", "si",
    "no", "vale", "bien", "qué tal", "que tal", "cómo estás", "como estas",
    "buenos días", "buenos dias", "buenas tardes", "buenas noches",
    "good morning", "good afternoon", "good evening", "please", "por favor"
  ]
};

const INTENT_PRIORITY: RobustIntent[] = [
  "artifact",
  "analysis",
  "code",
  "automation",
  "nav",
  "chat"
];

export function classifyIntent(text: string): IntentResult {
  const normalizedText = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const originalLower = text.toLowerCase();
  
  const scores: Record<RobustIntent, { count: number; keywords: string[] }> = {
    analysis: { count: 0, keywords: [] },
    nav: { count: 0, keywords: [] },
    artifact: { count: 0, keywords: [] },
    code: { count: 0, keywords: [] },
    automation: { count: 0, keywords: [] },
    chat: { count: 0, keywords: [] }
  };

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [RobustIntent, string[]][]) {
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalizedText.includes(normalizedKeyword) || originalLower.includes(keyword.toLowerCase())) {
        scores[intent].count++;
        if (!scores[intent].keywords.includes(keyword)) {
          scores[intent].keywords.push(keyword);
        }
      }
    }
  }

  let maxScore = 0;
  let winningIntent: RobustIntent = "chat";
  const matchedKeywords: string[] = [];

  for (const intent of INTENT_PRIORITY) {
    const score = scores[intent].count;
    if (score > maxScore) {
      maxScore = score;
      winningIntent = intent;
    }
  }

  if (maxScore > 0) {
    matchedKeywords.push(...scores[winningIntent].keywords);
  }

  const confidence = calculateConfidence(maxScore, normalizedText.length);
  const reason = maxScore > 0
    ? `Matched ${maxScore} keyword(s): ${matchedKeywords.slice(0, 3).join(", ")}`
    : "No keywords matched, defaulting to chat";

  return {
    intent: winningIntent,
    confidence,
    matchedKeywords,
    reason
  };
}

function calculateConfidence(matchCount: number, textLength: number): number {
  if (matchCount === 0) return 0.3;
  if (matchCount === 1) return 0.6;
  if (matchCount === 2) return 0.75;
  if (matchCount >= 3) return 0.9;
  return Math.min(0.95, 0.5 + (matchCount * 0.15));
}

export class RobustIntentClassifier {
  classify(text: string): IntentResult {
    const startTime = Date.now();
    const result = classifyIntent(text);
    const duration = Date.now() - startTime;
    
    console.log(`[RobustIntentClassifier] Classified in ${duration}ms: intent=${result.intent}, confidence=${result.confidence.toFixed(2)}, keywords=[${result.matchedKeywords.slice(0, 3).join(", ")}]`);
    
    return result;
  }
}
