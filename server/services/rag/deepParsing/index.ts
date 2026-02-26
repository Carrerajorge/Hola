/**
 * Deep Parsing — Parser Factory
 *
 * Selects the appropriate parser based on MIME type.
 * Each parser returns a ParsedStructure with hierarchy, tables, and figures.
 */

import type { DocumentParser, ParsedStructure } from "./types";
import { detectDocumentType } from "./types";
import { parsePdf } from "./pdfStructuredParser";
import { parseDocx } from "./docxStructuredParser";
import { parseSpreadsheet } from "./spreadsheetParser";
import { parseImage } from "./imageParser";
import { parseText } from "./textParser";

const MIME_MAP: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
    "application/vnd.ms-excel": "spreadsheet",
    "text/csv": "spreadsheet",
    "image/png": "image",
    "image/jpeg": "image",
    "image/webp": "image",
    "image/gif": "image",
    "text/plain": "text",
    "text/markdown": "text",
    "text/html": "text",
    "application/json": "text",
};

function getParserType(mimeType: string): string {
    return MIME_MAP[mimeType] || "text";
}

export function selectParser(mimeType: string): DocumentParser {
    const type = getParserType(mimeType);
    switch (type) {
        case "pdf": return { name: "pdf", parse: parsePdf };
        case "docx": return { name: "docx", parse: parseDocx };
        case "spreadsheet": return { name: "spreadsheet", parse: parseSpreadsheet };
        case "image": return { name: "image", parse: parseImage };
        default: return { name: "text", parse: parseText };
    }
}

export async function deepParse(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
): Promise<ParsedStructure> {
    const parser = selectParser(mimeType);
    return parser.parse(buffer, mimeType, fileName);
}

export { detectDocumentType } from "./types";
export type { ParsedStructure, Section, ExtractedTable, ExtractedFigure, DocumentType, DocumentMetadata, DocumentParser } from "./types";
