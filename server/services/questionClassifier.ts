/**
 * Question Classifier Service
 * 
 * Detects the type of user question to determine appropriate response format.
 * Critical for Answer-First system to ensure precise, relevant responses.
 */

// =============================================================================
// Types
// =============================================================================

export type QuestionType =
    | 'factual_simple'      // "¿Qué día es el vuelo?"
    | 'factual_multiple'    // "¿Cuánto cuesta y qué incluye?"
    | 'extraction'          // "Lista todas las fechas"
    | 'summary'             // "Resume el documento"
    | 'analysis'            // "Analiza el documento"
    | 'comparison'          // "Compara X con Y"
    | 'explanation'         // "¿Por qué...?" / "Explica..."
    | 'open_ended'          // Preguntas abiertas
    | 'yes_no'              // "¿Es posible...?"
    | 'action'              // "Genera...", "Crea..."
    | 'greeting';           // Saludos

export type QuestionIntent =
    | "DOCUMENT_ANALYSIS"
    | "CHART_GENERATION"
    | "ACADEMIC_SEARCH"   // New intent for scientific research
    | "GENERAL_KNOWLEDGE";

export interface QuestionClassification {
    type: QuestionType;
    confidence: number;
    expectedFormat: ResponseFormat;
    maxTokens: number;
    maxCharacters: number;
    requiresCitation: boolean;
    allowsExpansion: boolean;
    extractedTarget?: QuestionTarget;
}

export interface ClassificationResult {
    intent: QuestionIntent;
    confidence: number;
    reasoning: string;
    isFollowUp: boolean;
    refinedQuery?: string; // Query optimizada
}

export interface QuestionTarget {
    entity: string;           // "fecha", "precio", "nombre"
    context?: string;         // "vuelo", "boleto", "pasajero"
    expectedType?: 'date' | 'number' | 'currency' | 'text' | 'list' | 'boolean';
}

export type ResponseFormat =
    | 'single_value'        // Una sola respuesta directa
    | 'short_list'          // Lista corta (3-5 items)
    | 'numbered_list'       // Lista numerada
    | 'paragraph'           // Un párrafo
    | 'structured'          // Secciones con headers
    | 'yes_no_explanation'  // Sí/No + breve explicación
    | 'free_form';          // Sin restricción

// =============================================================================
// Question Patterns
// =============================================================================

const QUESTION_PATTERNS: Array<{
    patterns: RegExp[];
    type: QuestionType;
    confidence: number;
}> = [
        // FACTUAL SIMPLE - Preguntas con respuesta de un solo dato
        {
            patterns: [
                /^¿?(?:cuál|cual|qué|que)\s+(?:es|fue|será|era)\s+(?:el|la|los|las)\s+\w+\s*\?*$/i,
                /^¿?(?:qué|que|cuál|cual)\s+(?:día|fecha|hora|año|mes)\s+/i,
                /^¿?(?:cuánto|cuanto|cuánta|cuanta)\s+(?:es|cuesta|vale|mide|pesa)\s+/i,
                /^¿?(?:quién|quien)\s+(?:es|fue|era|será)\s+/i,
                /^¿?(?:dónde|donde)\s+(?:está|esta|queda|es)\s+/i,
                /^¿?(?:cuándo|cuando)\s+(?:es|fue|será|era)\s+/i,
                /^(?:dime|dame)\s+(?:el|la|los|las)\s+\w+$/i,
            ],
            type: 'factual_simple',
            confidence: 0.9
        },

        // YES/NO - Preguntas de sí o no
        {
            patterns: [
                /^¿?(?:es|está|son|están|hay|tiene|puede|puedo|podemos|permite|incluye|aplica)\s+/i,
                /^¿?(?:se puede|se permite|es posible|está permitido)\s+/i,
                /^¿?(?:existe|existen|había|habrá)\s+/i,
            ],
            type: 'yes_no',
            confidence: 0.85
        },

        // FACTUAL MULTIPLE - Múltiples datos solicitados
        {
            patterns: [
                /(?:y\s+(?:también|además|cuál|cuánto|qué|cuándo|dónde))/i,
                /(?:cuáles|cuales)\s+son\s+(?:los|las)\s+/i,
                /(?:qué|que)\s+(?:datos|información|detalles)\s+/i,
                /(?:menciona|enumera|lista)\s+/i,
            ],
            type: 'factual_multiple',
            confidence: 0.8
        },

        // EXTRACTION - Solicitud de extracción de lista
        {
            patterns: [
                /^(?:extrae|extraer|lista|listar|enumera|enumerar|dame todas?|muestra todas?)\s+/i,
                /^(?:cuáles|cuales)\s+son\s+(?:todos?|todas?)\s+/i,
                /(?:todos?\s+(?:los|las)|todas?\s+(?:los|las))\s+\w+/i,
            ],
            type: 'extraction',
            confidence: 0.85
        },

        // SUMMARY - Solicitud de resumen
        {
            patterns: [
                /^(?:resume|resumir|resumen|resumė|haz un resumen|hazme un resumen)\s*/i,
                /^(?:sintetiza|síntesis|sintesis)\s+/i,
                /(?:de qué|de que)\s+(?:trata|habla|se trata)\s+/i,
                /^(?:resumen\s+(?:ejecutivo|general|breve|del\s+documento))/i,
            ],
            type: 'summary',
            confidence: 0.9
        },

        // ANALYSIS - Solicitud de análisis
        {
            patterns: [
                /^(?:analiza|análisis|analizar|evalúa|evaluar|examina|revisar)\s+/i,
                /^(?:qué opinas|que opinas|qué piensas|que piensas)\s+/i,
                /(?:puntos\s+(?:fuertes|débiles|clave|importantes))/i,
                /(?:ventajas\s+y\s+desventajas|pros\s+y\s+contras)/i,
            ],
            type: 'analysis',
            confidence: 0.85
        },

        // COMPARISON
        {
            patterns: [
                /^(?:compara|comparar|diferencias?\s+entre|similitudes?\s+entre)\s+/i,
                /(?:vs\.?|versus|contra|frente\s+a)\s+/i,
                /(?:cuál\s+es\s+(?:mejor|peor|más|menos))/i,
            ],
            type: 'comparison',
            confidence: 0.85
        },

        // EXPLANATION - Preguntas de por qué / explicación
        {
            patterns: [
                /^¿?(?:por qué|porque|porqué)\s+/i,
                /^(?:explica|explicar|explícame|explicame)\s+/i,
                /^(?:cómo|como)\s+(?:funciona|trabaja|opera|se\s+hace)\s+/i,
                /(?:qué\s+significa|que\s+significa|a\s+qué\s+se\s+refiere)/i,
            ],
            type: 'explanation',
            confidence: 0.8
        },

        // ACTION - Comandos de acción
        {
            patterns: [
                /^(?:genera|generar|crea|crear|escribe|escribir|redacta|redactar)\s+/i,
                /^(?:traduce|traducir|convierte|convertir|transforma)\s+/i,
                /^(?:calcula|calcular|suma|restar|multiplicar|dividir)\s+/i,
            ],
            type: 'action',
            confidence: 0.85
        },

        // GREETING
        {
            patterns: [
                /^(?:hola|buenos?\s+(?:días|tardes|noches)|saludos?|hey|hi|hello)\s*[!.,]?\s*$/i,
                /^(?:gracias?|muchas?\s+gracias?|te\s+agradezco)\s*[!.,]?\s*$/i,
            ],
            type: 'greeting',
            confidence: 0.95
        },
    ];

// =============================================================================
// Entity Extraction Patterns
// =============================================================================

const ENTITY_PATTERNS: Array<{
    pattern: RegExp;
    entity: string;
    expectedType: QuestionTarget['expectedType'];
}> = [
        // Dates
        { pattern: /(?:día|fecha|cuando|cuándo)\s+/i, entity: 'fecha', expectedType: 'date' },
        { pattern: /(?:hora|horario|tiempo)\s+/i, entity: 'hora', expectedType: 'text' },

        // Money
        { pattern: /(?:costo|precio|cuánto\s+cuesta|cuanto\s+cuesta|valor|monto|tarifa)\s*/i, entity: 'precio', expectedType: 'currency' },
        { pattern: /(?:total|subtotal|impuesto|tasa)\s*/i, entity: 'monto', expectedType: 'currency' },

        // People
        { pattern: /(?:nombre|pasajero|cliente|usuario|autor)\s*/i, entity: 'nombre', expectedType: 'text' },
        { pattern: /(?:quién|quien)\s+/i, entity: 'persona', expectedType: 'text' },

        // Location
        { pattern: /(?:dónde|donde|destino|origen|ubicación|dirección|lugar)\s*/i, entity: 'ubicación', expectedType: 'text' },
        { pattern: /(?:aeropuerto|ciudad|país|terminal)\s*/i, entity: 'lugar', expectedType: 'text' },

        // Documents
        { pattern: /(?:número|código|referencia|identificación|documento)\s*/i, entity: 'identificador', expectedType: 'text' },

        // Counts
        { pattern: /(?:cuántos|cuántas|cantidad|número\s+de)\s*/i, entity: 'cantidad', expectedType: 'number' },
    ];

const CONTEXT_PATTERNS: Array<{
    pattern: RegExp;
    context: string;
}> = [
        { pattern: /(?:vuelo|avión|avion|viaje|itinerario)/i, context: 'vuelo' },
        { pattern: /(?:boleto|ticket|pasaje|reserva|reservación)/i, context: 'boleto' },
        { pattern: /(?:equipaje|maleta|valija|bodega|cabina)/i, context: 'equipaje' },
        { pattern: /(?:pago|factura|cobro|cargo)/i, context: 'pago' },
        { pattern: /(?:pasajero|viajero|cliente)/i, context: 'pasajero' },
        { pattern: /(?:documento|archivo|pdf|excel|word)/i, context: 'documento' },
    ];

// =============================================================================
// Response Format Configuration
// =============================================================================

const FORMAT_CONFIG: Record<QuestionType, {
    format: ResponseFormat;
    maxTokens: number;
    maxCharacters: number;
    requiresCitation: boolean;
    allowsExpansion: boolean;
}> = {
    factual_simple: {
        format: 'single_value',
        maxTokens: 50,
        maxCharacters: 200,
        requiresCitation: true,
        allowsExpansion: false
    },
    yes_no: {
        format: 'yes_no_explanation',
        maxTokens: 80,
        maxCharacters: 300,
        requiresCitation: true,
        allowsExpansion: false
    },
    factual_multiple: {
        format: 'short_list',
        maxTokens: 150,
        maxCharacters: 600,
        requiresCitation: true,
        allowsExpansion: true
    },
    extraction: {
        format: 'numbered_list',
        maxTokens: 300,
        maxCharacters: 1200,
        requiresCitation: true,
        allowsExpansion: true
    },
    summary: {
        format: 'structured',
        maxTokens: 500,
        maxCharacters: 2000,
        requiresCitation: true,
        allowsExpansion: true
    },
    analysis: {
        format: 'structured',
        maxTokens: 800,
        maxCharacters: 3200,
        requiresCitation: true,
        allowsExpansion: true
    },
    comparison: {
        format: 'structured',
        maxTokens: 400,
        maxCharacters: 1600,
        requiresCitation: true,
        allowsExpansion: true
    },
    explanation: {
        format: 'paragraph',
        maxTokens: 250,
        maxCharacters: 1000,
        requiresCitation: true,
        allowsExpansion: true
    },
    action: {
        format: 'free_form',
        maxTokens: 1000,
        maxCharacters: 4000,
        requiresCitation: false,
        allowsExpansion: true
    },
    open_ended: {
        format: 'paragraph',
        maxTokens: 300,
        maxCharacters: 1200,
        requiresCitation: false,
        allowsExpansion: true
    },
    greeting: {
        format: 'single_value',
        maxTokens: 30,
        maxCharacters: 120,
        requiresCitation: false,
        allowsExpansion: false
    }
};

// =============================================================================
// Main Classification Function
// =============================================================================

export function classifyQuestion(question: string): QuestionClassification {
    const normalized = question.trim().toLowerCase();

    // Try to match patterns
    let bestMatch: { type: QuestionType; confidence: number } = {
        type: 'open_ended',
        confidence: 0.3
    };

    for (const { patterns, type, confidence } of QUESTION_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(normalized)) {
                if (confidence > bestMatch.confidence) {
                    bestMatch = { type, confidence };
                }
            }
        }
    }

    // Extract target entity
    const extractedTarget = extractQuestionTarget(question);

    // Get format configuration
    const config = FORMAT_CONFIG[bestMatch.type];

    return {
        type: bestMatch.type,
        confidence: bestMatch.confidence,
        expectedFormat: config.format,
        maxTokens: config.maxTokens,
        maxCharacters: config.maxCharacters,
        requiresCitation: config.requiresCitation,
        allowsExpansion: config.allowsExpansion,
        extractedTarget
    };
}

/**
 * Extract what specific information the user is asking for
 */
export function extractQuestionTarget(question: string): QuestionTarget | undefined {
    const normalized = question.toLowerCase();

    let entity: string | undefined;
    let expectedType: QuestionTarget['expectedType'] | undefined;
    let context: string | undefined;

    // Find entity
    for (const { pattern, entity: e, expectedType: t } of ENTITY_PATTERNS) {
        if (pattern.test(normalized)) {
            entity = e;
            expectedType = t;
            break;
        }
    }

    // Find context
    for (const { pattern, context: c } of CONTEXT_PATTERNS) {
        if (pattern.test(normalized)) {
            context = c;
            break;
        }
    }

    if (!entity) return undefined;

    return { entity, context, expectedType };
}

/**
 * Quick check if question is factual simple (for fast path)
 */
export function isSimpleFactualQuestion(question: string): boolean {
    const classification = classifyQuestion(question);
    return classification.type === 'factual_simple' || classification.type === 'yes_no';
}

/**
 * Get response guidelines based on question type
 */
export function getResponseGuidelines(classification: QuestionClassification): string {
    const { type, extractedTarget, maxCharacters } = classification;

    const guidelines: string[] = [];

    switch (type) {
        case 'factual_simple':
            guidelines.push(`RESPONDE EN UNA SOLA FRASE (máximo ${maxCharacters} caracteres).`);
            if (extractedTarget) {
                guidelines.push(`El usuario busca: ${extractedTarget.entity}${extractedTarget.context ? ` relacionado con ${extractedTarget.context}` : ''}.`);
            }
            guidelines.push('NO hagas resúmenes ni proporciones información adicional.');
            break;

        case 'yes_no':
            guidelines.push('Responde primero SÍ o NO, luego una breve explicación.');
            guidelines.push(`Máximo ${maxCharacters} caracteres en total.`);
            break;

        case 'factual_multiple':
            guidelines.push('Proporciona solo los datos solicitados en lista corta.');
            guidelines.push('Máximo 5 items con sus valores.');
            break;

        case 'extraction':
            guidelines.push('Lista todos los items solicitados de forma numerada.');
            guidelines.push('Sin explicaciones innecesarias, solo los datos.');
            break;

        case 'summary':
            guidelines.push('Ahora SÍ puedes hacer un resumen estructurado.');
            guidelines.push('Incluye: resumen ejecutivo, hallazgos clave, métricas.');
            break;

        case 'analysis':
            guidelines.push('Proporciona un análisis estructurado y detallado.');
            break;

        default:
            guidelines.push(`Limita tu respuesta a ${maxCharacters} caracteres.`);
    }

    if (classification.requiresCitation) {
        guidelines.push('SIEMPRE incluye la cita [documento p:X] o [hoja:X].');
    }

    return guidelines.join('\n');
}

// =============================================================================
// Export
// =============================================================================

export const questionClassifier = {
    classifyQuestion,
    extractQuestionTarget,
    isSimpleFactualQuestion,
    getResponseGuidelines,
    FORMAT_CONFIG
};

export default questionClassifier;
