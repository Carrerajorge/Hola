/**
 * File Content Extractor
 * 
 * Extrae contenido de archivos para previsualización con:
 * - Soporte para .doc (Word 97-2003) vía backend
 * - Indicador de progreso
 * - Cache integrado
 * - Detección de tablas
 */

import {
  getCachedPreview,
  setCachedPreview,
  setExtractionProgress,
  extractTablesFromHtml,
  type CachedPreview,
} from "./filePreviewCache";

const WORD_SIZE_LIMIT = 15 * 1024 * 1024;
const EXCEL_SIZE_LIMIT = 10 * 1024 * 1024;
const TEXT_SIZE_LIMIT = 5 * 1024 * 1024;

export interface ExtractionResult {
  content?: string;
  htmlContent?: string;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  error?: string;
}

async function updateProgress(fileId: string, stage: "reading" | "extracting" | "parsing" | "ready" | "error", progress: number, message: string) {
  setExtractionProgress(fileId, { fileId, stage, progress, message });
}

export async function extractWordContent(
  file: File,
  fileId: string
): Promise<ExtractionResult> {
  const cached = getCachedPreview(fileId);
  if (cached?.content || cached?.htmlContent) {
    return {
      content: cached.content,
      htmlContent: cached.htmlContent,
      tables: cached.tables,
    };
  }

  if (file.size > WORD_SIZE_LIMIT) {
    return { error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Límite: ${WORD_SIZE_LIMIT / 1024 / 1024} MB` };
  }

  const isDoc = file.name.toLowerCase().endsWith(".doc") && !file.name.toLowerCase().endsWith(".docx");

  try {
    await updateProgress(fileId, "reading", 10, "Leyendo archivo...");

    const buffer = await file.arrayBuffer();
    
    await updateProgress(fileId, "extracting", 30, "Extrayendo contenido...");

    if (isDoc) {
      const result = await extractDocContent(buffer, fileId);
      if (result.content || result.htmlContent) {
        cacheResult(fileId, file, result);
      }
      return result;
    }

    const mammoth = await import("mammoth");
    await updateProgress(fileId, "parsing", 60, "Procesando documento...");

    const mammothResult = await mammoth.convertToHtml({ arrayBuffer: buffer });
    
    await updateProgress(fileId, "ready", 100, "Completado");

    const tables = extractTablesFromHtml(mammothResult.value);
    const textContent = mammothResult.value.replace(/<[^>]*>/g, "").trim();

    const result: ExtractionResult = {
      content: textContent,
      htmlContent: mammothResult.value,
      tables,
    };

    cacheResult(fileId, file, result);

    console.log("[WordExtractor] Extracted content length:", textContent.length, "tables:", tables.length);

    return result;
  } catch (error) {
    await updateProgress(fileId, "error", 0, error instanceof Error ? error.message : "Error desconocido");
    console.error("[WordExtractor] Error:", error);
    return { error: error instanceof Error ? error.message : "Error al extraer contenido" };
  }
}

async function extractDocContent(buffer: ArrayBuffer, fileId: string): Promise<ExtractionResult> {
  try {
    const formData = new FormData();
    formData.append("file", new Blob([buffer]), "document.doc");

    const response = await fetch("/api/convert/doc", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Error del servidor: ${response.status}`);
    }

    const data = await response.json();
    
    await updateProgress(fileId, "ready", 100, "Completado");

    return {
      content: data.text || data.content,
      htmlContent: data.html || data.htmlContent,
      tables: data.tables || extractTablesFromHtml(data.html || ""),
    };
  } catch (error) {
    console.warn("[DocExtractor] Backend conversion failed, trying fallback:", error);
    
    try {
      const text = await extractTextFromBinary(buffer);
      return { content: text };
    } catch (fallbackError) {
      return { error: "No se pudo extraer el contenido del archivo .doc. Intenta convertirlo a .docx primero." };
    }
  }
}

async function extractTextFromBinary(buffer: ArrayBuffer): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(buffer);
  
  const cleanText = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/[^\x20-\x7E\n\r\táéíóúüñÁÉÍÓÚÜÑ¿¡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanText.length < 50) {
    throw new Error("Could not extract meaningful text");
  }

  return cleanText;
}

export async function extractExcelContent(
  file: File,
  fileId: string
): Promise<ExtractionResult> {
  const cached = getCachedPreview(fileId);
  if (cached?.content) {
    return {
      content: cached.content,
      tables: cached.tables,
    };
  }

  if (file.size > EXCEL_SIZE_LIMIT) {
    return { error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Límite: ${EXCEL_SIZE_LIMIT / 1024 / 1024} MB` };
  }

  try {
    await updateProgress(fileId, "reading", 10, "Leyendo archivo...");

    const buffer = await file.arrayBuffer();
    
    await updateProgress(fileId, "extracting", 30, "Parseando hoja de cálculo...");

    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "array" });

    await updateProgress(fileId, "parsing", 60, "Extrayendo datos...");

    const result: ExtractionResult = {};
    const tables: Array<{ headers: string[]; rows: string[][] }> = [];

    for (const sheetName of workbook.SheetNames.slice(0, 5)) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown as unknown[][];

      if (jsonData.length > 0) {
        const json = jsonData.map(row => 
          (row as unknown[]).map(cell => String(cell ?? ""))
        );
        tables.push({
          headers: json[0] || [],
          rows: json.slice(1, 101),
        });
      }

      if (!result.content) {
        result.content = csv;
      } else {
        result.content += `\n\n--- Hoja: ${sheetName} ---\n\n${csv}`;
      }
    }

    result.tables = tables;

    await updateProgress(fileId, "ready", 100, "Completado");

    cacheResult(fileId, file, result);

    console.log("[ExcelExtractor] Extracted sheets:", workbook.SheetNames.length, "tables:", tables.length);

    return result;
  } catch (error) {
    await updateProgress(fileId, "error", 0, error instanceof Error ? error.message : "Error desconocido");
    console.error("[ExcelExtractor] Error:", error);
    return { error: error instanceof Error ? error.message : "Error al extraer contenido" };
  }
}

export async function extractTextContent(
  file: File,
  fileId: string
): Promise<ExtractionResult> {
  const cached = getCachedPreview(fileId);
  if (cached?.content) {
    return { content: cached.content };
  }

  if (file.size > TEXT_SIZE_LIMIT) {
    return { error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Límite: ${TEXT_SIZE_LIMIT / 1024 / 1024} MB` };
  }

  try {
    await updateProgress(fileId, "reading", 30, "Leyendo archivo...");

    const content = await file.text();

    await updateProgress(fileId, "ready", 100, "Completado");

    cacheResult(fileId, file, { content });

    console.log("[TextExtractor] Extracted content length:", content.length);

    return { content };
  } catch (error) {
    await updateProgress(fileId, "error", 0, error instanceof Error ? error.message : "Error desconocido");
    console.error("[TextExtractor] Error:", error);
    return { error: error instanceof Error ? error.message : "Error al leer archivo" };
  }
}

function cacheResult(fileId: string, file: File, result: ExtractionResult): void {
  const cached: CachedPreview = {
    id: fileId,
    name: file.name,
    mimeType: file.type,
    content: result.content,
    htmlContent: result.htmlContent,
    tables: result.tables,
    extractedAt: Date.now(),
    size: file.size,
  };
  setCachedPreview(cached);
}

export async function extractFileContent(
  file: File,
  fileId: string
): Promise<ExtractionResult> {
  const name = file.name.toLowerCase();
  const type = file.type;

  if (name.endsWith(".docx") || name.endsWith(".doc") || type.includes("word")) {
    return extractWordContent(file, fileId);
  }

  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv") ||
    type.includes("sheet") ||
    type.includes("excel")
  ) {
    return extractExcelContent(file, fileId);
  }

  if (type.startsWith("text/") || name.match(/\.(txt|md|json|csv|log)$/i)) {
    return extractTextContent(file, fileId);
  }

  return { error: "Tipo de archivo no soportado para previsualización" };
}
