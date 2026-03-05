import { describe, it, expect } from "vitest";
import {
  MissingCapabilitySchema,
  CatalogEntrySchema,
  RepoSourceSchema,
  FusedManifestSchema,
  AnalysisResultSchema,
  ExportedSymbolSchema,
} from "../types";

describe("selfExpand types", () => {
  it("validates a MissingCapability", () => {
    const cap = MissingCapabilitySchema.parse({
      id: "pdf-parsing",
      keywords: ["pdf", "parse"],
      toolNameAttempted: "pdf_parse",
      userMessage: "extract text from this PDF",
      confidence: 0.9,
    });
    expect(cap.id).toBe("pdf-parsing");
    expect(cap.confidence).toBeGreaterThan(0);
  });

  it("validates a CatalogEntry with repos", () => {
    const entry = CatalogEntrySchema.parse({
      id: "pdf-parsing",
      tags: ["pdf", "parse", "document"],
      repos: [
        {
          name: "pdf-parse",
          git: "https://github.com/user/pdf-parse.git",
          extractPaths: ["lib/"],
          language: "javascript",
        },
      ],
    });
    expect(entry.repos).toHaveLength(1);
    expect(entry.repos[0].language).toBe("javascript");
  });

  it("validates a FusedManifest", () => {
    const manifest = FusedManifestSchema.parse({
      capabilityId: "pdf-parsing",
      sourceName: "pdf-parse",
      sourceGit: "https://github.com/user/pdf-parse.git",
      sourceCommitSha: "abc123",
      extractedFiles: ["lib/index.js"],
      portStrategy: "transpile-js",
      fusedAt: new Date().toISOString(),
      registeredTools: ["pdf_parse"],
      totalPortedLines: 120,
    });
    expect(manifest.registeredTools).toContain("pdf_parse");
  });

  it("validates an AnalysisResult", () => {
    const result = AnalysisResultSchema.parse({
      entryExports: [
        {
          name: "parsePdf",
          kind: "function",
          signature: "(buffer: Buffer) => Promise<PdfData>",
          sourceFile: "lib/index.js",
          lineStart: 10,
          lineEnd: 45,
          body: "function parsePdf(buffer) { ... }",
        },
      ],
      dependencies: [],
      hasNativeBindings: false,
      totalLines: 120,
      language: "javascript",
      suggestedPortStrategy: "transpile-js",
    });
    expect(result.entryExports).toHaveLength(1);
    expect(result.suggestedPortStrategy).toBe("transpile-js");
  });

  it("rejects invalid confidence (> 1)", () => {
    expect(() =>
      MissingCapabilitySchema.parse({
        id: "x",
        keywords: [],
        userMessage: "test",
        confidence: 1.5,
      })
    ).toThrow();
  });

  it("rejects unknown language in RepoSource", () => {
    expect(() =>
      RepoSourceSchema.parse({
        name: "x",
        git: "https://github.com/x.git",
        extractPaths: [],
        language: "ruby",
      })
    ).toThrow();
  });
});
