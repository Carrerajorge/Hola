/**
 * Tests for Document Compiler V2 — Robust document generation pipeline.
 *
 * Tests cover:
 *   1. Design tokens resolution and validation
 *   2. Component registry constraints
 *   3. Preflight validation and auto-fixes
 *   4. Layout guardrails (auto-fit, splitting, overflow)
 *   5. Graceful degradation
 *   6. End-to-end compilation for all 3 formats
 *   7. Edge cases: empty input, huge data, invalid chars, formula injection
 */

import { describe, it, expect, beforeEach } from "vitest";

// === Design Tokens ===
import {
  UnifiedDesignTokensSchema,
  resolveUnifiedTheme,
  extractBaseTokens,
  UNIFIED_THEMES,
} from "../../server/agent/documents/designTokens";

// === Component Registry ===
import {
  buildComponent,
  getSafeFallback,
  enforceTextConstraints,
  enforceListConstraints,
  enforceTableConstraints,
  DEFAULT_CONSTRAINTS,
} from "../../server/agent/documents/componentRegistry";

// === Layout Guardrails ===
import {
  autoFitText,
  splitBullets,
  splitTable,
  computeSlideLayout,
} from "../../server/agent/documents/layoutGuardrails";

// === Preflight Validator ===
import { PreflightValidator } from "../../server/agent/documents/preflightValidator";

// === Graceful Degradation ===
import { DegradationManager } from "../../server/agent/documents/gracefulDegradation";

// === Compiler V2 ===
import { DocumentCompilerV2 } from "../../server/agent/documents/compilerV2";

/* ================================================================== */
/*  1. DESIGN TOKENS                                                   */
/* ================================================================== */

describe("UnifiedDesignTokens", () => {
  it("should parse default tokens without errors", () => {
    const tokens = UnifiedDesignTokensSchema.parse({});
    expect(tokens.version).toBe("2.0.0");
    expect(tokens.name).toBe("default");
    expect(tokens.base.font.heading).toBe("Calibri");
    expect(tokens.table.headerBg).toBe("#1a73e8");
    expect(tokens.chart.seriesColors).toHaveLength(10);
  });

  it("should resolve named themes", () => {
    const corporate = resolveUnifiedTheme("corporate");
    expect(corporate.name).toBe("corporate");
    expect(corporate.base.color.primary).toBe("#1a365d");
    expect(corporate.table.headerBg).toBe("#1a365d");
  });

  it("should fallback for unknown theme names", () => {
    const tokens = resolveUnifiedTheme("nonexistent");
    expect(tokens.name).toBe("default");
  });

  it("should reject dangerous keys (__proto__)", () => {
    const tokens = resolveUnifiedTheme({ __proto__: {} } as any);
    expect(tokens.name).toBe("default");
  });

  it("should extract base tokens for backward compat", () => {
    const unified = resolveUnifiedTheme("corporate");
    const base = extractBaseTokens(unified);
    expect(base.font.heading).toBe("Calibri");
    expect(base.color.primary).toBe("#1a365d");
  });

  it("should have all predefined themes", () => {
    expect(Object.keys(UNIFIED_THEMES)).toEqual(
      expect.arrayContaining(["default", "corporate", "modern", "academic", "minimal"])
    );
  });
});

/* ================================================================== */
/*  2. COMPONENT REGISTRY                                              */
/* ================================================================== */

describe("ComponentRegistry", () => {
  describe("enforceTextConstraints", () => {
    it("should pass short text through unchanged", () => {
      const result = enforceTextConstraints("Hello", DEFAULT_CONSTRAINTS.title);
      expect(result.data).toBe("Hello");
      expect(result.wasModified).toBe(false);
    });

    it("should truncate text exceeding maxChars", () => {
      const longText = "A".repeat(300);
      const result = enforceTextConstraints(longText, DEFAULT_CONSTRAINTS.title); // maxChars: 200
      expect(result.data.length).toBeLessThanOrEqual(200);
      expect(result.data).toContain("…");
      expect(result.wasModified).toBe(true);
    });

    it("should strip control characters", () => {
      const result = enforceTextConstraints("Hello\x00World\x07", DEFAULT_CONSTRAINTS.paragraph);
      expect(result.data).toBe("HelloWorld");
      expect(result.wasModified).toBe(true);
    });

    it("should strip bidi overrides", () => {
      const result = enforceTextConstraints("Hello\u202AWorld\u202E", DEFAULT_CONSTRAINTS.paragraph);
      expect(result.data).toBe("HelloWorld");
    });
  });

  describe("enforceListConstraints", () => {
    it("should cap list items at maxItems", () => {
      const items = Array.from({ length: 100 }, (_, i) => `Item ${i}`);
      const result = enforceListConstraints(items, DEFAULT_CONSTRAINTS.bullets); // maxItems: 50
      expect(result.data.length).toBeLessThanOrEqual(50);
      expect(result.wasModified).toBe(true);
    });

    it("should truncate individual items exceeding maxChars", () => {
      const items = ["Short", "A".repeat(3000)];
      const result = enforceListConstraints(items, DEFAULT_CONSTRAINTS.bullets); // maxChars: 2000
      expect(result.data[1].length).toBeLessThanOrEqual(2000);
      expect(result.wasModified).toBe(true);
    });
  });

  describe("enforceTableConstraints", () => {
    it("should pad rows to match header count", () => {
      const headers = ["A", "B", "C"];
      const rows = [["1"], ["2", "3"]]; // rows shorter than headers
      const result = enforceTableConstraints(headers, rows, DEFAULT_CONSTRAINTS.table);
      expect(result.data.rows[0]).toHaveLength(3);
      expect(result.data.rows[1]).toHaveLength(3);
      // Rows were padded with empty strings to match header count
      expect(result.data.rows[0][1]).toBe("");
      expect(result.data.rows[0][2]).toBe("");
    });

    it("should trim rows exceeding header count", () => {
      const headers = ["A", "B"];
      const rows = [["1", "2", "3", "4"]];
      const result = enforceTableConstraints(headers, rows, DEFAULT_CONSTRAINTS.table);
      expect(result.data.rows[0]).toHaveLength(2);
    });

    it("should cap rows at maxItems", () => {
      const headers = ["A"];
      const rows = Array.from({ length: 300 }, () => ["val"]);
      const result = enforceTableConstraints(headers, rows, DEFAULT_CONSTRAINTS.table); // maxItems: 200
      expect(result.data.rows.length).toBeLessThanOrEqual(200);
    });
  });

  describe("buildComponent", () => {
    it("should build a title component with constraints", () => {
      const comp = buildComponent("title", "My Presentation Title");
      expect(comp.type).toBe("title");
      expect(comp.content).toBe("My Presentation Title");
      expect(comp.constraints.maxChars).toBe(200);
    });

    it("should apply constraint enforcement to bullets", () => {
      const items = Array.from({ length: 100 }, (_, i) => `Bullet ${i}`);
      const comp = buildComponent("bullets", items);
      expect(comp.content.length).toBeLessThanOrEqual(50);
      expect(comp.enforcement.wasModified).toBe(true);
    });
  });

  describe("getSafeFallback", () => {
    it("should return text for text components", () => {
      expect(getSafeFallback("title", "My Title")).toBe("My Title");
    });

    it("should return placeholder for charts", () => {
      expect(getSafeFallback("chart", {})).toBe("[Gráfico]");
    });

    it("should handle table fallback", () => {
      const result = getSafeFallback("table", { headers: ["A", "B"] });
      expect(result).toContain("Tabla");
    });
  });
});

/* ================================================================== */
/*  3. PREFLIGHT VALIDATOR                                             */
/* ================================================================== */

describe("PreflightValidator", () => {
  let validator: PreflightValidator;

  beforeEach(() => {
    validator = new PreflightValidator();
  });

  describe("PPTX validation", () => {
    it("should pass a valid presentation spec", () => {
      const spec = {
        title: "Test Presentation",
        slides: [{
          type: "content",
          components: [{
            type: "title",
            content: "Slide 1",
          }],
        }],
      };
      const result = validator.validate(spec, "pptx");
      expect(result.canRender).toBe(true);
      expect(result.errors).toBe(0);
    });

    it("should auto-fix slide title exceeding max length", () => {
      const spec = {
        title: "A".repeat(600),
        slides: [],
      };
      const result = validator.validate(spec, "pptx");
      expect(result.sanitizedSpec.title.length).toBeLessThanOrEqual(500);
      expect(result.autoFixes).toBeGreaterThan(0);
    });

    it("should handle null spec gracefully", () => {
      const result = validator.validate(null, "pptx");
      expect(result.canRender).toBe(false);
      expect(result.errors).toBeGreaterThan(0);
    });

    it("should clamp out-of-bounds positions", () => {
      const spec = {
        title: "Test",
        slides: [{
          type: "content",
          components: [{
            type: "title",
            content: "Title",
            position: { x: 15, y: 20, w: 5, h: 2 }, // way outside bounds
          }],
        }],
      };
      const result = validator.validate(spec, "pptx");
      const pos = result.sanitizedSpec.slides[0].components[0].position;
      expect(pos.x).toBeLessThanOrEqual(10);
      expect(pos.y).toBeLessThanOrEqual(6);
    });

    it("should truncate slides exceeding maximum", () => {
      const spec = {
        title: "Test",
        slides: Array.from({ length: 250 }, () => ({
          type: "content",
          components: [{ type: "title", content: "Slide" }],
        })),
      };
      const result = validator.validate(spec, "pptx");
      expect(result.sanitizedSpec.slides.length).toBeLessThanOrEqual(200);
    });
  });

  describe("DOCX validation", () => {
    it("should detect heading hierarchy skips", () => {
      const spec = {
        title: "Test",
        sections: [
          { type: "heading", level: 1, content: "H1" },
          { type: "heading", level: 4, content: "H4" }, // skips H2, H3
        ],
      };
      const result = validator.validate(spec, "docx");
      const headingSkip = result.issues.find(i => i.code === "DOC_HEADING_SKIP");
      expect(headingSkip).toBeTruthy();
    });

    it("should auto-fix table row column mismatches", () => {
      const spec = {
        title: "Test",
        sections: [{
          type: "table",
          content: [
            ["A", "B", "C"],    // header: 3 cols
            ["1"],               // row: 1 col (should be padded)
            ["1", "2", "3", "4"], // row: 4 cols (should be trimmed)
          ],
        }],
      };
      const result = validator.validate(spec, "docx");
      const table = result.sanitizedSpec.sections[0].content;
      expect(table[1]).toHaveLength(3); // padded
      expect(table[2]).toHaveLength(3); // trimmed
    });
  });

  describe("XLSX validation", () => {
    it("should fix duplicate sheet names", () => {
      const spec = {
        title: "Test",
        sheets: [
          { name: "Sheet1", columns: [{ key: "a", header: "A" }], rows: [] },
          { name: "Sheet1", columns: [{ key: "a", header: "A" }], rows: [] },
        ],
      };
      const result = validator.validate(spec, "xlsx");
      const names = result.sanitizedSpec.sheets.map((s: any) => s.name);
      expect(new Set(names).size).toBe(2); // all unique
    });

    it("should strip formula injection from cells", () => {
      const spec = {
        title: "Test",
        sheets: [{
          name: "Data",
          columns: [{ key: "a", header: "A" }],
          rows: [{ a: "=CMD('calc')" }, { a: "+1+1" }],
        }],
      };
      const result = validator.validate(spec, "xlsx");
      const rows = result.sanitizedSpec.sheets[0].rows;
      expect(rows[0].a).toMatch(/^'/); // prefixed with '
      expect(rows[1].a).toMatch(/^'/);
    });

    it("should handle missing sheets array", () => {
      const result = validator.validate({ title: "Test" }, "xlsx");
      expect(result.canRender).toBe(false);
      expect(result.errors).toBeGreaterThan(0);
    });
  });

  describe("UTF-8 sanitization", () => {
    it("should strip null bytes from all text", () => {
      const spec = {
        title: "Test\x00Title",
        slides: [{
          type: "content",
          components: [{ type: "title", content: "Hello\x00World" }],
        }],
      };
      const result = validator.validate(spec, "pptx");
      expect(result.sanitizedSpec.title).not.toContain("\x00");
      expect(result.sanitizedSpec.slides[0].components[0].content).not.toContain("\x00");
    });
  });
});

/* ================================================================== */
/*  4. LAYOUT GUARDRAILS                                               */
/* ================================================================== */

describe("LayoutGuardrails", () => {
  describe("autoFitText", () => {
    it("should not modify text that fits", () => {
      const result = autoFitText("Short text", { x: 0, y: 0, w: 5, h: 2 }, 24, 8);
      expect(result.text).toBe("Short text");
      expect(result.truncated).toBe(false);
    });

    it("should shrink font for text that barely overflows", () => {
      const longText = "This is a moderately long text that needs a smaller font to fit properly in the box";
      const result = autoFitText(longText, { x: 0, y: 0, w: 3, h: 0.5 }, 24, 8);
      expect(result.fontSize).toBeLessThan(24);
      expect(result.shrunk).toBe(true);
    });

    it("should truncate text at minimum font size", () => {
      const veryLong = "A".repeat(5000);
      const result = autoFitText(veryLong, { x: 0, y: 0, w: 2, h: 0.5 }, 12, 8);
      expect(result.truncated).toBe(true);
      expect(result.text).toContain("…");
      expect(result.fontSize).toBe(8);
    });

    it("should handle empty box gracefully", () => {
      const result = autoFitText("Test", { x: 0, y: 0, w: 0, h: 0 }, 12, 8);
      expect(result.text).toBe("Test");
    });
  });

  describe("splitBullets", () => {
    it("should not split when items fit", () => {
      const items = ["Item 1", "Item 2", "Item 3"];
      const result = splitBullets(items, { x: 0, y: 0, w: 8, h: 4 }, 12);
      expect(result.current).toEqual(items);
      expect(result.overflow).toHaveLength(0);
    });

    it("should split long lists into groups", () => {
      const items = Array.from({ length: 30 }, (_, i) => `Item ${i}`);
      const result = splitBullets(items, { x: 0, y: 0, w: 8, h: 1 }, 12);
      expect(result.current.length).toBeLessThan(30);
      expect(result.overflow.length).toBeGreaterThan(0);
    });
  });

  describe("splitTable", () => {
    it("should not split small tables", () => {
      const result = splitTable(["A", "B"], [["1", "2"], ["3", "4"]], 10);
      expect(result.splitCount).toBe(0);
      expect(result.overflow).toHaveLength(0);
    });

    it("should split large tables with header repetition", () => {
      const rows = Array.from({ length: 50 }, (_, i) => [`val_${i}`]);
      const result = splitTable(["Header"], rows, 10);
      expect(result.splitCount).toBeGreaterThan(0);
      expect(result.overflow.length).toBeGreaterThan(0);
      // All groups should have headers
      expect(result.current.headers).toEqual(["Header"]);
      for (const group of result.overflow) {
        expect(group.headers).toEqual(["Header"]);
      }
    });
  });

  describe("computeSlideLayout", () => {
    it("should compute layout for components", () => {
      const tokens = resolveUnifiedTheme("corporate");
      const components = [
        buildComponent("title", "My Title"),
        buildComponent("bullets", ["Bullet 1", "Bullet 2", "Bullet 3"]),
      ];
      const result = computeSlideLayout(components, tokens);
      expect(result.decisions).toHaveLength(2);
      expect(result.density).toBeGreaterThan(0);
    });

    it("should detect overflow", () => {
      const tokens = resolveUnifiedTheme("default");
      // Create many components to force overflow
      const components = Array.from({ length: 20 }, (_, i) =>
        buildComponent("paragraph", "A".repeat(500))
      );
      const result = computeSlideLayout(components, tokens);
      expect(result.overflowComponents.length).toBeGreaterThan(0);
    });
  });
});

/* ================================================================== */
/*  5. GRACEFUL DEGRADATION                                            */
/* ================================================================== */

describe("GracefulDegradation", () => {
  it("should record degradation events", () => {
    const manager = new DegradationManager();
    manager.recordDegradation("chart", new Error("Chart lib failed"), "slide[0].comp[2]");
    const log = manager.getLog();
    expect(log.degradedCount).toBe(1);
    expect(log.events[0].componentType).toBe("chart");
    expect(log.events[0].error).toContain("Chart lib failed");
  });

  it("should try render and fallback on failure", () => {
    const manager = new DegradationManager();
    const comp = buildComponent("title", "My Title");

    const { result, degraded } = manager.tryRender(
      comp,
      () => { throw new Error("render failed"); },
      (fallback) => `FALLBACK: ${fallback}`,
    );

    expect(degraded).toBe(true);
    expect(result).toContain("FALLBACK");
  });

  it("should succeed when render works", () => {
    const manager = new DegradationManager();
    const comp = buildComponent("title", "My Title");

    const { result, degraded } = manager.tryRender(
      comp,
      () => "rendered OK",
      (fallback) => `FALLBACK: ${fallback}`,
    );

    expect(degraded).toBe(false);
    expect(result).toBe("rendered OK");
  });

  it("should track degradation ratio", () => {
    const manager = new DegradationManager();

    // 3 components, 1 fails
    const comp = buildComponent("title", "Test");
    manager.tryRender(comp, () => "ok", (f) => f);
    manager.tryRender(comp, () => { throw new Error("fail"); }, (f) => f);
    manager.tryRender(comp, () => "ok", (f) => f);

    const log = manager.getLog();
    expect(log.totalComponents).toBe(3);
    expect(log.degradedCount).toBe(1);
    expect(log.degradationRatio).toBeCloseTo(1 / 3, 2);
  });
});

/* ================================================================== */
/*  6. END-TO-END COMPILATION                                          */
/* ================================================================== */

describe("DocumentCompilerV2 — End-to-end", () => {
  let compiler: DocumentCompilerV2;

  beforeEach(() => {
    compiler = new DocumentCompilerV2();
  });

  it("should compile a PPTX from spec", async () => {
    const result = await compiler.compile({
      format: "pptx",
      spec: {
        format: "pptx",
        title: "Test Presentation",
        slides: [
          {
            type: "cover",
            components: [
              { type: "title", content: "Welcome" },
              { type: "subtitle", content: "A test presentation" },
            ],
          },
          {
            type: "content",
            components: [
              { type: "title", content: "Slide 2" },
              { type: "bullets", content: ["Point A", "Point B", "Point C"] },
            ],
          },
        ],
      } as any,
      theme: "corporate",
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.format).toBe("pptx");
    expect(result.filename).toContain(".pptx");
    expect(result.mimeType).toContain("presentationml");
    expect(result.metrics.durationMs).toBeGreaterThan(0);
    expect(result.preflight.canRender).toBe(true);
  });

  it("should compile a DOCX from spec", async () => {
    const result = await compiler.compile({
      format: "docx",
      spec: {
        format: "docx",
        title: "Test Document",
        sections: [
          { type: "heading", level: 1, content: "Introduction" },
          { type: "paragraph", content: "This is a test document with multiple sections." },
          { type: "bullets", content: ["First point", "Second point"] },
          { type: "table", content: [["Name", "Age"], ["Alice", "30"], ["Bob", "25"]] },
        ],
      } as any,
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.format).toBe("docx");
    expect(result.filename).toContain(".docx");
  });

  it("should compile an XLSX from spec", async () => {
    const result = await compiler.compile({
      format: "xlsx",
      spec: {
        format: "xlsx",
        title: "Test Workbook",
        sheets: [{
          name: "Sales",
          columns: [
            { key: "product", header: "Producto", type: "string" },
            { key: "amount", header: "Monto", type: "number" },
            { key: "date", header: "Fecha", type: "string" },
          ],
          rows: [
            { product: "Widget A", amount: 1500, date: "2024-01-15" },
            { product: "Widget B", amount: 2300, date: "2024-01-16" },
          ],
          formulas: [],
          filters: true,
          freezeRow: 1,
          freezeCol: 0,
          protection: false,
        }],
      } as any,
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.format).toBe("xlsx");
  });

  it("should compile from raw text (markdown → DOCX)", async () => {
    const result = await compiler.compileFromText({
      format: "docx",
      title: "Markdown Test",
      content: "# Hello\n\nThis is a **bold** paragraph.\n\n- Item 1\n- Item 2\n",
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.format).toBe("docx");
  });

  it("should compile from raw text (CSV → XLSX)", async () => {
    const result = await compiler.compileFromText({
      format: "xlsx",
      title: "CSV Test",
      content: "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n",
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.format).toBe("xlsx");
  });

  it("should compile from raw text (JSON → PPTX)", async () => {
    const result = await compiler.compileFromText({
      format: "pptx",
      title: "JSON Test",
      content: JSON.stringify([
        { title: "Overview", bullets: ["Point 1", "Point 2"] },
        { title: "Details", bullets: ["Detail A", "Detail B"] },
      ]),
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.format).toBe("pptx");
  });
});

/* ================================================================== */
/*  7. EDGE CASES                                                      */
/* ================================================================== */

describe("Edge cases", () => {
  let compiler: DocumentCompilerV2;

  beforeEach(() => {
    compiler = new DocumentCompilerV2();
  });

  it("should handle empty PPTX spec (produce fallback)", async () => {
    const result = await compiler.compile({
      format: "pptx",
      spec: { format: "pptx", title: "Empty", slides: [] } as any,
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("should handle empty DOCX spec (produce fallback)", async () => {
    const result = await compiler.compile({
      format: "docx",
      spec: { format: "docx", title: "Empty", sections: [] } as any,
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("should handle text with control characters", async () => {
    const result = await compiler.compile({
      format: "docx",
      spec: {
        format: "docx",
        title: "Test\x00\x07\x1F",
        sections: [
          { type: "paragraph", content: "Hello\x00World\x07Test\x1F" },
        ],
      } as any,
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.preflight.autoFixes).toBeGreaterThan(0);
  });

  it("should handle formula injection in XLSX", async () => {
    const result = await compiler.compile({
      format: "xlsx",
      spec: {
        format: "xlsx",
        title: "Injection Test",
        sheets: [{
          name: "Data",
          columns: [{ key: "cmd", header: "Command", type: "string" }],
          rows: [
            { cmd: "=HYPERLINK('http://evil.com','click')" },
            { cmd: "+cmd('calc')" },
            { cmd: "@SUM(A1:A10)" },
          ],
          formulas: [],
          filters: true,
          freezeRow: 1,
          freezeCol: 0,
          protection: false,
        }],
      } as any,
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    // Formula injection should be sanitized
  });

  it("should handle very long title", async () => {
    const result = await compiler.compile({
      format: "docx",
      spec: {
        format: "docx",
        title: "T".repeat(10000),
        sections: [{ type: "paragraph", content: "Content" }],
      } as any,
    });
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.filename.length).toBeLessThan(300);
  });

  it("should apply different themes", async () => {
    const themes = ["default", "corporate", "modern", "academic", "minimal"];

    for (const theme of themes) {
      const result = await compiler.compile({
        format: "pptx",
        spec: {
          format: "pptx",
          title: `${theme} Theme Test`,
          slides: [{
            type: "content",
            components: [{ type: "title", content: "Theme Test" }],
          }],
        } as any,
        theme,
      });
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    }
  });
});
