import { describe, it, expect } from "vitest";
import { parsePdf } from "../pdfStructuredParser";

describe("parsePdf", () => {
    it("extracts text from a simple PDF buffer", async () => {
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
