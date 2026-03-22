import { describe, expect, it } from "vitest";
import {
  hasExplicitDocumentArtifactRequest,
  hasExplicitSpreadsheetArtifactRequest,
  classifyOutputFormat,
} from "@shared/explicitArtifactRequests";

describe("explicitArtifactRequests", () => {
  it("requires an explicit file/document signal before treating plain writing as a DOCX request", () => {
    expect(hasExplicitDocumentArtifactRequest("escribe una carta de amor de 400 palabras")).toBe(false);
    expect(hasExplicitDocumentArtifactRequest("redacta una carta formal en Word")).toBe(true);
    expect(hasExplicitDocumentArtifactRequest("crea un documento sobre energía solar")).toBe(true);
  });

  it("does not treat a plain table request as an Excel file request", () => {
    expect(hasExplicitSpreadsheetArtifactRequest("hazme una tabla con los precios")).toBe(false);
    expect(hasExplicitSpreadsheetArtifactRequest("hazme una tabla en Excel con los precios")).toBe(true);
  });
});

describe("classifyOutputFormat — universal format gate", () => {
  describe("returns 'text' for content-only requests (no file format signal)", () => {
    const textCases = [
      "crea una carta de amor en 400 palabras",
      "escribe un ensayo sobre la libertad",
      "redacta un informe ejecutivo",
      "hazme una propuesta de negocios",
      "escribe una receta de cocina",
      "crea un resumen de la reunión",
      "redacta un memorando para el equipo",
      "hazme un currículum profesional",
      "escribe un poema de amor",
      "crea una historia de ciencia ficción",
    ];

    for (const msg of textCases) {
      it(`"${msg}" → text`, () => {
        const result = classifyOutputFormat(msg);
        expect(result.action).toBe("text");
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });
    }
  });

  describe("returns 'word' when explicit Word/docx keyword is present", () => {
    const wordCases = [
      "crea una carta de amor en Word",
      "genera un informe en docx",
      "escribe un ensayo y expórtalo como .docx",
      "redacta un informe ejecutivo en formato word",
      "hazme un currículum en word",
    ];

    for (const msg of wordCases) {
      it(`"${msg}" → word`, () => {
        const result = classifyOutputFormat(msg);
        expect(result.action).toBe("word");
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });
    }
  });

  describe("returns 'excel' when explicit Excel keyword is present", () => {
    const excelCases = [
      "hazme una tabla en excel con los precios",
      "genera un archivo xlsx con los datos",
      "exporta los datos a Excel",
    ];

    for (const msg of excelCases) {
      it(`"${msg}" → excel`, () => {
        const result = classifyOutputFormat(msg);
        expect(result.action).toBe("excel");
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });
    }
  });

  describe("returns 'pptx' when explicit PowerPoint keyword is present", () => {
    const pptxCases = [
      "crea un powerpoint sobre el proyecto",
      "genera diapositivas del tema",
      "hazme unas slides para la junta",
      "crea una presentación en pptx",
    ];

    for (const msg of pptxCases) {
      it(`"${msg}" → pptx`, () => {
        const result = classifyOutputFormat(msg);
        expect(result.action).toBe("pptx");
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });
    }
  });

  describe("returns 'word' for PDF requests (closest file deliverable)", () => {
    it('"crea un informe en PDF" → word', () => {
      const result = classifyOutputFormat("crea un informe en PDF");
      expect(result.action).toBe("word");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });
});
