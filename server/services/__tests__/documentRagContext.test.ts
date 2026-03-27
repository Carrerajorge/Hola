import { describe, expect, it } from "vitest";
import {
  buildRelevantConversationDocumentContext,
  conversationDocumentsToChunks,
  selectRelevantDocumentChunks,
} from "../documentRagContext";

describe("documentRagContext", () => {
  it("prioritizes the chunk that best matches the active question", async () => {
    const selected = await selectRelevantDocumentChunks(
      "cuales fueron los ingresos y el EBITDA del Q4 LATAM",
      [
        {
          filename: "reporte-q4.pdf",
          content:
            "El reporte del Q4 LATAM muestra ingresos record, EBITDA positivo y crecimiento de revenue en Mexico y Peru.",
          location: { page: 2 },
        },
        {
          filename: "manual-rrhh.docx",
          content:
            "Politica de vacaciones, licencias, feriados corporativos y conducta del empleado.",
          location: { page: 1 },
        },
        {
          filename: "bugs.txt",
          content:
            "Stack trace de null pointer exception en login y timeout en websocket.",
          location: { chunkIndex: 1 },
        },
      ],
      { maxChunks: 2 },
    );

    expect(selected.length).toBeGreaterThan(0);
    expect(selected[0].filename).toBe("reporte-q4.pdf");
    expect(selected[0].citation).toBe("doc:reporte-q4.pdf p2");
    expect(selected.some((chunk) => chunk.filename === "manual-rrhh.docx")).toBe(
      false,
    );
  });

  it("respects per-document diversity when several chunks from one file compete", async () => {
    const selected = await selectRelevantDocumentChunks(
      "explica el pipeline RAG con retrieval y reranking",
      [
        {
          filename: "arquitectura.md",
          content:
            "El pipeline RAG usa retrieval semantico, reranking y citas para responder preguntas tecnicas.",
          location: { chunkIndex: 1 },
        },
        {
          filename: "arquitectura.md",
          content:
            "El retrieval recupera chunks y el reranking elimina ruido antes de pasar contexto al modelo.",
          location: { chunkIndex: 2 },
        },
        {
          filename: "operacion.md",
          content:
            "La operacion del sistema incluye un pipeline RAG con retrieval hibrido, reranking y trazabilidad documental.",
          location: { chunkIndex: 1 },
        },
      ],
      {
        maxChunks: 2,
        perDocumentLimit: 1,
        minScore: 0.05,
      },
    );

    expect(selected).toHaveLength(2);
    expect(new Set(selected.map((chunk) => chunk.filename)).size).toBe(2);
  });

  it("preserves page, slide and sheet locations for downstream citations", () => {
    const chunks = conversationDocumentsToChunks([
      {
        id: "doc-pdf",
        fileName: "informe.pdf",
        extractedText:
          "=== Page 1 ===\nResumen ejecutivo.\n=== Page 2 ===\nEl EBITDA del Q4 LATAM subio 18 por ciento.",
      },
      {
        id: "doc-ppt",
        fileName: "roadmap.pptx",
        extractedText:
          "## Slide 1\nIntroduccion.\n## Slide 2\nArquitectura RAG nativa con reranking y citas.",
      },
      {
        id: "doc-xlsx",
        fileName: "ventas.xlsx",
        extractedText:
          "### Sheet: Ventas\nIngresos LATAM, EBITDA, crecimiento Q4.",
      },
    ]);

    expect(chunks.some((chunk) => chunk.filename === "informe.pdf" && chunk.location?.page === 2)).toBe(true);
    expect(chunks.some((chunk) => chunk.filename === "roadmap.pptx" && chunk.location?.slide === 2)).toBe(true);
    expect(chunks.some((chunk) => chunk.filename === "ventas.xlsx" && chunk.location?.sheet === "Ventas")).toBe(true);
  });

  it("builds document context with location-aware citations for persistent conversation files", async () => {
    const slideContext = await buildRelevantConversationDocumentContext(
      "necesito la arquitectura RAG nativa",
      [
        {
          fileName: "roadmap.pptx",
          extractedText:
            "## Slide 1\nIntroduccion.\n## Slide 2\nArquitectura RAG nativa con reranking y citas.",
        },
      ],
    );
    expect(slideContext).toContain("[CONTEXTO DOCUMENTAL RELEVANTE]");
    expect(slideContext).toContain("doc:roadmap.pptx slide:2");

    const sheetContext = await buildRelevantConversationDocumentContext(
      "dame los ingresos LATAM de ventas",
      [
        {
          fileName: "ventas.xlsx",
          extractedText:
            "### Sheet: Ventas\nIngresos LATAM, EBITDA, crecimiento Q4.",
        },
      ],
    );
    expect(sheetContext).toContain("doc:ventas.xlsx sheet:Ventas");

    const pageContext = await buildRelevantConversationDocumentContext(
      "cuanto fue el EBITDA del Q4 LATAM",
      [
        {
          fileName: "informe.pdf",
          extractedText:
            "=== Page 1 ===\nResumen ejecutivo.\n=== Page 2 ===\nEl EBITDA del Q4 LATAM subio 18 por ciento.",
        },
      ],
    );
    expect(pageContext).toContain("doc:informe.pdf p2");
  });
});
