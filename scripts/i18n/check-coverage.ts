import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANGUAGE_REGISTRY,
  SUPPORTED_LANGUAGES,
  getLanguageFallbackChain,
  type SupportedLanguage,
} from "../../client/src/locales/registry";

type LocaleFile = {
  metadata?: {
    name?: string;
    nativeName?: string;
    rtl?: boolean;
  };
  messages?: Record<string, string>;
  literals?: Record<string, string>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCALES_DIR = path.resolve(__dirname, "../../client/src/locales");

async function loadLocaleFile(language: SupportedLanguage): Promise<LocaleFile> {
  const filePath = path.join(LOCALES_DIR, `${language}.json`);
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as LocaleFile;
}

function assertStringMap(input: unknown, field: string, language: string): string[] {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push(`${language}: \"${field}\" must be an object`);
    return errors;
  }

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      errors.push(`${language}: ${field}.${key} must be a string`);
    }
  }

  return errors;
}

async function main() {
  const errors: string[] = [];
  const allowedTopLevelKeys = new Set(["metadata", "messages", "literals"]);

  if (SUPPORTED_LANGUAGES.length !== 100) {
    errors.push(`Expected exactly 100 supported languages, found ${SUPPORTED_LANGUAGES.length}`);
  }

  const registryCodeSet = new Set(LANGUAGE_REGISTRY.map((entry) => entry.code));
  for (const language of SUPPORTED_LANGUAGES) {
    if (!registryCodeSet.has(language)) {
      errors.push(`Language \"${language}\" is in SUPPORTED_LANGUAGES but not in LANGUAGE_REGISTRY`);
    }
  }

  const files = await readdir(LOCALES_DIR);
  const localeJsonFiles = files.filter((file) => file.endsWith(".json"));
  const localeCodesFromFiles = new Set(localeJsonFiles.map((file) => file.replace(/\.json$/i, "")));

  if (localeJsonFiles.length !== SUPPORTED_LANGUAGES.length) {
    errors.push(
      `Expected ${SUPPORTED_LANGUAGES.length} locale JSON files, found ${localeJsonFiles.length} (${localeJsonFiles.join(", ")})`
    );
  }

  for (const language of SUPPORTED_LANGUAGES) {
    if (!localeCodesFromFiles.has(language)) {
      errors.push(`${language}: missing locale JSON file`);
    }
  }

  for (const localeCode of localeCodesFromFiles) {
    if (!registryCodeSet.has(localeCode)) {
      errors.push(`${localeCode}: locale JSON exists but is not declared in LANGUAGE_REGISTRY`);
    }
  }

  const localeFiles = new Map<SupportedLanguage, LocaleFile>();

  for (const language of SUPPORTED_LANGUAGES) {
    try {
      const localeFile = await loadLocaleFile(language);
      localeFiles.set(language, localeFile);

      for (const topLevelKey of Object.keys(localeFile as Record<string, unknown>)) {
        if (!allowedTopLevelKeys.has(topLevelKey)) {
          errors.push(`${language}: unsupported top-level key \"${topLevelKey}\"`);
        }
      }

      if (!localeFile.metadata?.name) {
        errors.push(`${language}: metadata.name is required`);
      }

      if (!localeFile.metadata?.nativeName) {
        errors.push(`${language}: metadata.nativeName is required`);
      }

      const registryLanguage = LANGUAGE_REGISTRY.find((entry) => entry.code === language);
      if (!registryLanguage) {
        errors.push(`${language}: not found in LANGUAGE_REGISTRY`);
      } else if (Boolean(localeFile.metadata?.rtl) !== Boolean(registryLanguage.rtl)) {
        errors.push(
          `${language}: metadata.rtl (${Boolean(localeFile.metadata?.rtl)}) does not match registry (${Boolean(
            registryLanguage.rtl
          )})`
        );
      }

      errors.push(...assertStringMap(localeFile.messages ?? {}, "messages", language));
      errors.push(...assertStringMap(localeFile.literals ?? {}, "literals", language));
    } catch (error) {
      errors.push(`${language}: locale file is missing or invalid JSON (${String(error)})`);
    }
  }

  const en = localeFiles.get("en");
  const es = localeFiles.get("es");

  if (!en) errors.push("en locale file is required");
  if (!es) errors.push("es locale file is required");

  const requiredMessageKeys = new Set<string>([
    ...Object.keys(en?.messages ?? {}),
    ...Object.keys(es?.messages ?? {}),
  ]);

  const requiredLiteralKeys = new Set<string>([
    ...Object.keys(en?.literals ?? {}),
    ...Object.keys(es?.literals ?? {}),
  ]);

  for (const language of SUPPORTED_LANGUAGES) {
    const locale = localeFiles.get(language);
    if (!locale) continue;

    const availableMessages = new Set<string>([
      ...Object.keys(locale.messages ?? {}),
      ...Object.keys(en?.messages ?? {}),
      ...Object.keys(es?.messages ?? {}),
    ]);

    const availableLiterals = new Set<string>([
      ...Object.keys(locale.literals ?? {}),
      ...Object.keys(en?.literals ?? {}),
      ...Object.keys(es?.literals ?? {}),
    ]);

    for (const key of requiredMessageKeys) {
      if (!availableMessages.has(key)) {
        errors.push(`${language}: missing message key \"${key}\" even with fallback`);
      }
    }

    for (const key of requiredLiteralKeys) {
      if (!availableLiterals.has(key)) {
        errors.push(`${language}: missing literal key \"${key}\" even with fallback`);
      }
    }

    const chain = getLanguageFallbackChain(language);
    if (chain.length < 2) {
      errors.push(`${language}: fallback chain must include at least two locales`);
    }
  }

  if (errors.length > 0) {
    console.error("[i18n:check] Validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`[i18n:check] OK - ${SUPPORTED_LANGUAGES.length} locale files validated.`);
  console.log(`[i18n:check] Reference keys: ${requiredMessageKeys.size} messages, ${requiredLiteralKeys.size} literals.`);
}

main().catch((error) => {
  console.error("[i18n:check] Unexpected failure", error);
  process.exit(1);
});
