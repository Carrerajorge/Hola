import type { ParsedStructure } from "./types";
import { detectDocumentType } from "./types";

export async function parseSpreadsheet(buffer: Buffer, _mimeType: string, fileName: string): Promise<ParsedStructure> {
    const text = buffer.toString("utf-8").replace(/[^\x20-\x7E\n]/g, " ");
    return {
        sections: [{ title: fileName, level: 1, content: text, pageNumber: 1, children: [], type: "table" }],
        tables: [],
        figures: [],
        rawText: text,
        metadata: { documentType: "table", language: "es", pageCount: 1, hasImages: false, hasTables: true, wordCount: text.split(/\s+/).length },
    };
}
