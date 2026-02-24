import type { ParsedStructure } from "./types";
import { detectDocumentType } from "./types";

export async function parseText(buffer: Buffer, _mimeType: string, fileName: string): Promise<ParsedStructure> {
    const text = buffer.toString("utf-8");
    return {
        sections: [{ title: fileName, level: 1, content: text, pageNumber: 1, children: [], type: "paragraph" }],
        tables: [],
        figures: [],
        rawText: text,
        metadata: { documentType: detectDocumentType(text), language: "es", pageCount: 1, hasImages: false, hasTables: false, wordCount: text.split(/\s+/).length },
    };
}
