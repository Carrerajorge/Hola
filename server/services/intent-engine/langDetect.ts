import { franc } from "franc";
import type { SupportedLocale } from "../../../shared/schemas/intent";

const FRANC_TO_LOCALE: Record<string, SupportedLocale> = {
  spa: "es",
  eng: "en",
  por: "pt",
  fra: "fr",
  deu: "de",
  ita: "it"
};

const LOCALE_MARKERS: Record<SupportedLocale, string[]> = {
  es: [
    "crear", "generar", "hacer", "por favor", "sobre", "para", "con",
    "presentacion", "documento", "tabla", "hoja", "resumen", "traducir",
    "buscar", "analizar", "¿", "¡", "el", "la", "los", "las", "un", "una"
  ],
  en: [
    "create", "generate", "make", "please", "about", "for", "with",
    "presentation", "document", "table", "spreadsheet", "summary", "translate",
    "search", "analyze", "the", "a", "an", "is", "are", "was", "were"
  ],
  pt: [
    "criar", "gerar", "fazer", "por favor", "sobre", "para", "com",
    "apresentacao", "documento", "tabela", "planilha", "resumo", "traduzir",
    "buscar", "analisar", "o", "a", "os", "as", "um", "uma", "é", "são"
  ],
  fr: [
    "créer", "générer", "faire", "s'il vous plaît", "sur", "pour", "avec",
    "présentation", "document", "tableau", "feuille", "résumé", "traduire",
    "chercher", "analyser", "le", "la", "les", "un", "une", "est", "sont"
  ],
  de: [
    "erstellen", "generieren", "machen", "bitte", "über", "für", "mit",
    "präsentation", "dokument", "tabelle", "blatt", "zusammenfassung", "übersetzen",
    "suchen", "analysieren", "der", "die", "das", "ein", "eine", "ist", "sind"
  ],
  it: [
    "creare", "generare", "fare", "per favore", "su", "per", "con",
    "presentazione", "documento", "tabella", "foglio", "riassunto", "tradurre",
    "cercare", "analizzare", "il", "la", "i", "le", "un", "una", "è", "sono"
  ]
};

export interface LanguageDetectionResult {
  locale: SupportedLocale;
  confidence: number;
  method: "franc" | "markers" | "default";
  all_scores: Record<SupportedLocale, number>;
}

function countMarkerMatches(text: string, locale: SupportedLocale): number {
  const lowerText = text.toLowerCase();
  const markers = LOCALE_MARKERS[locale];
  let count = 0;
  
  for (const marker of markers) {
    if (lowerText.includes(marker.toLowerCase())) {
      count++;
    }
  }
  
  return count;
}

function detectByMarkers(text: string): LanguageDetectionResult {
  const scores: Record<SupportedLocale, number> = {
    es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0
  };
  
  for (const locale of Object.keys(scores) as SupportedLocale[]) {
    scores[locale] = countMarkerMatches(text, locale);
  }
  
  const totalMatches = Object.values(scores).reduce((a, b) => a + b, 0);
  
  if (totalMatches === 0) {
    return {
      locale: "es",
      confidence: 0.5,
      method: "default",
      all_scores: scores
    };
  }
  
  let bestLocale: SupportedLocale = "es";
  let bestScore = 0;
  
  for (const [locale, score] of Object.entries(scores) as [SupportedLocale, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestLocale = locale;
    }
  }
  
  const confidence = Math.min(0.95, 0.5 + (bestScore / totalMatches) * 0.45);
  
  return {
    locale: bestLocale,
    confidence,
    method: "markers",
    all_scores: scores
  };
}

function detectByFranc(text: string): LanguageDetectionResult {
  const defaultScores: Record<SupportedLocale, number> = {
    es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0
  };
  
  if (text.length < 10) {
    return {
      locale: "es",
      confidence: 0.5,
      method: "default",
      all_scores: defaultScores
    };
  }
  
  try {
    const detected = franc(text);
    
    if (detected === "und") {
      return detectByMarkers(text);
    }
    
    const locale = FRANC_TO_LOCALE[detected];
    
    if (locale) {
      return {
        locale,
        confidence: 0.85,
        method: "franc",
        all_scores: { ...defaultScores, [locale]: 1 }
      };
    }
    
    return detectByMarkers(text);
  } catch {
    return detectByMarkers(text);
  }
}

export function detectLanguage(text: string): LanguageDetectionResult {
  if (text.length < 20) {
    return detectByMarkers(text);
  }
  
  const francResult = detectByFranc(text);
  
  if (francResult.confidence >= 0.7) {
    return francResult;
  }
  
  const markerResult = detectByMarkers(text);
  
  if (markerResult.confidence > francResult.confidence) {
    return markerResult;
  }
  
  return francResult;
}

export function isCodeSwitching(text: string): boolean {
  const scores: Record<SupportedLocale, number> = {
    es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0
  };
  
  for (const locale of Object.keys(scores) as SupportedLocale[]) {
    scores[locale] = countMarkerMatches(text, locale);
  }
  
  const nonZeroLocales = Object.values(scores).filter(s => s > 0).length;
  
  return nonZeroLocales >= 2;
}
