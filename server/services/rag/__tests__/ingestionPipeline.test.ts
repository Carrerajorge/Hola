import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedStructure } from "../deepParsing/types";
import type { EnhancedChunk } from "../chunking/types";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// vi.hoisted() is needed for variables referenced inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockEmbedBatch } = vi.hoisted(() => ({
    mockEmbedBatch: vi.fn(),
}));

// Mock the database
vi.mock("../../../db", () => {
    const selectReturn = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
    };
    return {
        db: {
            select: vi.fn().mockReturnValue(selectReturn),
            insert: vi.fn().mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: "chunk-uuid-1" }]),
                }),
            }),
            execute: vi.fn().mockResolvedValue(undefined),
        },
    };
});

// Mock deep parsing
vi.mock("../deepParsing", () => ({
    deepParse: vi.fn(),
}));

// Mock chunking
vi.mock("../chunking", () => ({
    hierarchicalChunk: vi.fn(),
}));

// Mock the embedding provider factory
vi.mock("../embeddings/embeddingProvider", () => ({
    EmbeddingProviderFactory: {
        getProvider: vi.fn().mockReturnValue({
            name: "mock",
            dimensions: 768,
            embed: vi.fn(),
            embedBatch: mockEmbedBatch,
        }),
    },
}));

// Mock the legacy embeddings (used by existing ingest())
vi.mock("../../embeddings", () => ({
    getEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0)),
}));

// Mock semanticChunker (used by existing ingest())
vi.mock("../../semanticChunker", () => ({
    chunkDocument: vi.fn().mockReturnValue({ chunks: [] }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { db } from "../../../db";
import { deepParse } from "../deepParsing";
import { hierarchicalChunk } from "../chunking";
import { EmbeddingProviderFactory } from "../embeddings/embeddingProvider";
import { ingestDocument, ingestionPipeline } from "../ingestionPipeline";
import type { DocumentIngestionInput, IngestionOptions } from "../ingestionPipeline";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeParsedStructure(overrides?: Partial<ParsedStructure>): ParsedStructure {
    return {
        sections: [
            {
                title: "Introduction",
                level: 1,
                content: "This is the introduction section with enough content to be meaningful.",
                pageNumber: 1,
                children: [],
                type: "heading",
            },
            {
                title: "Methods",
                level: 1,
                content: "Here we describe the methodology used in our study.",
                pageNumber: 2,
                children: [],
                type: "paragraph",
            },
        ],
        tables: [],
        figures: [],
        rawText: "This is the introduction section. Here we describe the methodology.",
        metadata: {
            documentType: "paper",
            language: "en",
            pageCount: 3,
            hasImages: false,
            hasTables: false,
            wordCount: 150,
            title: "Test Document Title",
        },
        ...overrides,
    };
}

function makeEnhancedChunks(): EnhancedChunk[] {
    return [
        {
            content: "This is the introduction section with enough content to be meaningful.",
            metadata: {
                headerChain: ["Introduction"],
                pageNumber: 1,
                documentType: "paper",
                chunkStrategy: "paper-default",
                sectionType: "heading",
                documentPosition: 0.0,
                extractedKeywords: ["introduction", "section"],
            },
        },
        {
            content: "Here we describe the methodology used in our study.",
            metadata: {
                headerChain: ["Methods"],
                pageNumber: 2,
                documentType: "paper",
                chunkStrategy: "paper-default",
                sectionType: "paragraph",
                documentPosition: 0.5,
                extractedKeywords: ["methodology", "study"],
            },
        },
    ];
}

function makeDefaultOptions(): IngestionOptions {
    return {
        tenantId: "tenant-1",
        userId: "user-1",
        conversationId: "conv-1",
        tags: ["test"],
        skipDuplicates: true,
        batchSize: 10,
    };
}

function makeDocumentInput(): DocumentIngestionInput {
    return {
        buffer: Buffer.from("fake document content"),
        mimeType: "application/pdf",
        fileName: "test-document.pdf",
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ingestDocument", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset default mock implementations
        mockEmbedBatch.mockResolvedValue([
            new Array(768).fill(0.1),
            new Array(768).fill(0.2),
        ]);

        // db.insert chain: returns unique IDs for each chunk
        let insertCallCount = 0;
        (db.insert as any).mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockImplementation(() => {
                    insertCallCount++;
                    return Promise.resolve([{ id: `chunk-uuid-${insertCallCount}` }]);
                }),
            }),
        });

        // db.select chain: no duplicates by default
        const selectReturn = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([]),
        };
        (db.select as any).mockReturnValue(selectReturn);
    });

    // -----------------------------------------------------------------------
    // 1. Deep parse + chunk pipeline: field mapping
    // -----------------------------------------------------------------------
    describe("deep parse + chunk pipeline", () => {
        it("calls deepParse with buffer, mimeType, and fileName", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            const input = makeDocumentInput();
            const options = makeDefaultOptions();

            await ingestDocument(input, options);

            expect(deepParse).toHaveBeenCalledWith(
                input.buffer,
                input.mimeType,
                input.fileName,
            );
        });

        it("calls hierarchicalChunk with the parsed structure", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(hierarchicalChunk).toHaveBeenCalledWith(parsedStructure);
        });

        it("generates embeddings via EmbeddingProviderFactory", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(EmbeddingProviderFactory.getProvider).toHaveBeenCalled();
            expect(mockEmbedBatch).toHaveBeenCalledWith(
                chunks.map((c) => c.content),
            );
        });

        it("maps EnhancedChunk fields correctly to InsertRagChunk", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            // Track what gets inserted
            const insertedRows: any[] = [];
            (db.insert as any).mockReturnValue({
                values: vi.fn().mockImplementation((row: any) => {
                    insertedRows.push(row);
                    return {
                        returning: vi.fn().mockResolvedValue([{ id: `chunk-uuid-${insertedRows.length}` }]),
                    };
                }),
            });

            const options = makeDefaultOptions();
            await ingestDocument(makeDocumentInput(), options);

            expect(insertedRows).toHaveLength(2);

            // First chunk mapping
            const row0 = insertedRows[0];
            expect(row0.content).toBe(chunks[0].content);
            expect(row0.sectionTitle).toBe("Introduction");
            expect(row0.pageNumber).toBe(1);
            expect(row0.chunkType).toBe("heading");
            // documentPosition = 0.0, importance = 1 - 0.0 * 0.5 = 1.0
            expect(row0.importance).toBe(1.0);
            expect(row0.tags).toContain("introduction");
            expect(row0.tags).toContain("section");
            expect(row0.tags).toContain("test"); // user-supplied tag merged with auto-extracted
            expect(row0.language).toBe("en");
            expect(row0.mimeType).toBe("application/pdf");
            expect(row0.title).toBe("Test Document Title");
            expect(row0.tenantId).toBe("tenant-1");
            expect(row0.userId).toBe("user-1");
            expect(row0.source).toBe("document");

            // Second chunk mapping
            const row1 = insertedRows[1];
            expect(row1.content).toBe(chunks[1].content);
            expect(row1.sectionTitle).toBe("Methods");
            expect(row1.pageNumber).toBe(2);
            expect(row1.chunkType).toBe("paragraph");
            // documentPosition = 0.5, importance = 1 - 0.5 * 0.5 = 0.75
            expect(row1.importance).toBe(0.75);
            expect(row1.tags).toContain("methodology");
            expect(row1.tags).toContain("study");
            expect(row1.tags).toContain("test"); // user-supplied tag merged
        });

        it("stores metadata jsonb with chunk strategy and document type", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            const insertedRows: any[] = [];
            (db.insert as any).mockReturnValue({
                values: vi.fn().mockImplementation((row: any) => {
                    insertedRows.push(row);
                    return {
                        returning: vi.fn().mockResolvedValue([{ id: `chunk-uuid-${insertedRows.length}` }]),
                    };
                }),
            });

            await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            const meta = insertedRows[0].metadata;
            expect(meta.documentType).toBe("paper");
            expect(meta.chunkStrategy).toBe("paper-default");
            expect(meta.headerChain).toEqual(["Introduction"]);
            expect(meta.documentPosition).toBe(0.0);
        });

        it("returns correct IngestionResult", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            const result = await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(result.chunksCreated).toBe(2);
            expect(result.chunksSkipped).toBe(0);
            expect(result.totalTokensEstimated).toBeGreaterThan(0);
            expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
            expect(result.chunkIds).toHaveLength(2);
        });

        it("runs tsvector update SQL for inserted chunks", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(db.execute).toHaveBeenCalled();
        });

        it("uses fileName as title when parsedStructure.metadata.title is missing", async () => {
            const parsedStructure = makeParsedStructure({
                metadata: {
                    documentType: "generic",
                    language: "es",
                    pageCount: 1,
                    hasImages: false,
                    hasTables: false,
                    wordCount: 50,
                    title: undefined,
                },
            });
            const chunks = makeEnhancedChunks().slice(0, 1);

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            const insertedRows: any[] = [];
            (db.insert as any).mockReturnValue({
                values: vi.fn().mockImplementation((row: any) => {
                    insertedRows.push(row);
                    return {
                        returning: vi.fn().mockResolvedValue([{ id: "chunk-uuid-1" }]),
                    };
                }),
            });

            await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(insertedRows[0].title).toBe("test-document.pdf");
        });
    });

    // -----------------------------------------------------------------------
    // 2. Dedup behavior
    // -----------------------------------------------------------------------
    describe("dedup behavior", () => {
        it("skips chunks when skipDuplicates is true and chunk already exists", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            // First chunk: exists (duplicate)
            // Second chunk: does not exist
            let selectCallCount = 0;
            (db.select as any).mockReturnValue({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockImplementation(() => {
                    selectCallCount++;
                    if (selectCallCount === 1) {
                        return Promise.resolve([{ id: "existing-chunk-id" }]);
                    }
                    return Promise.resolve([]);
                }),
            });

            let insertCallCount = 0;
            (db.insert as any).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockImplementation(() => {
                        insertCallCount++;
                        return Promise.resolve([{ id: `new-chunk-${insertCallCount}` }]);
                    }),
                }),
            });

            const options = makeDefaultOptions();
            options.skipDuplicates = true;

            const result = await ingestDocument(makeDocumentInput(), options);

            expect(result.chunksCreated).toBe(1);
            expect(result.chunksSkipped).toBe(1);
            expect(result.chunkIds).toContain("existing-chunk-id");
        });

        it("does not skip duplicates when skipDuplicates is false", async () => {
            const parsedStructure = makeParsedStructure();
            const chunks = makeEnhancedChunks();

            (deepParse as any).mockResolvedValue(parsedStructure);
            (hierarchicalChunk as any).mockReturnValue(chunks);

            const options = makeDefaultOptions();
            options.skipDuplicates = false;

            const result = await ingestDocument(makeDocumentInput(), options);

            // No select calls for dedup checking
            expect(db.select).not.toHaveBeenCalled();
            expect(result.chunksCreated).toBe(2);
            expect(result.chunksSkipped).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 3. Empty document
    // -----------------------------------------------------------------------
    describe("empty document", () => {
        it("returns chunksCreated: 0 when deep parsing returns no sections and chunking yields nothing", async () => {
            const emptyStructure = makeParsedStructure({
                sections: [],
                tables: [],
                figures: [],
                rawText: "",
            });

            (deepParse as any).mockResolvedValue(emptyStructure);
            (hierarchicalChunk as any).mockReturnValue([]);

            const result = await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(result.chunksCreated).toBe(0);
            expect(result.chunksSkipped).toBe(0);
            expect(result.totalTokensEstimated).toBe(0);
            expect(result.chunkIds).toHaveLength(0);
        });

        it("does not call embedBatch when there are no chunks", async () => {
            const emptyStructure = makeParsedStructure({
                sections: [],
                tables: [],
                figures: [],
                rawText: "",
            });

            (deepParse as any).mockResolvedValue(emptyStructure);
            (hierarchicalChunk as any).mockReturnValue([]);

            await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(mockEmbedBatch).not.toHaveBeenCalled();
        });

        it("does not execute tsvector update when there are no chunks", async () => {
            const emptyStructure = makeParsedStructure({
                sections: [],
                tables: [],
                figures: [],
                rawText: "",
            });

            (deepParse as any).mockResolvedValue(emptyStructure);
            (hierarchicalChunk as any).mockReturnValue([]);

            await ingestDocument(makeDocumentInput(), makeDefaultOptions());

            expect(db.execute).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // 4. Export surface
    // -----------------------------------------------------------------------
    describe("exports", () => {
        it("ingestDocument is exported as a standalone function", () => {
            expect(typeof ingestDocument).toBe("function");
        });

        it("ingestDocument is also available on the ingestionPipeline object", () => {
            expect(typeof ingestionPipeline.ingestDocument).toBe("function");
            expect(ingestionPipeline.ingestDocument).toBe(ingestDocument);
        });

        it("existing ingest function is still exported on ingestionPipeline", () => {
            expect(typeof ingestionPipeline.ingest).toBe("function");
        });

        it("existing deleteBySource function is still exported on ingestionPipeline", () => {
            expect(typeof ingestionPipeline.deleteBySource).toBe("function");
        });
    });
});
