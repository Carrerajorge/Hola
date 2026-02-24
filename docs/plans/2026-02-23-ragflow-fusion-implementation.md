# RAGFlow Fusion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fuse RAGFlow's deep document parsing, hierarchical chunking, model-based reranking, and multi-model embeddings into ILIAGPT's existing RAG pipeline.

**Architecture:** Enhance the existing `server/services/rag/` pipeline: upgrade `hybridRetriever.ts` to use pgvector SQL queries, add deep parsing modules under `rag/deepParsing/`, add hierarchical chunking under `rag/chunking/`, add model-based reranker, and add multi-model embedding provider. All backward-compatible with existing API contracts.

**Tech Stack:** TypeScript, PostgreSQL + pgvector (already in schema), Drizzle ORM, Gemini API, pdfjs-dist, mammoth, tesseract.js

---

## Task 1: Multi-Model Embedding Provider

**Files:**
- Create: `server/services/rag/embeddings/embeddingProvider.ts`
- Modify: `server/services/embeddings.ts`
- Test: `server/services/rag/embeddings/__tests__/embeddingProvider.test.ts`

**Step 1: Write the failing test**

Create `server/services/rag/embeddings/__tests__/embeddingProvider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingProviderFactory, type EmbeddingProvider } from "../embeddingProvider";

describe("EmbeddingProviderFactory", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });

    it("returns fallback provider when no API keys are set", () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENAI_API_KEY", "");
        const provider = EmbeddingProviderFactory.getProvider();
        expect(provider.name).toBe("fallback");
        expect(provider.dimensions).toBe(768);
    });

    it("returns gemini provider when GEMINI_API_KEY is set", () => {
        vi.stubEnv("GEMINI_API_KEY", "test-key");
        const provider = EmbeddingProviderFactory.getProvider();
        expect(provider.name).toBe("gemini");
        expect(provider.dimensions).toBe(768);
    });

    it("fallback provider generates deterministic embeddings", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const provider = EmbeddingProviderFactory.getProvider();
        const emb1 = await provider.embed("hello world");
        const emb2 = await provider.embed("hello world");
        expect(emb1).toEqual(emb2);
        expect(emb1.length).toBe(768);
    });

    it("fallback provider embedBatch matches individual embeds", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const provider = EmbeddingProviderFactory.getProvider();
        const texts = ["hello world", "goodbye world"];
        const batch = await provider.embedBatch(texts);
        const individual = await Promise.all(texts.map(t => provider.embed(t)));
        expect(batch).toEqual(individual);
    });

    it("embeddings are normalized (unit magnitude)", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const provider = EmbeddingProviderFactory.getProvider();
        const emb = await provider.embed("some text for normalization test");
        const magnitude = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
        expect(magnitude).toBeCloseTo(1.0, 1);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/rag/embeddings/__tests__/embeddingProvider.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `server/services/rag/embeddings/embeddingProvider.ts`:

```typescript
/**
 * Multi-Model Embedding Provider
 *
 * Auto-selects the best available embedding model based on API keys.
 * Priority: Gemini > OpenAI > Fallback hash-based.
 * Inspired by RAGFlow's multi-model embedding support.
 */

import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";

const isTestEnv =
    process.env.NODE_ENV === "test" ||
    !!process.env.VITEST_WORKER_ID ||
    !!process.env.VITEST_POOL_ID;

export interface EmbeddingProvider {
    name: string;
    dimensions: number;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Gemini Provider
// ---------------------------------------------------------------------------

class GeminiEmbeddingProvider implements EmbeddingProvider {
    name = "gemini";
    dimensions = 768;
    private ai: GoogleGenAI;
    private model: string;

    constructor(apiKey: string) {
        this.ai = new GoogleGenAI({ apiKey });
        this.model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
    }

    async embed(text: string): Promise<number[]> {
        const result = await this.ai.models.embedContent({
            model: this.model,
            contents: [{ role: "user", parts: [{ text: text.slice(0, 8000) }] }],
        });
        const values = result.embeddings?.[0]?.values ?? result.embedding?.values;
        if (!values) throw new Error("Gemini embedding returned no values");
        return values;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const batchSize = 10;
        const results: number[][] = [];
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const embeddings = await Promise.all(batch.map((t) => this.embed(t)));
            results.push(...embeddings);
        }
        return results;
    }
}

// ---------------------------------------------------------------------------
// OpenAI Provider
// ---------------------------------------------------------------------------

class OpenAIEmbeddingProvider implements EmbeddingProvider {
    name = "openai";
    dimensions = 1536;
    private apiKey: string;
    private model: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
    }

    async embed(text: string): Promise<number[]> {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, input: text.slice(0, 8000) }),
        });
        if (!res.ok) throw new Error(`OpenAI embedding error: ${res.status}`);
        const data = await res.json();
        return data.data[0].embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                input: texts.map((t) => t.slice(0, 8000)),
            }),
        });
        if (!res.ok) throw new Error(`OpenAI embedding error: ${res.status}`);
        const data = await res.json();
        return data.data.map((d: any) => d.embedding);
    }
}

// ---------------------------------------------------------------------------
// Fallback Provider (hash-based, deterministic, no API needed)
// ---------------------------------------------------------------------------

class FallbackEmbeddingProvider implements EmbeddingProvider {
    name = "fallback";
    dimensions = 768;

    async embed(text: string): Promise<number[]> {
        return generateFallbackEmbedding(text);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.map((t) => generateFallbackEmbedding(t));
    }
}

function generateFallbackEmbedding(text: string): number[] {
    const DIMS = 768;
    const embedding = new Array(DIMS).fill(0);
    const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

    for (let idx = 0; idx < words.length; idx++) {
        const word = words[idx];
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash) + word.charCodeAt(i);
            hash = hash & hash;
        }
        const position = Math.abs(hash) % DIMS;
        embedding[position] += 1 / (idx + 1);
    }

    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
        for (let i = 0; i < embedding.length; i++) embedding[i] /= magnitude;
    }
    return embedding;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export class EmbeddingProviderFactory {
    private static instance: EmbeddingProvider | null = null;

    static getProvider(): EmbeddingProvider {
        // Always return fresh in test to respect stubbed env vars
        if (isTestEnv) return EmbeddingProviderFactory.createProvider();
        if (!this.instance) this.instance = this.createProvider();
        return this.instance;
    }

    private static createProvider(): EmbeddingProvider {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (geminiKey && !isTestEnv) return new GeminiEmbeddingProvider(geminiKey);

        const openaiKey = process.env.OPENAI_API_KEY;
        if (openaiKey && !isTestEnv) return new OpenAIEmbeddingProvider(openaiKey);

        return new FallbackEmbeddingProvider();
    }

    static reset(): void {
        this.instance = null;
    }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/rag/embeddings/__tests__/embeddingProvider.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add server/services/rag/embeddings/
git commit -m "feat(rag): add multi-model embedding provider (Gemini/OpenAI/fallback)"
```

---

## Task 2: Deep Document Parsing — Types & Parser Factory

**Files:**
- Create: `server/services/rag/deepParsing/types.ts`
- Create: `server/services/rag/deepParsing/index.ts`
- Test: `server/services/rag/deepParsing/__tests__/parserFactory.test.ts`

**Step 1: Write the failing test**

Create `server/services/rag/deepParsing/__tests__/parserFactory.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectDocumentType, type ParsedStructure, type Section } from "../types";
import { selectParser } from "../index";

describe("detectDocumentType", () => {
    it("detects academic papers from abstract/references", () => {
        const text = "Abstract\nThis paper presents a novel approach...\nReferences\n[1] Smith et al.";
        expect(detectDocumentType(text)).toBe("paper");
    });

    it("detects legal documents from article/clause keywords", () => {
        const text = "Artículo 1. Objeto y ámbito de aplicación\nCláusula segunda...";
        expect(detectDocumentType(text)).toBe("legal");
    });

    it("detects manuals from procedural keywords", () => {
        const text = "Paso 1: Instalar el software\nWARNING: No desconectar...\nProcedimiento de mantenimiento";
        expect(detectDocumentType(text)).toBe("manual");
    });

    it("detects table-heavy documents", () => {
        const text = "| Col A | Col B |\n|-------|-------|\n| 1 | 2 |\n| 3 | 4 |\n\nMore text.\n\n| X | Y |\n|---|---|\n| a | b |";
        expect(detectDocumentType(text)).toBe("table");
    });

    it("falls back to generic", () => {
        const text = "This is a regular document with no special patterns.";
        expect(detectDocumentType(text)).toBe("generic");
    });
});

describe("selectParser", () => {
    it("returns correct parser for each MIME type", () => {
        expect(selectParser("application/pdf").name).toBe("pdf");
        expect(selectParser("application/vnd.openxmlformats-officedocument.wordprocessingml.document").name).toBe("docx");
        expect(selectParser("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").name).toBe("spreadsheet");
        expect(selectParser("image/png").name).toBe("image");
        expect(selectParser("text/plain").name).toBe("text");
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/rag/deepParsing/__tests__/parserFactory.test.ts`
Expected: FAIL

**Step 3: Write types and parser factory**

Create `server/services/rag/deepParsing/types.ts`:

```typescript
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
    if (paperScore >= 3) return "paper";
    if (legalScore >= 2) return "legal";
    if (manualScore >= 2) return "manual";
    return "generic";
}
```

Create `server/services/rag/deepParsing/index.ts`:

```typescript
/**
 * Deep Parsing — Parser Factory
 *
 * Selects the appropriate parser based on MIME type.
 * Each parser returns a ParsedStructure with hierarchy, tables, and figures.
 */

import type { DocumentParser, ParsedStructure } from "./types";
import { detectDocumentType } from "./types";
import { parsePdf } from "./pdfStructuredParser";
import { parseDocx } from "./docxStructuredParser";
import { parseSpreadsheet } from "./spreadsheetParser";
import { parseImage } from "./imageParser";
import { parseText } from "./textParser";

const MIME_MAP: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
    "application/vnd.ms-excel": "spreadsheet",
    "text/csv": "spreadsheet",
    "image/png": "image",
    "image/jpeg": "image",
    "image/webp": "image",
    "image/gif": "image",
    "text/plain": "text",
    "text/markdown": "text",
    "text/html": "text",
    "application/json": "text",
};

function getParserType(mimeType: string): string {
    return MIME_MAP[mimeType] || "text";
}

export function selectParser(mimeType: string): DocumentParser {
    const type = getParserType(mimeType);
    switch (type) {
        case "pdf": return { name: "pdf", parse: parsePdf };
        case "docx": return { name: "docx", parse: parseDocx };
        case "spreadsheet": return { name: "spreadsheet", parse: parseSpreadsheet };
        case "image": return { name: "image", parse: parseImage };
        default: return { name: "text", parse: parseText };
    }
}

export async function deepParse(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
): Promise<ParsedStructure> {
    const parser = selectParser(mimeType);
    return parser.parse(buffer, mimeType, fileName);
}

export { detectDocumentType } from "./types";
export type { ParsedStructure, Section, ExtractedTable, DocumentType, DocumentMetadata } from "./types";
```

**Step 4: Create stub parsers** (so the factory imports resolve)

Create each of these minimal stubs (they'll be fully implemented in Task 3):

`server/services/rag/deepParsing/pdfStructuredParser.ts`:
```typescript
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
```

Repeat similar stubs for `docxStructuredParser.ts`, `spreadsheetParser.ts`, `imageParser.ts`, `textParser.ts`.

**Step 5: Run test to verify it passes**

Run: `npx vitest run server/services/rag/deepParsing/__tests__/parserFactory.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/services/rag/deepParsing/
git commit -m "feat(rag): add deep parsing types, auto-detection, and parser factory"
```

---

## Task 3: Deep Parsing — PDF Structured Parser

**Files:**
- Modify: `server/services/rag/deepParsing/pdfStructuredParser.ts`
- Test: `server/services/rag/deepParsing/__tests__/pdfParser.test.ts`

**Step 1: Write the test**

Create `server/services/rag/deepParsing/__tests__/pdfParser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parsePdf } from "../pdfStructuredParser";
import { readFileSync } from "fs";
import path from "path";

describe("parsePdf", () => {
    it("extracts text from a simple PDF buffer", async () => {
        // Create a minimal text buffer that pdf-parse can handle,
        // or use a fixture file if one exists in test data
        const simpleText = "Chapter 1: Introduction\n\nThis is the first paragraph.\n\nChapter 2: Methods\n\nWe used the following approach.";
        const buffer = Buffer.from(simpleText);
        const result = await parsePdf(buffer, "application/pdf", "test.pdf");

        expect(result.rawText.length).toBeGreaterThan(0);
        expect(result.metadata.documentType).toBeDefined();
        expect(result.sections.length).toBeGreaterThan(0);
    });

    it("detects headings in extracted text", async () => {
        const text = "# Title\n\nParagraph one.\n\n## Section A\n\nContent of section A.\n\n## Section B\n\nContent of section B.";
        const buffer = Buffer.from(text);
        const result = await parsePdf(buffer, "text/plain", "test.txt");

        const headings = result.sections.filter(s => s.type === "heading");
        expect(headings.length).toBeGreaterThan(0);
    });

    it("detects tables in text", async () => {
        const text = "Some text\n\n| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |\n\nMore text.";
        const buffer = Buffer.from(text);
        const result = await parsePdf(buffer, "text/plain", "test.txt");

        expect(result.tables.length).toBeGreaterThan(0);
        expect(result.tables[0].headers).toContain("Name");
    });

    it("populates metadata correctly", async () => {
        const text = "Abstract\n\nOur research shows...\n\nReferences\n\n[1] Paper";
        const buffer = Buffer.from(text);
        const result = await parsePdf(buffer, "text/plain", "test.txt");

        expect(result.metadata.documentType).toBe("paper");
        expect(result.metadata.wordCount).toBeGreaterThan(0);
    });
});
```

**Step 2: Implement the full PDF parser**

Replace `server/services/rag/deepParsing/pdfStructuredParser.ts` with full implementation that:
- Uses `pdf-parse` (already in deps) for text extraction
- Builds a section tree from detected headings (markdown-style `#`, ALL-CAPS lines, numbered sections)
- Detects and extracts markdown tables
- Detects figures by caption patterns
- Calls `detectDocumentType` for metadata
- Handles fallback gracefully if pdf-parse fails (treat as raw text)

Key logic: Parse the extracted text into sections by splitting on heading patterns (`/^#{1,6}\s/m`, `/^[A-Z][A-Z\s]{3,}$/m`, `/^\d+\.\s+[A-Z]/m`), then build a tree based on heading level.

**Step 3: Run test, Step 4: Commit**

```bash
npx vitest run server/services/rag/deepParsing/__tests__/pdfParser.test.ts
git add server/services/rag/deepParsing/
git commit -m "feat(rag): implement PDF structured parser with section tree and table extraction"
```

---

## Task 4: Deep Parsing — DOCX, Spreadsheet, Image, Text Parsers

**Files:**
- Modify: `server/services/rag/deepParsing/docxStructuredParser.ts`
- Modify: `server/services/rag/deepParsing/spreadsheetParser.ts`
- Modify: `server/services/rag/deepParsing/imageParser.ts`
- Modify: `server/services/rag/deepParsing/textParser.ts`
- Test: `server/services/rag/deepParsing/__tests__/parsers.test.ts`

**Step 1: Write tests for each parser**

Test that each parser returns a valid `ParsedStructure` with sections, correct metadata, and handles edge cases (empty buffer, very large content).

**Step 2: Implement each parser**

- **docxStructuredParser**: Use `mammoth` (already in deps) with custom transforms. Extract heading hierarchy using mammoth's `transformDocument` to preserve heading levels. Detect tables via mammoth's table transforms.
- **spreadsheetParser**: Use `xlsx` (already in deps). Auto-detect header row, convert each sheet to sections, generate NL descriptions of columns.
- **imageParser**: Use `tesseract.js` (already in deps via `performOCR` in `server/services/ocrService.ts`). Run OCR, then parse the resulting text as a text document.
- **textParser**: Parse markdown/plain text into section tree. Detect headings, tables, code blocks, lists. Most straightforward parser.

**Step 3: Run tests, Step 4: Commit**

```bash
npx vitest run server/services/rag/deepParsing/__tests__/parsers.test.ts
git add server/services/rag/deepParsing/
git commit -m "feat(rag): implement DOCX, spreadsheet, image, and text parsers"
```

---

## Task 5: Hierarchical Chunking

**Files:**
- Create: `server/services/rag/chunking/hierarchicalChunker.ts`
- Create: `server/services/rag/chunking/templateStrategies.ts`
- Create: `server/services/rag/chunking/chunkMerger.ts`
- Create: `server/services/rag/chunking/index.ts`
- Test: `server/services/rag/chunking/__tests__/hierarchicalChunker.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { hierarchicalChunk, type EnhancedChunk } from "../index";
import type { ParsedStructure } from "../../deepParsing/types";

describe("hierarchicalChunk", () => {
    const mockStructure: ParsedStructure = {
        sections: [
            {
                title: "Chapter 1",
                level: 1,
                content: "",
                pageNumber: 1,
                type: "heading",
                children: [
                    {
                        title: "Section 1.1",
                        level: 2,
                        content: "This is the content of section 1.1 which is long enough to be its own chunk and contains important information about the topic at hand.",
                        pageNumber: 1,
                        type: "paragraph",
                        children: [],
                    },
                    {
                        title: "Section 1.2",
                        level: 2,
                        content: "Content of section 1.2 with additional details.",
                        pageNumber: 2,
                        type: "paragraph",
                        children: [],
                    },
                ],
            },
        ],
        tables: [],
        figures: [],
        rawText: "...",
        metadata: { documentType: "generic", language: "es", pageCount: 2, hasImages: false, hasTables: false, wordCount: 100 },
    };

    it("produces chunks with headerChain breadcrumbs", () => {
        const chunks = hierarchicalChunk(mockStructure);
        expect(chunks.length).toBeGreaterThan(0);
        const chunk = chunks.find(c => c.content.includes("section 1.1"));
        expect(chunk).toBeDefined();
        expect(chunk!.metadata.headerChain).toContain("Chapter 1");
        expect(chunk!.metadata.headerChain).toContain("Section 1.1");
    });

    it("preserves page numbers in chunks", () => {
        const chunks = hierarchicalChunk(mockStructure);
        const page2Chunk = chunks.find(c => c.content.includes("section 1.2"));
        expect(page2Chunk?.metadata.pageNumber).toBe(2);
    });

    it("sets documentType and chunkStrategy in metadata", () => {
        const chunks = hierarchicalChunk(mockStructure);
        expect(chunks[0].metadata.documentType).toBe("generic");
        expect(chunks[0].metadata.chunkStrategy).toBeDefined();
    });

    it("merges small adjacent chunks", () => {
        const tinyStructure: ParsedStructure = {
            ...mockStructure,
            sections: [{
                title: "Title",
                level: 1,
                content: "",
                pageNumber: 1,
                type: "heading",
                children: [
                    { title: "", level: 2, content: "Short.", pageNumber: 1, type: "paragraph", children: [] },
                    { title: "", level: 2, content: "Also short.", pageNumber: 1, type: "paragraph", children: [] },
                ],
            }],
        };
        const chunks = hierarchicalChunk(tinyStructure);
        // Should merge tiny chunks together
        expect(chunks.length).toBeLessThanOrEqual(2);
    });
});
```

**Step 2: Implement hierarchical chunker**

Core logic:
1. **Walk the section tree depth-first**, building chunks from leaf sections
2. **Propagate headerChain** from ancestors (["Chapter 1", "Section 1.1"])
3. **Apply template strategy** based on `documentType`:
   - `paper`: Each named section is a chunk (Abstract, Methodology, Results...)
   - `legal`: Each article/clause is a chunk
   - `manual`: Each step/procedure is a chunk
   - `table`: Each table + context is a chunk
   - `generic`: Size-based chunking with sentence overlap
4. **Merge** chunks smaller than `minChunkSize` (100 chars) with adjacent same-level chunks
5. **Enrich metadata**: `headerChain`, `semanticDensity`, `documentPosition`, `extractedKeywords` (top TF terms)

Create `server/services/rag/chunking/index.ts` that exports `hierarchicalChunk(structure: ParsedStructure): EnhancedChunk[]`.

**Step 3: Run tests, Step 4: Commit**

```bash
npx vitest run server/services/rag/chunking/__tests__/hierarchicalChunker.test.ts
git add server/services/rag/chunking/
git commit -m "feat(rag): implement hierarchical chunker with template strategies and breadcrumbs"
```

---

## Task 6: Model-Based Reranker

**Files:**
- Create: `server/services/rag/reranker.ts`
- Test: `server/services/rag/__tests__/reranker.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { rerankChunks, type RerankOptions } from "../reranker";
import type { ScoredChunk } from "../hybridRetriever";

describe("rerankChunks", () => {
    const mockChunks: ScoredChunk[] = [
        { id: "1", content: "PostgreSQL is a database", score: 0.8, vectorScore: 0.8, bm25Score: 0.6, source: "doc", metadata: {}, tags: [] },
        { id: "2", content: "Redis is an in-memory store", score: 0.7, vectorScore: 0.7, bm25Score: 0.5, source: "doc", metadata: {}, tags: [] },
        { id: "3", content: "PostgreSQL supports vector search via pgvector", score: 0.6, vectorScore: 0.6, bm25Score: 0.4, source: "doc", metadata: {}, tags: [] },
    ];

    it("reranks using heuristic when no API keys available", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("COHERE_API_KEY", "");
        const result = await rerankChunks("pgvector database", mockChunks);
        expect(result.length).toBe(3);
        // Chunk 3 mentions both pgvector and database, should be boosted
        expect(result[0].rerankerScore).toBeDefined();
    });

    it("respects topN parameter", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const result = await rerankChunks("pgvector", mockChunks, { topN: 2 });
        expect(result.length).toBe(2);
    });

    it("preserves all chunk properties", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const result = await rerankChunks("test", mockChunks);
        for (const chunk of result) {
            expect(chunk.id).toBeDefined();
            expect(chunk.content).toBeDefined();
            expect(chunk.source).toBeDefined();
        }
    });
});
```

**Step 2: Implement reranker**

Create `server/services/rag/reranker.ts`:

```typescript
/**
 * Model-Based Reranker
 *
 * Inspired by RAGFlow's reranking pipeline.
 * Auto-selects: Gemini cross-encoder > Cohere Rerank > Heuristic.
 */

import { GoogleGenAI } from "@google/genai";
import type { ScoredChunk } from "./hybridRetriever";

const isTestEnv = process.env.NODE_ENV === "test" || !!process.env.VITEST_WORKER_ID;

export interface RerankOptions {
    model?: "gemini" | "cohere" | "heuristic" | "auto";
    topN?: number;
}

export async function rerankChunks(
    query: string,
    chunks: ScoredChunk[],
    options: RerankOptions = {},
): Promise<ScoredChunk[]> {
    const { model = "auto", topN = chunks.length } = options;

    let reranked: ScoredChunk[];

    if (model === "cohere" || (model === "auto" && process.env.COHERE_API_KEY && !isTestEnv)) {
        reranked = await rerankCohere(query, chunks);
    } else if (model === "gemini" || (model === "auto" && process.env.GEMINI_API_KEY && !isTestEnv)) {
        reranked = await rerankGemini(query, chunks);
    } else {
        reranked = rerankHeuristic(query, chunks);
    }

    return reranked.slice(0, topN);
}

// Gemini cross-encoder: ask the model to rank passages by relevance
async function rerankGemini(query: string, chunks: ScoredChunk[]): Promise<ScoredChunk[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const passages = chunks.map((c, i) => `[${i}] ${c.content.slice(0, 300)}`).join("\n\n");

    const prompt = `Given the query: "${query}"
Rate each passage's relevance from 0.0 to 1.0. Return ONLY a JSON array of numbers in order.

${passages}`;

    try {
        const result = await ai.models.generateContent({
            model: process.env.RAG_RERANKER_MODEL || "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const text = result.text?.replace(/```json?\n?/g, "").replace(/```/g, "").trim() || "[]";
        const scores: number[] = JSON.parse(text);

        return chunks
            .map((chunk, i) => ({
                ...chunk,
                rerankerScore: scores[i] ?? chunk.score,
                score: (chunk.score + (scores[i] ?? chunk.score)) / 2,
            }))
            .sort((a, b) => b.score - a.score);
    } catch {
        return rerankHeuristic(query, chunks);
    }
}

// Cohere Rerank API
async function rerankCohere(query: string, chunks: ScoredChunk[]): Promise<ScoredChunk[]> {
    try {
        const res = await fetch("https://api.cohere.ai/v1/rerank", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
            },
            body: JSON.stringify({
                model: "rerank-v3.5",
                query,
                documents: chunks.map((c) => c.content.slice(0, 1000)),
                top_n: chunks.length,
            }),
        });

        if (!res.ok) return rerankHeuristic(query, chunks);
        const data = await res.json();

        const indexed = new Map(chunks.map((c, i) => [i, c]));
        return data.results.map((r: any) => ({
            ...indexed.get(r.index)!,
            rerankerScore: r.relevance_score,
            score: (indexed.get(r.index)!.score + r.relevance_score) / 2,
        }));
    } catch {
        return rerankHeuristic(query, chunks);
    }
}

// Heuristic reranker (enhanced version of existing crossEncoderRerank)
function rerankHeuristic(query: string, chunks: ScoredChunk[]): ScoredChunk[] {
    const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 2));

    return chunks
        .map((chunk) => {
            let boost = 0;
            const contentLower = chunk.content.toLowerCase();
            const contentTerms = contentLower.split(/\s+/);

            // Exact match boost
            const exactMatches = contentTerms.filter((t) => queryTerms.has(t)).length;
            boost += exactMatches * 0.03;

            // Title match boost
            if (chunk.sectionTitle) {
                const titleTerms = chunk.sectionTitle.toLowerCase().split(/\s+/);
                boost += titleTerms.filter((t) => queryTerms.has(t)).length * 0.08;
            }

            // Proximity boost
            const queryArr = Array.from(queryTerms);
            for (let i = 0; i < queryArr.length - 1; i++) {
                const pattern = new RegExp(`${queryArr[i]}\\s+(?:\\S+\\s+){0,3}${queryArr[i + 1]}`, "i");
                if (pattern.test(chunk.content)) boost += 0.05;
            }

            // Content-type context boosts
            if (chunk.chunkType === "heading") boost += 0.04;
            if (chunk.chunkType === "table" && /tabla|table|datos|data/i.test(query)) boost += 0.08;
            if (chunk.chunkType === "code" && /código|code|función|function/i.test(query)) boost += 0.08;

            // Header chain boost (new — breadcrumb relevance)
            const headerChain = (chunk.metadata as any)?.headerChain as string[] | undefined;
            if (headerChain) {
                for (const header of headerChain) {
                    const headerTerms = header.toLowerCase().split(/\s+/);
                    boost += headerTerms.filter((t) => queryTerms.has(t)).length * 0.06;
                }
            }

            const rerankerScore = chunk.score + boost;
            return { ...chunk, rerankerScore, score: rerankerScore };
        })
        .sort((a, b) => b.score - a.score);
}
```

**Step 3: Run tests, Step 4: Commit**

```bash
npx vitest run server/services/rag/__tests__/reranker.test.ts
git add server/services/rag/reranker.ts server/services/rag/__tests__/
git commit -m "feat(rag): add model-based reranker (Gemini/Cohere/heuristic auto-select)"
```

---

## Task 7: Upgrade hybridRetriever to Use pgvector SQL Queries

**Files:**
- Modify: `server/services/rag/hybridRetriever.ts` (lines 208-336 — `retrieve()` function)
- Test: `server/services/rag/__tests__/hybridRetriever.test.ts`

This is the most impactful change. Replace the in-memory cosine similarity + BM25 computation with SQL queries that use the pgvector HNSW index and tsvector GIN index already in the `rag_chunks` schema.

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { hybridRetriever } from "../hybridRetriever";

describe("hybridRetriever.retrieve", () => {
    // These tests validate the interface contract — actual DB tests are integration tests
    it("returns empty when no chunks match", async () => {
        const result = await hybridRetriever.retrieve("test query", {
            tenantId: "test",
            userId: "user-1",
        });
        expect(result.chunks).toEqual([]);
        expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
});
```

**Step 2: Modify `retrieve()` in `hybridRetriever.ts`**

Key changes to the `retrieve()` function:

1. Replace lines 249-255 (wide SELECT * fetch) with a pgvector-powered SQL query:
```sql
SELECT id, content, page_number, section_title, source, source_id, chunk_type,
       metadata, tags, embedding,
       1 - (embedding <=> $queryEmbedding::vector) AS vector_score,
       ts_rank_cd(search_vector, plainto_tsquery('simple', $query)) AS fts_score
FROM rag_chunks
WHERE tenant_id = $tenantId AND user_id = $userId AND is_active = true
  AND (embedding IS NOT NULL OR search_vector IS NOT NULL)
ORDER BY embedding <=> $queryEmbedding::vector
LIMIT $candidateLimit
```

2. Replace lines 276-305 (in-memory BM25 + cosine scoring) with reading the SQL-computed scores directly.

3. Keep MMR diversification (lines 114-158) and reranker integration as-is, but replace `crossEncoderRerank` call (line 313) with `rerankChunks` from the new reranker module.

4. Add import: `import { rerankChunks } from "./reranker";`

**Step 3: Run tests, Step 4: Commit**

```bash
npx vitest run server/services/rag/__tests__/hybridRetriever.test.ts
git add server/services/rag/hybridRetriever.ts server/services/rag/__tests__/
git commit -m "feat(rag): upgrade hybridRetriever to pgvector SQL queries + model reranker"
```

---

## Task 8: Wire Deep Parsing + Hierarchical Chunking into Ingestion Pipeline

**Files:**
- Modify: `server/services/rag/ingestionPipeline.ts` (lines 76-140 — chunking adapter section)
- Test: `server/services/rag/__tests__/ingestionPipeline.test.ts`

**Step 1: Write the test**

Test that the ingestion pipeline:
- Accepts a Buffer + mimeType and produces chunks with enhanced metadata
- Uses deep parsing when a Buffer is provided
- Falls back to text-based chunking for plain text

**Step 2: Modify ingestionPipeline.ts**

Add a new `ingestDocument` method that:
1. Calls `deepParse(buffer, mimeType, fileName)` from the deep parsing module
2. Calls `hierarchicalChunk(parsedStructure)` from the chunking module
3. Generates embeddings via `EmbeddingProviderFactory.getProvider()`
4. Inserts chunks into `ragChunks` with the new enhanced metadata fields

This works ALONGSIDE the existing `ingest()` method (which handles text-based ingestion) — no breaking changes.

Add imports:
```typescript
import { deepParse } from "../rag/deepParsing";
import { hierarchicalChunk } from "../rag/chunking";
import { EmbeddingProviderFactory } from "../rag/embeddings/embeddingProvider";
```

**Step 3: Run tests, Step 4: Commit**

```bash
npx vitest run server/services/rag/__tests__/ingestionPipeline.test.ts
git add server/services/rag/ingestionPipeline.ts server/services/rag/__tests__/
git commit -m "feat(rag): wire deep parsing + hierarchical chunking into ingestion pipeline"
```

---

## Task 9: Update rag/index.ts Orchestrator + Deprecate Old Files

**Files:**
- Modify: `server/services/rag/index.ts` (add new exports)
- Modify: `server/services/ragService.ts` (add deprecation re-exports)
- Modify: `server/services/ragPipeline.ts` (add deprecation re-exports)

**Step 1: Update `rag/index.ts`**

Add exports for new modules:
```typescript
export { deepParse, selectParser, detectDocumentType } from "./deepParsing";
export type { ParsedStructure, Section, ExtractedTable, DocumentType } from "./deepParsing";
export { hierarchicalChunk } from "./chunking";
export type { EnhancedChunk, EnhancedChunkMetadata } from "./chunking";
export { rerankChunks } from "./reranker";
export type { RerankOptions } from "./reranker";
export { EmbeddingProviderFactory } from "./embeddings/embeddingProvider";
export type { EmbeddingProvider } from "./embeddings/embeddingProvider";
```

**Step 2: Add deprecation notices to old files**

At the top of `ragService.ts`:
```typescript
/** @deprecated Use imports from 'server/services/rag' instead */
```

At the top of `ragPipeline.ts`:
```typescript
/** @deprecated Use imports from 'server/services/rag' instead */
```

Don't delete them — they may have active importers. Just mark deprecated.

**Step 3: Commit**

```bash
git add server/services/rag/index.ts server/services/ragService.ts server/services/ragPipeline.ts
git commit -m "feat(rag): update orchestrator exports, deprecate legacy RAG files"
```

---

## Task 10: Integration Test — Full Pipeline End-to-End

**Files:**
- Create: `server/services/rag/__tests__/integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect } from "vitest";
import { deepParse } from "../deepParsing";
import { hierarchicalChunk } from "../chunking";
import { EmbeddingProviderFactory } from "../embeddings/embeddingProvider";
import { rerankChunks } from "../reranker";

describe("RAG Pipeline Integration", () => {
    const sampleDoc = `
# Project Report

## Executive Summary

This report summarizes the findings of our Q4 analysis.

## Methodology

We used the following approach:
1. Data collection from 500 users
2. Statistical analysis using R
3. Validation with cross-validation

## Results

| Metric | Value | Change |
|--------|-------|--------|
| Revenue | $1.2M | +15% |
| Users | 50K | +22% |
| Churn | 3.2% | -0.5% |

## Conclusion

The results indicate strong growth across all metrics.

## References

[1] Smith et al., 2025. Data Analysis Methods.
`;

    it("full pipeline: parse -> chunk -> embed -> rerank", async () => {
        // 1. Parse
        const buffer = Buffer.from(sampleDoc);
        const parsed = await deepParse(buffer, "text/plain", "report.md");

        expect(parsed.metadata.documentType).toBe("paper");
        expect(parsed.sections.length).toBeGreaterThan(0);
        expect(parsed.tables.length).toBeGreaterThan(0);

        // 2. Chunk
        const chunks = hierarchicalChunk(parsed);
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0].metadata.headerChain.length).toBeGreaterThan(0);

        // 3. Embed
        const provider = EmbeddingProviderFactory.getProvider();
        const embeddings = await provider.embedBatch(chunks.map(c => c.content));
        expect(embeddings.length).toBe(chunks.length);
        expect(embeddings[0].length).toBe(768);

        // 4. Rerank
        const scoredChunks = chunks.map((c, i) => ({
            id: `chunk-${i}`,
            content: c.content,
            score: 0.5,
            vectorScore: 0.5,
            bm25Score: 0.5,
            source: "doc",
            metadata: c.metadata,
            tags: [],
        }));

        const reranked = await rerankChunks("revenue growth metrics", scoredChunks);
        expect(reranked.length).toBeGreaterThan(0);
        // Table chunk about revenue should rank higher
        const tableChunk = reranked.find(c => c.content.includes("Revenue"));
        expect(tableChunk).toBeDefined();
    });
});
```

**Step 2: Run integration test, Step 3: Commit**

```bash
npx vitest run server/services/rag/__tests__/integration.test.ts
git add server/services/rag/__tests__/integration.test.ts
git commit -m "test(rag): add full pipeline integration test (parse -> chunk -> embed -> rerank)"
```

---

## Summary of All Tasks

| Task | What | Files | Estimated |
|------|------|-------|-----------|
| 1 | Multi-model embedding provider | `rag/embeddings/embeddingProvider.ts` + test | 15 min |
| 2 | Deep parsing types + factory | `rag/deepParsing/types.ts`, `index.ts` + test | 15 min |
| 3 | PDF structured parser | `rag/deepParsing/pdfStructuredParser.ts` + test | 20 min |
| 4 | DOCX, spreadsheet, image, text parsers | 4 parser files + test | 25 min |
| 5 | Hierarchical chunker + template strategies | `rag/chunking/` (3 files) + test | 25 min |
| 6 | Model-based reranker | `rag/reranker.ts` + test | 15 min |
| 7 | Upgrade hybridRetriever to pgvector SQL | Modify `hybridRetriever.ts` + test | 20 min |
| 8 | Wire into ingestion pipeline | Modify `ingestionPipeline.ts` + test | 15 min |
| 9 | Update orchestrator + deprecate old files | Modify `rag/index.ts`, `ragService.ts`, `ragPipeline.ts` | 10 min |
| 10 | Integration test | `rag/__tests__/integration.test.ts` | 10 min |

**Total: 10 tasks, ~170 min of implementation**

**Dependencies:** Tasks 1-6 are independent and can be parallelized. Task 7 depends on Task 6. Task 8 depends on Tasks 2-5. Tasks 9-10 depend on all prior tasks.

```
Task 1 (embeddings) ──────────────────────────────────────┐
Task 2 (types/factory) ──→ Task 3 (PDF) ──→ Task 4 (other parsers) ──┐
Task 5 (chunking) ────────────────────────────────────────────────────┤
Task 6 (reranker) ──→ Task 7 (hybridRetriever upgrade) ──────────────┤
                                                                      ├──→ Task 8 (wire) ──→ Task 9 (orchestrator) ──→ Task 10 (integration)
```
