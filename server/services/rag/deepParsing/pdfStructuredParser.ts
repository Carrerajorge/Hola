import type { ParsedStructure } from "./types";
import { parseStructuredText } from "./parsingUtils";

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function parsePdf(
    buffer: Buffer,
    _mimeType: string,
    fileName: string,
): Promise<ParsedStructure> {
    let rawText: string;
    let pageCount = 1;

    // Try pdf-parse for real PDFs; fall back to raw text for non-PDF buffers
    try {
        const pdfParseMod = await import("pdf-parse");
        const PDFParseClass =
            (pdfParseMod as any).PDFParse ??
            (pdfParseMod as any).default?.PDFParse;
        if (!PDFParseClass) throw new Error("PDFParse class not found");

        const parser = new PDFParseClass({ data: new Uint8Array(buffer) });
        const textResult = await parser.getText();
        rawText = textResult?.text ?? "";
        try {
            const info = await parser.getInfo();
            pageCount = (info as any).numPages ?? 1;
        } catch {
            // info extraction is optional
        }
        await parser.destroy().catch(() => {});
    } catch {
        // Not a valid PDF or pdf-parse unavailable -- treat as raw text
        rawText = buffer
            .toString("utf-8")
            .replace(/[^\x20-\x7E\xA0-\xFF\n\t]/g, " ");
    }

    // Delegate structural parsing to shared utility
    const result = parseStructuredText(rawText, fileName, pageCount);

    // For PDF, if the result is empty, return a minimal section with the filename
    if (!rawText.trim()) {
        return {
            sections: [
                {
                    title: fileName,
                    level: 1,
                    content: "",
                    pageNumber: 1,
                    children: [],
                    type: "paragraph",
                },
            ],
            tables: [],
            figures: [],
            rawText: "",
            metadata: {
                documentType: "generic",
                language: "unknown",
                pageCount,
                hasImages: false,
                hasTables: false,
                wordCount: 0,
            },
        };
    }

    return result;
}
