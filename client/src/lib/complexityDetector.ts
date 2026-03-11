export interface ComplexityCheckResult {
  agent_required: boolean;
  agent_reason?: string;
  confidence: 'high' | 'medium' | 'low';
}

const AGENT_PATTERNS: Array<{ pattern: RegExp; reason: string; confidence: 'high' | 'medium'; category: string }> = [
  { pattern: /\b(busca|buscar|search|find|investigar|investigate|research)\b.*\b(web|internet|online|en línea|información|information)\b/i, reason: "Requiere búsqueda web", confidence: 'high', category: "research" },
  { pattern: /\b(navega|navigate|browse|visita|visit|abre|open)\b.*\b(página|page|sitio|site|url|web)\b/i, reason: "Requiere navegación web", confidence: 'high', category: "research" },
  { pattern: /\b(verifica|verify|comprueba|check|confirma|confirm)\b.*\b(hechos|facts|fuentes|sources|información|information|datos|data)\b/i, reason: "Verificación de información", confidence: 'high', category: "research" },
  { pattern: /\b(scrape|scrapear|extraer datos|extract data|web scraping)\b/i, reason: "Extracción de datos web", confidence: 'high', category: "research" },
  { pattern: /https?:\/\/[^\s]+/i, reason: "URL detectada", confidence: 'medium', category: "research" },
  { pattern: /\b(crea|create|genera|generate|haz|make)\b.*\b(documento|document|word|excel|pdf|csv|archivo|file|presentación|presentation|ppt|powerpoint)\b/i, reason: "Creación de archivos", confidence: 'high', category: "content" },
  { pattern: /\b(ejecuta|execute|run|corre|instala|install|configura|configure|setup)\b.*\b(código|code|script|programa|program|python|javascript|shell|comando|command|paquete|package|dependencia|dependency)\b/i, reason: "Ejecución o configuración técnica", confidence: 'high', category: "development" },
  { pattern: /\b(analiza|analyze|procesa|process|lee|read|resume|summarize|extrae|extract)\b.*\b(archivo|file|documento|document|excel|spreadsheet|hoja de cálculo|csv|pdf|ppt|powerpoint)\b/i, reason: "Análisis de archivos", confidence: 'high', category: "files" },
  { pattern: /\b(automatiza|automate|automatizar|automation|workflow|flujo de trabajo|programa|schedule|planifica|monitor|monitorea|vigila)\b/i, reason: "Automatización o monitoreo", confidence: 'medium', category: "automation" },
  { pattern: /\b(primero|first)\b.*\b(luego|then|después|after)\b/i, reason: "Tarea multi-paso", confidence: 'medium', category: "multistep" },
  { pattern: /\b(paso\s+\d+|step\s+\d+|\d+\.\s+\w+|\d+\)\s+\w+)/i, reason: "Pasos enumerados", confidence: 'high', category: "multistep" },
  { pattern: /\b(usa el agente|use agent|modo agente|agent mode|con el agente|with agent)\b/i, reason: "Solicitud de agente", confidence: 'high', category: "explicit" },
];

const TRIVIAL_PATTERNS = [
  /^[¿¡]?(hola|hi|hello|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening)[\s!?.,]*$/i,
  /^[¿¡]?(gracias|thanks|thank you|thx|ty|muchas gracias)[\s!?.,]*$/i,
  /^[¿¡]?(ok|okay|sí|si|yes|no|nope|vale|bien|bueno|sure|got it)[\s!?.,]*$/i,
  /^[¿¡]?(adiós|bye|goodbye|chao|hasta luego|see you)[\s!?.,]*$/i,
  /^[¿¡]?(cómo|como)\s+(estás|estas)[\s!?.,]*$/i,
  /^[¿¡]?how are you[\s!?.,]*$/i,
];

const SIMPLE_CHAT_PATTERNS = [
  /^[¿¡]?(qué|que|what|cuál|cual|which|cómo|como|how|por qué|why|dónde|donde|where|cuándo|cuando|when)\b/i,
  /^[¿¡]?(explica|explícame|explain|define|describe|resume|summarize|dame|give me|cuéntame|cuentame|tell me)\b/i,
  /^[¿¡]?(puedes|can you|podrías|podrias)\b/i,
];

export function checkComplexityLocally(message: string, hasAttachments: boolean = false): ComplexityCheckResult {
  const trimmed = message.trim();

  // 1) Keep trivial greetings/acknowledgements in normal chat mode.
  if (!trimmed || TRIVIAL_PATTERNS.some(p => p.test(trimmed))) {
    return { agent_required: false, confidence: 'high' };
  }

  // 2) Explicit user request still has priority reasoning.
  for (const { pattern, reason, confidence } of AGENT_PATTERNS) {
    if (pattern.test(message)) {
      return { agent_required: true, agent_reason: reason, confidence };
    }
  }

  if (hasAttachments) {
    return {
      agent_required: true,
      agent_reason: "Modo agente por adjuntos",
      confidence: "high",
    };
  }

  // 4) Conversational/general prompts should stay in standard chat mode.
  if (trimmed.length <= 140 && SIMPLE_CHAT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      agent_required: false,
      confidence: "high",
    };
  }

  // 5) Safe default: do not auto-activate agent mode unless there is a strong signal.
  return {
    agent_required: false,
    confidence: "medium",
  };
}

export async function checkComplexityWithApi(message: string, hasAttachments: boolean = false): Promise<ComplexityCheckResult> {
  // Force local check to respect the disabled heuristics
  return checkComplexityLocally(message, hasAttachments);
}

export function shouldAutoActivateAgent(message: string, hasAttachments: boolean = false): ComplexityCheckResult {
  return checkComplexityLocally(message, hasAttachments);
}
