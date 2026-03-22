import { describe, expect, it } from "vitest";
import {
  hasExplicitDocumentArtifactRequest,
  hasExplicitSpreadsheetArtifactRequest,
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
