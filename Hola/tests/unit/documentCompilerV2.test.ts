/**
 * Document Compiler V2 — Comprehensive Test Suite
 *
 * Tests cover:
 *   1. Design Tokens: parsing, versioning, theme resolution, variants
 *   2. Document IR: schema validation, normalization, minimal IR
 *   3. Component Registry: normalization, fallback chains, sanitization
 *   4. Layout Engine: slide splitting, table splitting, height estimation
 *   5. Preflight Validator: structure, security, colors, images
 *   6. Graceful Degradation: component fallback, manifest tracking
 *   7. Format Compilers: DOCX/XLSX/PPTX output validity
 *   8. End-to-end: full pipeline producing valid files
 *   9. Adversarial: formula injection, path traversal, overflow, control chars
 */

import { describe, it, expect, beforeEach } from "vitest";

// Design Tokens
import {
  DesignTokensV2Schema,
  resolveTokens,
  applyVariant,
  THEME_PRESETS_V2,
  parseSemver,
  isCompatible,
} from "../../server/agent/documents/designTokens";

// Document IR
import {
  DocumentIRSchema,
  parseDocumentIR,
  createMinimalIR,
  type DocumentIR,
} from "../../server/agent/documents/documentIR";

// Component Registry
import {
  normalizeBlock,
  getFallbackChain,
  isComponentSupported,
  COMPONENT_CONTRACTS,
  resolveTextStyleForBlock,
} from "../../server/agent/documents/componentRegistry";

// Layout Engine
import { LayoutEngineV2 } from "../../server/agent/documents/layoutEngineV2";

// Preflight Validator
import { PreflightValidator } from "../../server/agent/documents/preflightValidator";

// Graceful Degradation
import { DegradationEngine } from "../../server/agent/documents/gracefulDegradation";

// Compiler V2
import { DocumentCompilerV2 } from "../../server/agent/documents/documentCompilerV2";

/* ================================================================== */
/*  1. DESIGN TOKENS                                                   */
/* ================================================================== */

describe("DesignTokensV2", () => {
  it("should parse default tokens", () => {
    const tokens = DesignTokensV2Schema.parse({});
    expect(tokens.name).toBe("default");
    expect(tokens.version).toBe("1.0.0");
    expect(tokens.colors.primary).toBe("#1a73e8");
    expect(tokens.textStyles.body.fontFamily).toBe("Calibri");
  });

  it("should resolve theme by name", () => {
    const tokens = resolveTokens("corporate");
    expect(tokens.name).toBe("corporate");
    expect(tokens.colors.primary).toBe("#1a365d");
  });

  it("should fall back to default for unknown theme", () => {
    const tokens = resolveTokens("nonexistent_theme");
    expect(tokens.name).toBe("default");
  });

  it("should fall back for undefined", () => {
    const tokens = resolveTokens(undefined);
    expect(tokens.name).toBe("default");
  });

  it("should reject prototype pollution", () => {
    const tokens = resolveTokens({ __proto__: { admin: true } } as any);
    expect(tokens.name).toBe("default");
  });

  it("should parse partial overrides", () => {
    const tokens = resolveTokens({
      name: "custom",
      colors: { primary: "#ff0000" },
    });
    expect(tokens.name).toBe("custom");
    expect(tokens.colors.primary).toBe("#ff0000");
    // Non-overridden values should have defaults
    expect(tokens.colors.secondary).toBe("#34a853");
  });

  it("should have all preset themes", () => {
    expect(Object.keys(THEME_PRESETS_V2)).toContain("corporate");
    expect(Object.keys(THEME_PRESETS_V2)).toContain("academic");
    expect(Object.keys(THEME_PRESETS_V2)).toContain("modern");
    expect(Object.keys(THEME_PRESETS_V2)).toContain("minimal");
    expect(Object.keys(THEME_PRESETS_V2)).toContain("dark");
  });

  it("should apply section variants", () => {
    const base = DesignTokensV2Schema.parse({
      name: "test",
      colors: { primary: "#000000" },
      sectionVariants: {
        highlight: {
          colors: { primary: "#ff0000" },
        },
      },
    });
    const merged = applyVariant(base, "highlight");
    expect(merged.colors.primary).toBe("#ff0000");
    // Base should not be mutated
    expect(base.colors.primary).toBe("#000000");
  });

  it("should parse semver correctly", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver("0.0.1")).toEqual({ major: 0, minor: 0, patch: 1 });
  });

  it("should check semver compatibility", () => {
    expect(isCompatible("1.0.0", "1.0.0")).toBe(true);
    expect(isCompatible("1.0.0", "1.1.0")).toBe(true);
    expect(isCompatible("1.0.0", "2.0.0")).toBe(false);
  });
});

/* ================================================================== */
/*  2. DOCUMENT IR                                                     */
/* ================================================================== */

describe("DocumentIR", () => {
  it("should parse a valid IR", () => {
    const result = parseDocumentIR({
      format: "docx",
      sections: [
        {
          blocks: [
            { type: "heading", level: 1, text: "Hello World" },
            { type: "paragraph", text: "This is a test." },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data?.sections).toHaveLength(1);
    expect(result.data?.sections[0].blocks).toHaveLength(2);
  });

  it("should assign auto IDs to sections", () => {
    const result = parseDocumentIR({
      format: "pptx",
      sections: [
        { blocks: [{ type: "heading", level: 1, text: "Slide 1" }] },
        { blocks: [{ type: "heading", level: 1, text: "Slide 2" }] },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data?.sections[0].id).toBe("section_1");
    expect(result.data?.sections[1].id).toBe("section_2");
  });

  it("should reject invalid format", () => {
    const result = parseDocumentIR({
      format: "pdf",
      sections: [{ blocks: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing sections", () => {
    const result = parseDocumentIR({ format: "docx" });
    expect(result.success).toBe(false);
  });

  it("should create a minimal IR", () => {
    const ir = createMinimalIR("pptx", "Test Presentation");
    expect(ir.format).toBe("pptx");
    expect(ir.metadata.title).toBe("Test Presentation");
    expect(ir.sections).toHaveLength(1);
    expect(ir.sections[0].blocks[0].type).toBe("heading");
  });

  it("should parse complex blocks", () => {
    const result = parseDocumentIR({
      format: "xlsx",
      sections: [{
        blocks: [
          {
            type: "table",
            columns: [
              { key: "name", header: "Name" },
              { key: "value", header: "Value", type: "number" },
            ],
            rows: [
              { name: "A", value: 1 },
              { name: "B", value: 2 },
            ],
          },
        ],
      }],
    });
    expect(result.success).toBe(true);
  });

  it("should parse KPI card blocks", () => {
    const result = parseDocumentIR({
      format: "pptx",
      sections: [{
        blocks: [{
          type: "kpi_card",
          title: "Revenue",
          value: "$1.2M",
          change: 12.5,
          changeDirection: "up",
          icon: "trending",
        }],
      }],
    });
    expect(result.success).toBe(true);
  });
});

/* ================================================================== */
/*  3. COMPONENT REGISTRY                                              */
/* ================================================================== */

describe("ComponentRegistry", () => {
  const tokens = resolveTokens("corporate");

  it("should normalize a heading block", () => {
    const block = { type: "heading" as const, level: 1, text: "Hello", constraints: {} };
    const { block: normalized, warnings } = normalizeBlock(block, tokens);
    expect(warnings).toHaveLength(0);
    expect(normalized.type).toBe("heading");
  });

  it("should truncate long text", () => {
    const longText = "x".repeat(600);
    const block = { type: "heading" as const, level: 1, text: longText, constraints: {} };
    const { block: normalized, warnings } = normalizeBlock(block, tokens);
    expect(warnings.length).toBeGreaterThan(0);
    expect((normalized as any).text.length).toBeLessThanOrEqual(500);
  });

  it("should cap list items", () => {
    const items = Array(300).fill("item");
    const block = { type: "bullets" as const, items, level: 0, constraints: {} };
    const { block: normalized, warnings } = normalizeBlock(block, tokens);
    expect((normalized as any).items.length).toBeLessThanOrEqual(200);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("should sanitize formula injection in tables", () => {
    const block = {
      type: "table" as const,
      columns: [{ key: "cmd", header: "Command" }],
      rows: [{ cmd: "=HYPERLINK(\"http://evil.com\")" }],
      showHeader: true,
      showStripes: true,
      constraints: {},
    };
    const { block: normalized } = normalizeBlock(block, tokens);
    const firstRow = (normalized as any).rows[0];
    expect(firstRow.cmd).toMatch(/^'/); // Should be prefixed with '
  });

  it("should strip control characters", () => {
    const block = {
      type: "paragraph" as const,
      text: "Hello\x00World\x1F!",
      constraints: {},
    };
    const { block: normalized } = normalizeBlock(block, tokens);
    // Control chars \x00 and \x1F are stripped (not replaced with space)
    expect((normalized as any).text).toBe("HelloWorld!");
  });

  it("should return fallback chains", () => {
    const chain = getFallbackChain("chart");
    expect(chain).toContain("chart");
    expect(chain).toContain("table");
    expect(chain).toContain("paragraph");
  });

  it("should check component format support", () => {
    expect(isComponentSupported("heading", "docx")).toBe(true);
    expect(isComponentSupported("toc", "docx")).toBe(true);
    expect(isComponentSupported("toc", "pptx")).toBe(false);
    expect(isComponentSupported("toc", "xlsx")).toBe(false);
  });

  it("should have contracts for all block types", () => {
    const expectedTypes = [
      "heading", "paragraph", "richtext", "bullets", "numbered",
      "table", "chart", "image", "kpi_card", "badge", "callout",
      "quote", "code", "divider", "spacer", "page_break", "toc", "columns",
    ];
    for (const type of expectedTypes) {
      expect(COMPONENT_CONTRACTS[type]).toBeDefined();
    }
  });

  it("should resolve text styles for blocks", () => {
    const headingBlock = { type: "heading" as const, level: 1, text: "H1", constraints: {} };
    const style = resolveTextStyleForBlock(headingBlock, tokens);
    expect(style.fontFamily).toBe("Calibri");
    expect(style.fontWeight).toBe("bold");
  });
});

/* ================================================================== */
/*  4. LAYOUT ENGINE                                                   */
/* ================================================================== */

describe("LayoutEngineV2", () => {
  const tokens = resolveTokens("corporate");
  const engine = new LayoutEngineV2(tokens);

  it("should compute slide layouts", () => {
    const sections = [{
      blocks: [
        { type: "heading" as const, level: 1, text: "Title", constraints: {} },
        { type: "paragraph" as const, text: "Content paragraph.", constraints: {} },
      ],
    }];
    const slides = engine.computeSlideLayouts(sections as any);
    expect(slides.length).toBeGreaterThanOrEqual(1);
    expect(slides[0].components.length).toBeGreaterThanOrEqual(1);
  });

  it("should split overflowing sections into multiple slides", () => {
    const blocks = Array(20).fill(null).map((_, i) => ({
      type: "paragraph" as const,
      text: `Paragraph ${i + 1}: ${"Lorem ipsum dolor sit amet. ".repeat(10)}`,
      constraints: {},
    }));
    const sections = [{ blocks }];
    const slides = engine.computeSlideLayouts(sections as any);
    expect(slides.length).toBeGreaterThan(1);
  });

  it("should compute page layouts", () => {
    const sections = [{
      blocks: [
        { type: "heading" as const, level: 1, text: "Title", constraints: {} },
        { type: "paragraph" as const, text: "Body text.", constraints: {} },
      ],
    }];
    const pages = engine.computePageLayouts(sections as any);
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle page breaks", () => {
    const sections = [{
      blocks: [
        { type: "heading" as const, level: 1, text: "Page 1", constraints: {} },
        { type: "page_break" as const },
        { type: "heading" as const, level: 1, text: "Page 2", constraints: {} },
      ],
    }];
    const pages = engine.computePageLayouts(sections as any);
    expect(pages.length).toBe(2);
  });

  it("should split large tables", () => {
    const rows = Array(100).fill({ a: 1, b: 2 });
    const chunks = engine.splitTableRows([{ key: "a" }, { key: "b" }], rows, 20);
    expect(chunks.length).toBe(5);
    expect(chunks[0].isFirstChunk).toBe(true);
    expect(chunks[1].isFirstChunk).toBe(false);
  });

  it("should split bullet items", () => {
    const items = Array(25).fill("item");
    const groups = engine.splitBulletItems(items, 8);
    expect(groups.length).toBe(4);
  });

  it("should estimate block heights", () => {
    const heading = { type: "heading" as const, level: 1, text: "H1", constraints: {} };
    const h = engine.estimateBlockHeight(heading, 8);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(5);
  });

  it("should compute column widths", () => {
    const cols = [{ header: "Name" }, { header: "Value" }];
    const rows = [{ Name: "Alpha", Value: 12345 }];
    const widths = engine.computeColumnWidths(cols, rows);
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeGreaterThanOrEqual(8);
  });
});

/* ================================================================== */
/*  5. PREFLIGHT VALIDATOR                                             */
/* ================================================================== */

describe("PreflightValidator", () => {
  const validator = new PreflightValidator();
  const tokens = resolveTokens("corporate");

  function makeIR(overrides: Partial<DocumentIR> = {}): DocumentIR {
    return {
      schemaVersion: "2.0.0",
      format: "docx",
      metadata: { title: "Test", keywords: [], language: "en", custom: {} },
      theme: "default",
      sections: [{ blocks: [{ type: "heading", level: 1, text: "Hello", constraints: {} }] }],
      constraints: {},
      ...overrides,
    } as DocumentIR;
  }

  it("should validate a correct document", () => {
    const report = validator.validate(makeIR(), tokens);
    expect(report.valid).toBe(true);
    expect(report.errors).toBe(0);
  });

  it("should warn on empty title", () => {
    const ir = makeIR({ metadata: { title: "", keywords: [], language: "en", custom: {} } });
    const report = validator.validate(ir, tokens);
    expect(report.issues.some(i => i.code === "PREFLIGHT_EMPTY_TITLE")).toBe(true);
  });

  it("should auto-truncate long titles", () => {
    const longTitle = "A".repeat(600);
    const ir = makeIR({ metadata: { title: longTitle, keywords: [], language: "en", custom: {} } });
    const report = validator.validate(ir, tokens);
    expect(ir.metadata.title.length).toBeLessThanOrEqual(500);
    // Title truncation is recorded as an info issue
    expect(report.issues.some(i => i.code === "PREFLIGHT_TITLE_TRUNCATED")).toBe(true);
  });

  it("should detect unsafe image paths", () => {
    const ir = makeIR({
      sections: [{
        blocks: [{
          type: "image",
          src: "javascript:alert(1)",
          alt: "test",
          fit: "contain",
          constraints: {},
        }],
      }],
    });
    const report = validator.validate(ir, tokens);
    expect(report.issues.some(i => i.code === "PREFLIGHT_IMAGE_UNSAFE_PATH")).toBe(true);
  });

  it("should detect path traversal", () => {
    const ir = makeIR({
      sections: [{
        blocks: [{
          type: "image",
          src: "../../etc/passwd",
          alt: "test",
          fit: "contain",
          constraints: {},
        }],
      }],
    });
    const report = validator.validate(ir, tokens);
    expect(report.issues.some(i => i.code === "PREFLIGHT_IMAGE_UNSAFE_PATH")).toBe(true);
  });

  it("should detect UNC paths", () => {
    const ir = makeIR({
      sections: [{
        blocks: [{
          type: "image",
          src: "\\\\evil-server\\share\\file.jpg",
          alt: "test",
          fit: "contain",
          constraints: {},
        }],
      }],
    });
    const report = validator.validate(ir, tokens);
    expect(report.issues.some(i => i.code === "PREFLIGHT_IMAGE_UNSAFE_PATH")).toBe(true);
  });

  it("should warn on unsupported components", () => {
    const ir = makeIR({
      format: "xlsx",
      sections: [{
        blocks: [{ type: "toc", maxLevel: 3 }],
      }],
    });
    const report = validator.validate(ir, tokens);
    expect(report.issues.some(i => i.code === "PREFLIGHT_UNSUPPORTED_COMPONENT")).toBe(true);
  });

  it("should sanitize control characters", () => {
    const ir = makeIR({
      sections: [{
        blocks: [{ type: "heading", level: 1, text: "Hello\x00\x01\x02World", constraints: {} }],
      }],
    });
    validator.validate(ir, tokens);
    // Control chars are stripped (not replaced with space)
    expect((ir.sections[0].blocks[0] as any).text).toBe("HelloWorld");
  });

  it("should detect empty tables", () => {
    const ir = makeIR({
      sections: [{
        blocks: [{
          type: "table",
          columns: [],
          rows: [],
          showHeader: true,
          showStripes: true,
          constraints: {},
        }],
      }],
    });
    const report = validator.validate(ir, tokens);
    expect(report.issues.some(i => i.code === "PREFLIGHT_TABLE_NO_COLUMNS")).toBe(true);
  });
});

/* ================================================================== */
/*  6. GRACEFUL DEGRADATION                                            */
/* ================================================================== */

describe("DegradationEngine", () => {
  let engine: DegradationEngine;

  beforeEach(() => {
    engine = new DegradationEngine();
  });

  it("should pass through successful renders", async () => {
    const block = { type: "heading" as const, level: 1, text: "Hello", constraints: {} };
    const result = await engine.withDegradation(
      block,
      "test.path",
      () => "success",
      () => "fallback",
    );
    expect(result).toBe("success");
    expect(engine.getManifest().intact).toBe(true);
  });

  it("should degrade to fallback on error", async () => {
    const block = { type: "chart" as const, chartType: "bar", labels: [], datasets: [], constraints: {} } as any;
    const result = await engine.withDegradation(
      block,
      "test.path",
      () => { throw new Error("chart render failed"); },
      () => "fallback_result",
    );
    expect(result).toBe("fallback_result");
    const manifest = engine.getManifest();
    expect(manifest.intact).toBe(false);
    expect(manifest.count).toBe(1);
    expect(manifest.entries[0].originalType).toBe("chart");
  });

  it("should record degradation details", async () => {
    const block = { type: "kpi_card" as const, title: "Revenue", value: 100, constraints: {} } as any;
    await engine.withDegradation(
      block,
      "sections[0].blocks[2]",
      () => { throw new Error("render error"); },
      () => "ok",
    );
    const entry = engine.getManifest().entries[0];
    expect(entry.path).toBe("sections[0].blocks[2]");
    expect(entry.error).toContain("render error");
  });

  it("should reset between compilations", () => {
    engine.withDegradationSync(
      { type: "paragraph" as const, text: "test", constraints: {} },
      "path",
      () => { throw new Error("fail"); },
      () => "ok",
    );
    expect(engine.getManifest().count).toBe(1);
    engine.reset();
    expect(engine.getManifest().count).toBe(0);
  });
});

/* ================================================================== */
/*  7. END-TO-END COMPILATION                                         */
/* ================================================================== */

describe("DocumentCompilerV2 — End-to-End", () => {
  const compiler = new DocumentCompilerV2();

  it("should compile a DOCX document", async () => {
    const output = await compiler.compile({
      format: "docx",
      metadata: { title: "Test Document" },
      sections: [{
        blocks: [
          { type: "heading", level: 1, text: "Chapter 1" },
          { type: "paragraph", text: "This is the first paragraph." },
          { type: "bullets", items: ["Item A", "Item B", "Item C"] },
          { type: "table", columns: [{ key: "n", header: "Name" }, { key: "v", header: "Value" }], rows: [{ n: "Alpha", v: 1 }] },
        ],
      }],
    });

    expect(output.buffer).toBeInstanceOf(Buffer);
    expect(output.buffer.length).toBeGreaterThan(100);
    expect(output.filename).toBe("Test Document.docx");
    expect(output.mimeType).toContain("wordprocessingml");
    expect(output.format).toBe("docx");
  }, 30_000);

  it("should compile an XLSX workbook", async () => {
    const output = await compiler.compile({
      format: "xlsx",
      metadata: { title: "Test Workbook" },
      sections: [{
        title: "Data",
        blocks: [{
          type: "table",
          columns: [
            { key: "name", header: "Name" },
            { key: "amount", header: "Amount", type: "number" },
          ],
          rows: [
            { name: "Alice", amount: 100 },
            { name: "Bob", amount: 200 },
          ],
        }],
      }],
    });

    expect(output.buffer).toBeInstanceOf(Buffer);
    expect(output.buffer.length).toBeGreaterThan(100);
    expect(output.filename).toBe("Test Workbook.xlsx");
    expect(output.mimeType).toContain("spreadsheetml");
  }, 30_000);

  it("should compile a PPTX presentation", async () => {
    const output = await compiler.compile({
      format: "pptx",
      metadata: { title: "Test Presentation" },
      theme: "corporate",
      sections: [
        {
          slideType: "cover",
          blocks: [
            { type: "heading", level: 1, text: "Welcome" },
            { type: "paragraph", text: "Subtitle goes here" },
          ],
        },
        {
          slideType: "content",
          blocks: [
            { type: "heading", level: 2, text: "Agenda" },
            { type: "bullets", items: ["Topic 1", "Topic 2", "Topic 3"] },
          ],
        },
      ],
    });

    expect(output.buffer).toBeInstanceOf(Buffer);
    expect(output.buffer.length).toBeGreaterThan(100);
    expect(output.filename).toBe("Test Presentation.pptx");
    expect(output.mimeType).toContain("presentationml");
  }, 30_000);

  it("should never throw, even with invalid input", async () => {
    const output = await compiler.compile({});
    expect(output.buffer).toBeInstanceOf(Buffer);
    // Invalid input produces a minimal fallback document
    expect(output.buffer.length).toBeGreaterThan(0);
    expect(output.metrics.normalizeWarnings.length).toBeGreaterThan(0);
  }, 30_000);

  it("should handle null/undefined input", async () => {
    const output = await compiler.compile(null);
    expect(output.buffer).toBeInstanceOf(Buffer);
  }, 30_000);

  it("should include degradation manifest", async () => {
    const output = await compiler.compile({
      format: "docx",
      metadata: { title: "Test" },
      sections: [{
        blocks: [
          { type: "heading", level: 1, text: "Title" },
          { type: "paragraph", text: "Normal paragraph" },
        ],
      }],
    });

    expect(output.degradation).toBeDefined();
    expect(typeof output.degradation.count).toBe("number");
    expect(Array.isArray(output.degradation.entries)).toBe(true);
  }, 30_000);

  it("should compile with all themes", async () => {
    const themes = ["default", "corporate", "academic", "modern", "minimal", "dark"];
    for (const theme of themes) {
      const output = await compiler.compile({
        format: "docx",
        metadata: { title: `Theme: ${theme}` },
        theme,
        sections: [{
          blocks: [{ type: "heading", level: 1, text: `Theme ${theme}` }],
        }],
      });
      expect(output.buffer.length).toBeGreaterThan(100);
    }
  }, 60_000);

  it("should handle complex multi-section documents", async () => {
    const output = await compiler.compile({
      format: "docx",
      metadata: { title: "Complex Document", author: "Test", subject: "Testing" },
      theme: "corporate",
      sections: [
        {
          title: "Introduction",
          blocks: [
            { type: "heading", level: 1, text: "Introduction" },
            { type: "paragraph", text: "Welcome to this document." },
            { type: "callout", variant: "info", title: "Note", text: "Important information here." },
          ],
        },
        {
          title: "Data",
          blocks: [
            { type: "heading", level: 1, text: "Data Analysis" },
            {
              type: "table",
              columns: [
                { key: "metric", header: "Metric" },
                { key: "value", header: "Value" },
                { key: "change", header: "Change" },
              ],
              rows: [
                { metric: "Revenue", value: "$1.2M", change: "+15%" },
                { metric: "Users", value: "50,000", change: "+23%" },
              ],
            },
            { type: "quote", text: "Data is the new oil.", attribution: "Clive Humby" },
          ],
        },
        {
          title: "Conclusion",
          blocks: [
            { type: "heading", level: 1, text: "Conclusion" },
            { type: "numbered", items: ["First point", "Second point", "Third point"] },
            { type: "badge", text: "COMPLETED", variant: "success" },
          ],
        },
      ],
    });

    expect(output.buffer.length).toBeGreaterThan(500);
    expect(output.preflight.valid).toBe(true);
  }, 30_000);
});

/* ================================================================== */
/*  8. ADVERSARIAL / SECURITY TESTS                                    */
/* ================================================================== */

describe("Adversarial & Security", () => {
  const compiler = new DocumentCompilerV2();
  const tokens = resolveTokens("default");

  it("should sanitize formula injection in tables", async () => {
    const output = await compiler.compile({
      format: "xlsx",
      metadata: { title: "Formula Test" },
      sections: [{
        blocks: [{
          type: "table",
          columns: [{ key: "cmd", header: "Command" }],
          rows: [
            { cmd: "=HYPERLINK(\"http://evil.com\")" },
            { cmd: "+cmd|'/C calc'" },
            { cmd: "-5+3" },
            { cmd: "@SUM(A1:A10)" },
          ],
        }],
      }],
    });
    expect(output.buffer.length).toBeGreaterThan(100);
  }, 30_000);

  it("should handle extremely long text", async () => {
    const longText = "x".repeat(500_000);
    const output = await compiler.compile({
      format: "docx",
      metadata: { title: "Long Text" },
      sections: [{
        blocks: [{ type: "paragraph", text: longText }],
      }],
    });
    expect(output.buffer).toBeInstanceOf(Buffer);
    expect(output.buffer.length).toBeGreaterThan(0);
  }, 30_000);

  it("should handle many sections", async () => {
    const sections = Array(100).fill(null).map((_, i) => ({
      blocks: [{ type: "heading" as const, level: 1, text: `Section ${i}` }],
    }));

    const output = await compiler.compile({
      format: "pptx",
      metadata: { title: "Many Slides" },
      sections,
    });
    expect(output.buffer).toBeInstanceOf(Buffer);
    expect(output.buffer.length).toBeGreaterThan(100);
  }, 60_000);

  it("should handle unicode content", async () => {
    const output = await compiler.compile({
      format: "docx",
      metadata: { title: "Unicode: Ñ ü ö ä 日本語 中文" },
      sections: [{
        blocks: [
          { type: "heading", level: 1, text: "Título con acentos: àáâãäå" },
          { type: "paragraph", text: "日本語テスト 中文测试 한국어 العربية" },
          { type: "bullets", items: ["Café", "naïve", "résumé", "Ünterwegs"] },
        ],
      }],
    });
    expect(output.buffer.length).toBeGreaterThan(100);
  }, 30_000);

  it("should reject dangerous image paths", () => {
    const validator = new PreflightValidator();
    const ir: DocumentIR = {
      schemaVersion: "2.0.0",
      format: "docx",
      metadata: { title: "Test", keywords: [], language: "en", custom: {} },
      theme: "default",
      sections: [{
        blocks: [
          { type: "image", src: "file:///etc/shadow", alt: "", fit: "contain", constraints: {} } as any,
          { type: "image", src: "/proc/self/environ", alt: "", fit: "contain", constraints: {} } as any,
          { type: "image", src: "data:text/html,<script>alert(1)</script>", alt: "", fit: "contain", constraints: {} } as any,
        ],
      }],
      constraints: {},
    };
    const report = validator.validate(ir, tokens);
    const unsafeIssues = report.issues.filter(i => i.code === "PREFLIGHT_IMAGE_UNSAFE_PATH");
    expect(unsafeIssues.length).toBe(3);
  });

  it("should normalize block with empty items gracefully", () => {
    const block = { type: "bullets" as const, items: [], level: 0, constraints: {} };
    const { block: normalized, warnings } = normalizeBlock(block, tokens);
    expect(normalized.type).toBe("bullets");
  });
});
