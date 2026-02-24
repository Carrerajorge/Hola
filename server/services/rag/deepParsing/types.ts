/**
 * Deep Parsing Types — inspired by RAGFlow's DeepDoc
 *
 * Defines the structured output of document parsing: sections with hierarchy,
 * extracted tables with NL descriptions, and detected figures.
 */

export interface ParsedStructure {
    sections: Section[];
    tables: ExtractedTable[];
    figures: ExtractedFigure[];
    rawText: string;
    metadata: DocumentMetadata;
}

export interface Section {
    title: string;
    level: number;
    content: string;
    pageNumber: number;
    children: Section[];
    type: "heading" | "paragraph" | "list" | "code" | "table" | "figure";
}

export interface ExtractedTable {
    headers: string[];
    rows: string[][];
    caption?: string;
    pageNumber: number;
    naturalLanguageDescription: string;
}

export interface ExtractedFigure {
    caption?: string;
    altText?: string;
    pageNumber: number;
    context: string;
}

export type DocumentType = "paper" | "legal" | "manual" | "table" | "generic";

export interface DocumentMetadata {
    documentType: DocumentType;
    language: string;
    pageCount: number;
    hasImages: boolean;
    hasTables: boolean;
    wordCount: number;
    title?: string;
}

export interface DocumentParser {
    name: string;
    parse(buffer: Buffer, mimeType: string, fileName: string): Promise<ParsedStructure>;
}

// ---------------------------------------------------------------------------
// Document type auto-detection from content
// ---------------------------------------------------------------------------

const PAPER_PATTERNS = [
    /\babstract\b/i,
    /\breferences\b/i,
    /\bmethodology\b/i,
    /\bconclusion\b/i,
    /\bintroduction\b/i,
    /\brelated\s+work\b/i,
    /\bet\s+al\b/i,
];

const LEGAL_PATTERNS = [
    /\bart[ií]culo\s+\d/i,
    /\bcl[aá]usula\b/i,
    /\bley\s+\d/i,
    /\bdisposici[oó]n/i,
    /\btribunal\b/i,
    /\bcontrato\b/i,
    /\bsection\s+\d+\.\d+/i,
];

const MANUAL_PATTERNS = [
    /\bpaso\s+\d/i,
    /\bstep\s+\d/i,
    /\bprocedimiento\b/i,
    /\bprocedure\b/i,
    /\bwarning\b/i,
    /\bcaution\b/i,
    /\bnote:\s/i,
    /\bprerequisites?\b/i,
];

export function detectDocumentType(text: string): DocumentType {
    const paperScore = PAPER_PATTERNS.filter((p) => p.test(text)).length;
    const legalScore = LEGAL_PATTERNS.filter((p) => p.test(text)).length;
    const manualScore = MANUAL_PATTERNS.filter((p) => p.test(text)).length;

    // Table-heavy: count markdown tables
    const tableMatches = text.match(/\|[^\n]+\|(?:\n\|[^\n]+\|)+/g) || [];
    const tableRatio = tableMatches.join("").length / (text.length || 1);

    if (tableRatio > 0.3) return "table";
    if (paperScore >= 2) return "paper";
    if (legalScore >= 2) return "legal";
    if (manualScore >= 2) return "manual";
    return "generic";
}
