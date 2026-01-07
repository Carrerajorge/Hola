export const ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/tiff",
] as const;

export const HTTP_HEADERS = {
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ACCEPT_HTML: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  ACCEPT_LANGUAGE: "es-ES,es;q=0.9,en;q=0.8"
} as const;

export const TIMEOUTS = {
  PAGE_FETCH: 5000,  // Reduced from 8000 for faster searches
  SCREENSHOT_INTERVAL: 1500,
  MAX_CONTENT_LENGTH: 1500  // Slightly reduced for faster processing
} as const;

export const LIMITS = {
  MAX_SEARCH_RESULTS: 15,
  MAX_CONTENT_FETCH: 6,  // Reduced from 10 for faster searches while keeping good content
  EMBEDDING_BATCH_SIZE: 20,
  MAX_EMBEDDING_INPUT: 8000,
  RAG_SIMILAR_CHUNKS: 3,
  RAG_SIMILARITY_THRESHOLD: 0.5,
  MAX_FILE_SIZE_MB: 100,
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024
} as const;

export const MEMORY_INTENT_KEYWORDS = [
  "mi archivo", "mis archivos", "mi documento", "mis documentos",
  "el archivo que", "el documento que", "lo que subí", "lo que cargué",
  "el pdf", "el excel", "el word", "la presentación",
  "según mi", "de acuerdo a mi", "basándote en mi",
  "usa mi", "revisa mi", "analiza mi", "lee mi",
  "en mi archivo", "en mis documentos", "de mi archivo"
] as const;

export const FILE_UPLOAD_CONFIG = {
  CHUNK_SIZE_MB: 5,
  CHUNK_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_PARALLEL_CHUNKS: 4,
  UPLOAD_TIMEOUT_MS: 60000
} as const;

export const ALLOWED_EXTENSIONS: Record<string, string> = {
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/html": ".html",
  "application/json": ".json",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint": ".ppt",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/webp": ".webp",
  "image/tiff": ".tiff"
} as const;
