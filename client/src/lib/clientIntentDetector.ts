
import {
    hasExplicitDocumentArtifactRequest,
    hasExplicitSpreadsheetArtifactRequest,
    hasExplicitPresentationArtifactRequest,
    classifyOutputFormat,
} from "@shared/explicitArtifactRequests";

export type IntentType =
    | "research"
    | "data_analysis"
    | "code_generation"
    | "spreadsheet_creation"
    | "document_generation"
    | "presentation_creation"
    | "web_automation"
    | "document_analysis"
    | "chat";

const INTENT_PATTERNS: Record<Exclude<IntentType, "chat">, RegExp[]> = {
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
        /\b(crea|create|genera|generate|escribe|write|redacta|draft|hazme|make me|prepara|prepare)\b.*\b(documento|document|word|docx|pdf|archivo|file)\b/i,
        /\b(informe|report|carta|letter|ensayo|essay|cv|curr[ií]culum|curriculum|propuesta)\b.*\b(word|docx|pdf|archivo|file|formato|adjunta|attach|exporta|export|guarda|save|descarga|download)\b/i
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
    ]
};

export function detectClientIntent(message: string): IntentType {
    const lowerMessage = message.toLowerCase();

    // Priority 1: Check document_analysis FIRST — analysis verbs ("analiza",
    // "revisa", "resume") targeting a file should route to analysis, not creation,
    // even if the message mentions a file format keyword like "PDF" or "excel".
    const analysisPatterns = INTENT_PATTERNS.document_analysis || [];
    for (const pattern of analysisPatterns) {
        if (pattern.test(lowerMessage)) {
            return "document_analysis";
        }
    }

    // Priority 2: Universal format gate — only route to file-generation intents
    // when the user explicitly mentioned a file format keyword.
    const formatGate = classifyOutputFormat(message);

    if (formatGate.action !== "text" && formatGate.confidence >= 0.85) {
        // User explicitly asked for a file format — route to the right intent
        if (formatGate.action === "excel" || hasExplicitSpreadsheetArtifactRequest(message)) {
            return "spreadsheet_creation";
        }
        if (formatGate.action === "pptx" || hasExplicitPresentationArtifactRequest(message)) {
            return "presentation_creation";
        }
        if (formatGate.action === "word" || hasExplicitDocumentArtifactRequest(message)) {
            return "document_generation";
        }
    }

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        // Skip document_analysis — already handled above
        if (intent === "document_analysis") continue;

        for (const pattern of patterns) {
            if (pattern.test(lowerMessage)) {
                // Extra safety: if a pattern matched a file-generation intent but
                // the format gate says "text", downgrade to "chat".
                // Content words (carta, tabla, presentación) alone must not
                // trigger file generation.
                const FILE_INTENTS = new Set(["document_generation", "spreadsheet_creation", "presentation_creation"]);
                if (FILE_INTENTS.has(intent) && formatGate.action === "text") {
                    continue;
                }
                return intent as IntentType;
            }
        }
    }

    return "chat";
}
