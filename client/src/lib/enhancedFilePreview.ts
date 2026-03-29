/**
 * Enhanced File Preview System
 * 
 * Integra todas las mejoras:
 * - Validación de integridad
 * - Web Workers para extracción
 * - Streaming de contenido
 * - Compresión de cache
 * - Prefetch inteligente
 * - Sincronización entre pestañas
 * - OCR para PDFs escaneados
 * - Thumbnails
 */

import { validateFileIntegrity, getQuickValidation } from "./fileIntegrityValidator";
import { getWorkerManager } from "./workerManager";
import { getStreamingExtractor } from "./streamingExtractor";
import { compressContent, decompressContent, storeCompressed, retrieveCompressed } from "./contentCompressor";
import { getPrefetchManager } from "./prefetchManager";
import { initCrossTabSync, getCrossTabSync } from "./crossTabSync";
import { needsOCR, performOCR } from "./ocrService";
import { generateThumbnail, cacheThumbnail, getCachedThumbnail } from "./thumbnailService";
import { getCachedPreview, setCachedPreview, type CachedPreview } from "./filePreviewCache";
import { extractFileContent } from "./fileContentExtractor";

// Initialize systems
let initialized = false;

export function initializeEnhancedPreview(): void {
  if (initialized) return;

  initCrossTabSync();
  initialized = true;

  console.log("[EnhancedPreview] Initialized");
}

export interface EnhancedPreviewOptions {
  useWorker?: boolean;
  useStreaming?: boolean;
  useOCR?: boolean;
  useCache?: boolean;
  useCompression?: boolean;
  usePrefetch?: boolean;
  validateIntegrity?: boolean;
  generateThumbnail?: boolean;
}

const DEFAULT_OPTIONS: EnhancedPreviewOptions = {
  useWorker: true,
  useStreaming: true,
  useOCR: true,
  useCache: true,
  useCompression: true,
  usePrefetch: true,
  validateIntegrity: true,
  generateThumbnail: true,
};

export interface PreviewResult {
  fileId: string;
  content?: string;
  htmlContent?: string;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  thumbnail?: string;
  ocrPerformed?: boolean;
  validation?: {
    valid: boolean;
    error?: string;
    detectedType?: string;
  };
  stats: {
    extractionTime: number;
    contentSize: number;
    compressionRatio?: number;
  };
}

export type ProgressCallback = (
  stage: "validating" | "extracting" | "processing" | "ocr" | "compressing" | "caching" | "ready",
  progress: number,
  message: string
) => void;

/**
 * Main function to get enhanced file preview
 */
export async function getEnhancedPreview(
  file: File,
  fileId: string,
  options: EnhancedPreviewOptions = {},
  onProgress?: ProgressCallback
): Promise<PreviewResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  const result: PreviewResult = {
    fileId,
    stats: {
      extractionTime: 0,
      contentSize: 0,
    },
  };

  // Check cache first
  if (opts.useCache) {
    const cached = getCachedPreview(fileId);
    if (cached?.content || cached?.htmlContent) {
      // Check if compressed
      const compressed = retrieveCompressed(fileId);
      if (compressed) {
        result.content = decompressContent(compressed.compressed) || cached.content;
        result.stats.compressionRatio = compressed.compressionRatio;
      } else {
        result.content = cached.content;
        result.htmlContent = cached.htmlContent;
      }
      result.tables = cached.tables;

      // Get cached thumbnail
      const thumbnail = getCachedThumbnail(fileId);
      if (thumbnail) {
        result.thumbnail = thumbnail.dataUrl;
      }

      result.stats.extractionTime = Date.now() - startTime;
      result.stats.contentSize = result.content?.length || 0;

      return result;
    }
  }

  // Validate integrity
  if (opts.validateIntegrity) {
    onProgress?.("validating", 5, "Validando archivo...");

    const validation = await validateFileIntegrity(file);
    result.validation = validation;

    if (!validation.valid) {
      result.stats.extractionTime = Date.now() - startTime;
      return result;
    }
  }

  // Generate thumbnail
  if (opts.generateThumbnail) {
    try {
      const thumbnail = await generateThumbnail(file);
      result.thumbnail = thumbnail.dataUrl;
      cacheThumbnail(fileId, thumbnail);
    } catch (e) {
      console.warn("[EnhancedPreview] Thumbnail generation failed:", e);
    }
  }

  // Check if OCR is needed
  let needsOcr = false;
  if (opts.useOCR) {
    try {
      const buffer = await file.slice(0, 65536).arrayBuffer();
      needsOcr = await needsOCR(buffer, file.type);

      if (needsOcr) {
        onProgress?.("ocr", 20, "Detectado PDF escaneado, iniciando OCR...");
      }
    } catch (e) {
      console.warn("[EnhancedPreview] OCR check failed:", e);
    }
  }

  // Extract content
  let content = "";
  let htmlContent = "";
  let tables: Array<{ headers: string[]; rows: string[][] }> = [];

  if (needsOcr) {
    // Perform OCR
    onProgress?.("ocr", 30, "Realizando OCR...");

    try {
      const buffer = await file.arrayBuffer();
      const ocrResult = await performOCR(buffer, {
        language: "spa+eng",
        mimeType: file.type,
        onProgress: (p) => {
          onProgress?.("ocr", 30 + p.progress * 0.5, p.message);
        },
      });

      content = ocrResult.text;
      result.ocrPerformed = true;

      onProgress?.("processing", 80, "Procesando resultado OCR...");
    } catch (e) {
      console.error("[EnhancedPreview] OCR failed:", e);
    }
  } else {
    // Normal extraction
    onProgress?.("extracting", 30, "Extrayendo contenido...");

    // Try worker first
    const workerManager = getWorkerManager();
    const workerReady = await workerManager.isReady();

    if (opts.useWorker && workerReady) {
      try {
        const workerResult = await workerManager.extractFile(
          file,
          fileId,
          (fid, stage, progress, message) => {
            onProgress?.("extracting", 30 + progress * 0.5, message);
          }
        );

        content = workerResult.content || "";
        htmlContent = workerResult.htmlContent || "";
        tables = workerResult.tables || [];
      } catch (e) {
        console.warn("[EnhancedPreview] Worker extraction failed, falling back:", e);
        const fallbackResult = await extractFileContent(file, fileId);
        content = fallbackResult.content || "";
        htmlContent = fallbackResult.htmlContent || "";
        tables = fallbackResult.tables || [];
      }
    } else {
      // Use streaming extractor for large files
      if (opts.useStreaming && file.size > 5 * 1024 * 1024) {
        const streamingExtractor = getStreamingExtractor();

        await new Promise<void>((resolve) => {
          streamingExtractor.extractStreaming(file, fileId, (chunk) => {
            if (chunk.error) {
              console.error("[EnhancedPreview] Streaming error:", chunk.error);
            } else {
              content = chunk.content;
              htmlContent = chunk.htmlContent || "";
            }

            onProgress?.("extracting", 30 + chunk.progress * 0.5, "Extrayendo...");

            if (chunk.done) {
              resolve();
            }
          });
        });
      } else {
        // Direct extraction
        const extractionResult = await extractFileContent(file, fileId);
        content = extractionResult.content || "";
        htmlContent = extractionResult.htmlContent || "";
        tables = extractionResult.tables || [];
      }
    }
  }

  result.content = content;
  result.htmlContent = htmlContent;
  result.tables = tables;

  // Compress and cache
  if (opts.useCache && opts.useCompression && content) {
    onProgress?.("compressing", 90, "Comprimiendo contenido...");

    const compressed = compressContent(htmlContent || content);
    if (compressed) {
      storeCompressed(fileId, compressed);
      result.stats.compressionRatio = compressed.compressionRatio;
    }
  }

  // Cache preview
  if (opts.useCache) {
    onProgress?.("caching", 95, "Guardando en caché...");

    const preview: CachedPreview = {
      id: fileId,
      name: file.name,
      mimeType: file.type,
      content,
      htmlContent,
      tables,
      extractedAt: Date.now(),
      size: file.size,
    };

    setCachedPreview(preview);

    // Broadcast to other tabs
    const crossTab = getCrossTabSync();
    crossTab.broadcastPreviewCached(preview);
  }

  result.stats.extractionTime = Date.now() - startTime;
  result.stats.contentSize = content?.length || 0;

  onProgress?.("ready", 100, "Completado");

  return result;
}

/**
 * Prefetch file preview in background
 */
export function prefetchFilePreview(file: File, fileId: string): void {
  const prefetchManager = getPrefetchManager();
  prefetchManager.registerFile(file, fileId);
}

/**
 * Handle hover for prefetch
 */
export function onFileHover(fileId: string): void {
  const prefetchManager = getPrefetchManager();
  prefetchManager.onHover(fileId);
}

/**
 * Handle hover end
 */
export function onFileHoverEnd(fileId: string): void {
  const prefetchManager = getPrefetchManager();
  prefetchManager.onHoverEnd(fileId);
}

// Re-export utilities
export {
  validateFileIntegrity,
  getQuickValidation,
  compressContent,
  decompressContent,
  needsOCR,
  performOCR,
  generateThumbnail,
  getCachedThumbnail,
  getCachedPreview,
  setCachedPreview,
};
