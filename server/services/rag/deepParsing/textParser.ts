import type { ParsedStructure } from "./types";
import { parseStructuredText } from "./parsingUtils";

/**
 * Text / Markdown parser.
 *
 * Delegates all structural parsing (heading detection, section tree building,
 * table extraction, figure detection, language detection, document type
 * classification) to the shared `parseStructuredText` utility.
 */
export async function parseText(
    buffer: Buffer,
    _mimeType: string,
    fileName: string,
): Promise<ParsedStructure> {
    const rawText = buffer.toString("utf-8");
    return parseStructuredText(rawText, fileName);
}
