import type { ParsedStructure } from "./types";

/**
 * Image parser (minimal).
 *
 * Returns a minimal ParsedStructure with figure metadata for the image.
 * Does NOT attempt OCR — that will be wired in Task 8.
 * Always sets `hasImages: true`.
 */
export async function parseImage(
    _buffer: Buffer,
    _mimeType: string,
    fileName: string,
): Promise<ParsedStructure> {
    return {
        sections: [
            {
                title: fileName,
                level: 1,
                content: `[Image: ${fileName}]`,
                pageNumber: 1,
                children: [],
                type: "figure",
            },
        ],
        tables: [],
        figures: [
            {
                caption: fileName,
                pageNumber: 1,
                context: `Image file: ${fileName}`,
            },
        ],
        rawText: `[Image: ${fileName}]`,
        metadata: {
            documentType: "generic",
            language: "unknown",
            pageCount: 1,
            hasImages: true,
            hasTables: false,
            wordCount: 0,
        },
    };
}
