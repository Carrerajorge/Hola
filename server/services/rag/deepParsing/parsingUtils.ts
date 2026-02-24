/**
 * Shared parsing utilities for deep document parsing.
 *
 * Extracted from pdfStructuredParser so that textParser, docxParser, and
 * others can reuse heading detection, section tree building, table/figure
 * extraction, and language detection without duplication.
 */

import type { Section, ExtractedTable, ExtractedFigure, ParsedStructure } from "./types";
import { detectDocumentType } from "./types";

// ---------------------------------------------------------------------------
// Heading patterns
// ---------------------------------------------------------------------------
const HEADING_PATTERNS: {
    regex: RegExp;
    levelFn: (m: RegExpMatchArray) => number;
    titleFn: (m: RegExpMatchArray) => string;
}[] = [
    {
        regex: /^(#{1,6})\s+(.+)$/gm,
        levelFn: (m) => m[1].length,
        titleFn: (m) => m[2].trim(),
    },
    {
        regex: /^([A-Z][A-Z\s]{3,})$/gm,
        levelFn: () => 1,
        titleFn: (m) => m[1].trim(),
    },
    {
        regex: /^(\d+(?:\.\d+)*)\s+([A-Z].+)$/gm,
        levelFn: (m) => m[1].split(".").length,
        titleFn: (m) => `${m[1]} ${m[2].trim()}`,
    },
];

// ---------------------------------------------------------------------------
// Table extraction
// ---------------------------------------------------------------------------
const TABLE_REGEX = /\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)+)/g;

export function extractTables(text: string, pageNumber: number): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    TABLE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TABLE_REGEX.exec(text)) !== null) {
        const headerLine = match[1];
        const headers = headerLine
            .split("|")
            .map((h) => h.trim())
            .filter(Boolean);
        const rowLines = match[2].trim().split("\n");
        const rows = rowLines.map((line) =>
            line
                .split("|")
                .map((c) => c.trim())
                .filter(Boolean),
        );
        tables.push({
            headers,
            rows,
            pageNumber,
            naturalLanguageDescription: `Table with columns: ${headers.join(", ")}. Contains ${rows.length} rows.`,
        });
    }
    return tables;
}

// ---------------------------------------------------------------------------
// Figure detection
// ---------------------------------------------------------------------------
const FIGURE_REGEX =
    /(?:Figure|Fig\.?|Imagen|Figura)\s*(\d+)[.:]\s*(.+)/gi;

export function extractFigures(text: string, pageNumber: number): ExtractedFigure[] {
    const figures: ExtractedFigure[] = [];
    FIGURE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FIGURE_REGEX.exec(text)) !== null) {
        figures.push({
            caption: match[2].trim(),
            pageNumber,
            context: text.slice(
                Math.max(0, match.index - 100),
                match.index + match[0].length + 100,
            ),
        });
    }
    return figures;
}

// ---------------------------------------------------------------------------
// Heading extraction
// ---------------------------------------------------------------------------
export interface RawHeading {
    title: string;
    level: number;
    position: number;
    matchLength: number;
}

export function findHeadings(text: string): RawHeading[] {
    const headings: RawHeading[] = [];
    const seen = new Set<number>(); // Avoid duplicate positions from multiple patterns

    for (const { regex, levelFn, titleFn } of HEADING_PATTERNS) {
        regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(text)) !== null) {
            if (!seen.has(m.index)) {
                seen.add(m.index);
                headings.push({
                    title: titleFn(m),
                    level: levelFn(m),
                    position: m.index,
                    matchLength: m[0].length,
                });
            }
        }
    }

    return headings.sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// Section tree builder
// ---------------------------------------------------------------------------

/**
 * Build a flat list of sections from the text and detected headings.
 *
 * Each section retains its `level` so consumers can reconstruct a tree
 * hierarchy if needed, but the returned array is flat — this makes
 * downstream chunking and retrieval simpler.
 */
export function buildSectionTree(
    text: string,
    headings: RawHeading[],
): Section[] {
    if (headings.length === 0) {
        return [
            {
                title: "",
                level: 1,
                content: text.trim(),
                pageNumber: 1,
                children: [],
                type: "paragraph",
            },
        ];
    }

    const sections: Section[] = [];

    // If there is text before the first heading, create a paragraph section
    const preamble = text.slice(0, headings[0].position).trim();
    if (preamble) {
        sections.push({
            title: "",
            level: 0,
            content: preamble,
            pageNumber: 1,
            children: [],
            type: "paragraph",
        });
    }

    for (let i = 0; i < headings.length; i++) {
        const contentStart = headings[i].position + headings[i].matchLength;
        const contentEnd =
            i + 1 < headings.length ? headings[i + 1].position : text.length;
        const content = text.slice(contentStart, contentEnd).trim();

        sections.push({
            title: headings[i].title,
            level: headings[i].level,
            content,
            pageNumber: 1,
            children: [],
            type: "heading",
        });
    }

    return sections;
}

// ---------------------------------------------------------------------------
// Language detection (simple heuristic)
// ---------------------------------------------------------------------------
const SPANISH_MARKERS =
    /\b(el|la|los|las|de|del|en|con|que|por|para|una|uno|es|son|como|este|esta)\b/gi;

export function detectLanguage(text: string): string {
    const spanishCount = (text.match(SPANISH_MARKERS) || []).length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount === 0) return "unknown";
    return spanishCount / wordCount > 0.05 ? "es" : "en";
}

// ---------------------------------------------------------------------------
// Full structural parse from raw text
// ---------------------------------------------------------------------------

/**
 * Perform full structural parsing on raw text: headings, sections, tables,
 * figures, language detection, document type classification.
 *
 * This is the shared core used by textParser, docxParser, and (after
 * text extraction) pdfParser.
 */
export function parseStructuredText(
    rawText: string,
    fileName: string,
    pageCount: number = 1,
): ParsedStructure {
    // Handle empty content
    if (!rawText.trim()) {
        return {
            sections: [],
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

    const headings = findHeadings(rawText);
    const sections = buildSectionTree(rawText, headings);
    const tables = extractTables(rawText, 1);
    const figures = extractFigures(rawText, 1);
    const documentType = detectDocumentType(rawText);
    const language = detectLanguage(rawText);
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;

    return {
        sections,
        tables,
        figures,
        rawText,
        metadata: {
            documentType,
            language,
            pageCount,
            hasImages: figures.length > 0,
            hasTables: tables.length > 0,
            wordCount,
            title: sections.find((s) => s.type === "heading")?.title || fileName,
        },
    };
}
