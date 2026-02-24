import type { ParsedStructure } from "./types";
import { parseStructuredText } from "./parsingUtils";

/**
 * DOCX parser.
 *
 * Attempts to use `mammoth` to extract text from real DOCX files.
 * If mammoth fails (e.g., the buffer is not a valid DOCX), falls back to
 * raw UTF-8 text extraction with non-printable character stripping.
 *
 * After text extraction, delegates structural parsing to the shared
 * `parseStructuredText` utility.
 */
export async function parseDocx(
    buffer: Buffer,
    _mimeType: string,
    fileName: string,
): Promise<ParsedStructure> {
    let rawText: string;

    // Try mammoth for real DOCX files
    try {
        const mammoth = await import("mammoth");
        const extractRaw =
            (mammoth as any).extractRawText ??
            (mammoth as any).default?.extractRawText;
        if (!extractRaw) throw new Error("mammoth.extractRawText not found");

        const result = await extractRaw({ buffer });
        rawText = result?.value ?? "";
    } catch {
        // Not a valid DOCX or mammoth unavailable -- treat as raw text
        rawText = buffer
            .toString("utf-8")
            .replace(/[^\x20-\x7E\xA0-\xFF\n\t]/g, " ");
    }

    return parseStructuredText(rawText, fileName);
}
