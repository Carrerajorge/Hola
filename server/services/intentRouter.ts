import { z } from "zod";
import { llmGateway } from "../lib/llmGateway";

export const IntentTypeSchema = z.enum([
  "CREATE_PRESENTATION",
  "CREATE_DOCUMENT",
  "CREATE_SPREADSHEET",
  "SUMMARIZE",
  "TRANSLATE",
  "SEARCH_WEB",
  "ANALYZE_DOCUMENT",
  "CHAT_GENERAL",
  "NEED_CLARIFICATION"
]);

export const OutputFormatSchema = z.enum([
  "pptx",
  "docx",
  "xlsx",
  "pdf",
  "txt",
  "csv",
  "html"
]).nullable();

export const LengthSchema = z.enum(["short", "medium", "long"]).nullable();

export const SlotsSchema = z.object({
  topic: z.string().optional(),
  title: z.string().optional(),
  language: z.string().optional(),
  length: LengthSchema.optional(),
  audience: z.string().optional(),
  style: z.string().optional(),
  bullet_points: z.boolean().optional(),
  include_images: z.boolean().optional(),
  source_language: z.string().optional(),
  target_language: z.string().optional(),
  num_slides: z.number().optional(),
  template: z.string().optional()
});

export const IntentResultSchema = z.object({
  intent: IntentTypeSchema,
  output_format: OutputFormatSchema,
  slots: SlotsSchema,
  confidence: z.number().min(0).max(1),
  normalized_text: z.string(),
  clarification_question: z.string().optional(),
  matched_patterns: z.array(z.string()).optional(),
  reasoning: z.string().optional()
});

export type IntentType = z.infer<typeof IntentTypeSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type Slots = z.infer<typeof SlotsSchema>;
export type IntentResult = z.infer<typeof IntentResultSchema>;

const TYPO_CORRECTIONS: Record<string, string> = {
  "pawer point": "powerpoint",
  "pawerpoint": "powerpoint",
  "power pont": "powerpoint",
  "powerpint": "powerpoint",
  "powrpoint": "powerpoint",
  "powepoint": "powerpoint",
  "poewr point": "powerpoint",
  "slaind": "slides",
  "slaid": "slides",
  "slaide": "slides",
  "slidez": "slides",
  "precentacion": "presentacion",
  "presentasion": "presentacion",
  "presentaciom": "presentacion",
  "presetacion": "presentacion",
  "presentacin": "presentacion",
  "diapositvas": "diapositivas",
  "diapositivs": "diapositivas",
  "diapisitivas": "diapositivas",
  "documeto": "documento",
  "docuemnto": "documento",
  "documentp": "documento",
  "documnt": "documento",
  "exel": "excel",
  "excell": "excel",
  "exce": "excel",
  "hoja de calulo": "hoja de calculo",
  "hoja d calculo": "hoja de calculo",
  "spreadhseet": "spreadsheet",
  "spredsheet": "spreadsheet",
  "spreadhsheet": "spreadsheet",
  "resum": "resumen",
  "resumn": "resumen",
  "resumir": "resumen",
  "summay": "summary",
  "sumary": "summary",
  "traduccion": "traduccion",
  "traduccin": "traduccion",
  "traduce": "traducir",
  "transalte": "translate",
  "tranlate": "translate",
  "translte": "translate",
  "buscar": "buscar",
  "busacr": "buscar",
  "bsucar": "buscar",
  "investigar": "investigar",
  "investiga": "investigar",
  "analizar": "analizar",
  "analisar": "analizar",
  "analyza": "analizar"
};

const INTENT_ALIASES: Record<IntentType, string[]> = {
  CREATE_PRESENTATION: [
    "ppt", "pptx", "powerpoint", "power point", "presentacion", "presentación",
    "diapositivas", "slides", "slide", "crear presentacion", "generar presentacion",
    "make presentation", "create presentation", "generate slides", "hacer diapositivas",
    "armar presentacion", "construir presentacion", "exportar a ppt", "presenta"
  ],
  CREATE_DOCUMENT: [
    "doc", "docx", "word", "documento", "informe", "reporte", "report",
    "crear documento", "generar documento", "hacer documento", "escribir documento",
    "create document", "make document", "write document", "generate report",
    "elaborar informe", "redactar", "carta", "letter", "essay", "ensayo",
    "articulo", "article", "manual", "guia", "guide"
  ],
  CREATE_SPREADSHEET: [
    "xls", "xlsx", "excel", "hoja de calculo", "hoja de cálculo", "spreadsheet",
    "sheet", "tabla", "table", "crear excel", "generar excel", "hacer tabla",
    "create spreadsheet", "make excel", "generate table", "datos tabulares",
    "planilla", "calcular", "calculate", "formulas", "grafico", "chart"
  ],
  SUMMARIZE: [
    "resume", "resumen", "resumir", "resumeme", "sintetiza", "sintetizar",
    "summary", "summarize", "síntesis", "sintesis", "condensar", "condensed",
    "extracto", "extract key points", "puntos clave", "lo mas importante",
    "en pocas palabras", "briefing", "brief", "tldr", "tl;dr"
  ],
  TRANSLATE: [
    "traduce", "traducir", "traduccion", "traducción", "translate", "translation",
    "al español", "al ingles", "al inglés", "to english", "to spanish",
    "en frances", "en francés", "to french", "en aleman", "en alemán", "to german",
    "pasar a", "convertir a idioma", "cambiar idioma"
  ],
  SEARCH_WEB: [
    "busca en internet", "buscar en web", "search web", "search online",
    "busca online", "google", "investigar", "research", "buscar informacion",
    "encuentra informacion", "find information", "look up", "consultar",
    "averiguar", "indagar", "explorar web", "navegar", "browse"
  ],
  ANALYZE_DOCUMENT: [
    "analiza", "analizar", "análisis", "analisis", "analyze", "analysis",
    "revisa", "revisar", "review", "evalua", "evaluar", "evaluate", "evaluation",
    "examina", "examinar", "examine", "interpreta", "interpretar", "interpret",
    "diagnostico", "diagnóstico", "diagnosis", "critica", "criticar", "critique"
  ],
  CHAT_GENERAL: [
    "hola", "hello", "hi", "hey", "gracias", "thanks", "ok", "sí", "si",
    "no", "vale", "bien", "qué tal", "que tal", "cómo estás", "como estas",
    "buenos días", "buenos dias", "buenas tardes", "buenas noches",
    "por favor", "please", "ayuda", "help"
  ],
  NEED_CLARIFICATION: []
};

const CREATION_VERBS = [
  "crear", "crea", "creame", "créame", "generar", "genera", "generame",
  "hacer", "haz", "hazme", "armar", "arma", "armame",
  "construir", "construye", "construyeme", "exportar", "exporta",
  "create", "make", "generate", "build", "produce", "design", "draft",
  "elaborar", "elabora", "redactar", "redacta", "preparar", "prepara",
  "desarrollar", "desarrolla", "escribir", "escribe", "escribeme"
];

const FORMAT_KEYWORDS: Record<NonNullable<OutputFormat>, string[]> = {
  pptx: ["pptx", "ppt", "powerpoint", "power point", "presentacion", "presentación", "slides", "diapositivas"],
  docx: ["docx", "doc", "word", "documento", "document", "informe", "reporte", "report"],
  xlsx: ["xlsx", "xls", "excel", "spreadsheet", "hoja de calculo", "tabla", "planilla"],
  pdf: ["pdf", "portable document", "exportar pdf"],
  txt: ["txt", "texto plano", "plain text", "text file"],
  csv: ["csv", "comma separated", "valores separados"],
  html: ["html", "webpage", "pagina web", "página web"]
};

const AUDIENCE_KEYWORDS: Record<string, string[]> = {
  "executives": ["ejecutivos", "directivos", "ceo", "cfo", "c-level", "junta directiva", "board", "executives", "leadership"],
  "technical": ["tecnicos", "técnicos", "ingenieros", "developers", "programadores", "technical", "engineering"],
  "general": ["general", "publico general", "público general", "everyone", "todos", "audiencia general"],
  "academic": ["academico", "académico", "estudiantes", "students", "universidad", "university", "academic", "research"],
  "clients": ["clientes", "customers", "clients", "compradores", "buyers"],
  "investors": ["inversores", "inversionistas", "investors", "stakeholders", "accionistas"]
};

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  "es": ["español", "espanol", "spanish", "castellano"],
  "en": ["ingles", "inglés", "english"],
  "fr": ["frances", "francés", "french"],
  "de": ["aleman", "alemán", "german", "deutsch"],
  "pt": ["portugues", "português", "portuguese"],
  "it": ["italiano", "italian"],
  "zh": ["chino", "chinese", "mandarin"],
  "ja": ["japones", "japonés", "japanese"]
};

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

function fuzzyMatch(text: string, target: string, threshold: number = 0.75): { match: boolean; similarity: number } {
  const normalizedText = text.toLowerCase();
  const normalizedTarget = target.toLowerCase();
  
  if (normalizedText.includes(normalizedTarget)) {
    return { match: true, similarity: 1.0 };
  }
  
  const distance = levenshteinDistance(normalizedText, normalizedTarget);
  const maxLength = Math.max(normalizedText.length, normalizedTarget.length);
  const similarity = 1 - (distance / maxLength);
  
  return { match: similarity >= threshold, similarity };
}

function normalize(text: string): string {
  let normalized = text.toLowerCase();
  
  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  normalized = normalized.replace(/[^\w\s]/g, " ");
  
  normalized = normalized.replace(/\s+/g, " ").trim();
  
  for (const [typo, correction] of Object.entries(TYPO_CORRECTIONS)) {
    const regex = new RegExp(typo.replace(/\s+/g, "\\s*"), "gi");
    normalized = normalized.replace(regex, correction);
  }
  
  return normalized;
}

function extractSlots(normalizedText: string, originalText: string): Slots {
  const slots: Slots = {};
  
  const lengthPatterns: Array<{ pattern: RegExp; value: "short" | "medium" | "long" }> = [
    { pattern: /\b(breve|corto|corta|short|brief|rapido|rápido|conciso)\b/i, value: "short" },
    { pattern: /\b(medio|mediano|mediana|medium|moderate|normal)\b/i, value: "medium" },
    { pattern: /\b(largo|larga|long|extenso|extensa|detallado|detallada|completo|completa|exhaustivo)\b/i, value: "long" }
  ];
  
  for (const { pattern, value } of lengthPatterns) {
    if (pattern.test(normalizedText)) {
      slots.length = value;
      break;
    }
  }
  
  for (const [audience, keywords] of Object.entries(AUDIENCE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        slots.audience = audience;
        break;
      }
    }
    if (slots.audience) break;
  }
  
  const targetLangPatterns = [
    /(?:al|to|en|into)\s+(español|espanol|ingles|inglés|frances|francés|aleman|alemán|portugues|português|italiano|chino|japones|japonés|english|spanish|french|german|portuguese|italian|chinese|japanese)/i,
    /(?:traduce|translate|traducir)\s+(?:a|to|al)\s+(\w+)/i
  ];
  
  for (const pattern of targetLangPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const lang = match[1].toLowerCase();
      for (const [code, keywords] of Object.entries(LANGUAGE_KEYWORDS)) {
        if (keywords.some(k => k.toLowerCase() === lang)) {
          slots.target_language = code;
          break;
        }
      }
      break;
    }
  }
  
  const slidesPattern = /(\d+)\s*(?:diapositivas?|slides?|paginas?|páginas?|hojas?)/i;
  const slidesMatch = normalizedText.match(slidesPattern);
  if (slidesMatch) {
    slots.num_slides = parseInt(slidesMatch[1], 10);
  }
  
  if (/\b(con\s*)?imagenes?\b|\b(with\s*)?images?\b|\b(incluir?\s*)?fotos?\b|\billustrat/i.test(normalizedText)) {
    slots.include_images = true;
  }
  
  if (/\b(sin\s*)?imagenes?\b|\b(no\s*)?images?\b|\btext\s*only\b|\bsolo\s*texto\b/i.test(normalizedText)) {
    slots.include_images = false;
  }
  
  if (/\bbullet\s*points?\b|\bviñetas?\b|\bpuntos?\b|\blista\b|\bitemized\b/i.test(normalizedText)) {
    slots.bullet_points = true;
  }
  
  const stylePatterns: Array<{ pattern: RegExp; style: string }> = [
    { pattern: /\b(profesional|professional|formal|corporativo|corporate|business)\b/i, style: "professional" },
    { pattern: /\b(creativo|creative|moderno|modern|innovador)\b/i, style: "creative" },
    { pattern: /\b(minimalista|minimal|simple|clean|limpio)\b/i, style: "minimal" },
    { pattern: /\b(academico|académico|academic|científico|scientific|research)\b/i, style: "academic" },
    { pattern: /\b(casual|informal|friendly|amigable)\b/i, style: "casual" }
  ];
  
  for (const { pattern, style } of stylePatterns) {
    if (pattern.test(normalizedText)) {
      slots.style = style;
      break;
    }
  }
  
  const topicPatterns = [
    /(?:sobre|about|acerca\s+de|regarding|tema|topic|de)\s+["']?([^"'\n,\.]{3,50})["']?/i,
    /(?:presentacion|documento|excel|informe|reporte|resumen)\s+(?:de|sobre|about)\s+["']?([^"'\n,\.]{3,50})["']?/i
  ];
  
  for (const pattern of topicPatterns) {
    const match = originalText.match(pattern);
    if (match) {
      slots.topic = match[1].trim();
      break;
    }
  }
  
  const titlePatterns = [
    /(?:titulo|title|titulado|titled|llamado|called)\s*[:\s]+["']?([^"'\n]{3,80})["']?/i,
    /["']([^"']{5,60})["']\s*(?:como\s+titulo|as\s+title)/i
  ];
  
  for (const pattern of titlePatterns) {
    const match = originalText.match(pattern);
    if (match) {
      slots.title = match[1].trim();
      break;
    }
  }
  
  return slots;
}

function detectOutputFormat(normalizedText: string): OutputFormat {
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS) as [NonNullable<OutputFormat>, string[]][]) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        return format;
      }
    }
  }
  return null;
}

function hasCreationVerb(normalizedText: string): boolean {
  return CREATION_VERBS.some(verb => {
    const pattern = new RegExp(`\\b${verb}\\b`, "i");
    return pattern.test(normalizedText);
  });
}

interface RuleMatchResult {
  intent: IntentType;
  confidence: number;
  matchedPatterns: string[];
  outputFormat: OutputFormat;
}

function ruleBasedMatch(normalizedText: string): RuleMatchResult {
  const scores: Record<IntentType, { score: number; patterns: string[] }> = {
    CREATE_PRESENTATION: { score: 0, patterns: [] },
    CREATE_DOCUMENT: { score: 0, patterns: [] },
    CREATE_SPREADSHEET: { score: 0, patterns: [] },
    SUMMARIZE: { score: 0, patterns: [] },
    TRANSLATE: { score: 0, patterns: [] },
    SEARCH_WEB: { score: 0, patterns: [] },
    ANALYZE_DOCUMENT: { score: 0, patterns: [] },
    CHAT_GENERAL: { score: 0, patterns: [] },
    NEED_CLARIFICATION: { score: 0, patterns: [] }
  };
  
  const words = normalizedText.split(/\s+/);
  
  for (const [intent, aliases] of Object.entries(INTENT_ALIASES) as [IntentType, string[]][]) {
    for (const alias of aliases) {
      if (normalizedText.includes(alias.toLowerCase())) {
        scores[intent].score += 2;
        scores[intent].patterns.push(alias);
      } else {
        for (const word of words) {
          const { match, similarity } = fuzzyMatch(word, alias, 0.80);
          if (match && similarity > 0.80) {
            scores[intent].score += similarity;
            scores[intent].patterns.push(`~${alias}(${similarity.toFixed(2)})`);
          }
        }
      }
    }
  }
  
  const hasCreation = hasCreationVerb(normalizedText);
  if (hasCreation) {
    for (const createIntent of ["CREATE_PRESENTATION", "CREATE_DOCUMENT", "CREATE_SPREADSHEET"] as IntentType[]) {
      if (scores[createIntent].score > 0) {
        scores[createIntent].score += 1.5;
        scores[createIntent].patterns.push("[+creation_verb]");
      }
    }
  }
  
  const outputFormat = detectOutputFormat(normalizedText);
  if (outputFormat) {
    if (["pptx"].includes(outputFormat)) {
      scores.CREATE_PRESENTATION.score += 2;
    } else if (["docx", "pdf", "txt"].includes(outputFormat)) {
      scores.CREATE_DOCUMENT.score += 2;
    } else if (["xlsx", "csv"].includes(outputFormat)) {
      scores.CREATE_SPREADSHEET.score += 2;
    }
  }
  
  let bestIntent: IntentType = "CHAT_GENERAL";
  let bestScore = 0;
  
  const priorityOrder: IntentType[] = [
    "CREATE_PRESENTATION",
    "CREATE_DOCUMENT", 
    "CREATE_SPREADSHEET",
    "SUMMARIZE",
    "TRANSLATE",
    "SEARCH_WEB",
    "ANALYZE_DOCUMENT",
    "CHAT_GENERAL"
  ];
  
  for (const intent of priorityOrder) {
    if (scores[intent].score > bestScore) {
      bestScore = scores[intent].score;
      bestIntent = intent;
    }
  }
  
  let confidence: number;
  if (bestScore === 0) {
    confidence = 0.3;
  } else if (bestScore < 2) {
    confidence = 0.5;
  } else if (bestScore < 4) {
    confidence = 0.65;
  } else if (bestScore < 6) {
    confidence = 0.80;
  } else {
    confidence = Math.min(0.95, 0.80 + (bestScore - 6) * 0.02);
  }
  
  return {
    intent: bestIntent,
    confidence,
    matchedPatterns: scores[bestIntent].patterns,
    outputFormat
  };
}

const LLM_CLASSIFIER_PROMPT = `You are a precise intent classifier for a chatbot. Analyze the user's message and return ONLY a valid JSON object with NO additional text, markdown, or explanation.

IMPORTANT: Your response must be ONLY the JSON object, nothing else.

Classify the intent into one of these categories:
- CREATE_PRESENTATION: User wants to create a PowerPoint/slides presentation
- CREATE_DOCUMENT: User wants to create a Word document, report, or essay
- CREATE_SPREADSHEET: User wants to create an Excel spreadsheet or table
- SUMMARIZE: User wants a summary of content
- TRANSLATE: User wants to translate text between languages
- SEARCH_WEB: User wants to search the internet for information
- ANALYZE_DOCUMENT: User wants analysis/review of a document
- CHAT_GENERAL: General conversation, greetings, or unclear intent
- NEED_CLARIFICATION: Ambiguous request that needs clarification

Determine the output format if applicable:
- pptx, docx, xlsx, pdf, txt, csv, html, or null

Extract these slots if mentioned:
- topic: Main subject/topic
- title: Specific title if given
- language: Language code (es, en, fr, de, pt, it, zh, ja)
- length: short, medium, or long
- audience: Target audience
- style: Writing/presentation style
- bullet_points: true if bulleted format requested
- include_images: true/false if images mentioned
- target_language: For translations, target language code
- num_slides: Number of slides if specified

Example output format:
{"intent":"CREATE_PRESENTATION","output_format":"pptx","slots":{"topic":"artificial intelligence","audience":"executives","include_images":true},"confidence":0.92,"reasoning":"User explicitly requested a PowerPoint presentation about AI for executives"}`;

async function llmFallbackClassifier(normalizedText: string, originalText: string): Promise<IntentResult | null> {
  try {
    console.log("[IntentRouter] Using LLM fallback classifier...");
    
    const response = await llmGateway.chat([
      { role: "system", content: LLM_CLASSIFIER_PROMPT },
      { role: "user", content: `Classify this message:\n\n"${originalText}"` }
    ], {
      model: "gemini-2.0-flash",
      temperature: 0.1,
      maxTokens: 500
    });
    
    const content = response.content?.trim();
    if (!content) {
      console.log("[IntentRouter] LLM returned empty response");
      return null;
    }
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("[IntentRouter] Could not extract JSON from LLM response:", content.substring(0, 200));
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    const result: IntentResult = {
      intent: IntentTypeSchema.parse(parsed.intent || "CHAT_GENERAL"),
      output_format: parsed.output_format || null,
      slots: SlotsSchema.parse(parsed.slots || {}),
      confidence: Math.min(0.95, Math.max(0.5, parsed.confidence || 0.75)),
      normalized_text: normalizedText,
      reasoning: parsed.reasoning
    };
    
    console.log(`[IntentRouter] LLM classified: ${result.intent} (confidence: ${result.confidence})`);
    return result;
    
  } catch (error) {
    console.error("[IntentRouter] LLM fallback error:", error);
    return null;
  }
}

function generateClarificationQuestion(normalizedText: string, matchedIntents: IntentType[]): string {
  if (matchedIntents.length >= 2) {
    const options = matchedIntents.slice(0, 3).map(intent => {
      switch (intent) {
        case "CREATE_PRESENTATION": return "crear una presentación";
        case "CREATE_DOCUMENT": return "crear un documento";
        case "CREATE_SPREADSHEET": return "crear una hoja de cálculo";
        case "SUMMARIZE": return "hacer un resumen";
        case "TRANSLATE": return "traducir el texto";
        case "SEARCH_WEB": return "buscar información en internet";
        case "ANALYZE_DOCUMENT": return "analizar el documento";
        default: return "otra cosa";
      }
    });
    return `¿Qué te gustaría que haga: ${options.join(", o ")}?`;
  }
  
  if (/presentacion|documento|excel|tabla/.test(normalizedText)) {
    return "¿Podrías especificar qué tipo de archivo deseas crear (presentación, documento Word, o Excel)?";
  }
  
  return "¿Podrías darme más detalles sobre lo que necesitas?";
}

export async function routeIntent(text: string): Promise<IntentResult> {
  const startTime = Date.now();
  const originalText = text;
  
  const normalizedText = normalize(text);
  console.log(`[IntentRouter] Normalized: "${normalizedText.substring(0, 100)}..."`);
  
  const ruleResult = ruleBasedMatch(normalizedText);
  console.log(`[IntentRouter] Rule-based: ${ruleResult.intent} (confidence: ${ruleResult.confidence.toFixed(2)})`);
  
  const slots = extractSlots(normalizedText, originalText);
  
  if (ruleResult.confidence >= 0.80) {
    const duration = Date.now() - startTime;
    console.log(`[IntentRouter] Final decision in ${duration}ms: ${ruleResult.intent} (rule-based)`);
    
    return {
      intent: ruleResult.intent,
      output_format: ruleResult.outputFormat,
      slots,
      confidence: ruleResult.confidence,
      normalized_text: normalizedText,
      matched_patterns: ruleResult.matchedPatterns
    };
  }
  
  const llmResult = await llmFallbackClassifier(normalizedText, originalText);
  
  if (llmResult && llmResult.confidence >= 0.60) {
    const mergedSlots = { ...slots, ...llmResult.slots };
    const duration = Date.now() - startTime;
    console.log(`[IntentRouter] Final decision in ${duration}ms: ${llmResult.intent} (LLM fallback)`);
    
    return {
      ...llmResult,
      slots: mergedSlots,
      output_format: llmResult.output_format || ruleResult.outputFormat
    };
  }
  
  if (ruleResult.confidence < 0.50) {
    const duration = Date.now() - startTime;
    console.log(`[IntentRouter] Need clarification (${duration}ms)`);
    
    const clarificationQuestion = generateClarificationQuestion(normalizedText, [ruleResult.intent]);
    
    return {
      intent: "NEED_CLARIFICATION",
      output_format: null,
      slots,
      confidence: ruleResult.confidence,
      normalized_text: normalizedText,
      clarification_question: clarificationQuestion,
      matched_patterns: ruleResult.matchedPatterns
    };
  }
  
  const duration = Date.now() - startTime;
  console.log(`[IntentRouter] Final decision in ${duration}ms: ${ruleResult.intent} (low confidence rule)`);
  
  return {
    intent: ruleResult.intent,
    output_format: ruleResult.outputFormat,
    slots,
    confidence: ruleResult.confidence,
    normalized_text: normalizedText,
    matched_patterns: ruleResult.matchedPatterns
  };
}

export class IntentRouter {
  async route(text: string): Promise<IntentResult> {
    return routeIntent(text);
  }
  
  normalize(text: string): string {
    return normalize(text);
  }
  
  ruleBasedMatch(normalizedText: string): RuleMatchResult {
    return ruleBasedMatch(normalizedText);
  }
  
  async llmFallback(normalizedText: string, originalText: string): Promise<IntentResult | null> {
    return llmFallbackClassifier(normalizedText, originalText);
  }
}

export const intentRouter = new IntentRouter();
