export interface ComplexityCheckResult {
  agent_required: boolean;
  agent_reason?: string;
  confidence: 'high' | 'medium' | 'low';
}

const AGENT_PATTERNS: Array<{ pattern: RegExp; reason: string; confidence: 'high' | 'medium' }> = [
  { pattern: /\b(busca|buscar|search|find|investigar|investigate|research)\b.*\b(web|internet|online|en línea)\b/i, reason: "Requiere búsqueda web", confidence: 'high' },
  { pattern: /\b(navega|navigate|browse|visita|visit|abre|open)\b.*\b(página|page|sitio|site|url|web)\b/i, reason: "Requiere navegación web", confidence: 'high' },
  { pattern: /\b(descarga|download|obtén|get|extrae|extract)\b.*\b(archivo|file|documento|document|datos|data)\b.*\b(de|from)\b/i, reason: "Requiere descarga de archivos", confidence: 'high' },
  { pattern: /\b(crea|create|genera|generate|haz|make)\b.*\b(documento|document|word|excel|pdf|csv|archivo|file|presentación|presentation|ppt|powerpoint)\b/i, reason: "Requiere generación de documentos", confidence: 'high' },
  { pattern: /\b(analiza|analyze|procesa|process)\b.*\b(archivo|file|documento|document|excel|spreadsheet|hoja de cálculo)\b/i, reason: "Requiere análisis de archivos", confidence: 'high' },
  { pattern: /\b(ejecuta|execute|run|corre)\b.*\b(código|code|script|programa|program|python|javascript|shell)\b/i, reason: "Requiere ejecución de código", confidence: 'high' },
  { pattern: /\b(primero|first)\b.*\b(luego|then|después|after)\b/i, reason: "Tarea de múltiples pasos", confidence: 'medium' },
  { pattern: /\b(paso\s+\d+|step\s+\d+|\d+\.\s+\w+)/i, reason: "Tarea con pasos enumerados", confidence: 'high' },
  { pattern: /\b(automatiza|automate|automatizar|automation)\b/i, reason: "Requiere automatización", confidence: 'high' },
  { pattern: /\b(compara|compare|comparar)\b.*\b(varios|multiple|diferentes|different)\b/i, reason: "Comparación de múltiples fuentes", confidence: 'medium' },
  { pattern: /\b(cv|curriculum|resume|currículum)\b/i, reason: "Generación de CV", confidence: 'high' },
  { pattern: /\b(informe|report|reporte)\b.*\b(completo|complete|detallado|detailed)\b/i, reason: "Generación de informe", confidence: 'high' },
  { pattern: /\b(scrape|scrapear|extraer datos|extract data)\b/i, reason: "Extracción de datos web", confidence: 'high' },
  { pattern: /\b(agente|agent)\b/i, reason: "Solicitud explícita de agente", confidence: 'high' },
  { pattern: /https?:\/\/[^\s]+/i, reason: "URL detectada - posible navegación", confidence: 'medium' },
];

const TRIVIAL_PATTERNS = [
  /^(hola|hi|hello|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening)[\s!?.,]*$/i,
  /^(gracias|thanks|thank you|thx|ty|muchas gracias)[\s!?.,]*$/i,
  /^(ok|okay|sí|si|yes|no|nope|vale|bien|bueno|sure|got it)[\s!?.,]*$/i,
  /^(adiós|bye|goodbye|chao|hasta luego|see you)[\s!?.,]*$/i
];

export function checkComplexityLocally(message: string, hasAttachments: boolean = false): ComplexityCheckResult {
  const trimmed = message.trim();
  
  if (trimmed.length < 10 || TRIVIAL_PATTERNS.some(p => p.test(trimmed))) {
    return { agent_required: false, confidence: 'high' };
  }

  for (const { pattern, reason, confidence } of AGENT_PATTERNS) {
    if (pattern.test(message)) {
      return { agent_required: true, agent_reason: reason, confidence };
    }
  }

  const wordCount = message.split(/\s+/).length;
  
  if (wordCount < 15) {
    return { agent_required: false, confidence: 'high' };
  }
  
  const hasMultiStep = (message.match(/\by\b|\band\b|,/gi) || []).length >= 3;
  const hasActionVerbs = /\b(crea|create|genera|generate|busca|search|encuentra|find|analiza|analyze|procesa|process|descarga|download)\b/i.test(message);
  
  if (hasMultiStep && wordCount > 25 && hasActionVerbs) {
    return { agent_required: true, agent_reason: "Tarea compleja de múltiples pasos", confidence: 'medium' };
  }

  if (hasAttachments && /\b(analiza|analyze|procesa|process|extrae|extract|resume|resumen|summarize)\b/i.test(message)) {
    return { agent_required: true, agent_reason: "Análisis de archivo adjunto", confidence: 'high' };
  }

  return { agent_required: false, confidence: 'low' };
}

export async function checkComplexityWithApi(message: string, hasAttachments: boolean = false): Promise<ComplexityCheckResult> {
  try {
    const response = await fetch('/api/chat/complexity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, hasAttachments }),
    });
    
    if (!response.ok) {
      console.warn('[ComplexityDetector] API call failed, using local check');
      return checkComplexityLocally(message, hasAttachments);
    }
    
    const data = await response.json();
    return {
      agent_required: data.agent_required,
      agent_reason: data.agent_reason,
      confidence: data.agent_required ? 'high' : 'low',
    };
  } catch (error) {
    console.warn('[ComplexityDetector] API error, using local check:', error);
    return checkComplexityLocally(message, hasAttachments);
  }
}

export function shouldAutoActivateAgent(message: string, hasAttachments: boolean = false): ComplexityCheckResult {
  return checkComplexityLocally(message, hasAttachments);
}
