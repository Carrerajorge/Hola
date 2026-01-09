/**
 * Zip Bomb Guard - Protection against decompression attacks
 * PARE Phase 2 Security Hardening
 * 
 * Detects zip bombs by checking compression ratio, nested depth,
 * and maximum extracted size limits.
 */

import JSZip from 'jszip';

export interface ZipBombCheckOptions {
  maxCompressionRatio: number;
  maxNestedDepth: number;
  maxExtractedSizeMB: number;
  maxFileCount: number;
}

export interface ZipBombCheckResult {
  safe: boolean;
  suspicious: boolean;
  blocked: boolean;
  reason?: string;
  metrics: ZipBombMetrics;
}

export interface ZipBombMetrics {
  compressedSize: number;
  estimatedUncompressedSize: number;
  compressionRatio: number;
  fileCount: number;
  nestedDepth: number;
  hasNestedArchive: boolean;
}

const DEFAULT_OPTIONS: ZipBombCheckOptions = {
  maxCompressionRatio: 100,
  maxNestedDepth: 2,
  maxExtractedSizeMB: 100,
  maxFileCount: 10000,
};

const ARCHIVE_EXTENSIONS = ['.zip', '.jar', '.war', '.ear', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'];
const ARCHIVE_MAGIC_BYTES = [
  [0x50, 0x4B, 0x03, 0x04],
  [0x50, 0x4B, 0x05, 0x06],
  [0x50, 0x4B, 0x07, 0x08],
];

function isArchiveFile(filename: string, buffer?: Buffer): boolean {
  const lowerName = filename.toLowerCase();
  
  if (ARCHIVE_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
    return true;
  }
  
  if (buffer && buffer.length >= 4) {
    for (const magic of ARCHIVE_MAGIC_BYTES) {
      if (magic.every((byte, i) => buffer[i] === byte)) {
        return true;
      }
    }
  }
  
  return false;
}

function estimateUncompressedSize(zip: JSZip): number {
  let totalSize = 0;
  
  zip.forEach((relativePath, file) => {
    if (!file.dir) {
      const fileData = (file as any)._data;
      if (fileData && typeof fileData.uncompressedSize === 'number') {
        totalSize += fileData.uncompressedSize;
      } else if (fileData && typeof fileData.compressedSize === 'number') {
        totalSize += fileData.compressedSize * 10;
      } else {
        totalSize += 1024 * 1024;
      }
    }
  });
  
  return totalSize;
}

/**
 * Check a buffer for zip bomb characteristics
 */
export async function checkZipBomb(
  buffer: Buffer,
  options: Partial<ZipBombCheckOptions> = {}
): Promise<ZipBombCheckResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const metrics: ZipBombMetrics = {
    compressedSize: buffer.length,
    estimatedUncompressedSize: 0,
    compressionRatio: 0,
    fileCount: 0,
    nestedDepth: 0,
    hasNestedArchive: false,
  };

  try {
    const zip = await JSZip.loadAsync(buffer);
    
    let fileCount = 0;
    let hasNestedArchive = false;
    const nestedArchives: string[] = [];
    
    zip.forEach((relativePath, file) => {
      if (!file.dir) {
        fileCount++;
        
        if (isArchiveFile(relativePath)) {
          hasNestedArchive = true;
          nestedArchives.push(relativePath);
        }
      }
    });
    
    metrics.fileCount = fileCount;
    metrics.hasNestedArchive = hasNestedArchive;
    
    if (fileCount > opts.maxFileCount) {
      return {
        safe: false,
        suspicious: true,
        blocked: true,
        reason: `Excessive file count: ${fileCount} (limit: ${opts.maxFileCount})`,
        metrics,
      };
    }
    
    metrics.estimatedUncompressedSize = estimateUncompressedSize(zip);
    metrics.compressionRatio = metrics.estimatedUncompressedSize / Math.max(buffer.length, 1);
    
    if (metrics.compressionRatio > opts.maxCompressionRatio) {
      return {
        safe: false,
        suspicious: true,
        blocked: true,
        reason: `Suspicious compression ratio: ${metrics.compressionRatio.toFixed(1)}:1 (limit: ${opts.maxCompressionRatio}:1)`,
        metrics,
      };
    }
    
    const maxExtractedBytes = opts.maxExtractedSizeMB * 1024 * 1024;
    if (metrics.estimatedUncompressedSize > maxExtractedBytes) {
      return {
        safe: false,
        suspicious: true,
        blocked: true,
        reason: `Extracted size would exceed limit: ${(metrics.estimatedUncompressedSize / (1024 * 1024)).toFixed(1)}MB (limit: ${opts.maxExtractedSizeMB}MB)`,
        metrics,
      };
    }
    
    if (hasNestedArchive) {
      let maxDepth = 1;
      
      for (const archivePath of nestedArchives.slice(0, 5)) {
        try {
          const nestedFile = zip.file(archivePath);
          if (nestedFile) {
            const nestedBuffer = await nestedFile.async('nodebuffer');
            const nestedResult = await checkNestedArchive(nestedBuffer, 1, opts);
            maxDepth = Math.max(maxDepth, nestedResult.depth);
            
            if (nestedResult.blocked) {
              metrics.nestedDepth = nestedResult.depth;
              return {
                safe: false,
                suspicious: true,
                blocked: true,
                reason: `Nested archive issue at depth ${nestedResult.depth}: ${nestedResult.reason}`,
                metrics,
              };
            }
          }
        } catch {
        }
      }
      
      metrics.nestedDepth = maxDepth;
      
      if (maxDepth > opts.maxNestedDepth) {
        return {
          safe: false,
          suspicious: true,
          blocked: true,
          reason: `Nested archive depth ${maxDepth} exceeds limit of ${opts.maxNestedDepth}`,
          metrics,
        };
      }
    }
    
    const suspicious = metrics.compressionRatio > 50 || hasNestedArchive;
    
    return {
      safe: !suspicious,
      suspicious,
      blocked: false,
      metrics,
    };
    
  } catch (error) {
    return {
      safe: false,
      suspicious: true,
      blocked: false,
      reason: `Failed to analyze archive: ${error instanceof Error ? error.message : 'unknown error'}`,
      metrics,
    };
  }
}

async function checkNestedArchive(
  buffer: Buffer,
  currentDepth: number,
  options: ZipBombCheckOptions
): Promise<{ depth: number; blocked: boolean; reason?: string }> {
  if (currentDepth >= options.maxNestedDepth) {
    return { depth: currentDepth + 1, blocked: true, reason: 'Max nesting depth exceeded' };
  }
  
  try {
    const zip = await JSZip.loadAsync(buffer);
    let maxDepth = currentDepth + 1;
    let hasNestedArchive = false;
    
    const promises: Promise<{ depth: number; blocked: boolean; reason?: string }>[] = [];
    
    zip.forEach((relativePath, file) => {
      if (!file.dir && isArchiveFile(relativePath)) {
        hasNestedArchive = true;
        
        if (promises.length < 3) {
          promises.push(
            (async () => {
              const nestedBuffer = await file.async('nodebuffer');
              return checkNestedArchive(nestedBuffer, currentDepth + 1, options);
            })()
          );
        }
      }
    });
    
    if (promises.length > 0) {
      const results = await Promise.all(promises);
      for (const result of results) {
        maxDepth = Math.max(maxDepth, result.depth);
        if (result.blocked) {
          return result;
        }
      }
    }
    
    return { depth: maxDepth, blocked: false };
    
  } catch {
    return { depth: currentDepth + 1, blocked: false };
  }
}

/**
 * Quick check if buffer appears to be a zip bomb
 * Returns true if the file should be blocked
 */
export async function isZipBomb(
  buffer: Buffer,
  options?: Partial<ZipBombCheckOptions>
): Promise<boolean> {
  const result = await checkZipBomb(buffer, options);
  return result.blocked;
}

/**
 * Validate a ZIP-based document file (DOCX, XLSX, PPTX, etc.)
 */
export async function validateZipDocument(
  buffer: Buffer,
  filename: string
): Promise<{ valid: boolean; error?: string }> {
  const result = await checkZipBomb(buffer);
  
  if (result.blocked) {
    console.error(`[ZipBombGuard] Blocked suspicious file: ${filename}`, {
      reason: result.reason,
      metrics: result.metrics,
    });
    
    return {
      valid: false,
      error: `Security check failed: ${result.reason}`,
    };
  }
  
  if (result.suspicious) {
    console.warn(`[ZipBombGuard] Suspicious but allowed: ${filename}`, {
      metrics: result.metrics,
    });
  }
  
  return { valid: true };
}

export const zipBombGuard = {
  checkZipBomb,
  isZipBomb,
  validateZipDocument,
  DEFAULT_OPTIONS,
};
