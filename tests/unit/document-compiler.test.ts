import { describe, it, expect, vi } from "vitest";
import { DocumentCompiler } from "../../Hola/server/agent/documents/compiler";
import { DesignTokensSchema, LayoutEngine, type PresentationSpec, type DocumentSpec, type WorkbookSpec } from "../../Hola/server/agent/documents/documentEngine";
import { resolveTheme, THEMES } from "../../Hola/server/agent/documents/themes";
import { markdownToDocSpec, csvToWorkbookSpec, jsonToPresentationSpec } from "../../Hola/server/agent/documents/textToSpec";

/* ================================================================== */
/*  DESIGN TOKENS & THEMES                                             */
/* ================================================================== */

describe("DesignTokens", () => {
  it("parses empty object to full defaults", () => {
    const tokens = DesignTokensSchema.parse({});
    expect(tokens.font.heading).toBe("Calibri");
    expect(tokens.font.sizeH1).toBe(28);
    expect(tokens.color.primary).toBe("#1a73e8");
    expect(tokens.spacing.md).toBe(16);
    expect(tokens.layout.slideWidth).toBe(10);
    expect(tokens.layout.slideHeight).toBe(5.625);
    expect(tokens.layout.pageWidth).toBe(8.5);
    expect(tokens.border.radiusMd).toBe(4);
    expect(tokens.shadow.sm.blur).toBe(2);
    expect(tokens.version).toBe("1.0.0");
    expect(tokens.name).toBe("default");
  });

  it("merges partial overrides", () => {
    const tokens = DesignTokensSchema.parse({
      font: { heading: "Arial", sizeH1: 36 },
      color: { primary: "#ff0000" },
    });
    expect(tokens.font.heading).toBe("Arial");
    expect(tokens.font.sizeH1).toBe(36);
    expect(tokens.font.body).toBe("Calibri"); // default preserved
    expect(tokens.color.primary).toBe("#ff0000");
    expect(tokens.color.secondary).toBe("#34a853"); // default preserved
  });
});

describe("resolveTheme", () => {
  it("returns default theme for undefined", () => {
    const theme = resolveTheme(undefined);
    expect(theme.name).toBe("default");
  });

  it("returns named theme", () => {
    const theme = resolveTheme("corporate");
    expect(theme.name).toBe("corporate");
    expect(theme.color.primary).toBe("#1a365d");
  });

  it("returns default for unknown name", () => {
    const theme = resolveTheme("nonexistent");
    expect(theme.name).toBe("default");
  });

  it("parses partial tokens", () => {
    const theme = resolveTheme({ font: { heading: "Georgia" } });
    expect(theme.font.heading).toBe("Georgia");
    expect(theme.font.body).toBe("Calibri"); // defaults filled
  });

  it("has all expected themes", () => {
    expect(Object.keys(THEMES)).toContain("default");
    expect(Object.keys(THEMES)).toContain("corporate");
    expect(Object.keys(THEMES)).toContain("academic");
    expect(Object.keys(THEMES)).toContain("modern");
    expect(Object.keys(THEMES)).toContain("minimal");
    expect(Object.keys(THEMES)).toContain("nature");
  });
});

/* ================================================================== */
/*  TEXT-TO-SPEC ADAPTERS                                              */
/* ================================================================== */

describe("markdownToDocSpec", () => {
  it("converts headings", () => {
    const spec = markdownToDocSpec("Test", "# Main\n## Sub\nBody text");
    expect(spec.format).toBe("docx");
    expect(spec.title).toBe("Test");
    expect(spec.sections.length).toBeGreaterThanOrEqual(3);
    expect(spec.sections[0]).toEqual({ type: "heading", level: 1, content: "Main" });
    expect(spec.sections[1]).toEqual({ type: "heading", level: 2, content: "Sub" });
  });

  it("converts bullet lists", () => {
    const spec = markdownToDocSpec("Test", "- item1\n- item2\n- item3");
    const bullets = spec.sections.find(s => s.type === "bullets");
    expect(bullets).toBeDefined();
    expect(bullets!.content).toEqual(["item1", "item2", "item3"]);
  });

  it("converts numbered lists", () => {
    const spec = markdownToDocSpec("Test", "1. first\n2. second");
    const nums = spec.sections.find(s => s.type === "numberedList");
    expect(nums).toBeDefined();
    expect(nums!.content).toEqual(["first", "second"]);
  });

  it("converts code blocks", () => {
    const spec = markdownToDocSpec("Test", "```\nconst x = 1;\n```");
    const code = spec.sections.find(s => s.type === "code");
    expect(code).toBeDefined();
    expect(code!.content).toBe("const x = 1;");
  });

  it("converts blockquotes", () => {
    const spec = markdownToDocSpec("Test", "> Important note");
    const quote = spec.sections.find(s => s.type === "quote");
    expect(quote).toBeDefined();
    expect(quote!.content).toBe("Important note");
  });

  it("converts tables", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const spec = markdownToDocSpec("Test", md);
    const table = spec.sections.find(s => s.type === "table");
    expect(table).toBeDefined();
    expect(table!.content).toEqual([["A", "B"], ["1", "2"]]);
  });

  it("sanitizes control characters", () => {
    const spec = markdownToDocSpec("Test", "Hello\x00World\x07!");
    const para = spec.sections.find(s => s.type === "paragraph");
    expect(para).toBeDefined();
    expect(para!.content).not.toContain("\x00");
    expect(para!.content).not.toContain("\x07");
  });
});

describe("csvToWorkbookSpec", () => {
  it("parses comma-separated data", () => {
    const spec = csvToWorkbookSpec("Sales", "Name,Amount\nAlice,100\nBob,200");
    expect(spec.format).toBe("xlsx");
    expect(spec.sheets.length).toBe(1);
    expect(spec.sheets[0].columns.length).toBe(2);
    expect(spec.sheets[0].rows.length).toBe(2);
    expect(spec.sheets[0].rows[0].col_0).toBe("Alice");
    expect(spec.sheets[0].rows[0].col_1).toBe(100); // auto-detected number
  });

  it("parses pipe-separated data", () => {
    const spec = csvToWorkbookSpec("Test", "| A | B |\n| 1 | 2 |");
    expect(spec.sheets[0].columns.length).toBeGreaterThanOrEqual(2);
  });

  it("parses tab-separated data", () => {
    const spec = csvToWorkbookSpec("Test", "A\tB\n1\t2");
    expect(spec.sheets[0].columns.length).toBe(2);
  });

  it("sanitizes formula injection", () => {
    const spec = csvToWorkbookSpec("Test", "Name,Value\n=HYPERLINK(),+cmd");
    const row = spec.sheets[0].rows[0];
    expect(String(row.col_0).startsWith("'")).toBe(true); // prefixed with quote
    expect(String(row.col_1).startsWith("'")).toBe(true);
  });

  it("handles empty input gracefully", () => {
    const spec = csvToWorkbookSpec("Test", "");
    expect(spec.sheets.length).toBe(1);
    expect(spec.sheets[0].rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("jsonToPresentationSpec", () => {
  it("parses JSON slides", () => {
    const json = JSON.stringify([
      { title: "Slide 1", bullets: ["Point A", "Point B"] },
      { title: "Slide 2", content: ["Point C"] },
    ]);
    const spec = jsonToPresentationSpec("My Deck", json);
    expect(spec.format).toBe("pptx");
    expect(spec.slides.length).toBe(3); // cover + 2 content
    expect(spec.slides[0].type).toBe("cover");
    expect(spec.slides[1].type).toBe("content");
  });

  it("falls back to markdown parsing for invalid JSON", () => {
    const md = "## Slide 1\n- Point A\n- Point B\n## Slide 2\n- Point C";
    const spec = jsonToPresentationSpec("My Deck", md);
    expect(spec.format).toBe("pptx");
    expect(spec.slides.length).toBeGreaterThanOrEqual(2);
  });

  it("truncates long titles", () => {
    const json = JSON.stringify([{ title: "A".repeat(1000), bullets: ["x"] }]);
    const spec = jsonToPresentationSpec("My Deck", json);
    const slide = spec.slides[1];
    const titleComp = slide.components.find(c => c.type === "title");
    expect(titleComp!.content.length).toBeLessThanOrEqual(501);
  });
});

/* ================================================================== */
/*  DOCUMENT COMPILER                                                  */
/* ================================================================== */

describe("DocumentCompiler", () => {
  const compiler = new DocumentCompiler("corporate");

  describe("compile PPTX", () => {
    it("produces valid PPTX buffer", async () => {
      const spec: PresentationSpec = {
        format: "pptx",
        title: "Test Presentation",
        slides: [
          {
            type: "cover",
            components: [
              { type: "title", content: "Hello World" },
              { type: "subtitle", content: "By Test" },
            ],
          },
          {
            type: "content",
            components: [
              { type: "title", content: "Key Points" },
              { type: "bullets", content: ["Point 1", "Point 2", "Point 3"] },
            ],
          },
        ],
      };

      const result = await compiler.compile({ format: "pptx", spec });
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.filename).toMatch(/\.pptx$/);
      expect(result.mimeType).toContain("presentationml");
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.sizeBytes).toBeGreaterThan(0);
    });

    it("applies theme tokens", async () => {
      const spec: PresentationSpec = {
        format: "pptx",
        title: "Themed",
        slides: [{
          type: "cover",
          components: [{ type: "title", content: "Themed Deck" }],
        }],
      };

      const resultDefault = await compiler.compile({ format: "pptx", spec, theme: "default" });
      const resultModern = await compiler.compile({ format: "pptx", spec, theme: "modern" });

      // Both should produce valid buffers
      expect(resultDefault.buffer.length).toBeGreaterThan(0);
      expect(resultModern.buffer.length).toBeGreaterThan(0);
    });
  });

  describe("compile DOCX", () => {
    it("produces valid DOCX buffer", async () => {
      const spec: DocumentSpec = {
        format: "docx",
        title: "Test Document",
        sections: [
          { type: "heading", level: 1, content: "Introduction" },
          { type: "paragraph", content: "This is a test document." },
          { type: "bullets", content: ["Item 1", "Item 2"] },
        ],
      };

      const result = await compiler.compile({ format: "docx", spec });
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.filename).toMatch(/\.docx$/);
      expect(result.mimeType).toContain("wordprocessingml");
    });
  });

  describe("compile XLSX", () => {
    it("produces valid XLSX buffer", async () => {
      const spec: WorkbookSpec = {
        format: "xlsx",
        title: "Test Workbook",
        sheets: [{
          name: "Sheet1",
          columns: [
            { key: "name", header: "Name", type: "string" },
            { key: "value", header: "Value", type: "number" },
          ],
          rows: [
            { name: "Alice", value: 100 },
            { name: "Bob", value: 200 },
          ],
          formulas: [],
          filters: true,
          freezeRow: 1,
          freezeCol: 0,
          protection: false,
        }],
      };

      const result = await compiler.compile({ format: "xlsx", spec });
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.filename).toMatch(/\.xlsx$/);
      expect(result.mimeType).toContain("spreadsheetml");
    });
  });

  describe("compileFromText", () => {
    it("compiles markdown to DOCX", async () => {
      const result = await compiler.compileFromText({
        format: "docx",
        title: "From Markdown",
        content: "# Hello\n\nThis is a test.\n\n- Bullet 1\n- Bullet 2",
      });
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.format).toBe("docx");
    });

    it("compiles CSV to XLSX", async () => {
      const result = await compiler.compileFromText({
        format: "xlsx",
        title: "From CSV",
        content: "Name,Score\nAlice,95\nBob,87",
      });
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.format).toBe("xlsx");
    });

    it("compiles JSON to PPTX", async () => {
      const result = await compiler.compileFromText({
        format: "pptx",
        title: "From JSON",
        content: JSON.stringify([
          { title: "Intro", bullets: ["Hello"] },
        ]),
      });
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.format).toBe("pptx");
    });
  });

  describe("graceful degradation", () => {
    it("produces fallback on error in rendering", async () => {
      // Spec with invalid image path should not crash
      const spec: PresentationSpec = {
        format: "pptx",
        title: "Degradation Test",
        slides: [{
          type: "content",
          components: [
            { type: "title", content: "Valid Title" },
            { type: "image", content: "/nonexistent/path/image.png" },
          ],
        }],
      };

      const result = await compiler.compile({ format: "pptx", spec });
      // Should still produce a valid buffer
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it("handles empty spec gracefully", async () => {
      const spec: DocumentSpec = {
        format: "docx",
        title: "Empty",
        sections: [],
      };

      const result = await compiler.compile({ format: "docx", spec });
      // Validation may report warning but should still produce output
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });
});

/* ================================================================== */
/*  LAYOUT ENGINE                                                      */
/* ================================================================== */

describe("LayoutEngine", () => {
  const tokens = DesignTokensSchema.parse({});
  const engine = new LayoutEngine(tokens);

  it("calculates slide layout boxes", () => {
    const components = [
      { type: "title", content: "Hello" },
      { type: "bullets", content: ["A", "B", "C"] },
    ];
    const boxes = engine.calculateSlideLayout(components);
    expect(boxes.length).toBe(2);
    expect(boxes[0].x).toBeGreaterThanOrEqual(0);
    expect(boxes[0].y).toBeGreaterThanOrEqual(0);
    expect(boxes[0].w).toBeGreaterThan(0);
    expect(boxes[0].h).toBeGreaterThan(0);
  });

  it("prevents overflow beyond slide boundaries", () => {
    const components = Array(20).fill({ type: "body", content: "A".repeat(500) });
    const boxes = engine.calculateSlideLayout(components);
    for (const box of boxes) {
      expect(box.x + box.w).toBeLessThanOrEqual(tokens.layout.slideWidth + 0.01);
      expect(box.y + box.h).toBeLessThanOrEqual(tokens.layout.slideHeight + 0.01);
    }
  });

  it("autoFitText reduces font size", () => {
    const box = { x: 0, y: 0, w: 3, h: 0.5 };
    const longText = "A".repeat(500);
    const result = engine.autoFitText(longText, box, 28);
    expect(result.fontSize).toBeLessThan(28);
    expect(result.fontSize).toBeGreaterThanOrEqual(tokens.font.sizeMin);
  });

  it("splitTable divides rows with header repetition", () => {
    const rows = [
      ["H1", "H2"],
      ...Array(25).fill(["d1", "d2"]),
    ];
    const chunks = engine.splitTable(rows, 10);
    expect(chunks.length).toBe(3); // 25 data rows / 10 per page = 3 chunks
    // Each chunk includes header
    for (const chunk of chunks) {
      expect(chunk.rows[0]).toEqual(["H1", "H2"]);
      expect(chunk.includesHeader).toBe(true);
    }
  });

  it("splitBullets divides items by available height", () => {
    const box = { x: 0, y: 0, w: 9, h: 1.0 };
    const items = Array(20).fill("Bullet point text");
    const groups = engine.splitBullets(items, box, 12);
    expect(groups.length).toBeGreaterThan(1);
    // All items accounted for
    const total = groups.reduce((sum, g) => sum + g.length, 0);
    expect(total).toBe(20);
  });

  it("checkTextFit returns fits=true for short text", () => {
    const box = { x: 0, y: 0, w: 5, h: 2 };
    const result = engine.checkTextFit("Hello", box, 12);
    expect(result.fits).toBe(true);
    expect(result.overflow).toBe(false);
  });

  it("checkTextFit truncates long text with ellipsis", () => {
    const box = { x: 0, y: 0, w: 1, h: 0.3 };
    const result = engine.checkTextFit("A".repeat(1000), box, 12);
    expect(result.fits).toBe(false);
    expect(result.overflow).toBe(true);
    expect(result.truncated).toContain("…");
  });
});
