export interface ComplexityCheckResult {
  agent_required: boolean;
  agent_reason?: string;
  confidence: 'high' | 'medium' | 'low';
}

const AGENT_PATTERNS: Array<{ pattern: RegExp; reason: string; confidence: 'high' | 'medium'; category: string }> = [
  // === INVESTIGACIÓN Y WEB ===
  { pattern: /https?:\/\/[^\s]+/i, reason: "URL detectada", confidence: 'high', category: "research" },
  { pattern: /\b(busca|buscar|search|find|investiga|investigar|research|verifica|verify|comprueba|check)\b.*\b(web|internet|online|url|sitio|site|página|page|fuentes|sources|noticias|news|precios|price|clima|weather)\b/i, reason: "Requiere búsqueda web", confidence: 'high', category: "research" },
  { pattern: /\b(navega|navigate|browse|visita|visit|abre|open|ve a|go to)\b.*\b(página|page|sitio|site|url|web)\b/i, reason: "Requiere navegación web", confidence: 'high', category: "research" },
  { pattern: /\b(recopila|collect|gather)\b.*\b(información|information|datos|data)\b.*\b(múltiples|multiple|varias|several|fuentes|sources)\b/i, reason: "Recopilación multi-fuente", confidence: 'high', category: "research" },

  // === DESARROLLO Y SISTEMA ===
  { pattern: /\b(corrige|fix|depura|debug|arregla|implementa|implement|refactoriza|refactor)\b.*\b(código|code|bug|error|repo|repositorio|archivo|file|tests?|pruebas)\b/i, reason: "Trabajo de código", confidence: 'high', category: "development" },
  { pattern: /\b(ejecuta|execute|run|corre|lanza)\b.*\b(comando|command|script|terminal|shell|npm|pnpm|yarn|python|node)\b/i, reason: "Ejecución de comandos", confidence: 'high', category: "development" },
  { pattern: /\b(instala|install|configura|configure|setup)\b.*\b(paquete|package|librería|library|dependencia|dependency|entorno|environment)\b/i, reason: "Configuración técnica", confidence: 'high', category: "development" },

  // === AUTOMATIZACIÓN ===
  { pattern: /\b(automatiza|automate|workflow|flujo de trabajo|monitoriza|monitor|supervisa|watch)\b/i, reason: "Automatización", confidence: 'high', category: "automation" },
  { pattern: /\b(reserva|book|booking|compra|purchase|buy)\b.*\b(restaurante|restaurant|hotel|vuelo|flight|mesa|table)\b/i, reason: "Automatización externa", confidence: 'high', category: "automation" },

  // === SOLICITUD EXPLÍCITA ===
  { pattern: /\b(usa el agente|use agent|modo agente|agent mode|con el agente|with agent)\b/i, reason: "Solicitud de agente", confidence: 'high', category: "explicit" },
];

const TRIVIAL_PATTERNS = [
  /^(hola|hi|hello|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening)[\s!?.,]*$/i,
  /^(gracias|thanks|thank you|thx|ty|muchas gracias)[\s!?.,]*$/i,
  /^(ok|okay|sí|si|yes|no|nope|vale|bien|bueno|sure|got it)[\s!?.,]*$/i,
  /^(adiós|bye|goodbye|chao|hasta luego|see you)[\s!?.,]*$/i
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

  // 3) Attachments are a strong signal that tool-assisted handling is needed.
  if (hasAttachments) {
    return {
      agent_required: true,
      agent_reason: "Modo agente por adjuntos",
      confidence: "high",
    };
  }

  // 4) Default to normal chat unless there is a clear tool/action signal.
  return {
    agent_required: false,
    confidence: "high",
  };
}

export async function checkComplexityWithApi(message: string, hasAttachments: boolean = false): Promise<ComplexityCheckResult> {
  // Force local check to respect the disabled heuristics
  return checkComplexityLocally(message, hasAttachments);
}

export function shouldAutoActivateAgent(message: string, hasAttachments: boolean = false): ComplexityCheckResult {
  return checkComplexityLocally(message, hasAttachments);
}
