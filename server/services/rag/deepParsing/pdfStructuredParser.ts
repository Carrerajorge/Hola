import type { ParsedStructure } from "./types";
import { detectDocumentType } from "./types";

export async function parsePdf(buffer: Buffer, _mimeType: string, fileName: string): Promise<ParsedStructure> {
    // Stub — will be fully implemented in Task 3
    const text = buffer.toString("utf-8").replace(/[^\x20-\x7E\n]/g, " ");
    return {
        sections: [{ title: fileName, level: 1, content: text, pageNumber: 1, children: [], type: "paragraph" }],
        tables: [],
        figures: [],
        rawText: text,
        metadata: { documentType: detectDocumentType(text), language: "es", pageCount: 1, hasImages: false, hasTables: false, wordCount: text.split(/\s+/).length },
    };
}
