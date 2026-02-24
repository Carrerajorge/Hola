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
    it("returns correct parser for document MIME types", () => {
        expect(selectParser("application/pdf").name).toBe("pdf");
        expect(selectParser("application/vnd.openxmlformats-officedocument.wordprocessingml.document").name).toBe("docx");
        expect(selectParser("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").name).toBe("spreadsheet");
    });

    it("returns correct parser for media and text MIME types", () => {
        expect(selectParser("image/png").name).toBe("image");
        expect(selectParser("text/plain").name).toBe("text");
        expect(selectParser("text/markdown").name).toBe("text");
        expect(selectParser("unknown/type").name).toBe("text"); // fallback
    });
});
