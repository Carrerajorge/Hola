import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import ExcelJS from "exceljs";
import {
  spreadsheetUploads,
  spreadsheetSheets,
  spreadsheetAnalysisSessions,
  spreadsheetAnalysisOutputs,
  type InsertSpreadsheetUpload,
  type SpreadsheetUpload,
  type InsertSpreadsheetSheet,
  type SpreadsheetSheet,
  type InsertSpreadsheetAnalysisSession,
  type SpreadsheetAnalysisSession,
  type InsertSpreadsheetAnalysisOutput,
  type SpreadsheetAnalysisOutput,
  type SpreadsheetUploadStatus,
} from "@shared/schema";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
];
const PREVIEW_ROW_LIMIT = 100;

export interface SheetInfo {
  name: string;
  sheetIndex: number;
  rowCount: number;
  columnCount: number;
  inferredHeaders: string[];
  columnTypes: ColumnTypeInfo[];
  previewData: any[][];
}

export interface ColumnTypeInfo {
  name: string;
  type: "text" | "number" | "date" | "boolean" | "mixed" | "empty";
  sampleValues?: any[];
  nullCount?: number;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  checksum?: string;
}

export interface ParsedSpreadsheet {
  sheets: SheetInfo[];
}

export function validateSpreadsheetFile(
  buffer: Buffer,
  mimeType: string
): FileValidationResult {
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    };
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: xlsx, xls, csv`,
    };
  }

  const checksum = generateChecksum(buffer);
  return { valid: true, checksum };
}

export function generateChecksum(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function createUpload(
  data: InsertSpreadsheetUpload
): Promise<SpreadsheetUpload> {
  const [upload] = await db
    .insert(spreadsheetUploads)
    .values(data)
    .returning();
  return upload;
}

export async function getUpload(
  id: string
): Promise<SpreadsheetUpload | undefined> {
  const [upload] = await db
    .select()
    .from(spreadsheetUploads)
    .where(eq(spreadsheetUploads.id, id))
    .limit(1);
  return upload;
}

export async function getUserUploads(
  userId: string
): Promise<SpreadsheetUpload[]> {
  return db
    .select()
    .from(spreadsheetUploads)
    .where(eq(spreadsheetUploads.userId, userId))
    .orderBy(desc(spreadsheetUploads.createdAt));
}

export async function updateUploadStatus(
  id: string,
  status: SpreadsheetUploadStatus,
  errorMessage?: string
): Promise<SpreadsheetUpload | undefined> {
  const [updated] = await db
    .update(spreadsheetUploads)
    .set({
      status,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(spreadsheetUploads.id, id))
    .returning();
  return updated;
}

export async function deleteUpload(id: string): Promise<void> {
  await db.delete(spreadsheetUploads).where(eq(spreadsheetUploads.id, id));
}

export async function createSheet(
  data: InsertSpreadsheetSheet
): Promise<SpreadsheetSheet> {
  const [sheet] = await db
    .insert(spreadsheetSheets)
    .values(data)
    .returning();
  return sheet;
}

export async function getSheets(uploadId: string): Promise<SpreadsheetSheet[]> {
  return db
    .select()
    .from(spreadsheetSheets)
    .where(eq(spreadsheetSheets.uploadId, uploadId))
    .orderBy(spreadsheetSheets.sheetIndex);
}

export async function createAnalysisSession(
  data: InsertSpreadsheetAnalysisSession
): Promise<SpreadsheetAnalysisSession> {
  const [session] = await db
    .insert(spreadsheetAnalysisSessions)
    .values(data)
    .returning();
  return session;
}

export async function getAnalysisSession(
  id: string
): Promise<SpreadsheetAnalysisSession | undefined> {
  const [session] = await db
    .select()
    .from(spreadsheetAnalysisSessions)
    .where(eq(spreadsheetAnalysisSessions.id, id))
    .limit(1);
  return session;
}

export async function updateAnalysisSession(
  id: string,
  updates: Partial<SpreadsheetAnalysisSession>
): Promise<SpreadsheetAnalysisSession | undefined> {
  const [updated] = await db
    .update(spreadsheetAnalysisSessions)
    .set(updates)
    .where(eq(spreadsheetAnalysisSessions.id, id))
    .returning();
  return updated;
}

export async function createAnalysisOutput(
  data: InsertSpreadsheetAnalysisOutput
): Promise<SpreadsheetAnalysisOutput> {
  const [output] = await db
    .insert(spreadsheetAnalysisOutputs)
    .values(data)
    .returning();
  return output;
}

export async function getAnalysisOutputs(
  sessionId: string
): Promise<SpreadsheetAnalysisOutput[]> {
  return db
    .select()
    .from(spreadsheetAnalysisOutputs)
    .where(eq(spreadsheetAnalysisOutputs.sessionId, sessionId))
    .orderBy(spreadsheetAnalysisOutputs.order);
}

export async function parseSpreadsheet(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedSpreadsheet> {
  if (mimeType === "text/csv") {
    return parseCsv(buffer);
  }
  return parseExcel(buffer);
}

async function parseExcel(buffer: Buffer): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: SheetInfo[] = [];

  workbook.eachSheet((worksheet, sheetIndex) => {
    const sheetInfo = extractSheetInfo(worksheet, sheetIndex - 1);
    sheets.push(sheetInfo);
  });

  return { sheets };
}

function parseCsv(buffer: Buffer): ParsedSpreadsheet {
  const content = buffer.toString("utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return {
      sheets: [
        {
          name: "Sheet1",
          sheetIndex: 0,
          rowCount: 0,
          columnCount: 0,
          inferredHeaders: [],
          columnTypes: [],
          previewData: [],
        },
      ],
    };
  }

  const data: any[][] = lines.map((line) => parseCsvLine(line));
  const headerInfo = detectHeaders(data);
  const headers = headerInfo.headers;
  const dataStartRow = headerInfo.dataStartRow;

  const dataRows = data.slice(dataStartRow);
  const columnCount = Math.max(...data.map((row) => row.length), 0);
  const previewData = data.slice(0, PREVIEW_ROW_LIMIT);

  const columnTypes = inferColumnTypes(
    dataRows,
    headers.length > 0 ? headers : undefined
  );

  return {
    sheets: [
      {
        name: "Sheet1",
        sheetIndex: 0,
        rowCount: data.length,
        columnCount,
        inferredHeaders: headers,
        columnTypes,
        previewData,
      },
    ],
  };
}

function parseCsvLine(line: string): string[] {
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
      } else if (char === ",") {
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

function extractSheetInfo(
  worksheet: ExcelJS.Worksheet,
  sheetIndex: number
): SheetInfo {
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
  const dataStartRow = headerInfo.dataStartRow;

  const dataRows = compactData.slice(dataStartRow);
  const rowCount = compactData.length;
  const columnCount = Math.max(...compactData.map((row) => row.length), 0);
  const previewData = compactData.slice(0, PREVIEW_ROW_LIMIT);

  const columnTypes = inferColumnTypes(
    dataRows,
    headers.length > 0 ? headers : undefined
  );

  return {
    name: worksheet.name,
    sheetIndex,
    rowCount,
    columnCount,
    inferredHeaders: headers,
    columnTypes,
    previewData,
  };
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
      return (cell.value.richText as any[])
        .map((rt) => rt.text)
        .join("");
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

    const nonEmptyCount = row.filter((cell) => cell !== null && cell !== undefined && cell !== "").length;
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

export function inferColumnTypes(
  data: any[][],
  headers?: string[]
): ColumnTypeInfo[] {
  if (data.length === 0) {
    return [];
  }

  const maxCols = Math.max(...data.map((row) => row.length), 0);
  const result: ColumnTypeInfo[] = [];

  for (let colIdx = 0; colIdx < maxCols; colIdx++) {
    const columnName = headers && headers[colIdx] ? headers[colIdx] : `Column${colIdx + 1}`;
    const values = data.map((row) => row[colIdx]);

    const typeInfo = analyzeColumnType(columnName, values);
    result.push(typeInfo);
  }

  return result;
}

function analyzeColumnType(name: string, values: any[]): ColumnTypeInfo {
  const nonNullValues = values.filter(
    (v) => v !== null && v !== undefined && v !== ""
  );
  const nullCount = values.length - nonNullValues.length;

  if (nonNullValues.length === 0) {
    return {
      name,
      type: "empty",
      sampleValues: [],
      nullCount,
    };
  }

  const typeCounts = {
    number: 0,
    text: 0,
    date: 0,
    boolean: 0,
  };

  for (const value of nonNullValues) {
    const type = detectValueType(value);
    typeCounts[type]++;
  }

  const total = nonNullValues.length;
  const threshold = 0.8;

  let inferredType: "text" | "number" | "date" | "boolean" | "mixed" = "mixed";

  if (typeCounts.number / total >= threshold) {
    inferredType = "number";
  } else if (typeCounts.date / total >= threshold) {
    inferredType = "date";
  } else if (typeCounts.boolean / total >= threshold) {
    inferredType = "boolean";
  } else if (typeCounts.text / total >= threshold) {
    inferredType = "text";
  }

  const sampleValues = nonNullValues.slice(0, 5);

  return {
    name,
    type: inferredType,
    sampleValues,
    nullCount,
  };
}

function detectValueType(value: any): "number" | "text" | "date" | "boolean" {
  if (typeof value === "boolean") {
    return "boolean";
  }

  if (value instanceof Date) {
    return "date";
  }

  if (typeof value === "number" && !isNaN(value)) {
    return "number";
  }

  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();

    if (trimmed === "true" || trimmed === "false" || trimmed === "yes" || trimmed === "no") {
      return "boolean";
    }

    const numValue = Number(value);
    if (!isNaN(numValue) && value.trim() !== "") {
      return "number";
    }

    const dateValue = Date.parse(value);
    if (!isNaN(dateValue) && isLikelyDateString(value)) {
      return "date";
    }

    return "text";
  }

  return "text";
}

function isLikelyDateString(value: string): boolean {
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^\d{1,2}-\d{1,2}-\d{2,4}$/,
    /^\w{3}\s+\d{1,2},?\s+\d{4}$/,
    /^\d{4}\/\d{2}\/\d{2}$/,
  ];

  return datePatterns.some((pattern) => pattern.test(value.trim()));
}

export const spreadsheetAnalyzer = {
  validateSpreadsheetFile,
  generateChecksum,
  createUpload,
  getUpload,
  getUserUploads,
  updateUploadStatus,
  deleteUpload,
  createSheet,
  getSheets,
  createAnalysisSession,
  getAnalysisSession,
  updateAnalysisSession,
  createAnalysisOutput,
  getAnalysisOutputs,
  parseSpreadsheet,
  inferColumnTypes,
};

export default spreadsheetAnalyzer;
