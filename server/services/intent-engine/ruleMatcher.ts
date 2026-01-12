import type { IntentType, OutputFormat, SupportedLocale, Slots } from "../../../shared/schemas/intent";

const INTENT_ALIASES: Record<SupportedLocale, Record<IntentType, string[]>> = {
  es: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "power point", "presentacion", "presentación",
      "diapositivas", "slides", "slide", "crear presentacion", "generar presentacion",
      "hacer diapositivas", "armar presentacion", "construir presentacion", "presenta"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "documento", "informe", "reporte",
      "crear documento", "generar documento", "hacer documento", "escribir documento",
      "elaborar informe", "redactar", "carta", "ensayo", "articulo", "manual", "guia"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "hoja de calculo", "hoja de cálculo", "spreadsheet",
      "tabla", "crear excel", "generar excel", "hacer tabla", "planilla", "calcular"
    ],
    SUMMARIZE: [
      "resume", "resumen", "resumir", "resumeme", "sintetiza", "sintetizar",
      "sintesis", "condensar", "extracto", "puntos clave", "lo mas importante",
      "en pocas palabras", "briefing", "tldr"
    ],
    TRANSLATE: [
      "traduce", "traducir", "traduccion", "traducción", "al español", "al ingles",
      "al inglés", "en frances", "en francés", "en aleman", "en alemán",
      "pasar a", "convertir a idioma", "cambiar idioma"
    ],
    SEARCH_WEB: [
      "busca en internet", "buscar en web", "busca online", "google",
      "investigar", "buscar informacion", "encuentra informacion",
      "consultar", "averiguar", "indagar", "explorar web"
    ],
    ANALYZE_DOCUMENT: [
      "analiza", "analizar", "análisis", "analisis", "revisa", "revisar",
      "evalua", "evaluar", "examina", "examinar", "interpreta", "interpretar",
      "diagnostico", "diagnóstico", "critica", "criticar"
    ],
    CHAT_GENERAL: [
      "hola", "gracias", "ok", "sí", "si", "no", "vale", "bien",
      "qué tal", "cómo estás", "buenos días", "buenas tardes", "buenas noches",
      "por favor", "ayuda"
    ],
    NEED_CLARIFICATION: []
  },
  en: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "power point", "presentation", "slides",
      "slide", "create presentation", "make presentation", "generate slides",
      "build presentation", "slide deck", "slidedeck"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "document", "report", "essay", "create document",
      "make document", "write document", "generate report", "letter", "article",
      "manual", "guide", "paper"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "spreadsheet", "sheet", "table",
      "create spreadsheet", "make excel", "generate table", "data table",
      "calculate", "formulas", "chart"
    ],
    SUMMARIZE: [
      "summary", "summarize", "summarise", "condense", "condensed",
      "extract key points", "key points", "tldr", "tl;dr", "brief", "briefing",
      "main points", "overview"
    ],
    TRANSLATE: [
      "translate", "translation", "to english", "to spanish", "to french",
      "to german", "to portuguese", "convert to", "change language"
    ],
    SEARCH_WEB: [
      "search web", "search online", "google", "research", "find information",
      "look up", "lookup", "browse", "find online", "web search"
    ],
    ANALYZE_DOCUMENT: [
      "analyze", "analyse", "analysis", "review", "evaluate", "evaluation",
      "examine", "interpret", "interpretation", "diagnosis", "critique"
    ],
    CHAT_GENERAL: [
      "hello", "hi", "hey", "thanks", "thank you", "ok", "yes", "no",
      "good morning", "good afternoon", "good evening", "please", "help"
    ],
    NEED_CLARIFICATION: []
  },
  pt: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "apresentacao", "apresentação", "slides",
      "criar apresentacao", "fazer apresentacao", "gerar slides"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "documento", "relatorio", "relatório",
      "criar documento", "fazer documento", "escrever documento"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "planilha", "tabela", "criar planilha",
      "fazer tabela", "gerar excel"
    ],
    SUMMARIZE: [
      "resumo", "resumir", "sintetizar", "sintese", "síntese",
      "pontos principais", "principais pontos"
    ],
    TRANSLATE: [
      "traduzir", "traducao", "tradução", "para ingles", "para português",
      "para espanhol"
    ],
    SEARCH_WEB: [
      "buscar na internet", "pesquisar", "pesquisa web", "procurar informacao"
    ],
    ANALYZE_DOCUMENT: [
      "analisar", "analise", "análise", "revisar", "avaliar", "examinar"
    ],
    CHAT_GENERAL: [
      "ola", "olá", "obrigado", "obrigada", "ok", "sim", "não", "bom dia",
      "boa tarde", "boa noite", "por favor", "ajuda"
    ],
    NEED_CLARIFICATION: []
  },
  fr: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "presentation", "présentation", "diapositives",
      "creer presentation", "créer présentation", "faire presentation"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "document", "rapport", "creer document",
      "créer document", "faire document", "rediger", "rédiger"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "tableur", "feuille de calcul", "tableau",
      "creer excel", "créer excel", "faire tableau"
    ],
    SUMMARIZE: [
      "resume", "résumé", "resumer", "résumer", "synthese", "synthèse",
      "condenser", "points cles", "points clés"
    ],
    TRANSLATE: [
      "traduire", "traduction", "en anglais", "en espagnol", "en allemand"
    ],
    SEARCH_WEB: [
      "chercher sur internet", "rechercher", "recherche web", "trouver information"
    ],
    ANALYZE_DOCUMENT: [
      "analyser", "analyse", "evaluer", "évaluer", "examiner", "interpreter"
    ],
    CHAT_GENERAL: [
      "bonjour", "salut", "merci", "ok", "oui", "non", "bonsoir",
      "s'il vous plait", "s'il vous plaît", "aide"
    ],
    NEED_CLARIFICATION: []
  },
  de: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "prasentation", "präsentation", "folien",
      "prasentation erstellen", "präsentation erstellen", "folien machen"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "dokument", "bericht", "dokument erstellen",
      "dokument schreiben", "verfassen"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "tabelle", "kalkulationstabelle",
      "excel erstellen", "tabelle erstellen"
    ],
    SUMMARIZE: [
      "zusammenfassung", "zusammenfassen", "kurz zusammenfassen",
      "kernpunkte", "hauptpunkte"
    ],
    TRANSLATE: [
      "ubersetzen", "übersetzen", "ubersetzung", "übersetzung",
      "auf englisch", "auf spanisch"
    ],
    SEARCH_WEB: [
      "im internet suchen", "websuche", "recherchieren", "nachschlagen"
    ],
    ANALYZE_DOCUMENT: [
      "analysieren", "analyse", "bewerten", "prufen", "prüfen", "untersuchen"
    ],
    CHAT_GENERAL: [
      "hallo", "guten tag", "guten morgen", "danke", "ok", "ja", "nein",
      "guten abend", "bitte", "hilfe"
    ],
    NEED_CLARIFICATION: []
  },
  it: {
    CREATE_PRESENTATION: [
      "ppt", "pptx", "powerpoint", "presentazione", "diapositive",
      "creare presentazione", "fare presentazione", "generare slide"
    ],
    CREATE_DOCUMENT: [
      "doc", "docx", "word", "documento", "rapporto", "relazione",
      "creare documento", "fare documento", "scrivere documento"
    ],
    CREATE_SPREADSHEET: [
      "xls", "xlsx", "excel", "foglio di calcolo", "tabella",
      "creare excel", "fare tabella"
    ],
    SUMMARIZE: [
      "riassunto", "riassumere", "sintetizzare", "sintesi", "punti chiave"
    ],
    TRANSLATE: [
      "tradurre", "traduzione", "in inglese", "in spagnolo", "in francese"
    ],
    SEARCH_WEB: [
      "cercare su internet", "ricerca web", "trovare informazioni"
    ],
    ANALYZE_DOCUMENT: [
      "analizzare", "analisi", "valutare", "esaminare", "interpretare"
    ],
    CHAT_GENERAL: [
      "ciao", "buongiorno", "buonasera", "grazie", "ok", "sì", "no",
      "per favore", "aiuto"
    ],
    NEED_CLARIFICATION: []
  }
};

const CREATION_VERBS: Record<SupportedLocale, string[]> = {
  es: [
    "crear", "crea", "creame", "créame", "generar", "genera", "generame",
    "hacer", "haz", "hazme", "armar", "arma", "armame",
    "construir", "construye", "exportar", "exporta",
    "elaborar", "elabora", "redactar", "redacta", "preparar", "prepara",
    "desarrollar", "desarrolla", "escribir", "escribe", "escribeme"
  ],
  en: [
    "create", "make", "generate", "build", "produce", "design", "draft",
    "write", "prepare", "develop", "compose", "construct"
  ],
  pt: [
    "criar", "crie", "gerar", "gere", "fazer", "faca", "faça",
    "construir", "elaborar", "preparar", "desenvolver", "escrever"
  ],
  fr: [
    "créer", "creer", "générer", "generer", "faire", "construire",
    "élaborer", "elaborer", "préparer", "preparer", "rédiger", "rediger"
  ],
  de: [
    "erstellen", "erstelle", "generieren", "generiere", "machen", "bauen",
    "entwickeln", "schreiben", "vorbereiten", "ausarbeiten"
  ],
  it: [
    "creare", "crea", "generare", "genera", "fare", "fai",
    "costruire", "elaborare", "preparare", "sviluppare", "scrivere"
  ]
};

const FORMAT_KEYWORDS: Record<NonNullable<OutputFormat>, string[]> = {
  pptx: ["pptx", "ppt", "powerpoint", "power point", "presentacion", "presentación", "presentation", "slides", "diapositivas", "folien", "apresentacao", "diapositive"],
  docx: ["docx", "doc", "word", "documento", "document", "informe", "reporte", "report", "dokument", "relatorio"],
  xlsx: ["xlsx", "xls", "excel", "spreadsheet", "hoja de calculo", "tabla", "planilla", "tabelle", "tableur", "foglio"],
  pdf: ["pdf", "portable document", "exportar pdf"],
  txt: ["txt", "texto plano", "plain text", "text file"],
  csv: ["csv", "comma separated", "valores separados"],
  html: ["html", "webpage", "pagina web", "página web"]
};

const AUDIENCE_KEYWORDS: Record<string, string[]> = {
  executives: ["ejecutivos", "directivos", "ceo", "cfo", "c-level", "junta directiva", "board", "executives", "leadership", "dirigeants", "führungskräfte"],
  technical: ["tecnicos", "técnicos", "ingenieros", "developers", "programadores", "technical", "engineering", "technique", "technisch"],
  general: ["general", "publico general", "público general", "everyone", "todos", "audiencia general", "grand public", "allgemein"],
  academic: ["academico", "académico", "estudiantes", "students", "universidad", "university", "academic", "research", "académique", "akademisch"],
  clients: ["clientes", "customers", "clients", "compradores", "buyers", "clienti", "kunden"],
  investors: ["inversores", "inversionistas", "investors", "stakeholders", "accionistas", "investisseurs", "investoren"]
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

function fuzzyMatch(text: string, target: string, threshold: number = 0.80): { match: boolean; similarity: number } {
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

export interface RuleMatchResult {
  intent: IntentType;
  confidence: number;
  raw_score: number;
  matched_patterns: string[];
  output_format: OutputFormat;
  has_creation_verb: boolean;
}

function hasCreationVerb(normalizedText: string, locale: SupportedLocale): boolean {
  const verbs = [...CREATION_VERBS[locale], ...CREATION_VERBS.en];
  return verbs.some(verb => {
    const pattern = new RegExp(`\\b${verb}\\b`, "i");
    return pattern.test(normalizedText);
  });
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

export function extractSlots(normalizedText: string, originalText: string): Slots {
  const slots: Slots = {};
  
  const lengthPatterns: Array<{ pattern: RegExp; value: "short" | "medium" | "long" }> = [
    { pattern: /\b(breve|corto|corta|short|brief|rapido|rápido|conciso|kurz|court|breve)\b/i, value: "short" },
    { pattern: /\b(medio|mediano|mediana|medium|moderate|normal|mittel|moyen)\b/i, value: "medium" },
    { pattern: /\b(largo|larga|long|extenso|extensa|detallado|detallada|completo|completa|exhaustivo|lang|détaillé|lungo)\b/i, value: "long" }
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
  
  const slidesPattern = /(\d+)\s*(?:diapositivas?|slides?|paginas?|páginas?|hojas?|folien?|diapositive?)/i;
  const slidesMatch = normalizedText.match(slidesPattern);
  if (slidesMatch) {
    slots.num_slides = parseInt(slidesMatch[1], 10);
  }
  
  if (/\b(con\s*)?imagenes?\b|\b(with\s*)?images?\b|\b(incluir?\s*)?fotos?\b|\billustrat|\bbilder\b|\bimmagini\b/i.test(normalizedText)) {
    slots.include_images = true;
  }
  
  if (/\b(sin\s*)?imagenes?\b|\b(no\s*)?images?\b|\btext\s*only\b|\bsolo\s*texto\b|\bkeine\s*bilder\b/i.test(normalizedText)) {
    slots.include_images = false;
  }
  
  if (/\bbullet\s*points?\b|\bviñetas?\b|\bpuntos?\b|\blista\b|\bitemized\b|\baufzaehlung\b|\bpuce\b/i.test(normalizedText)) {
    slots.bullet_points = true;
  }
  
  const stylePatterns: Array<{ pattern: RegExp; style: string }> = [
    { pattern: /\b(profesional|professional|formal|corporativo|corporate|business|formell|formel)\b/i, style: "professional" },
    { pattern: /\b(creativo|creative|moderno|modern|innovador|kreativ|créatif)\b/i, style: "creative" },
    { pattern: /\b(minimalista|minimal|simple|clean|limpio|schlicht)\b/i, style: "minimal" },
    { pattern: /\b(academico|académico|academic|científico|scientific|research|wissenschaftlich|académique)\b/i, style: "academic" },
    { pattern: /\b(casual|informal|friendly|amigable|locker)\b/i, style: "casual" }
  ];
  
  for (const { pattern, style } of stylePatterns) {
    if (pattern.test(normalizedText)) {
      slots.style = style;
      break;
    }
  }
  
  const topicPatterns = [
    /(?:sobre|about|acerca\s+de|regarding|tema|topic|de|sur|über|su)\s+["']?([^"'\n,\.]{3,50})["']?/i,
    /(?:presentacion|documento|excel|informe|reporte|resumen|presentation|document|report)\s+(?:de|sobre|about|sur|über)\s+["']?([^"'\n,\.]{3,50})["']?/i
  ];
  
  for (const pattern of topicPatterns) {
    const match = originalText.match(pattern);
    if (match) {
      slots.topic = match[1].trim();
      break;
    }
  }
  
  const titlePatterns = [
    /(?:titulo|title|titulado|titled|llamado|called|intitulé|betitelt)\s*[:\s]+["']?([^"'\n]{3,80})["']?/i
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

export function ruleBasedMatch(
  normalizedText: string,
  locale: SupportedLocale = "es"
): RuleMatchResult {
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
  
  const localeAliases = INTENT_ALIASES[locale] || INTENT_ALIASES.es;
  const englishAliases = INTENT_ALIASES.en;
  
  for (const [intent, aliases] of Object.entries(localeAliases) as [IntentType, string[]][]) {
    const allAliases = [...aliases, ...(englishAliases[intent] || [])];
    const uniqueAliases = [...new Set(allAliases)];
    
    for (const alias of uniqueAliases) {
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
  
  const hasCreation = hasCreationVerb(normalizedText, locale);
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
    confidence = 0.30;
  } else if (bestScore < 2) {
    confidence = 0.50;
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
    raw_score: bestScore,
    matched_patterns: scores[bestIntent].patterns,
    output_format: outputFormat,
    has_creation_verb: hasCreation
  };
}

export function getAliasCount(): Record<SupportedLocale, number> {
  const counts: Record<SupportedLocale, number> = { es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0 };
  
  for (const locale of Object.keys(counts) as SupportedLocale[]) {
    const localeAliases = INTENT_ALIASES[locale];
    counts[locale] = Object.values(localeAliases).reduce(
      (acc, arr) => acc + arr.length,
      0
    );
  }
  
  return counts;
}
