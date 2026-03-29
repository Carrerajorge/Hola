/**
 * File Extraction Worker
 * 
 * Web Worker para extraer contenido de archivos sin bloquear el hilo principal.
 * Maneja Word, Excel, PDF y texto.
 */

// @ts-ignore - Worker context
self.importScripts("https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js");
// @ts-ignore
self.importScripts("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");

interface WorkerMessage {
  type: "extract" | "cancel";
  fileId: string;
  file?: ArrayBuffer;
  fileName: string;
  mimeType: string;
}

interface ExtractionProgress {
  fileId: string;
  stage: "reading" | "extracting" | "parsing" | "ready" | "error";
  progress: number;
  message: string;
}

interface ExtractionResult {
  fileId: string;
  content?: string;
  htmlContent?: string;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  error?: string;
}

function sendProgress(data: ExtractionProgress): void {
  // @ts-ignore
  self.postMessage({ type: "progress", ...data });
}

function sendResult(data: ExtractionResult): void {
  // @ts-ignore
  self.postMessage({ type: "result", ...data });
}

async function extractWord(buffer: ArrayBuffer, fileId: string): Promise<ExtractionResult> {
  try {
    sendProgress({ fileId, stage: "extracting", progress: 30, message: "Extrayendo contenido de Word..." });

    // @ts-ignore
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });

    sendProgress({ fileId, stage: "parsing", progress: 70, message: "Procesando HTML..." });

    const htmlContent = result.value;
    const textContent = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    // Extract tables from HTML
    const tables = extractTablesFromHtml(htmlContent);

    sendProgress({ fileId, stage: "ready", progress: 100, message: "Completado" });

    return {
      fileId,
      content: textContent,
      htmlContent,
      tables,
    };
  } catch (error) {
    return {
      fileId,
      error: error instanceof Error ? error.message : "Error extracting Word content",
    };
  }
}

async function extractExcel(buffer: ArrayBuffer, fileId: string): Promise<ExtractionResult> {
  try {
    sendProgress({ fileId, stage: "extracting", progress: 30, message: "Parseando Excel..." });

    // @ts-ignore
    const workbook = XLSX.read(buffer, { type: "array" });

    sendProgress({ fileId, stage: "parsing", progress: 50, message: "Extrayendo hojas..." });

    const tables: Array<{ headers: string[]; rows: string[][] }> = [];
    let allContent = "";

    for (const sheetName of workbook.SheetNames.slice(0, 10)) {
      // @ts-ignore
      const sheet = workbook.Sheets[sheetName];
      // @ts-ignore
      const csv = XLSX.utils.sheet_to_csv(sheet);
      // @ts-ignore
      const json = XLSX.utils.sheet_to_json<string[][]>(sheet, { header: 1 }) as string[][];

      if (json.length > 0) {
        tables.push({
          headers: json[0] || [],
          rows: json.slice(1, 501), // Max 500 rows per sheet
        });
      }

      if (allContent) {
        allContent += `\n\n--- Hoja: ${sheetName} ---\n\n`;
      }
      allContent += csv;
    }

    sendProgress({ fileId, stage: "ready", progress: 100, message: "Completado" });

    return {
      fileId,
      content: allContent,
      tables,
    };
  } catch (error) {
    return {
      fileId,
      error: error instanceof Error ? error.message : "Error extracting Excel content",
    };
  }
}

function extractTablesFromHtml(html: string): Array<{ headers: string[]; rows: string[][] }> {
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  
  // Simple regex-based table extraction (no DOM in worker)
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableContent = tableMatch[1];
    
    // Extract rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: string[][] = [];
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const rowContent = rowMatch[1];
      
      // Extract cells
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellContent = cellMatch[1]
          .replace(/<[^>]*>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .trim();
        cells.push(cellContent);
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length > 0) {
      tables.push({
        headers: rows[0],
        rows: rows.slice(1),
      });
    }
  }

  return tables;
}

async function extractText(buffer: ArrayBuffer, fileId: string): Promise<ExtractionResult> {
  try {
    sendProgress({ fileId, stage: "reading", progress: 50, message: "Leyendo archivo de texto..." });

    const decoder = new TextDecoder("utf-8");
    const content = decoder.decode(buffer);

    sendProgress({ fileId, stage: "ready", progress: 100, message: "Completado" });

    return {
      fileId,
      content,
    };
  } catch (error) {
    return {
      fileId,
      error: error instanceof Error ? error.message : "Error reading text file",
    };
  }
}

// Message handler
// @ts-ignore
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, fileId, file, fileName, mimeType } = event.data;

  if (type === "cancel") {
    // Handle cancellation if needed
    return;
  }

  if (type === "extract" && file) {
    sendProgress({ fileId, stage: "reading", progress: 10, message: "Iniciando extracción..." });

    const ext = fileName.toLowerCase().split(".").pop() || "";
    let result: ExtractionResult;

    if (ext === "docx" || mimeType.includes("word")) {
      result = await extractWord(file, fileId);
    } else if (ext === "xlsx" || ext === "xls" || ext === "csv" || mimeType.includes("sheet") || mimeType.includes("excel")) {
      result = await extractExcel(file, fileId);
    } else {
      result = await extractText(file, fileId);
    }

    sendResult(result);
  }
};

// @ts-ignore
self.postMessage({ type: "ready" });
