import { inferMimeTypeFromFilename } from "./attachmentIngest";

const VALID_ATTACHMENT_TYPES = new Set([
  "word",
  "excel",
  "pdf",
  "text",
  "csv",
  "presentation",
  "ppt",
  "image",
  "document",
]);

const MIME_TYPE_REGEX = /^[a-z]+\/[a-z0-9.+-]+$/i;

export function isDocumentFile(
  mimeType: string,
  fileName: string,
  type?: string,
): boolean {
  const lowerMime = (mimeType || "").toLowerCase();
  const lowerName = (fileName || "").toLowerCase();
  const lowerType = (type || "").toLowerCase();

  if (lowerType === "image" || lowerMime.startsWith("image/")) return false;

  const docMimePatterns = [
    "pdf",
    "word",
    "document",
    "sheet",
    "excel",
    "spreadsheet",
    "presentation",
    "powerpoint",
    "csv",
    "text/plain",
    "text/csv",
    "application/json",
  ];
  if (docMimePatterns.some((pattern) => lowerMime.includes(pattern))) {
    return true;
  }

  const docExtensions = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".csv",
    ".txt",
    ".json",
    ".rtf",
    ".odt",
    ".ods",
    ".odp",
  ];
  if (docExtensions.some((extension) => lowerName.endsWith(extension))) {
    return true;
  }

  if (["pdf", "word", "excel", "ppt", "document"].includes(lowerType)) {
    return true;
  }

  if (!lowerMime || lowerMime === "application/octet-stream") {
    const hasImageExt = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".bmp",
    ].some((extension) => lowerName.endsWith(extension));
    return !hasImageExt;
  }

  return false;
}

export function resolveAnalyzeAttachmentMimeType(att: {
  mimeType?: string;
  type?: string;
  name?: string;
}): string {
  const rawMimeType =
    typeof att.mimeType === "string" ? att.mimeType.trim().toLowerCase() : "";
  if (rawMimeType && MIME_TYPE_REGEX.test(rawMimeType)) {
    return rawMimeType;
  }

  const inferredMimeType = inferMimeTypeFromFilename(att.name || "");
  if (inferredMimeType) {
    return inferredMimeType;
  }

  const rawType =
    typeof att.type === "string" ? att.type.trim().toLowerCase() : "";
  if (rawType && MIME_TYPE_REGEX.test(rawType)) {
    return rawType;
  }

  return "application/octet-stream";
}

export function toAnalyzePayloadAttachment(att: any) {
  const rest = { ...(att || {}) };
  const rawType =
    typeof rest.type === "string" ? rest.type.toLowerCase().trim() : "";
  const normalizedType = VALID_ATTACHMENT_TYPES.has(rawType)
    ? rawType
    : "document";

  return {
    id: rest.id || rest.fileId,
    name: rest.name || "documento",
    type: normalizedType === "image" ? "image" : "document",
    mimeType: resolveAnalyzeAttachmentMimeType(rest),
    storagePath: rest.storagePath,
    fileId: rest.fileId || rest.id,
  };
}
