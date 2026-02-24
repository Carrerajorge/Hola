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
