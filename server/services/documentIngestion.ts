import ExcelJS from "exceljs";
import mammoth from "mammoth";
import path from "path";
import { createRequire } from "module";

// pdf-parse is CommonJS, use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const PREVIEW_ROW_LIMIT = 100;

export interface DocumentMetadata {
  fileType: 'xlsx' | 'xls' | 'csv' | 'tsv' | 'pdf' | 'docx' | 'pptx' | 'ppt' | 'rtf' | 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff';
  fileName: string;
  fileSize: number;
  encoding?: string;
  pageCount?: number;
  sheetCount?: number;
}

export interface DocumentSheet {
  name: string;
  index: number;
  rowCount: number;
  columnCount: number;
  headers: string[];
  previewData: any[][];
  isTabular: boolean;
}

export interface ParsedDocument {
  metadata: DocumentMetadata;
  sheets: DocumentSheet[];
}

const MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number }[]> = {
  xlsx: [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // ZIP (OOXML)
  ],
  xls: [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }, // OLE2
  ],
  pdf: [
    { bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
  docx: [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // ZIP (OOXML)
  ],
};

const MIME_TYPE_MAP: Record<string, DocumentMetadata['fileType']> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function checkMagicBytes(buffer: Buffer, expected: { bytes: number[]; offset?: number }[]): boolean {
  for (const pattern of expected) {
    const offset = pattern.offset || 0;
    if (buffer.length < offset + pattern.bytes.length) continue;
    
    let matches = true;
    for (let i = 0; i < pattern.bytes.length; i++) {
      if (buffer[offset + i] !== pattern.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isTextFile(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) {
      return false;
    }
  }
  return true;
}

function detectDelimiter(buffer: Buffer): 'csv' | 'tsv' | null {
  const sample = buffer.toString('utf-8', 0, Math.min(buffer.length, 4096));
  const lines = sample.split(/\r?\n/).slice(0, 5);
  
  let tabCount = 0;
  let commaCount = 0;
  
  for (const line of lines) {
    tabCount += (line.match(/\t/g) || []).length;
    commaCount += (line.match(/,/g) || []).length;
  }
  
  if (tabCount > commaCount && tabCount > 0) return 'tsv';
  if (commaCount > 0) return 'csv';
  return null;
}

export async function detectFileType(
  buffer: Buffer,
  mimeType: string
): Promise<DocumentMetadata['fileType'] | null> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const mimeFileType = MIME_TYPE_MAP[mimeType];

  if (checkMagicBytes(buffer, MAGIC_BYTES.pdf)) {
    if (mimeFileType && mimeFileType !== 'pdf') {
      throw new Error('MIME type mismatch: file appears to be PDF');
    }
    return 'pdf';
  }

  if (checkMagicBytes(buffer, MAGIC_BYTES.xls)) {
    if (mimeFileType && mimeFileType !== 'xls') {
      throw new Error('MIME type mismatch: file appears to be XLS');
    }
    return 'xls';
  }

  if (checkMagicBytes(buffer, MAGIC_BYTES.xlsx)) {
    if (mimeFileType === 'xlsx') return 'xlsx';
    if (mimeFileType === 'docx') return 'docx';
    
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      return 'xlsx';
    } catch {
      try {
        await mammoth.extractRawText({ buffer });
        return 'docx';
      } catch {
        return mimeFileType || null;
      }
    }
  }

  if (isTextFile(buffer)) {
    const delimiter = detectDelimiter(buffer);
    if (mimeFileType === 'tsv' || delimiter === 'tsv') return 'tsv';
    if (mimeFileType === 'csv' || delimiter === 'csv') return 'csv';
    return 'csv';
  }

  return mimeFileType || null;
}

function sanitizeFileName(fileName: string): string {
  const basename = path.basename(fileName);
  return basename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 255);
}

export async function extractMetadata(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<DocumentMetadata> {
  const fileType = await detectFileType(buffer, mimeType);
  
  if (!fileType) {
    throw new Error('Unable to detect file type');
  }

  const metadata: DocumentMetadata = {
    fileType,
    fileName: sanitizeFileName(fileName),
    fileSize: buffer.length,
  };

  switch (fileType) {
    case 'xlsx':
    case 'xls': {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      metadata.sheetCount = workbook.worksheets.length;
      break;
    }
    case 'pdf': {
      const pdfData = await pdfParse(buffer);
      metadata.pageCount = pdfData.numpages;
      break;
    }
    case 'csv':
    case 'tsv': {
      metadata.encoding = 'utf-8';
      metadata.sheetCount = 1;
      break;
    }
    case 'docx': {
      metadata.encoding = 'utf-8';
      break;
    }
  }

  return metadata;
}

async function parseExcel(buffer: Buffer): Promise<DocumentSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: DocumentSheet[] = [];

  workbook.eachSheet((worksheet, sheetIndex) => {
    const data: any[][] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const rowData: any[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        rowData[colNumber - 1] = getCellValue(cell);
      });
      data[rowNumber - 1] = rowData;
    });

    const compactData = data.filter((row) => row && row.length > 0);
    const headerInfo = detectHeaders(compactData);
    const headers = headerInfo.headers;
    
    const rowCount = compactData.length;
    const columnCount = Math.max(...compactData.map((row) => row.length), 0);
    const previewData = compactData.slice(0, PREVIEW_ROW_LIMIT);

    sheets.push({
      name: worksheet.name,
      index: sheetIndex - 1,
      rowCount,
      columnCount,
      headers,
      previewData,
      isTabular: true,
    });
  });

  return sheets;
}

function getCellValue(cell: ExcelJS.Cell): any {
  if (cell.value === null || cell.value === undefined) {
    return null;
  }

  if (typeof cell.value === "object") {
    if ("result" in cell.value && cell.value.result !== undefined) {
      return cell.value.result;
    }
    if ("richText" in cell.value) {
      return (cell.value.richText as any[]).map((rt) => rt.text).join("");
    }
    if (cell.value instanceof Date) {
      return cell.value;
    }
    if ("hyperlink" in cell.value) {
      return (cell.value as any).text || (cell.value as any).hyperlink;
    }
  }

  return cell.value;
}

function parseDelimitedText(buffer: Buffer, delimiter: string): DocumentSheet[] {
  const content = buffer.toString("utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return [{
      name: "Sheet1",
      index: 0,
      rowCount: 0,
      columnCount: 0,
      headers: [],
      previewData: [],
      isTabular: true,
    }];
  }

  const data: any[][] = lines.map((line) => parseDelimitedLine(line, delimiter));
  const headerInfo = detectHeaders(data);
  const headers = headerInfo.headers;

  const columnCount = Math.max(...data.map((row) => row.length), 0);
  const previewData = data.slice(0, PREVIEW_ROW_LIMIT);

  return [{
    name: "Sheet1",
    index: 0,
    rowCount: data.length,
    columnCount,
    headers,
    previewData,
    isTabular: true,
  }];
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map(cell => cell.trim());
  }
  
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());
  return result;
}

interface HeaderDetectionResult {
  headers: string[];
  dataStartRow: number;
}

function detectHeaders(data: any[][]): HeaderDetectionResult {
  if (data.length === 0) {
    return { headers: [], dataStartRow: 0 };
  }

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const nonEmptyCount = row.filter(
      (cell) => cell !== null && cell !== undefined && cell !== ""
    ).length;
    if (nonEmptyCount === 0) continue;

    const allStrings = row.every(
      (cell) =>
        cell === null ||
        cell === undefined ||
        cell === "" ||
        typeof cell === "string"
    );
    const hasReasonableLengths = row.every(
      (cell) =>
        cell === null ||
        cell === undefined ||
        cell === "" ||
        (typeof cell === "string" && cell.length < 100)
    );

    if (allStrings && hasReasonableLengths && nonEmptyCount >= 2) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return { headers: [], dataStartRow: 0 };
  }

  const headers = data[headerRowIndex].map((cell, idx) => {
    if (cell === null || cell === undefined || cell === "") {
      return `Column${idx + 1}`;
    }
    return String(cell);
  });

  return {
    headers,
    dataStartRow: headerRowIndex + 1,
  };
}

async function parsePdf(buffer: Buffer): Promise<DocumentSheet[]> {
  const pdfData = await pdfParse(buffer);
  const text = pdfData.text || "";
  const numPages = pdfData.numpages || 1;

  const pages = text.split(/\f/).filter((page: string) => page.trim().length > 0);
  
  const sheets: DocumentSheet[] = [];

  if (pages.length === 0 && text.trim()) {
    const lines = text.split(/\r?\n/).filter((line: string) => line.trim());
    const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);
    
    sheets.push({
      name: "Page 1",
      index: 0,
      rowCount: lines.length,
      columnCount: 1,
      headers: ["Content"],
      previewData: previewLines.map((line: string) => [line]),
      isTabular: false,
    });
  } else {
    for (let i = 0; i < Math.max(pages.length, numPages); i++) {
      const pageText = pages[i] || "";
      const lines = pageText.split(/\r?\n/).filter((line: string) => line.trim());
      const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);

      sheets.push({
        name: `Page ${i + 1}`,
        index: i,
        rowCount: lines.length,
        columnCount: 1,
        headers: ["Content"],
        previewData: previewLines.map((line: string) => [line]),
        isTabular: false,
      });
    }
  }

  if (sheets.length === 0) {
    sheets.push({
      name: "Page 1",
      index: 0,
      rowCount: 0,
      columnCount: 1,
      headers: ["Content"],
      previewData: [],
      isTabular: false,
    });
  }

  return sheets;
}

async function parseDocx(buffer: Buffer): Promise<DocumentSheet[]> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || "";

  const headingPattern = /^(?:#{1,6}\s+.+|[A-Z][A-Z\s]{2,}[A-Z]$|(?:\d+\.)+\s+.+)/m;
  
  let sections: string[] = [];
  
  const paragraphs = text.split(/\n{2,}/);
  
  if (paragraphs.some(p => headingPattern.test(p.trim()))) {
    let currentSection = "";
    for (const para of paragraphs) {
      if (headingPattern.test(para.trim()) && currentSection.trim()) {
        sections.push(currentSection.trim());
        currentSection = para;
      } else {
        currentSection += "\n\n" + para;
      }
    }
    if (currentSection.trim()) {
      sections.push(currentSection.trim());
    }
  }
  
  if (sections.length === 0) {
    sections = paragraphs.filter(p => p.trim());
  }

  if (sections.length === 0) {
    return [{
      name: "Document",
      index: 0,
      rowCount: 0,
      columnCount: 1,
      headers: ["Content"],
      previewData: [],
      isTabular: false,
    }];
  }

  if (sections.length === 1 || sections.length > 50) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);
    
    return [{
      name: "Document",
      index: 0,
      rowCount: lines.length,
      columnCount: 1,
      headers: ["Content"],
      previewData: previewLines.map(line => [line]),
      isTabular: false,
    }];
  }

  return sections.map((section, index) => {
    const lines = section.split(/\r?\n/).filter(line => line.trim());
    const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);
    const firstLine = lines[0] || `Section ${index + 1}`;
    const sectionName = firstLine.length > 50 
      ? firstLine.substring(0, 47) + "..."
      : firstLine;

    return {
      name: sectionName,
      index,
      rowCount: lines.length,
      columnCount: 1,
      headers: ["Content"],
      previewData: previewLines.map(line => [line]),
      isTabular: false,
    };
  });
}

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  fileName: string = "document"
): Promise<ParsedDocument> {
  const metadata = await extractMetadata(buffer, mimeType, fileName);
  
  let sheets: DocumentSheet[];

  switch (metadata.fileType) {
    case 'xlsx':
    case 'xls':
      sheets = await parseExcel(buffer);
      break;
    case 'csv':
      sheets = parseDelimitedText(buffer, ',');
      break;
    case 'tsv':
      sheets = parseDelimitedText(buffer, '\t');
      break;
    case 'pdf':
      sheets = await parsePdf(buffer);
      break;
    case 'docx':
      sheets = await parseDocx(buffer);
      break;
    default:
      throw new Error(`Unsupported file type: ${metadata.fileType}`);
  }

  return {
    metadata,
    sheets,
  };
}

export function validateFileSize(buffer: Buffer): { valid: boolean; error?: string } {
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    };
  }
  return { valid: true };
}

export const documentIngestion = {
  detectFileType,
  extractMetadata,
  parseDocument,
  validateFileSize,
  sanitizeFileName,
  MAX_FILE_SIZE,
  PREVIEW_ROW_LIMIT,
};

export default documentIngestion;
