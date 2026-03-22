const CREATE_OR_WRITE_RE =
  /\b(crea(?:r)?|create|genera(?:r)?|generate|escribe|write|redacta(?:r)?|draft|haz(?:me)?|make|prepara(?:r)?|prepare|elabora(?:r)?|build)\b/i;

const FILE_DELIVERY_RE =
  /\b(adjunta(?:r|do|da|lo|la)?|attach|anexa(?:r|do|da)?|descarga(?:r)?|download|exporta(?:r)?|export|guarda(?:r|do|da|lo|la)?|save|sube(?:lo|la)?|upload|formato)\b/i;

const DOCUMENT_FORMAT_RE = /\b(documento|document|word|docx|pdf|archivo|file)\b/i;
const DOCUMENT_CONTENT_RE =
  /\b(informe|report|carta|letter|ensayo|essay|cv|curr[ií]culum|curriculum|resumen|summary|memorando|memo|propuesta)\b/i;

const SPREADSHEET_FORMAT_RE =
  /\b(excel|xlsx|spreadsheet|hoja(?:s)? de c[aá]lculo|hoja(?:s)? de calculo|csv)\b/i;
const SPREADSHEET_CONTENT_RE = /\b(tabla|table|dataset|presupuesto|budget|listado|base de datos|database)\b/i;

const PRESENTATION_FORMAT_RE = /\b(powerpoint|pptx|ppt|slides|diapositivas)\b/i;
const PRESENTATION_CONTENT_RE = /\b(presentaci[oó]n|presentation)\b/i;

const DOCUMENT_FORMAT_PHRASE_RE =
  /\b(?:en|como)\s+(?:un\s+)?(?:archivo\s+)?(?:formato\s+)?(?:word|docx|pdf|documento|document)\b/i;
const SPREADSHEET_FORMAT_PHRASE_RE =
  /\b(?:en|como)\s+(?:un\s+)?(?:archivo\s+)?(?:formato\s+)?(?:excel|xlsx|spreadsheet|csv)\b/i;
const PRESENTATION_FORMAT_PHRASE_RE =
  /\b(?:en|como)\s+(?:un\s+)?(?:archivo\s+)?(?:formato\s+)?(?:powerpoint|pptx|ppt|slides|diapositivas)\b/i;

function normalizeMessage(message: string): string {
  return String(message || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasExplicitFileDeliverySignal(message: string): boolean {
  return FILE_DELIVERY_RE.test(normalizeMessage(message));
}

export function hasExplicitDocumentArtifactRequest(message: string): boolean {
  const normalized = normalizeMessage(message);
  const hasCreateOrWrite = CREATE_OR_WRITE_RE.test(normalized);
  const hasDocumentFormat = DOCUMENT_FORMAT_RE.test(normalized);
  const hasDocumentContent = DOCUMENT_CONTENT_RE.test(normalized);
  const hasDelivery = FILE_DELIVERY_RE.test(normalized);

  return (
    (hasCreateOrWrite && hasDocumentFormat) ||
    DOCUMENT_FORMAT_PHRASE_RE.test(normalized) ||
    (hasDocumentContent && hasDelivery) ||
    (hasDocumentFormat && hasDelivery)
  );
}

export function hasExplicitSpreadsheetArtifactRequest(message: string): boolean {
  const normalized = normalizeMessage(message);
  const hasCreateOrWrite = CREATE_OR_WRITE_RE.test(normalized);
  const hasSpreadsheetFormat = SPREADSHEET_FORMAT_RE.test(normalized);
  const hasSpreadsheetContent = SPREADSHEET_CONTENT_RE.test(normalized);
  const hasDelivery = FILE_DELIVERY_RE.test(normalized);

  return (
    (hasCreateOrWrite && hasSpreadsheetFormat) ||
    SPREADSHEET_FORMAT_PHRASE_RE.test(normalized) ||
    (hasSpreadsheetContent && hasDelivery) ||
    (hasSpreadsheetFormat && hasDelivery)
  );
}

export function hasExplicitPresentationArtifactRequest(message: string): boolean {
  const normalized = normalizeMessage(message);
  const hasCreateOrWrite = CREATE_OR_WRITE_RE.test(normalized);
  const hasPresentationFormat = PRESENTATION_FORMAT_RE.test(normalized);
  const hasPresentationContent = PRESENTATION_CONTENT_RE.test(normalized);
  const hasDelivery = FILE_DELIVERY_RE.test(normalized);

  return (
    (hasCreateOrWrite && hasPresentationFormat) ||
    PRESENTATION_FORMAT_PHRASE_RE.test(normalized) ||
    (hasPresentationContent && hasDelivery) ||
    (hasPresentationFormat && hasDelivery)
  );
}
