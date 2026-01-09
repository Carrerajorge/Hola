/**
 * MIME Detector - Magic bytes detection for document types
 * PARE Phase 2 Security Hardening
 * 
 * Detects file types using magic bytes, with extension-based fallback
 * and content heuristics for text vs binary detection.
 */

export interface MimeDetectionResult {
  detectedMime: string;
  confidence: number;
  method: 'magic_bytes' | 'extension' | 'heuristic' | 'unknown';
  mismatch: boolean;
  mismatchDetails?: string;
  isBinary: boolean;
}

export interface MagicSignature {
  bytes: number[];
  offset?: number;
  mask?: number[];
  mime: string;
  extension: string;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf', extension: 'pdf' },
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip', extension: 'zip' },
  { bytes: [0x50, 0x4B, 0x05, 0x06], mime: 'application/zip', extension: 'zip' },
  { bytes: [0x50, 0x4B, 0x07, 0x08], mime: 'application/zip', extension: 'zip' },
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mime: 'image/png', extension: 'png' },
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg', extension: 'jpg' },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mime: 'image/gif', extension: 'gif' },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mime: 'image/gif', extension: 'gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'application/octet-stream', extension: 'webp' },
  { bytes: [0x00, 0x00, 0x00], mime: 'video/mp4', extension: 'mp4', offset: 4 },
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], mime: 'video/webm', extension: 'webm' },
  { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], mime: 'application/x-cfb', extension: 'doc' },
  { bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66], mime: 'application/rtf', extension: 'rtf' },
];

const EXTENSION_TO_MIME: Record<string, string> = {
  'pdf': 'application/pdf',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'doc': 'application/msword',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'xls': 'application/vnd.ms-excel',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'ppt': 'application/vnd.ms-powerpoint',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'csv': 'text/csv',
  'html': 'text/html',
  'htm': 'text/html',
  'json': 'application/json',
  'xml': 'application/xml',
  'zip': 'application/zip',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
};

const OOXML_CONTENT_TYPES: Record<string, string> = {
  'word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xl/workbook.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt/presentation.xml': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function matchMagicBytes(buffer: Buffer): MagicSignature | null {
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      const bufByte = buffer[offset + i];
      const sigByte = sig.bytes[i];
      const mask = sig.mask?.[i] ?? 0xFF;
      
      if ((bufByte & mask) !== (sigByte & mask)) {
        match = false;
        break;
      }
    }
    
    if (match) return sig;
  }
  return null;
}

function detectOOXMLType(buffer: Buffer): string | null {
  try {
    const content = buffer.toString('utf8', 0, Math.min(buffer.length, 2000));
    
    for (const [pattern, mime] of Object.entries(OOXML_CONTENT_TYPES)) {
      if (content.includes(pattern)) {
        return mime;
      }
    }
    
    if (content.includes('[Content_Types].xml')) {
      if (content.includes('word') || content.includes('document')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
      if (content.includes('xl') || content.includes('worksheet')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }
      if (content.includes('ppt') || content.includes('slide')) {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      }
    }
  } catch {
  }
  return null;
}

function isBinaryContent(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  let nullBytes = 0;
  let controlChars = 0;
  let highBytes = 0;
  
  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i];
    
    if (byte === 0x00) {
      nullBytes++;
    } else if (byte < 0x09 || (byte > 0x0D && byte < 0x20 && byte !== 0x1B)) {
      controlChars++;
    } else if (byte > 0x7F) {
      highBytes++;
    }
  }
  
  const nullRatio = nullBytes / checkLength;
  const controlRatio = controlChars / checkLength;
  
  return nullRatio > 0.01 || controlRatio > 0.1;
}

function isLikelyText(buffer: Buffer): boolean {
  const content = buffer.toString('utf8', 0, Math.min(buffer.length, 1000));
  
  const textPatterns = [
    /^[\s]*[{[\]"'a-zA-Z0-9]/,
    /^<[?!]?[a-zA-Z]/,
    /^#.*\n/,
    /^[a-zA-Z_][a-zA-Z0-9_]*\s*[=:(]/,
  ];
  
  for (const pattern of textPatterns) {
    if (pattern.test(content)) {
      return true;
    }
  }
  
  return false;
}

function detectTextMimeType(buffer: Buffer): string {
  const content = buffer.toString('utf8', 0, Math.min(buffer.length, 500)).trim();
  
  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      JSON.parse(buffer.toString('utf8'));
      return 'application/json';
    } catch {
    }
  }
  
  if (content.startsWith('<?xml') || content.startsWith('<')) {
    if (content.includes('<!DOCTYPE html') || content.includes('<html')) {
      return 'text/html';
    }
    return 'application/xml';
  }
  
  if (content.includes(',') && content.includes('\n')) {
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const commaCount = lines.map(l => (l.match(/,/g) || []).length);
      const consistent = commaCount.every(c => Math.abs(c - commaCount[0]) <= 1);
      if (consistent && commaCount[0] > 0) {
        return 'text/csv';
      }
    }
  }
  
  if (content.match(/^#\s|^\*\*|^-\s|^\d+\.\s|^>\s/m)) {
    return 'text/markdown';
  }
  
  return 'text/plain';
}

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Detect MIME type from buffer content and filename
 */
export function detectMime(
  buffer: Buffer,
  filename: string,
  providedMime?: string
): MimeDetectionResult {
  const extension = getExtension(filename);
  const extensionMime = EXTENSION_TO_MIME[extension];
  
  const magicMatch = matchMagicBytes(buffer);
  
  if (magicMatch) {
    let detectedMime = magicMatch.mime;
    
    if (detectedMime === 'application/zip') {
      const ooxmlType = detectOOXMLType(buffer);
      if (ooxmlType) {
        detectedMime = ooxmlType;
      } else if (extensionMime) {
        detectedMime = extensionMime;
      }
    }
    
    if (detectedMime === 'application/x-cfb') {
      detectedMime = extensionMime || 'application/msword';
    }
    
    const mismatch = !!(providedMime && providedMime !== detectedMime && 
                       !providedMime.includes('octet-stream'));
    
    return {
      detectedMime,
      confidence: 0.95,
      method: 'magic_bytes',
      mismatch,
      mismatchDetails: mismatch 
        ? `Provided: ${providedMime}, Detected: ${detectedMime}` 
        : undefined,
      isBinary: true,
    };
  }
  
  const binary = isBinaryContent(buffer);
  
  if (!binary) {
    const textMime = detectTextMimeType(buffer);
    const mismatch = !!(extensionMime && textMime !== extensionMime && 
                       !extensionMime.startsWith('text/'));
    
    return {
      detectedMime: textMime,
      confidence: 0.8,
      method: 'heuristic',
      mismatch,
      mismatchDetails: mismatch
        ? `Extension suggests: ${extensionMime}, Content suggests: ${textMime}`
        : undefined,
      isBinary: false,
    };
  }
  
  if (extensionMime) {
    const mismatch = !!(providedMime && providedMime !== extensionMime);
    
    return {
      detectedMime: extensionMime,
      confidence: 0.6,
      method: 'extension',
      mismatch,
      mismatchDetails: mismatch
        ? `Provided: ${providedMime}, Extension: ${extensionMime}`
        : undefined,
      isBinary: binary,
    };
  }
  
  return {
    detectedMime: providedMime || 'application/octet-stream',
    confidence: 0.3,
    method: 'unknown',
    mismatch: false,
    isBinary: binary,
  };
}

/**
 * Quick check if buffer looks like a specific MIME type
 */
export function quickCheckMime(buffer: Buffer, expectedMime: string): boolean {
  const result = detectMime(buffer, '', expectedMime);
  return result.detectedMime === expectedMime || 
         (result.method === 'magic_bytes' && result.confidence >= 0.9);
}

/**
 * Validate that file content matches its claimed type
 */
export function validateMimeMatch(
  buffer: Buffer,
  filename: string,
  claimedMime: string
): { valid: boolean; message?: string } {
  const detected = detectMime(buffer, filename, claimedMime);
  
  if (detected.mismatch) {
    console.warn(`[MimeDetector] MIME mismatch: ${detected.mismatchDetails}`);
    return {
      valid: false,
      message: detected.mismatchDetails,
    };
  }
  
  return { valid: true };
}

export const mimeDetector = {
  detectMime,
  quickCheckMime,
  validateMimeMatch,
  EXTENSION_TO_MIME,
};
