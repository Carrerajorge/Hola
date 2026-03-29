/**
 * Content Compressor
 * 
 * Comprime contenido extraído para reducir uso de memoria y localStorage.
 * Usa lz-string para compresión rápida en el navegador.
 */

import * as LZString from "lz-string";

export interface CompressedContent {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  timestamp: number;
}

const COMPRESSION_THRESHOLD = 1024; // Only compress if > 1KB
const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024; // 50MB max

export function compressContent(content: string): CompressedContent | null {
  if (!content || content.length === 0) {
    return null;
  }

  const originalSize = new Blob([content]).size;

  if (originalSize > MAX_UNCOMPRESSED_SIZE) {
    console.warn("[Compressor] Content too large to compress:", originalSize);
    return null;
  }

  if (originalSize < COMPRESSION_THRESHOLD) {
    return null;
  }

  try {
    const compressed = LZString.compressToUTF16(content);
    
    if (!compressed) {
      console.warn("[Compressor] Compression failed");
      return null;
    }

    const compressedSize = new Blob([compressed]).size;
    const compressionRatio = compressedSize / originalSize;

    console.log("[Compressor] Compressed:", {
      originalSize: (originalSize / 1024).toFixed(2) + "KB",
      compressedSize: (compressedSize / 1024).toFixed(2) + "KB",
      ratio: ((1 - compressionRatio) * 100).toFixed(1) + "% saved",
    });

    return {
      compressed,
      originalSize,
      compressedSize,
      compressionRatio,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("[Compressor] Error:", error);
    return null;
  }
}

export function decompressContent(compressed: string): string | null {
  if (!compressed) {
    return null;
  }

  try {
    const decompressed = LZString.decompressFromUTF16(compressed);
    
    if (!decompressed) {
      console.warn("[Compressor] Decompression failed");
      return null;
    }

    return decompressed;
  } catch (error) {
    console.error("[Compressor] Decompression error:", error);
    return null;
  }
}

export function compressHtml(html: string): CompressedContent | null {
  // HTML has high compression ratio due to repeated tags
  return compressContent(html);
}

export function compressJson(data: object): CompressedContent | null {
  try {
    const jsonString = JSON.stringify(data);
    return compressContent(jsonString);
  } catch (error) {
    console.error("[Compressor] JSON compression error:", error);
    return null;
  }
}

export function decompressJson<T>(compressed: string): T | null {
  const decompressed = decompressContent(compressed);
  if (!decompressed) return null;

  try {
    return JSON.parse(decompressed) as T;
  } catch (error) {
    console.error("[Compressor] JSON parse error:", error);
    return null;
  }
}

export function getCompressionStats(): {
  totalOriginal: number;
  totalCompressed: number;
  savedSpace: number;
  savedPercent: number;
} {
  let totalOriginal = 0;
  let totalCompressed = 0;

  // Iterate over cache if available
  const cache = getCompressionCache();
  for (const entry of Object.values(cache)) {
    totalOriginal += entry.originalSize;
    totalCompressed += entry.compressedSize;
  }

  const savedSpace = totalOriginal - totalCompressed;
  const savedPercent = totalOriginal > 0 ? (savedSpace / totalOriginal) * 100 : 0;

  return {
    totalOriginal,
    totalCompressed,
    savedSpace,
    savedPercent,
  };
}

const COMPRESSION_CACHE_KEY = "file_preview_compression_cache";

function getCompressionCache(): Record<string, CompressedContent> {
  try {
    const cached = localStorage.getItem(COMPRESSION_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

export function storeCompressed(fileId: string, content: CompressedContent): void {
  try {
    const cache = getCompressionCache();
    cache[fileId] = content;
    localStorage.setItem(COMPRESSION_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("[Compressor] Could not store in cache:", error);
  }
}

export function retrieveCompressed(fileId: string): CompressedContent | null {
  const cache = getCompressionCache();
  return cache[fileId] || null;
}

export function clearCompressionCache(): void {
  localStorage.removeItem(COMPRESSION_CACHE_KEY);
}
