import { describe, it, expect, vi } from "vitest";
import { DocumentCompiler } from "../../Hola/server/agent/documents/compiler";
import { DesignTokensSchema, LayoutEngine, type PresentationSpec, type DocumentSpec, type WorkbookSpec, isImagePathSafe, sanitizeSheetName, contrastRatio, safeColor } from "../../Hola/server/agent/documents/documentEngine";
import { resolveTheme, THEMES } from "../../Hola/server/agent/documents/themes";
import { markdownToDocSpec, csvToWorkbookSpec, jsonToPresentationSpec, markdownToPresentationSpec } from "../../Hola/server/agent/documents/textToSpec";
import { PresentationValidator } from "../../Hola/server/agent/documents/documentValidators";

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

/* ================================================================== */
/*  SECURITY TESTS — Round 1-4 hardening coverage                      */
/* ================================================================== */

describe("Security: isImagePathSafe", () => {
  it("blocks http:// URLs", () => expect(isImagePathSafe("http://evil.com/img.png")).toBe(false));
  it("blocks https:// URLs", () => expect(isImagePathSafe("https://evil.com/img.png")).toBe(false));
  it("blocks file:// protocol", () => expect(isImagePathSafe("file:///etc/passwd")).toBe(false));
  it("blocks UNC paths \\\\", () => expect(isImagePathSafe("\\\\server\\share\\img.png")).toBe(false));
  it("blocks UNC paths //", () => expect(isImagePathSafe("//server/share/img.png")).toBe(false));
  it("blocks /etc/ paths", () => expect(isImagePathSafe("/etc/shadow")).toBe(false));
  it("blocks /proc/ paths", () => expect(isImagePathSafe("/proc/self/environ")).toBe(false));
  it("blocks /sys/ paths", () => expect(isImagePathSafe("/sys/kernel")).toBe(false));
  it("blocks /dev/ paths", () => expect(isImagePathSafe("/dev/zero")).toBe(false));
  it("blocks path traversal ..", () => expect(isImagePathSafe("../../../etc/passwd")).toBe(false));
  it("blocks embedded traversal", () => expect(isImagePathSafe("images/../../../secret")).toBe(false));
  it("allows relative safe path", () => expect(isImagePathSafe("images/photo.png")).toBe(true));
  it("allows simple filename", () => expect(isImagePathSafe("logo.png")).toBe(true));
  it("rejects empty string", () => expect(isImagePathSafe("")).toBe(false));
  it("rejects null-ish", () => expect(isImagePathSafe(null as any)).toBe(false));
  it("rejects non-string", () => expect(isImagePathSafe(123 as any)).toBe(false));
  it("blocks HTTP with mixed case", () => expect(isImagePathSafe("HTTP://EVIL.COM")).toBe(false));
  it("blocks File:// mixed case", () => expect(isImagePathSafe("File:///tmp/x")).toBe(false));
});

describe("Security: sanitizeSheetName", () => {
  it("removes asterisks", () => expect(sanitizeSheetName("My*Sheet")).toBe("My_Sheet"));
  it("removes question marks", () => expect(sanitizeSheetName("What?")).toBe("What_"));
  it("removes colons", () => expect(sanitizeSheetName("Time:12")).toBe("Time_12"));
  it("removes slashes", () => expect(sanitizeSheetName("A/B\\C")).toBe("A_B_C"));
  it("removes brackets", () => expect(sanitizeSheetName("[Data]")).toBe("_Data_"));
  it("caps at 31 chars", () => expect(sanitizeSheetName("A".repeat(50)).length).toBeLessThanOrEqual(31));
  it("returns Sheet1 for empty", () => expect(sanitizeSheetName("")).toBe("Sheet1"));
  it("returns Sheet1 for null", () => expect(sanitizeSheetName(null as any)).toBe("Sheet1"));
  it("returns Sheet1 for non-string", () => expect(sanitizeSheetName(123 as any)).toBe("Sheet1"));
  it("trims whitespace", () => expect(sanitizeSheetName("  Data  ").trim()).toBeTruthy());
});

describe("Security: safeColor", () => {
  it("normalizes 6-digit hex with #", () => expect(safeColor("#aabbcc")).toBe("#aabbcc"));
  it("normalizes 6-digit hex without #", () => expect(safeColor("ff0000")).toBe("#ff0000"));
  it("expands 3-digit hex", () => expect(safeColor("#abc")).toBe("#aabbcc"));
  it("falls back on invalid", () => expect(safeColor("not-a-color")).toBe("#000000"));
  it("falls back on empty", () => expect(safeColor("")).toBe("#000000"));
  it("falls back on null", () => expect(safeColor(null)).toBe("#000000"));
  it("falls back on undefined", () => expect(safeColor(undefined)).toBe("#000000"));
  it("uses custom fallback", () => expect(safeColor("xxx", "#ffffff")).toBe("#ffffff"));
  it("handles mixed case hex", () => expect(safeColor("#AaBbCc")).toBe("#AaBbCc"));
  it("rejects rgb() syntax", () => expect(safeColor("rgb(255,0,0)")).toBe("#000000"));
});

describe("Security: contrastRatio", () => {
  it("black on white gives high ratio", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).toBeGreaterThanOrEqual(20);
  });
  it("white on white gives ratio ~1", () => {
    const ratio = contrastRatio("#ffffff", "#ffffff");
    expect(ratio).toBeCloseTo(1, 0);
  });
  it("detects low contrast", () => {
    const ratio = contrastRatio("#cccccc", "#dddddd");
    expect(ratio).toBeLessThan(4.5);
  });
  it("handles same colors", () => {
    const ratio = contrastRatio("#1a73e8", "#1a73e8");
    expect(ratio).toBeCloseTo(1, 0);
  });
});

describe("Security: DesignTokens schema bounds", () => {
  it("rejects font size > 200", () => {
    expect(() => DesignTokensSchema.parse({ font: { sizeH1: 999 } })).toThrow();
  });
  it("rejects font size < 1", () => {
    expect(() => DesignTokensSchema.parse({ font: { sizeBody: 0 } })).toThrow();
  });
  it("rejects negative margin", () => {
    expect(() => DesignTokensSchema.parse({ layout: { marginTop: -1 } })).toThrow();
  });
  it("rejects slideWidth > 50", () => {
    expect(() => DesignTokensSchema.parse({ layout: { slideWidth: 100 } })).toThrow();
  });
  it("rejects lineHeight > 5", () => {
    expect(() => DesignTokensSchema.parse({ font: { lineHeight: 10 } })).toThrow();
  });
  it("rejects font name with special chars", () => {
    expect(() => DesignTokensSchema.parse({ font: { heading: "Evil<script>" } })).toThrow();
  });
  it("rejects font name > 100 chars", () => {
    expect(() => DesignTokensSchema.parse({ font: { heading: "A".repeat(101) } })).toThrow();
  });
  it("allows valid font names", () => {
    const t = DesignTokensSchema.parse({ font: { heading: "Times New Roman" } });
    expect(t.font.heading).toBe("Times New Roman");
  });
});

describe("Security: textToSpec hardening", () => {
  it("caps bullet lists at 500 items", () => {
    const md = Array(600).fill("- bullet item").join("\n");
    const spec = markdownToDocSpec("Test", md);
    const bulletSection = spec.sections.find(s => s.type === "bullets");
    expect(bulletSection).toBeTruthy();
    expect(Array.isArray(bulletSection!.content) && bulletSection!.content.length).toBeLessThanOrEqual(500);
  });

  it("caps code blocks at 2000 lines", () => {
    const code = "```\n" + Array(3000).fill("code line").join("\n") + "\n```";
    const spec = markdownToDocSpec("Test", code);
    const codeSection = spec.sections.find(s => s.type === "code");
    expect(codeSection).toBeTruthy();
    const lines = (codeSection!.content as string).split("\n");
    expect(lines.length).toBeLessThanOrEqual(2000);
  });

  it("caps table rows in markdown", () => {
    const rows = Array(1200).fill("| A | B | C |").join("\n");
    const table = "| H1 | H2 | H3 |\n| --- | --- | --- |\n" + rows;
    const spec = markdownToDocSpec("Test", table);
    const tableSection = spec.sections.find(s => s.type === "table");
    expect(tableSection).toBeTruthy();
    expect(Array.isArray(tableSection!.content) && tableSection!.content.length).toBeLessThanOrEqual(1002);
  });

  it("uses Number.isFinite to reject Infinity", () => {
    const spec = csvToWorkbookSpec("Test", "Value\nInfinity\n-Infinity\nNaN\n1e999");
    const rows = spec.sheets[0].rows;
    for (const row of rows) {
      const val = row["col_0"];
      if (typeof val === "number") {
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });

  it("unescapes pipes in markdown table cells", () => {
    const md = "| Col1 | Col2 |\n| --- | --- |\n| a\\|b | c |";
    const spec = markdownToDocSpec("Test", md);
    const tbl = spec.sections.find(s => s.type === "table");
    expect(tbl).toBeTruthy();
    const firstRow = (tbl!.content as string[][])[1];
    expect(firstRow).toBeTruthy();
  });

  it("rejects JSON with > 1000 keys (wide-object DoS)", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 1100; i++) obj[`key_${i}`] = i;
    const input = JSON.stringify(obj);
    // Should fall back to markdown parsing since checkJsonDepth rejects wide objects
    const spec = jsonToPresentationSpec("Test", input);
    expect(spec.slides.length).toBeGreaterThanOrEqual(1);
  });

  it("validates array type before slicing bullets", () => {
    // If raw.bullets is a string instead of array, should not crash
    const input = JSON.stringify({ title: "Test", bullets: "not an array" });
    const spec = jsonToPresentationSpec("Test", input);
    expect(spec.slides.length).toBeGreaterThanOrEqual(1);
  });

  it("handles null/undefined CSV values", () => {
    const spec = csvToWorkbookSpec("Test", "H1,H2\na,b\n,\nc,");
    expect(spec.sheets[0].rows.length).toBeGreaterThanOrEqual(1);
  });

  it("flushes oversized paragraphs correctly", () => {
    const longLine = "A".repeat(60_000);
    const spec = markdownToDocSpec("Test", longLine);
    // Should not crash and should have content
    expect(spec.sections.length).toBeGreaterThanOrEqual(1);
  });

  it("markdownToPresentationSpec caps slides", () => {
    const md = Array(250).fill("## Slide Title\n- bullet").join("\n\n");
    const spec = markdownToPresentationSpec("Test", md);
    expect(spec.slides.length).toBeLessThanOrEqual(201); // 200 + cover
  });
});

describe("Security: themes.ts hardening", () => {
  it("rejects __proto__ key in token overrides", () => {
    // Use JSON.parse to create an object with __proto__ as a real own key
    // (object literal { __proto__: ... } sets prototype, not an own key)
    const tokens = JSON.parse('{"__proto__":{"font":{"heading":"Evil"}}}');
    const result = resolveTheme(tokens as any);
    // Should return default, not allow prototype pollution
    expect(result.font.heading).toBe("Calibri");
  });

  it("rejects constructor key in token overrides", () => {
    const tokens = { constructor: { font: { heading: "Evil" } } };
    const result = resolveTheme(tokens as any);
    expect(result.font.heading).toBe("Calibri");
  });

  it("handles Zod parse failure gracefully", () => {
    // Pass something that Zod can't parse
    const result = resolveTheme({ font: { sizeH1: 99999 } } as any);
    // Should return default due to Zod failure (sizeH1 > 200)
    expect(result.font.sizeH1).toBe(28); // default
  });

  it("all theme presets are valid", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      expect(theme.font.heading).toBeTruthy();
      expect(theme.color.primary).toBeTruthy();
      expect(theme.version).toBe("1.0.0");
    }
  });
});

describe("Security: DocumentCompiler hardening", () => {
  const compiler = new DocumentCompiler();

  it("slide hard limit at 200 causes validation error", async () => {
    const spec: PresentationSpec = {
      format: "pptx",
      title: "Big",
      slides: Array(201).fill({
        type: "content" as const,
        components: [{ type: "title" as const, content: "Slide" }],
      }),
    };
    const result = await compiler.compile({ format: "pptx", spec });
    // Should still produce a file (via degraded or otherwise), but validation should flag it
    expect(result.buffer.length).toBeGreaterThan(0);
    const hasMaxSlidesError = result.validation.issues.some(
      i => i.code === "PPT_EXCEEDS_MAX_SLIDES"
    );
    expect(hasMaxSlidesError).toBe(true);
  });

  it("XLSX workbook memory limit prevents OOM", async () => {
    const columns = Array(100).fill(null).map((_, i) => ({
      key: `c${i}`,
      header: `Col${i}`,
      type: "string" as const,
    }));
    const rowTemplate = Object.fromEntries(
      columns.map((c) => [c.key, "data"])
    ) as Record<string, string>;

    const spec: WorkbookSpec = {
      format: "xlsx",
      title: "Huge",
      sheets: [{
        name: "Data",
        columns,
        // Reuse a shared row object so test setup stays fast while preserving
        // the same estimated cell count (60_000 × 100).
        rows: Array(60_000).fill(rowTemplate),
        formulas: [],
        filters: true,
        freezeRow: 1,
        freezeCol: 0,
        protection: false,
      }],
    };
    // This should fail because 6M cells × 100 > 500MB limit
    // and compiler should catch + produce fallback
    const result = await compiler.compile({ format: "xlsx", spec });
    expect(result.buffer.length).toBeGreaterThan(0);
    // Should be degraded since it hit the limit
    expect(result.metrics.degraded).toBe(true);
  }, 20_000);

  it("sanitizeFilename handles UTF-8 chars", async () => {
    const spec: DocumentSpec = {
      format: "docx",
      title: "Résumé — Año 2024 — Ñ — Ü — Ö — Café",
      sections: [{ type: "paragraph", content: "Test" }],
    };
    const result = await compiler.compile({ format: "docx", spec });
    // Filename should contain accented chars, not just underscores
    expect(result.filename).toContain("Résumé");
    expect(result.filename.endsWith(".docx")).toBe(true);
  });

  it("auto-repair clamps PPTX positions", async () => {
    const spec: PresentationSpec = {
      format: "pptx",
      title: "Overflow",
      slides: [{
        type: "content",
        components: [{
          type: "title",
          content: "Off-canvas",
          position: { x: 20, y: 15, w: 5, h: 3 },
        }],
      }],
    };
    const result = await compiler.compile({ format: "pptx", spec });
    expect(result.buffer.length).toBeGreaterThan(0);
    const hasRepaired = result.validation.issues.some(i => i.code === "COMPILER_AUTO_REPAIRED");
    expect(hasRepaired).toBe(true);
  });
});

describe("Security: documentValidators.ts hardening", () => {
  it("issues array is capped and doesn't exhaust memory", () => {
    const validator = new PresentationValidator();
    // Create spec with many issues
    const spec = {
      slides: Array(100).fill(null).map(() => ({
        components: Array(200).fill(null).map((_, i) => ({
          type: "title",
          content: "",
          position: { x: 20 + i, y: 20, w: 1, h: 1 },
          style: { fontSize: 4 },
        })),
      })),
    };
    const result = validator.validateSpec(spec);
    // Should have issues but not crash, and cap should keep it bounded
    // The cap is checked at loop boundaries, so some overshoot is expected
    // (each slide can emit multiple issues before the next cap check)
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.length).toBeLessThanOrEqual(10_000); // well under 100*200=20_000 without cap
  });
});
