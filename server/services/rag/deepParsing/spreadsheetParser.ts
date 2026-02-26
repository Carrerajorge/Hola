import type { ParsedStructure, Section, ExtractedTable } from "./types";
import { detectLanguage } from "./parsingUtils";

/**
 * Spreadsheet / CSV parser.
 *
 * Attempts to use `xlsx` (SheetJS) to parse real Excel/XLSX buffers.
 * If xlsx fails (e.g., the buffer is not a valid spreadsheet), falls back
 * to CSV parsing (split by commas / newlines).
 *
 * Each sheet becomes a section. Data is converted into ExtractedTable
 * entries with headers and rows. Always sets `hasTables: true` in metadata
 * when data is present.
 */
export async function parseSpreadsheet(
    buffer: Buffer,
    _mimeType: string,
    fileName: string,
): Promise<ParsedStructure> {
    const sections: Section[] = [];
    const tables: ExtractedTable[] = [];
    let rawText = "";

    // Handle empty buffer
    if (buffer.length === 0) {
        return {
            sections: [],
            tables: [],
            figures: [],
            rawText: "",
            metadata: {
                documentType: "table",
                language: "unknown",
                pageCount: 1,
                hasImages: false,
                hasTables: false,
                wordCount: 0,
            },
        };
    }

    let parsed = false;

    // Try xlsx for real spreadsheet files
    try {
        const XLSX = await import("xlsx");
        const read = (XLSX as any).read ?? (XLSX as any).default?.read;
        const utils = (XLSX as any).utils ?? (XLSX as any).default?.utils;
        if (!read || !utils) throw new Error("xlsx read/utils not found");

        const workbook = read(buffer, { type: "buffer" });
        const sheetNames: string[] = workbook.SheetNames ?? [];

        for (const sheetName of sheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const jsonData: string[][] = utils.sheet_to_json(sheet, { header: 1 });

            if (jsonData.length === 0) continue;

            const headers = jsonData[0].map(String);
            const rows = jsonData.slice(1).map((row: any[]) => row.map(String));
            const sheetText = jsonData.map((row: any[]) => row.join("\t")).join("\n");

            rawText += (rawText ? "\n\n" : "") + sheetText;

            sections.push({
                title: sheetName,
                level: 1,
                content: sheetText,
                pageNumber: 1,
                children: [],
                type: "table",
            });

            tables.push({
                headers,
                rows,
                pageNumber: 1,
                naturalLanguageDescription: `Sheet "${sheetName}" with columns: ${headers.join(", ")}. Contains ${rows.length} data rows.`,
            });
        }
        parsed = true;
    } catch {
        // xlsx unavailable or buffer is not a valid spreadsheet
    }

    // Fallback: CSV parsing
    if (!parsed) {
        const text = buffer.toString("utf-8").trim();
        rawText = text;

        if (text) {
            const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

            if (lines.length > 0) {
                const headers = lines[0].split(",").map((h) => h.trim());
                const rows = lines.slice(1).map((line) =>
                    line.split(",").map((c) => c.trim()),
                );

                sections.push({
                    title: fileName,
                    level: 1,
                    content: text,
                    pageNumber: 1,
                    children: [],
                    type: "table",
                });

                tables.push({
                    headers,
                    rows,
                    pageNumber: 1,
                    naturalLanguageDescription: `CSV data with columns: ${headers.join(", ")}. Contains ${rows.length} data rows.`,
                });
            }
        }
    }

    const wordCount = rawText
        .split(/\s+/)
        .filter(Boolean).length;
    const language = detectLanguage(rawText);

    return {
        sections,
        tables,
        figures: [],
        rawText,
        metadata: {
            documentType: "table",
            language,
            pageCount: 1,
            hasImages: false,
            hasTables: tables.length > 0,
            wordCount,
        },
    };
}
