import type { ParsedStructure, Section, ExtractedTable, ExtractedFigure } from "./types";
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

function extractTables(text: string, pageNumber: number): ExtractedTable[] {
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

function extractFigures(text: string, pageNumber: number): ExtractedFigure[] {
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
interface RawHeading {
    title: string;
    level: number;
    position: number;
    matchLength: number;
}

function findHeadings(text: string): RawHeading[] {
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
function buildSectionTree(
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

    return nestSections(sections);
}

function nestSections(flat: Section[]): Section[] {
    const root: Section[] = [];
    const stack: Section[] = [];

    for (const section of flat) {
        // Pop sections from the stack that are at the same level or deeper
        while (
            stack.length > 0 &&
            stack[stack.length - 1].level >= section.level
        ) {
            stack.pop();
        }
        if (stack.length === 0) {
            root.push(section);
        } else {
            stack[stack.length - 1].children.push(section);
        }
        stack.push(section);
    }

    return root;
}

// ---------------------------------------------------------------------------
// Language detection (simple heuristic)
// ---------------------------------------------------------------------------
const SPANISH_MARKERS =
    /\b(el|la|los|las|de|del|en|con|que|por|para|una|uno|es|son|como|este|esta)\b/gi;

function detectLanguage(text: string): string {
    const spanishCount = (text.match(SPANISH_MARKERS) || []).length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount === 0) return "unknown";
    return spanishCount / wordCount > 0.05 ? "es" : "en";
}

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

    // Handle empty content
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
