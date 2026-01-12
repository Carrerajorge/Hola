import emojiRegex from "emoji-regex";
import type { SupportedLocale } from "../../../shared/schemas/intent";

const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const MENTION_PATTERN = /@[\w]+/g;
const HASHTAG_PATTERN = /#[\w]+/g;
const REPEATED_CHARS_PATTERN = /(.)\1{3,}/g;
const WHITESPACE_PATTERN = /\s+/g;

const TYPO_CORRECTIONS: Record<SupportedLocale, Record<string, string>> = {
  es: {
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
    "resum": "resumen",
    "resumn": "resumen",
    "traduccin": "traduccion",
    "busacr": "buscar",
    "bsucar": "buscar",
    "analisar": "analizar"
  },
  en: {
    "powerpiont": "powerpoint",
    "powrpoint": "powerpoint",
    "presenation": "presentation",
    "presntation": "presentation",
    "presentaiton": "presentation",
    "slidez": "slides",
    "spreadshet": "spreadsheet",
    "spreadhseet": "spreadsheet",
    "spredsheet": "spreadsheet",
    "documnet": "document",
    "docuemnt": "document",
    "summay": "summary",
    "sumary": "summary",
    "transalte": "translate",
    "tranlate": "translate",
    "translte": "translate",
    "serach": "search",
    "seach": "search"
  },
  pt: {
    "apresentacao": "apresentação",
    "apresentasao": "apresentação",
    "documeto": "documento",
    "planilah": "planilha",
    "planiha": "planilha",
    "resumao": "resumo",
    "traduzao": "tradução"
  },
  fr: {
    "presentacion": "présentation",
    "presentasion": "présentation",
    "documant": "document",
    "tabluer": "tableur",
    "resumé": "résumé",
    "tradcution": "traduction"
  },
  de: {
    "prasentation": "präsentation",
    "praesentation": "präsentation",
    "dokumentt": "dokument",
    "tabele": "tabelle",
    "zusammenfasug": "zusammenfassung",
    "ubersetzen": "übersetzen"
  },
  it: {
    "presentazoine": "presentazione",
    "documeto": "documento",
    "fogilo": "foglio",
    "riasunto": "riassunto",
    "traduzoine": "traduzione"
  }
};

const GLOBAL_TYPO_CORRECTIONS: Record<string, string> = {
  ...TYPO_CORRECTIONS.es,
  ...TYPO_CORRECTIONS.en
};

export interface PreprocessResult {
  normalized: string;
  original: string;
  removed_urls: string[];
  removed_emails: string[];
  removed_emojis: string[];
  typos_corrected: string[];
  locale_used: SupportedLocale;
}

export function normalizeUnicode(text: string): string {
  return text.normalize("NFKC");
}

export function removeEmojis(text: string): { text: string; removed: string[] } {
  const regex = emojiRegex();
  const removed: string[] = [];
  const cleaned = text.replace(regex, (match) => {
    removed.push(match);
    return " ";
  });
  return { text: cleaned, removed };
}

export function removeUrls(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cleaned = text.replace(URL_PATTERN, (match) => {
    removed.push(match);
    return " ";
  });
  return { text: cleaned, removed };
}

export function removeEmails(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cleaned = text.replace(EMAIL_PATTERN, (match) => {
    removed.push(match);
    return " ";
  });
  return { text: cleaned, removed };
}

export function removeMentionsAndHashtags(text: string): string {
  return text
    .replace(MENTION_PATTERN, " ")
    .replace(HASHTAG_PATTERN, " ");
}

export function collapseRepeatedChars(text: string): string {
  return text.replace(REPEATED_CHARS_PATTERN, "$1$1");
}

export function removeDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function collapseWhitespace(text: string): string {
  return text.replace(WHITESPACE_PATTERN, " ").trim();
}

export function applyTypoCorrections(
  text: string,
  locale: SupportedLocale
): { text: string; corrected: string[] } {
  const corrected: string[] = [];
  let result = text;
  
  const localeTyPos = TYPO_CORRECTIONS[locale] || {};
  const allTypos = { ...GLOBAL_TYPO_CORRECTIONS, ...localeTyPos };
  
  for (const [typo, correction] of Object.entries(allTypos)) {
    const regex = new RegExp(typo.replace(/\s+/g, "\\s*"), "gi");
    if (regex.test(result)) {
      result = result.replace(regex, correction);
      corrected.push(`${typo} -> ${correction}`);
    }
  }
  
  return { text: result, corrected };
}

export function preprocess(
  text: string,
  locale: SupportedLocale = "es"
): PreprocessResult {
  const original = text;
  
  let normalized = normalizeUnicode(text);
  
  const urlResult = removeUrls(normalized);
  normalized = urlResult.text;
  
  const emailResult = removeEmails(normalized);
  normalized = emailResult.text;
  
  const emojiResult = removeEmojis(normalized);
  normalized = emojiResult.text;
  
  normalized = removeMentionsAndHashtags(normalized);
  
  normalized = normalized.toLowerCase();
  
  normalized = removeDiacritics(normalized);
  
  normalized = collapseRepeatedChars(normalized);
  
  normalized = normalized.replace(/[^\w\s]/g, " ");
  
  const typoResult = applyTypoCorrections(normalized, locale);
  normalized = typoResult.text;
  
  normalized = collapseWhitespace(normalized);
  
  return {
    normalized,
    original,
    removed_urls: urlResult.removed,
    removed_emails: emailResult.removed,
    removed_emojis: emojiResult.removed,
    typos_corrected: typoResult.corrected,
    locale_used: locale
  };
}

export function getTypoCorrectionCount(): number {
  return Object.values(TYPO_CORRECTIONS).reduce(
    (acc, dict) => acc + Object.keys(dict).length,
    0
  );
}
