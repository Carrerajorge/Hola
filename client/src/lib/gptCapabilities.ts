export interface UiGptCapabilities {
  webBrowsing: boolean;
  canvas: boolean;
  imageGeneration: boolean;
  codeInterpreter: boolean;
  wordCreation: boolean;
  excelCreation: boolean;
  pptCreation: boolean;
}

export const DEFAULT_UI_GPT_CAPABILITIES: UiGptCapabilities = {
  webBrowsing: true,
  canvas: true,
  imageGeneration: true,
  codeInterpreter: false,
  wordCreation: true,
  excelCreation: true,
  pptCreation: true,
};

type UiCapabilityKey = keyof UiGptCapabilities;

const DOC_ALIAS_MAP: Record<"wordCreation" | "excelCreation" | "pptCreation", string[]> = {
  wordCreation: ["wordCreation", "word", "docx", "docxCreation"],
  excelCreation: ["excelCreation", "excel", "xlsx", "spreadsheet", "spreadsheetCreation"],
  pptCreation: ["pptCreation", "ppt", "powerpoint", "presentation", "presentationCreation"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function resolveFlag(
  source: Record<string, unknown>,
  key: UiCapabilityKey | string | string[],
  fallback: boolean,
): { value: boolean; explicit: boolean } {
  const keys = Array.isArray(key) ? key : [key];
  for (const candidate of keys) {
    if (hasOwn(source, candidate)) {
      return { value: parseBoolean(source[candidate], fallback), explicit: true };
    }
  }
  return { value: fallback, explicit: false };
}

export function normalizeUiGptCapabilities(
  value: unknown,
  fallback: UiGptCapabilities = DEFAULT_UI_GPT_CAPABILITIES,
): UiGptCapabilities {
  const source = asRecord(value) ?? {};
  const fallbackSafe: UiGptCapabilities = { ...DEFAULT_UI_GPT_CAPABILITIES, ...fallback };

  const webBrowsing = resolveFlag(source, "webBrowsing", fallbackSafe.webBrowsing);
  const canvas = resolveFlag(source, "canvas", fallbackSafe.canvas);
  const imageGeneration = resolveFlag(source, "imageGeneration", fallbackSafe.imageGeneration);
  const codeInterpreter = resolveFlag(source, "codeInterpreter", fallbackSafe.codeInterpreter);

  const wordCreation = resolveFlag(source, DOC_ALIAS_MAP.wordCreation, fallbackSafe.wordCreation);
  const excelCreation = resolveFlag(source, DOC_ALIAS_MAP.excelCreation, fallbackSafe.excelCreation);
  const pptCreation = resolveFlag(source, DOC_ALIAS_MAP.pptCreation, fallbackSafe.pptCreation);

  return {
    webBrowsing: webBrowsing.value,
    canvas: canvas.value,
    imageGeneration: imageGeneration.value,
    codeInterpreter: codeInterpreter.value,
    // Legacy compatibility: if doc flags are missing, inherit from canvas.
    wordCreation: wordCreation.explicit ? wordCreation.value : (canvas.value ? true : false),
    excelCreation: excelCreation.explicit ? excelCreation.value : (canvas.value ? true : false),
    pptCreation: pptCreation.explicit ? pptCreation.value : (canvas.value ? true : false),
  };
}
