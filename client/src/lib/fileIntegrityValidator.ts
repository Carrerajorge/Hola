/**
 * File Integrity Validator
 * 
 * Valida la integridad de archivos antes de intentar extraer contenido:
 * - Verifica magic bytes/firmas de archivo
 * - Detecta archivos corruptos
 * - Valida estructura de ZIP (docx, xlsx, pptx)
 * - Verifica trailer de PDF
 */

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  detectedType?: string;
  size: number;
  truncated?: boolean;
  corrupt?: boolean;
}

const MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number; mask?: number[] }> = {
  "application/pdf": { bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  "application/zip": { bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK (ZIP, DOCX, XLSX, PPTX)
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { bytes: [0x50, 0x4B, 0x03, 0x04] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { bytes: [0x50, 0x4B, 0x03, 0x04] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { bytes: [0x50, 0x4B, 0x03, 0x04] },
  "application/msword": { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }, // OLE2
  "image/png": { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  "image/jpeg": { bytes: [0xFF, 0xD8, 0xFF] },
  "image/gif": { bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  "image/webp": { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF (WebP container)
  "text/plain": { bytes: [] }, // No magic bytes, always valid
};

const ZIP_INTERNAL_FILES: Record<string, string[]> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "[Content_Types].xml",
    "word/document.xml",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    "[Content_Types].xml",
    "xl/workbook.xml",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    "[Content_Types].xml",
    "ppt/presentation.xml",
  ],
};

function bytesMatch(buffer: Uint8Array, expected: number[], offset = 0, mask?: number[]): boolean {
  if (buffer.length < expected.length + offset) return false;
  
  for (let i = 0; i < expected.length; i++) {
    const bufferByte = buffer[i + offset];
    const expectedByte = expected[i];
    
    if (mask && mask[i]) {
      if ((bufferByte & mask[i]) !== expectedByte) return false;
    } else {
      if (bufferByte !== expectedByte) return false;
    }
  }
  
  return true;
}

async function detectFileType(buffer: Uint8Array, fileName: string): Promise<string | null> {
  // Check by extension first for Office files (they share ZIP magic)
  const ext = fileName.toLowerCase().split(".").pop();
  
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (ext === "doc") return "application/msword";
  if (ext === "xls") return "application/vnd.ms-excel";
  if (ext === "ppt") return "application/vnd.ms-powerpoint";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  
  // Check magic bytes
  for (const [mimeType, config] of Object.entries(MAGIC_BYTES)) {
    if (config.bytes.length === 0) continue;
    if (bytesMatch(buffer, config.bytes, config.offset, config.mask)) {
      return mimeType;
    }
  }
  
  return null;
}

async function validateZipStructure(buffer: Uint8Array, expectedType: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // ZIP files have local file header signature at various positions
    // We need to check if this looks like a valid Office Open XML file
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    
    // Check for ZIP end of central directory record
    let hasEOCD = false;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
      if (
        buffer[i] === 0x50 &&
        buffer[i + 1] === 0x4B &&
        buffer[i + 2] === 0x05 &&
        buffer[i + 3] === 0x06
      ) {
        hasEOCD = true;
        break;
      }
    }
    
    if (!hasEOCD) {
      return { valid: false, error: "Archivo ZIP incompleto o corrupto (firma de fin no encontrada)" };
    }
    
    // Try to use JSZip to validate structure
    const JSZipModule = await import("jszip");
    // @ts-ignore - JSZip has different export patterns
    const JSZip = JSZipModule;
    const zip = await JSZip.loadAsync(buffer);
    
    const requiredFiles = ZIP_INTERNAL_FILES[expectedType] || [];
    const fileNames = Object.keys(zip.files);
    
    for (const required of requiredFiles) {
      const found = fileNames.some(f => f.toLowerCase() === required.toLowerCase());
      if (!found) {
        return { valid: false, error: `Archivo Office incompleto: falta ${required}` };
      }
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Error al validar estructura ZIP: ${error instanceof Error ? error.message : "Error desconocido"}` };
  }
}

async function validatePdfStructure(buffer: Uint8Array): Promise<{ valid: boolean; error?: string }> {
  // Check for PDF header
  if (!bytesMatch(buffer, [0x25, 0x50, 0x44, 0x46])) {
    return { valid: false, error: "No es un archivo PDF válido" };
  }
  
  // Check for EOF marker
  const eofPattern = new TextEncoder().encode("%%EOF");
  let hasEof = false;
  
  // Search in last 1024 bytes
  const searchStart = Math.max(0, buffer.length - 1024);
  for (let i = searchStart; i < buffer.length - 5; i++) {
    if (
      buffer[i] === eofPattern[0] &&
      buffer[i + 1] === eofPattern[1] &&
      buffer[i + 2] === eofPattern[2] &&
      buffer[i + 3] === eofPattern[3] &&
      buffer[i + 4] === eofPattern[4]
    ) {
      hasEof = true;
      break;
    }
  }
  
  if (!hasEof) {
    return { valid: false, error: "PDF incompleto o corrupto (falta marcador de fin)" };
  }
  
  return { valid: true };
}

async function validateOle2Structure(buffer: Uint8Array): Promise<{ valid: boolean; error?: string }> {
  // OLE2 magic bytes: D0 CF 11 E0 A1 B1 1A E1
  if (!bytesMatch(buffer, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) {
    return { valid: false, error: "No es un archivo OLE2 válido (.doc, .xls, .ppt)" };
  }
  
  // Check minimum size (OLE2 header is 512 bytes)
  if (buffer.length < 512) {
    return { valid: false, error: "Archivo OLE2 truncado" };
  }
  
  return { valid: true };
}

export async function validateFileIntegrity(
  file: File,
  buffer?: ArrayBuffer
): Promise<FileValidationResult> {
  const result: FileValidationResult = {
    valid: true,
    size: file.size,
  };
  
  // Get buffer if not provided
  let arrayBuffer = buffer;
  if (!arrayBuffer) {
    try {
      arrayBuffer = await file.slice(0, 65536).arrayBuffer(); // Read first 64KB
    } catch (error) {
      return { valid: false, size: file.size, error: "No se pudo leer el archivo" };
    }
  }
  
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Detect file type
  const detectedType = await detectFileType(uint8Array, file.name);
  result.detectedType = detectedType || undefined;
  
  // Check if file appears truncated
  if (file.size > 0 && uint8Array.length === 0) {
    result.truncated = true;
    result.valid = false;
    result.error = "Archivo vacío o truncado";
    return result;
  }
  
  // Validate based on type
  if (detectedType) {
    // PDF validation
    if (detectedType === "application/pdf") {
      const pdfValidation = await validatePdfStructure(uint8Array);
      if (!pdfValidation.valid) {
        result.valid = false;
        result.corrupt = true;
        result.error = pdfValidation.error;
        return result;
      }
    }
    
    // Office Open XML validation (DOCX, XLSX, PPTX)
    if (detectedType.includes("openxmlformats")) {
      // Need full buffer for ZIP validation
      const fullBuffer = await file.arrayBuffer();
      const zipValidation = await validateZipStructure(new Uint8Array(fullBuffer), detectedType);
      if (!zipValidation.valid) {
        result.valid = false;
        result.corrupt = true;
        result.error = zipValidation.error;
        return result;
      }
    }
    
    // OLE2 validation (DOC, XLS, PPT)
    if (detectedType === "application/msword" || 
        detectedType === "application/vnd.ms-excel" ||
        detectedType === "application/vnd.ms-powerpoint") {
      const oleValidation = await validateOle2Structure(uint8Array);
      if (!oleValidation.valid) {
        result.valid = false;
        result.corrupt = true;
        result.error = oleValidation.error;
        return result;
      }
    }
  }
  
  // Check for common corruption patterns
  // All zeros in header
  let allZeros = true;
  for (let i = 0; i < Math.min(16, uint8Array.length); i++) {
    if (uint8Array[i] !== 0) {
      allZeros = false;
      break;
    }
  }
  
  if (allZeros && uint8Array.length >= 16) {
    result.valid = false;
    result.corrupt = true;
    result.error = "Archivo corrupto: el encabezado contiene solo ceros";
    return result;
  }
  
  return result;
}

export function getQuickValidation(file: File): FileValidationResult {
  // Quick synchronous validation
  const ext = file.name.toLowerCase().split(".").pop();
  
  // Check for obviously wrong extensions
  const extensionMimeMap: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc: "application/msword",
    xls: "application/vnd.ms-excel",
    ppt: "application/vnd.ms-powerpoint",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    md: "text/markdown",
  };
  
  const expectedType = ext ? extensionMimeMap[ext] : undefined;
  
  if (expectedType && file.type && file.type !== "application/octet-stream") {
    // Check if declared type matches extension
    const typeMatches = file.type.includes(ext || "") || 
                        (ext === "jpg" && file.type.includes("jpeg")) ||
                        (ext === "docx" && file.type.includes("word")) ||
                        (ext === "xlsx" && file.type.includes("sheet")) ||
                        (ext === "pptx" && file.type.includes("presentation"));
    
    if (!typeMatches && !file.type.includes("octet-stream")) {
      return {
        valid: true,
        size: file.size,
        detectedType: expectedType,
        error: `El tipo declarado (${file.type}) no coincide con la extensión (.${ext})`,
      };
    }
  }
  
  return {
    valid: true,
    size: file.size,
    detectedType: expectedType,
  };
}
