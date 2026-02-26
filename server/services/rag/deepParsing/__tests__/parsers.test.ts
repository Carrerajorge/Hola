import { describe, it, expect } from "vitest";
import { parseDocx } from "../docxStructuredParser";
import { parseSpreadsheet } from "../spreadsheetParser";
import { parseImage } from "../imageParser";
import { parseText } from "../textParser";

describe("parseDocx", () => {
    it("extracts text from buffer", async () => {
        const text = "This is a document about testing.";
        const buffer = Buffer.from(text);
        const result = await parseDocx(buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "test.docx");

        expect(result.rawText.length).toBeGreaterThan(0);
        expect(result.sections.length).toBeGreaterThan(0);
        expect(result.metadata.wordCount).toBeGreaterThan(0);
    });

    it("handles empty buffer", async () => {
        const buffer = Buffer.alloc(0);
        const result = await parseDocx(buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "empty.docx");
        expect(result.rawText).toBe("");
        expect(result.metadata.wordCount).toBe(0);
    });
});

describe("parseSpreadsheet", () => {
    it("extracts data from a CSV-like text buffer", async () => {
        const csv = "Name,Age,City\nAlice,30,Madrid\nBob,25,Barcelona";
        const buffer = Buffer.from(csv);
        const result = await parseSpreadsheet(buffer, "text/csv", "data.csv");

        expect(result.rawText.length).toBeGreaterThan(0);
        expect(result.metadata.hasTables).toBe(true);
        expect(result.sections.length).toBeGreaterThan(0);
    });

    it("handles empty buffer", async () => {
        const buffer = Buffer.alloc(0);
        const result = await parseSpreadsheet(buffer, "text/csv", "empty.csv");
        expect(result.metadata.wordCount).toBe(0);
    });
});

describe("parseImage", () => {
    it("returns figure metadata for image buffer", async () => {
        const buffer = Buffer.from("fake-image-data");
        const result = await parseImage(buffer, "image/png", "photo.png");

        expect(result.figures.length).toBeGreaterThan(0);
        expect(result.metadata.hasImages).toBe(true);
        expect(result.figures[0].caption).toContain("photo.png");
    });

    it("handles empty buffer", async () => {
        const buffer = Buffer.alloc(0);
        const result = await parseImage(buffer, "image/jpeg", "empty.jpg");
        expect(result.figures.length).toBeGreaterThan(0);
        expect(result.metadata.hasImages).toBe(true);
    });
});

describe("parseText", () => {
    it("parses markdown with headings into sections", async () => {
        const md = "# Main Title\n\nIntro paragraph.\n\n## Section One\n\nContent here.\n\n## Section Two\n\nMore content.";
        const buffer = Buffer.from(md);
        const result = await parseText(buffer, "text/markdown", "doc.md");

        expect(result.sections.length).toBeGreaterThan(1);
        const headings = result.sections.filter(s => s.type === "heading");
        expect(headings.length).toBeGreaterThan(0);
    });

    it("detects tables in markdown", async () => {
        const md = "# Data\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
        const buffer = Buffer.from(md);
        const result = await parseText(buffer, "text/markdown", "table.md");

        expect(result.tables.length).toBeGreaterThan(0);
        expect(result.tables[0].headers).toContain("A");
    });

    it("detects document type from content", async () => {
        const text = "Abstract\nThis paper presents a methodology...\nConclusion\nOur results show...\nReferences\n[1] Author et al.";
        const buffer = Buffer.from(text);
        const result = await parseText(buffer, "text/plain", "paper.txt");

        expect(result.metadata.documentType).toBe("paper");
    });

    it("handles empty buffer", async () => {
        const buffer = Buffer.alloc(0);
        const result = await parseText(buffer, "text/plain", "empty.txt");
        expect(result.rawText).toBe("");
    });
});
