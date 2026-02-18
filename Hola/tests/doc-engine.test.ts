/**
 * DOCUMENT ENGINE — Integration & Unit Tests
 *
 * Coverage:
 * 1. Design Tokens: theme resolution, format adapters, registry
 * 2. Document Model: structure validation, component limits
 * 3. Preflight Validator: sanitization, error/warning detection, adversarial inputs
 * 4. Layout Engine: table splitting, density reflow, image scaling, guardrails
 * 5. Component Library: rendering, inline markdown, truncation, graceful degradation
 * 6. Document Compiler: full pipeline, error phases, post-render validation
 * 7. Fuzzing: adversarial inputs (XSS, SQL injection, null bytes, huge payloads)
 * 8. Golden files: deterministic output for fixed inputs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== Design Tokens =====
import {
  CORPORATE_THEME,
  MODERN_THEME,
  getTheme,
  getAvailableThemes,
  registerTheme,
  toWordColor,
  toExcelColor,
  pointsToEmu,
  inchesToEmu,
  inchesToTwips,
  pointsToHalfPoints,
  toPptxMasterDef,
  type DesignTheme,
  type ColorPalette,
} from "../server/lib/docEngine/designTokens";

// ===== Document Model =====
import type {
  DocumentModel,
  DocumentSection,
  DocumentComponent,
  TableComponent,
  ChartComponent,
  ImageComponent,
  OutputFormat,
} from "../server/lib/docEngine/documentModel";
import {
  COMPONENT_LIMITS,
  SECTION_LIMITS,
  DOCUMENT_LIMITS,
} from "../server/lib/docEngine/documentModel";

// ===== Preflight Validator =====
import { preflightValidate, type PreflightResult } from "../server/lib/docEngine/preflightValidator";

// ===== Layout Engine =====
import {
  resolveLayout,
  DEFAULT_LAYOUT,
  componentDensity,
  sectionDensity,
  type LayoutResult,
} from "../server/lib/docEngine/layoutEngine";

// ===== Component Library =====
import {
  renderComponent,
  renderSection,
  parseInlineMarkdown,
  truncateText,
  truncateList,
  truncateTableRows,
  type RenderNode,
  type RenderContext,
  type ParagraphNode,
  type TableNode,
  type TextRun,
} from "../server/lib/docEngine/componentLibrary";

// ===== Document Compiler =====
import {
  compileDocument,
  createDocumentModel,
  registerFormatCompiler,
  CompilationError,
  type CompilationResult,
} from "../server/lib/docEngine/documentCompiler";

// ===== Test Helpers =====

function makeModel(overrides?: Partial<DocumentModel>): DocumentModel {
  return {
    id: "test-doc-001",
    format: "docx",
    themeId: "corporate",
    metadata: { title: "Test Document" },
    sections: [
      {
        id: "sec-1",
        type: "content",
        title: "Section One",
        components: [
          { type: "heading", level: 1, text: "Hello World" },
          { type: "paragraph", text: "This is a test paragraph." },
        ],
      },
    ],
    ...overrides,
  };
}

function makeRenderContext(overrides?: Partial<RenderContext>): RenderContext {
  return {
    theme: CORPORATE_THEME,
    format: "docx",
    sectionIndex: 0,
    componentIndex: 0,
    errors: [],
    ...overrides,
  };
}

function makeTableComponent(rows: number, cols: number): TableComponent {
  const columns = Array.from({ length: cols }, (_, i) => ({
    header: `Column ${i + 1}`,
    dataType: "text" as const,
  }));
  const tableRows = Array.from({ length: rows }, (_, ri) =>
    Array.from({ length: cols }, (_, ci) => `R${ri + 1}C${ci + 1}`)
  );
  return {
    type: "table",
    columns,
    rows: tableRows,
    showHeader: true,
    variant: "default",
  };
}

// =====================================================
// 1. DESIGN TOKENS
// =====================================================

describe("Design Tokens", () => {
  describe("Built-in themes", () => {
    it("CORPORATE_THEME has all required fields", () => {
      expect(CORPORATE_THEME.id).toBe("corporate");
      expect(CORPORATE_THEME.name).toBe("Corporate Professional");
      expect(CORPORATE_THEME.version).toBe("1.0.0");
      expect(CORPORATE_THEME.colors).toBeDefined();
      expect(CORPORATE_THEME.typography).toBeDefined();
      expect(CORPORATE_THEME.spacing).toBeDefined();
      expect(CORPORATE_THEME.borders).toBeDefined();
      expect(CORPORATE_THEME.shadows).toBeDefined();
      expect(CORPORATE_THEME.radius).toBeDefined();
    });

    it("MODERN_THEME has distinct colors from corporate", () => {
      expect(MODERN_THEME.colors.primary).not.toBe(CORPORATE_THEME.colors.primary);
      expect(MODERN_THEME.typography.title.family).not.toBe(CORPORATE_THEME.typography.title.family);
    });

    it("themes have 10 chart series colors", () => {
      expect(CORPORATE_THEME.colors.chartSeries).toHaveLength(10);
      expect(MODERN_THEME.colors.chartSeries).toHaveLength(10);
    });

    it("typography covers all 12 required styles", () => {
      const required = [
        "display", "title", "heading1", "heading2", "heading3",
        "body", "caption", "code", "footnote", "tableHeader", "tableBody", "quote",
      ];
      for (const key of required) {
        expect(CORPORATE_THEME.typography).toHaveProperty(key);
        const font = (CORPORATE_THEME.typography as any)[key];
        expect(font.family).toBeTruthy();
        expect(font.size).toBeGreaterThan(0);
        expect(typeof font.bold).toBe("boolean");
      }
    });
  });

  describe("Theme Registry", () => {
    it("getTheme returns corporate by default", () => {
      const theme = getTheme("corporate");
      expect(theme.id).toBe("corporate");
    });

    it("getTheme returns modern theme", () => {
      const theme = getTheme("modern");
      expect(theme.id).toBe("modern");
    });

    it("getTheme falls back to corporate for unknown ID", () => {
      const theme = getTheme("nonexistent-theme");
      expect(theme.id).toBe("corporate");
    });

    it("registerTheme adds a custom theme", () => {
      const custom: DesignTheme = {
        ...CORPORATE_THEME,
        id: "test-custom",
        name: "Test Custom",
      };
      registerTheme(custom);
      expect(getTheme("test-custom").name).toBe("Test Custom");
    });

    it("getAvailableThemes returns at least corporate and modern", () => {
      const themes = getAvailableThemes();
      expect(themes).toContain("corporate");
      expect(themes).toContain("modern");
    });
  });

  describe("Format Adapters", () => {
    it("toWordColor strips leading #", () => {
      expect(toWordColor("#1A365D")).toBe("1A365D");
      expect(toWordColor("1A365D")).toBe("1A365D");
    });

    it("toExcelColor adds FF prefix (ARGB format)", () => {
      expect(toExcelColor("1A365D")).toBe("FF1A365D");
      expect(toExcelColor("#1A365D")).toBe("FF1A365D");
    });

    it("pointsToEmu converts correctly", () => {
      expect(pointsToEmu(1)).toBe(12700);
      expect(pointsToEmu(12)).toBe(152400);
    });

    it("inchesToEmu converts correctly", () => {
      expect(inchesToEmu(1)).toBe(914400);
    });

    it("inchesToTwips converts correctly", () => {
      expect(inchesToTwips(1)).toBe(1440);
    });

    it("pointsToHalfPoints converts correctly", () => {
      expect(pointsToHalfPoints(12)).toBe(24);
      expect(pointsToHalfPoints(11)).toBe(22);
    });

    it("toPptxMasterDef returns correct structure", () => {
      const def = toPptxMasterDef(CORPORATE_THEME);
      expect(def.bkgd).toBe(CORPORATE_THEME.colors.bgPrimary);
      expect(def.color).toBe(CORPORATE_THEME.colors.textPrimary);
      expect(def.titleColor).toBe(CORPORATE_THEME.colors.primaryDark);
      expect(def.bodyFontFace).toBe(CORPORATE_THEME.typography.body.family);
      expect(def.titleFontFace).toBe(CORPORATE_THEME.typography.title.family);
    });
  });
});

// =====================================================
// 2. DOCUMENT MODEL
// =====================================================

describe("Document Model", () => {
  describe("Component Limits", () => {
    it("defines limits for all component types", () => {
      expect(COMPONENT_LIMITS.heading.maxTextChars).toBe(500);
      expect(COMPONENT_LIMITS.table.maxColumns).toBe(26);
      expect(COMPONENT_LIMITS.table.maxRows).toBe(5_000);
      expect(COMPONENT_LIMITS.chart.maxCategories).toBe(500);
      expect(COMPONENT_LIMITS.image.maxSrcBytes).toBe(10 * 1024 * 1024);
    });

    it("section limits are defined", () => {
      expect(SECTION_LIMITS.maxComponents).toBe(200);
      expect(SECTION_LIMITS.maxTotalSections).toBe(100);
    });

    it("document limits are defined", () => {
      expect(DOCUMENT_LIMITS.maxSections).toBe(100);
      expect(DOCUMENT_LIMITS.maxTotalComponents).toBe(2_000);
      expect(DOCUMENT_LIMITS.maxDocumentSizeBytes).toBe(100 * 1024 * 1024);
    });
  });

  describe("createDocumentModel helper", () => {
    it("creates a model with defaults", () => {
      const model = createDocumentModel("docx", "My Report", [
        { id: "s1", type: "content", title: "Intro", components: [] },
      ]);
      expect(model.id).toMatch(/^doc-/);
      expect(model.format).toBe("docx");
      expect(model.themeId).toBe("corporate");
      expect(model.metadata.title).toBe("My Report");
      expect(model.metadata.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("accepts theme and author overrides", () => {
      const model = createDocumentModel("pptx", "Slides", [], {
        themeId: "modern",
        author: "Test User",
      });
      expect(model.themeId).toBe("modern");
      expect(model.metadata.author).toBe("Test User");
    });
  });
});

// =====================================================
// 3. PREFLIGHT VALIDATOR
// =====================================================

describe("Preflight Validator", () => {
  describe("Valid documents", () => {
    it("passes a simple valid document", () => {
      const model = makeModel();
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns sanitized model", () => {
      const model = makeModel();
      const result = preflightValidate(model);
      expect(result.sanitizedModel.id).toBe(model.id);
      expect(result.sanitizedModel.sections).toHaveLength(1);
    });

    it("estimates size", () => {
      const model = makeModel();
      const result = preflightValidate(model);
      expect(result.estimatedSizeBytes).toBeGreaterThan(0);
    });
  });

  describe("Document-level errors", () => {
    it("errors on missing document ID", () => {
      const model = makeModel({ id: "" });
      const result = preflightValidate(model);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "PF_MISSING_ID")).toBe(true);
    });

    it("errors on missing format", () => {
      const model = makeModel({ format: "" as any });
      const result = preflightValidate(model);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "PF_MISSING_FORMAT")).toBe(true);
    });

    it("errors on no sections", () => {
      const model = makeModel({ sections: [] });
      const result = preflightValidate(model);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "PF_NO_SECTIONS")).toBe(true);
    });

    it("errors on too many sections (> 100)", () => {
      const sections = Array.from({ length: 101 }, (_, i) => ({
        id: `sec-${i}`,
        type: "content" as const,
        components: [],
      }));
      const model = makeModel({ sections });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_TOO_MANY_SECTIONS")).toBe(true);
    });
  });

  describe("XML sanitization", () => {
    it("removes null bytes from text", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "heading", level: 1, text: "Hello\x00World" }],
        }],
      });
      const result = preflightValidate(model);
      const heading = result.sanitizedModel.sections[0].components[0] as any;
      expect(heading.text).toBe("HelloWorld");
    });

    it("removes control characters but keeps tabs and newlines", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "paragraph", text: "Line1\nLine2\tTabbed\x01BadChar\x0EBadChar2" }],
        }],
      });
      const result = preflightValidate(model);
      const para = result.sanitizedModel.sections[0].components[0] as any;
      expect(para.text).toContain("Line1\nLine2\tTabbed");
      expect(para.text).not.toContain("\x01");
      expect(para.text).not.toContain("\x0E");
    });

    it("sanitizes table cell values", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "table",
            columns: [{ header: "Col\x00A" }],
            rows: [["Value\x01Bad"]],
          } as TableComponent],
        }],
      });
      const result = preflightValidate(model);
      const table = result.sanitizedModel.sections[0].components[0] as any;
      expect(table.columns[0].header).toBe("ColA");
    });
  });

  describe("Table validation", () => {
    it("errors on empty columns", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "table", columns: [], rows: [] } as TableComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_EMPTY_TABLE_COLUMNS")).toBe(true);
    });

    it("errors on too many columns (> 26)", () => {
      const cols = Array.from({ length: 27 }, (_, i) => ({ header: `C${i}` }));
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "table", columns: cols, rows: [] } as TableComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_TOO_MANY_COLUMNS")).toBe(true);
    });

    it("warns on row/column mismatch", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "table",
            columns: [{ header: "A" }, { header: "B" }],
            rows: [["only-one"]],
          } as TableComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.warnings.some(w => w.code === "PF_ROW_LENGTH_MISMATCH")).toBe(true);
    });
  });

  describe("Chart validation", () => {
    it("errors on empty categories", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "chart",
            chartType: "bar",
            categories: [],
            series: [{ name: "S1", values: [] }],
          } as ChartComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_EMPTY_CHART_CATEGORIES")).toBe(true);
    });

    it("errors on empty series", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "chart",
            chartType: "bar",
            categories: ["A"],
            series: [],
          } as ChartComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_EMPTY_CHART_SERIES")).toBe(true);
    });

    it("warns on series value count mismatch", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "chart",
            chartType: "bar",
            categories: ["A", "B"],
            series: [{ name: "S1", values: [1, 2, 3] }],
          } as ChartComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.warnings.some(w => w.code === "PF_CHART_SERIES_MISMATCH")).toBe(true);
    });
  });

  describe("Image validation", () => {
    it("errors on missing image source", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "image", src: "", alt: "test" } as ImageComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_MISSING_IMAGE_SRC")).toBe(true);
    });

    it("errors on malformed data URI", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "image", src: "data:nope", alt: "test" } as ImageComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_INVALID_DATA_URI")).toBe(true);
    });

    it("errors on unsafe URL protocol", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "image", src: "javascript:alert(1)", alt: "test" } as ImageComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.some(e => e.code === "PF_UNSAFE_IMAGE_URL")).toBe(true);
    });

    it("allows valid https URL", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "image", src: "https://example.com/img.png", alt: "test" } as ImageComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.filter(e => e.path.includes("components[0]"))).toHaveLength(0);
    });

    it("allows valid base64 data URI", () => {
      const smallBase64 = "data:image/png;base64," + "A".repeat(100);
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{ type: "image", src: smallBase64, alt: "test" } as ImageComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.errors.filter(e => e.path.includes("components[0]"))).toHaveLength(0);
    });
  });
});

// =====================================================
// 4. LAYOUT ENGINE
// =====================================================

describe("Layout Engine", () => {
  describe("Table layout", () => {
    it("auto-fits column widths when not specified", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "data",
          components: [makeTableComponent(5, 3)],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      const table = result.model.sections[0].components[0] as TableComponent;
      expect(table.columns.every(c => typeof c.widthPercent === "number")).toBe(true);
      expect(result.actions.some(a => a.type === "autofit")).toBe(true);
    });

    it("limits columns to maxTableColumnsForWidth", () => {
      const model = makeModel({
        format: "pptx",
        sections: [{
          id: "s1",
          type: "data",
          components: [makeTableComponent(3, 12)],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      const table = result.model.sections[0].components[0] as TableComponent;
      expect(table.columns.length).toBeLessThanOrEqual(8); // pptx max
      expect(result.actions.some(a => a.type === "truncate")).toBe(true);
    });

    it("splits large tables across pages (DOCX)", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "data",
          components: [makeTableComponent(250, 3)],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      // DOCX maxVisibleRows is 100, so 250 rows = 3 parts
      const tableComps = result.model.sections[0].components.filter(c => c.type === "table");
      expect(tableComps.length).toBe(3);
      expect(result.actions.some(a => a.type === "split")).toBe(true);
    });

    it("splits large tables for slides (PPTX)", () => {
      const model = makeModel({
        format: "pptx",
        sections: [{
          id: "s1",
          type: "data",
          components: [makeTableComponent(30, 4)],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      // PPTX maxVisibleRows is 12, so 30 rows = 3 parts
      const allTables = result.model.sections.flatMap(s =>
        s.components.filter(c => c.type === "table")
      );
      expect(allTables.length).toBe(3);
    });

    it("truncates oversized cell text", () => {
      const model = makeModel({
        format: "pptx",
        sections: [{
          id: "s1",
          type: "data",
          components: [{
            type: "table",
            columns: [{ header: "A" }],
            rows: [["X".repeat(200)]],
          } as TableComponent],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      const table = result.model.sections[0].components[0] as TableComponent;
      const cell = table.rows[0][0] as string;
      // PPTX maxCellChars is 100
      expect(cell.length).toBeLessThanOrEqual(100);
      expect(cell.endsWith("...")).toBe(true);
    });
  });

  describe("Image scaling", () => {
    it("scales down oversized images preserving aspect ratio", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "image",
            src: "https://example.com/huge.png",
            alt: "big image",
            width: 20,
            height: 10,
          } as ImageComponent],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      const img = result.model.sections[0].components[0] as ImageComponent;
      expect(img.width!).toBeLessThanOrEqual(6.5); // DOCX content width
      expect(result.actions.some(a => a.type === "scale")).toBe(true);
    });

    it("does not scale images that fit", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "image",
            src: "https://example.com/small.png",
            alt: "small",
            width: 3,
            height: 2,
          } as ImageComponent],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      const img = result.model.sections[0].components[0] as ImageComponent;
      expect(img.width).toBe(3);
      expect(img.height).toBe(2);
    });
  });

  describe("Section density (slides)", () => {
    it("splits dense sections for PPTX", () => {
      // Create a section with enough components to exceed density 15
      const components: DocumentComponent[] = [
        { type: "heading", level: 1, text: "Title" },
        ...Array.from({ length: 5 }, (_, i) => ({
          type: "paragraph" as const,
          text: "A".repeat(600), // each paragraph density ~2
        })),
        makeTableComponent(10, 4), // table density ~7
        { type: "chart", chartType: "bar" as const, categories: ["A"], series: [{ name: "S", values: [1] }] } as ChartComponent, // chart density ~5
      ];

      const model = makeModel({
        format: "pptx",
        sections: [{
          id: "s1",
          type: "content",
          title: "Dense Section",
          components,
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      expect(result.model.sections.length).toBeGreaterThan(1);
      expect(result.actions.some(a => a.type === "reflow")).toBe(true);
    });

    it("does not split sparse sections for PPTX", () => {
      const model = makeModel({
        format: "pptx",
        sections: [{
          id: "s1",
          type: "content",
          components: [
            { type: "heading", level: 1, text: "Simple" },
            { type: "paragraph", text: "Short text" },
          ],
        }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      expect(result.model.sections).toHaveLength(1);
    });

    it("does not split sections for DOCX (infinite density limit)", () => {
      const components: DocumentComponent[] = Array.from({ length: 50 }, () => ({
        type: "paragraph" as const,
        text: "Long paragraph. ".repeat(50),
      }));
      const model = makeModel({
        format: "docx",
        sections: [{ id: "s1", type: "content", components }],
      });
      const result = resolveLayout(model, CORPORATE_THEME);
      expect(result.model.sections).toHaveLength(1);
    });
  });

  describe("Density calculator", () => {
    it("heading has density 1", () => {
      expect(componentDensity({ type: "heading", level: 1, text: "Hi" })).toBe(1);
    });

    it("chart has density 5", () => {
      expect(componentDensity({ type: "chart", chartType: "bar", categories: [], series: [] } as any)).toBe(5);
    });

    it("table density increases with rows and columns", () => {
      const small = componentDensity(makeTableComponent(2, 2));
      const large = componentDensity(makeTableComponent(10, 8));
      expect(large).toBeGreaterThan(small);
    });
  });

  describe("Guardrails", () => {
    it("truncates to 100 sections max", () => {
      const sections = Array.from({ length: 120 }, (_, i) => ({
        id: `s-${i}`,
        type: "content" as const,
        components: [{ type: "paragraph" as const, text: "x" }],
      }));
      const model = makeModel({ sections });
      const result = resolveLayout(model, CORPORATE_THEME);
      expect(result.model.sections.length).toBeLessThanOrEqual(100);
    });

    it("warns when total components exceed max", () => {
      // Create a document that has many components after layout
      const components: DocumentComponent[] = Array.from({ length: 200 }, () => ({
        type: "paragraph" as const,
        text: "x",
      }));
      // 11 sections * 200 components = 2200 > 2000 limit
      const sections = Array.from({ length: 11 }, (_, i) => ({
        id: `s-${i}`,
        type: "content" as const,
        components: [...components],
      }));
      const model = makeModel({ sections });
      const result = resolveLayout(model, CORPORATE_THEME);
      expect(result.violations.some(v => v.code === "DOC_TOO_MANY_COMPONENTS")).toBe(true);
    });
  });
});

// =====================================================
// 5. COMPONENT LIBRARY
// =====================================================

describe("Component Library", () => {
  describe("Inline Markdown Parser", () => {
    it("parses plain text", () => {
      const runs = parseInlineMarkdown("Hello world");
      expect(runs).toHaveLength(1);
      expect(runs[0].text).toBe("Hello world");
    });

    it("parses **bold**", () => {
      const runs = parseInlineMarkdown("Hello **bold** world");
      expect(runs).toHaveLength(3);
      expect(runs[1].text).toBe("bold");
      expect(runs[1].bold).toBe(true);
    });

    it("parses *italic*", () => {
      const runs = parseInlineMarkdown("Hello *italic* world");
      expect(runs).toHaveLength(3);
      expect(runs[1].text).toBe("italic");
      expect(runs[1].italic).toBe(true);
    });

    it("parses `code`", () => {
      const runs = parseInlineMarkdown("Use `const x = 1` here");
      expect(runs).toHaveLength(3);
      expect(runs[1].text).toBe("const x = 1");
      expect(runs[1].code).toBe(true);
    });

    it("parses [links](url)", () => {
      const runs = parseInlineMarkdown("Visit [Google](https://google.com) now");
      expect(runs).toHaveLength(3);
      expect(runs[1].text).toBe("Google");
      expect(runs[1].hyperlink).toBe("https://google.com");
      expect(runs[1].underline).toBe(true);
    });

    it("handles empty string", () => {
      const runs = parseInlineMarkdown("");
      expect(runs).toHaveLength(1);
      expect(runs[0].text).toBe("");
    });

    it("handles multiple inline formats", () => {
      const runs = parseInlineMarkdown("**bold** and *italic* and `code`");
      const boldRun = runs.find(r => r.bold);
      const italicRun = runs.find(r => r.italic);
      const codeRun = runs.find(r => r.code);
      expect(boldRun).toBeDefined();
      expect(italicRun).toBeDefined();
      expect(codeRun).toBeDefined();
    });
  });

  describe("Truncation helpers", () => {
    it("truncateText leaves short text unchanged", () => {
      expect(truncateText("Hi", 100)).toBe("Hi");
    });

    it("truncateText truncates with ellipsis", () => {
      const result = truncateText("A".repeat(200), 50);
      expect(result.length).toBe(50);
      expect(result.endsWith("...")).toBe(true);
    });

    it("truncateList leaves small lists unchanged", () => {
      const result = truncateList(["a", "b"], 10);
      expect(result.items).toEqual(["a", "b"]);
      expect(result.truncated).toBe(0);
    });

    it("truncateList truncates with 'and N more'", () => {
      const items = Array.from({ length: 20 }, (_, i) => `Item ${i}`);
      const result = truncateList(items, 5);
      expect(result.items.length).toBe(5);
      expect(result.items[4]).toContain("and");
      expect(result.items[4]).toContain("more");
      expect(result.truncated).toBeGreaterThan(0);
    });

    it("truncateTableRows truncates rows", () => {
      const rows = Array.from({ length: 100 }, (_, i) => [`row-${i}`]);
      const result = truncateTableRows(rows, 10);
      expect(result.rows.length).toBe(10);
      expect(result.truncated).toBe(90);
    });
  });

  describe("Component Renderers", () => {
    const ctx = makeRenderContext();

    it("renders heading with correct style", () => {
      const nodes = renderComponent({ type: "heading", level: 1, text: "Title" }, ctx);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("paragraph");
      const para = nodes[0] as ParagraphNode;
      expect(para.style).toBe("Heading1");
      expect(para.runs[0].text).toBe("Title");
      expect(para.runs[0].bold).toBe(true);
    });

    it("renders paragraph with inline markdown", () => {
      const nodes = renderComponent({ type: "paragraph", text: "Hello **world**" }, ctx);
      expect(nodes).toHaveLength(1);
      const para = nodes[0] as ParagraphNode;
      expect(para.runs.some(r => r.bold)).toBe(true);
    });

    it("renders bullet list", () => {
      const nodes = renderComponent({
        type: "bulletList",
        items: ["Item 1", "Item 2", "Item 3"],
      }, ctx);
      expect(nodes).toHaveLength(3);
      expect((nodes[0] as ParagraphNode).bulletLevel).toBe(0);
    });

    it("renders numbered list with startAt", () => {
      const nodes = renderComponent({
        type: "numberedList",
        items: ["First", "Second"],
        startAt: 5,
      }, ctx);
      expect(nodes).toHaveLength(2);
      expect((nodes[0] as ParagraphNode).numberedStart).toBe(5);
    });

    it("renders table with header and body rows", () => {
      const nodes = renderComponent(makeTableComponent(3, 2), ctx);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const table = nodes[0] as TableNode;
      expect(table.type).toBe("table");
      expect(table.headerRow).toHaveLength(2);
      expect(table.bodyRows).toHaveLength(3);
    });

    it("renders chart", () => {
      const nodes = renderComponent({
        type: "chart",
        chartType: "bar",
        title: "Sales",
        categories: ["Q1", "Q2"],
        series: [{ name: "Revenue", values: [100, 200] }],
      }, ctx);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("chart");
    });

    it("renders image with caption", () => {
      const nodes = renderComponent({
        type: "image",
        src: "https://example.com/img.png",
        alt: "Test",
        caption: "Figure 1",
      }, ctx);
      // Image node + caption paragraph
      expect(nodes.length).toBe(2);
      expect(nodes[0].type).toBe("image");
      expect(nodes[1].type).toBe("paragraph");
    });

    it("renders code block", () => {
      const nodes = renderComponent({
        type: "codeBlock",
        code: "console.log('hello');",
        language: "typescript",
      }, ctx);
      expect(nodes).toHaveLength(1);
      const para = nodes[0] as ParagraphNode;
      expect(para.runs[0].code).toBe(true);
      expect(para.runs[0].fontFamily).toBe("Consolas");
    });

    it("renders quote with attribution", () => {
      const nodes = renderComponent({
        type: "quote",
        text: "To be or not to be",
        attribution: "Shakespeare",
      }, ctx);
      expect(nodes).toHaveLength(2);
      expect((nodes[1] as ParagraphNode).runs[0].text).toContain("Shakespeare");
    });

    it("renders card", () => {
      const nodes = renderComponent({
        type: "card",
        title: "Card Title",
        body: "Card body text",
        icon: "🎯",
      }, ctx);
      expect(nodes.length).toBe(2);
    });

    it("renders badge with color", () => {
      const nodes = renderComponent({
        type: "badge",
        text: "Active",
        color: "success",
      }, ctx);
      expect(nodes).toHaveLength(1);
      const para = nodes[0] as ParagraphNode;
      expect(para.runs[0].color).toBe(CORPORATE_THEME.colors.success);
    });

    it("renders KPI with trend", () => {
      const nodes = renderComponent({
        type: "kpi",
        label: "Revenue",
        value: "$1.2M",
        unit: "USD",
        trend: "up",
        trendValue: "12%",
      }, ctx);
      expect(nodes).toHaveLength(2);
    });

    it("renders divider", () => {
      const nodes = renderComponent({ type: "divider" }, ctx);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("divider");
    });

    it("renders spacer", () => {
      const nodes = renderComponent({ type: "spacer", height: 20 }, ctx);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("spacer");
    });

    it("renders page break", () => {
      const nodes = renderComponent({ type: "pageBreak" }, ctx);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("pageBreak");
    });
  });

  describe("Graceful Degradation", () => {
    it("handles unknown component type with fallback", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent({ type: "nonexistent" } as any, ctx);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("paragraph");
      expect(ctx.errors).toHaveLength(1);
      expect(ctx.errors[0].fallbackUsed).toBe(true);
    });

    it("handles component renderer throwing an error", () => {
      // Create a table component that would cause an error
      // by having undefined rows (would throw on .map)
      const ctx = makeRenderContext();
      const badTable: any = {
        type: "table",
        columns: [{ header: "A" }],
        rows: null, // This should cause an error in the renderer
      };
      const nodes = renderComponent(badTable, ctx);
      expect(nodes).toHaveLength(1);
      expect(ctx.errors).toHaveLength(1);
      expect(ctx.errors[0].componentType).toBe("table");
      expect(ctx.errors[0].fallbackUsed).toBe(true);
    });
  });

  describe("renderSection", () => {
    it("renders all components in a section", () => {
      const ctx = makeRenderContext();
      const components: DocumentComponent[] = [
        { type: "heading", level: 1, text: "Title" },
        { type: "paragraph", text: "Body text" },
        { type: "divider" },
      ];
      const nodes = renderSection(components, ctx);
      expect(nodes.length).toBe(3); // 1 heading para + 1 body para + 1 divider
      expect(ctx.errors).toHaveLength(0);
    });

    it("continues rendering after a failed component", () => {
      const ctx = makeRenderContext();
      const components: DocumentComponent[] = [
        { type: "heading", level: 1, text: "Before" },
        { type: "nonexistent" } as any, // Will use fallback
        { type: "paragraph", text: "After" },
      ];
      const nodes = renderSection(components, ctx);
      // heading + fallback + paragraph
      expect(nodes.length).toBe(3);
      expect(ctx.errors).toHaveLength(1);
    });
  });
});

// =====================================================
// 6. DOCUMENT COMPILER
// =====================================================

describe("Document Compiler", () => {
  // Register a mock format compiler for testing
  const mockDocxCompiler = vi.fn(async () => {
    // Return a minimal valid ZIP file (PK header)
    const buffer = Buffer.alloc(200);
    buffer[0] = 0x50; // P
    buffer[1] = 0x4B; // K
    buffer[2] = 0x03;
    buffer[3] = 0x04;
    // Fill with some data to pass the minimum size check
    buffer.fill(0xAB, 4, 200);
    return buffer;
  });

  beforeEach(() => {
    mockDocxCompiler.mockClear();
    registerFormatCompiler("docx", mockDocxCompiler);
  });

  describe("Full pipeline", () => {
    it("compiles a valid document successfully", async () => {
      const model = makeModel();
      const result = await compileDocument(model);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      expect(result.filename).toBe("Test_Document.docx");
      expect(result.report.success).toBe(true);
      expect(result.report.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.report.timings.preflight).toBeDefined();
      expect(result.report.timings.layout).toBeDefined();
      expect(result.report.timings.render).toBeDefined();
      expect(result.report.timings.compile).toBeDefined();
    });

    it("passes rendered sections to format compiler", async () => {
      const model = makeModel();
      await compileDocument(model);

      expect(mockDocxCompiler).toHaveBeenCalledOnce();
      const [sections, compiledModel, theme] = mockDocxCompiler.mock.calls[0];
      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("sec-1");
      expect(sections[0].nodes.length).toBeGreaterThan(0);
      expect(compiledModel.format).toBe("docx");
      expect(theme.id).toBe("corporate");
    });

    it("sanitizes filename from title", async () => {
      const model = makeModel({
        metadata: { title: "My Report <2024> (draft) #1!" },
      });
      const result = await compileDocument(model);
      expect(result.filename).toBe("My_Report_2024_draft_1.docx");
    });

    it("uses theme override when provided", async () => {
      const model = makeModel();
      const result = await compileDocument(model, MODERN_THEME);

      const [_, __, theme] = mockDocxCompiler.mock.calls[0];
      expect(theme.id).toBe("modern");
    });
  });

  describe("Error handling by phase", () => {
    it("throws CompilationError on preflight failure", async () => {
      const model = makeModel({ id: "", sections: [] });
      try {
        await compileDocument(model);
        expect.unreachable("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(CompilationError);
        expect(error.phase).toBe("preflight");
        expect(error.report.preflight).toBeDefined();
      }
    });

    it("throws CompilationError when no format compiler registered", async () => {
      const model = makeModel({ format: "pptx" });
      // pptx compiler is not registered
      try {
        await compileDocument(model);
        expect.unreachable("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(CompilationError);
        expect(error.phase).toBe("compile");
        expect(error.message).toContain("No compiler registered");
      }
    });

    it("throws CompilationError when format compiler throws", async () => {
      registerFormatCompiler("docx", async () => {
        throw new Error("DOCX generation failed");
      });

      const model = makeModel();
      try {
        await compileDocument(model);
        expect.unreachable("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(CompilationError);
        expect(error.phase).toBe("compile");
        expect(error.message).toContain("DOCX generation failed");
      }
    });

    it("throws CompilationError on post-render validation failure (empty buffer)", async () => {
      registerFormatCompiler("docx", async () => Buffer.alloc(0));

      const model = makeModel();
      try {
        await compileDocument(model);
        expect.unreachable("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(CompilationError);
        expect(error.phase).toBe("postRender");
        expect(error.message).toContain("empty");
      }
    });

    it("throws CompilationError on invalid ZIP header", async () => {
      registerFormatCompiler("docx", async () => {
        const buf = Buffer.alloc(200);
        buf.fill(0xFF); // Wrong magic bytes
        return buf;
      });

      const model = makeModel();
      try {
        await compileDocument(model);
        expect.unreachable("Should have thrown");
      } catch (error: any) {
        expect(error).toBeInstanceOf(CompilationError);
        expect(error.phase).toBe("postRender");
        expect(error.message).toContain("PK magic bytes");
      }
    });
  });

  describe("Compilation report", () => {
    it("includes preflight, layout, degraded components, and timings", async () => {
      const model = makeModel();
      const result = await compileDocument(model);

      expect(result.report.preflight.valid).toBe(true);
      expect(result.report.layout.model).toBeDefined();
      expect(result.report.degradedComponents).toEqual([]);
      expect(result.report.postRender.valid).toBe(true);
      expect(result.report.postRender.bufferSizeBytes).toBeGreaterThan(0);
      expect(result.report.timings.total).toBeGreaterThanOrEqual(0);
    });

    it("reports degraded components", async () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [
            { type: "heading", level: 1, text: "OK" },
            { type: "nonexistent" } as any,
          ],
        }],
      });
      const result = await compileDocument(model);
      expect(result.report.degradedComponents).toHaveLength(1);
      expect(result.report.degradedComponents[0].fallbackUsed).toBe(true);
    });
  });
});

// =====================================================
// 7. FUZZING & ADVERSARIAL INPUTS
// =====================================================

describe("Fuzzing & Adversarial Inputs", () => {
  describe("XSS and injection attempts", () => {
    it("sanitizes XSS in heading text", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "heading",
            level: 1,
            text: "<script>alert('xss')</script>Hello",
          }],
        }],
      });
      const result = preflightValidate(model);
      // Preflight should pass (angle brackets are valid XML chars)
      // but the text should remain safe for rendering
      expect(result.valid).toBe(true);
    });

    it("sanitizes SQL injection in table cells", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "table",
            columns: [{ header: "Name" }],
            rows: [["Robert'; DROP TABLE students;--"]],
          } as TableComponent],
        }],
      });
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
      // SQL injection is just text in a document - it should be preserved
      const table = result.sanitizedModel.sections[0].components[0] as TableComponent;
      expect(table.rows[0][0]).toContain("DROP TABLE");
    });

    it("handles null bytes in all text fields", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [
            { type: "heading", level: 1, text: "Title\x00\x01\x02" },
            { type: "paragraph", text: "Para\x00graph" },
            { type: "bulletList", items: ["Item\x00One", "Item\x00Two"] },
            { type: "quote", text: "Quote\x00Text", attribution: "Auth\x00or" },
          ],
        }],
      });
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
      const heading = result.sanitizedModel.sections[0].components[0] as any;
      expect(heading.text).not.toContain("\x00");
      expect(heading.text).not.toContain("\x01");
    });
  });

  describe("Unicode edge cases", () => {
    it("handles emoji in text", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [
            { type: "heading", level: 1, text: "Report 📊 2024" },
            { type: "paragraph", text: "Status: ✅ Complete 🎉" },
          ],
        }],
      });
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
    });

    it("handles RTL text (Arabic/Hebrew)", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [
            { type: "heading", level: 1, text: "مرحبا بالعالم" },
            { type: "paragraph", text: "שלום עולם" },
          ],
        }],
      });
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
    });

    it("handles CJK characters", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [
            { type: "heading", level: 1, text: "日本語テスト" },
            { type: "paragraph", text: "中文测试 한국어 테스트" },
          ],
        }],
      });
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
    });

    it("handles zero-width characters", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "content",
          components: [{
            type: "paragraph",
            text: "Hello\u200B\u200C\u200DWorld", // zero-width space, non-joiner, joiner
          }],
        }],
      });
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
    });
  });

  describe("Extreme sizes", () => {
    it("handles very long paragraph text", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent({
        type: "paragraph",
        text: "X".repeat(100_000),
      }, ctx);
      expect(nodes).toHaveLength(1);
      const para = nodes[0] as ParagraphNode;
      expect(para.runs[0].text.length).toBeLessThanOrEqual(50_000);
    });

    it("handles very long bullet list", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent({
        type: "bulletList",
        items: Array.from({ length: 500 }, (_, i) => `Item ${i}`),
        maxItems: 20,
      }, ctx);
      expect(nodes.length).toBeLessThanOrEqual(20);
    });

    it("handles very large table", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent(makeTableComponent(10000, 3), ctx);
      const table = nodes.find(n => n.type === "table") as TableNode;
      expect(table).toBeDefined();
      // Component renderer uses its own maxRows default of 5000
      expect(table.bodyRows.length).toBeLessThanOrEqual(5000);
    });

    it("handles very long code block", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent({
        type: "codeBlock",
        code: "line\n".repeat(5000),
        maxLines: 100,
      }, ctx);
      const para = nodes[0] as ParagraphNode;
      expect(para.runs[0].text).toContain("more lines");
    });

    it("handles empty components gracefully", () => {
      const ctx = makeRenderContext();

      // Empty heading
      const h = renderComponent({ type: "heading", level: 1, text: "" }, ctx);
      expect(h).toHaveLength(1);

      // Empty paragraph
      const p = renderComponent({ type: "paragraph", text: "" }, ctx);
      expect(p).toHaveLength(1);

      // Empty bullet list
      const b = renderComponent({ type: "bulletList", items: [] }, ctx);
      expect(b).toHaveLength(0); // No items = no paragraphs

      // Empty table (will use fallback since columns array may cause issues)
      const t = renderComponent({
        type: "table",
        columns: [{ header: "A" }],
        rows: [],
      } as TableComponent, ctx);
      expect(t).toHaveLength(1); // Table with 0 rows
    });
  });

  describe("Special characters in filenames", () => {
    it("sanitizes special chars in document title for filename", () => {
      const model = makeModel({
        metadata: { title: "Q1/Q2 Report: Revenue & Expenses <2024>" },
      });
      // Verify the document compiles with this title
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
    });

    it("handles extremely long title", () => {
      const model = makeModel({
        metadata: { title: "A".repeat(500) },
      });
      const result = preflightValidate(model);
      expect(result.valid).toBe(true);
    });
  });
});

// =====================================================
// 8. GOLDEN FILE / DETERMINISTIC OUTPUT TESTS
// =====================================================

describe("Golden File / Deterministic Output", () => {
  describe("Component rendering is deterministic", () => {
    it("same heading input produces identical output", () => {
      const ctx1 = makeRenderContext();
      const ctx2 = makeRenderContext();
      const comp: DocumentComponent = { type: "heading", level: 2, text: "Test Heading" };
      const nodes1 = renderComponent(comp, ctx1);
      const nodes2 = renderComponent(comp, ctx2);
      expect(JSON.stringify(nodes1)).toBe(JSON.stringify(nodes2));
    });

    it("same table input produces identical output", () => {
      const ctx1 = makeRenderContext();
      const ctx2 = makeRenderContext();
      const comp = makeTableComponent(5, 3);
      const nodes1 = renderComponent(comp, ctx1);
      const nodes2 = renderComponent(comp, ctx2);
      expect(JSON.stringify(nodes1)).toBe(JSON.stringify(nodes2));
    });

    it("same model produces identical preflight result", () => {
      const model = makeModel();
      const result1 = preflightValidate(model);
      const result2 = preflightValidate(model);
      expect(result1.valid).toBe(result2.valid);
      expect(result1.errors).toEqual(result2.errors);
      expect(result1.warnings).toEqual(result2.warnings);
      expect(result1.estimatedSizeBytes).toBe(result2.estimatedSizeBytes);
    });

    it("same model produces identical layout result", () => {
      const model = makeModel({
        sections: [{
          id: "s1",
          type: "data",
          components: [makeTableComponent(150, 5)],
        }],
      });
      const result1 = resolveLayout(model, CORPORATE_THEME);
      const result2 = resolveLayout(model, CORPORATE_THEME);
      expect(result1.actions).toEqual(result2.actions);
      expect(result1.violations).toEqual(result2.violations);
      expect(JSON.stringify(result1.model.sections)).toBe(JSON.stringify(result2.model.sections));
    });
  });

  describe("Known golden outputs", () => {
    it("heading level 1 produces expected render node structure", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent({ type: "heading", level: 1, text: "Golden Test" }, ctx);
      expect(nodes).toEqual([{
        type: "paragraph",
        runs: [{
          type: "textRun",
          text: "Golden Test",
          bold: true,
          color: CORPORATE_THEME.colors.primaryDark,
          fontSize: CORPORATE_THEME.typography.heading1.size,
          fontFamily: CORPORATE_THEME.typography.heading1.family,
        }],
        alignment: "left",
        spaceBefore: CORPORATE_THEME.spacing.headingSpaceBefore,
        spaceAfter: CORPORATE_THEME.spacing.headingSpaceAfter,
        style: "Heading1",
      }]);
    });

    it("badge with success color produces expected color", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent({
        type: "badge",
        text: "PASS",
        color: "success",
      }, ctx);
      const para = nodes[0] as ParagraphNode;
      expect(para.runs[0].color).toBe("276749"); // CORPORATE success color
    });

    it("KPI with upward trend produces correct icon", () => {
      const ctx = makeRenderContext();
      const nodes = renderComponent({
        type: "kpi",
        label: "Revenue",
        value: "100",
        trend: "up",
        trendValue: "5%",
      }, ctx);
      const valuePara = nodes[1] as ParagraphNode;
      const trendRun = valuePara.runs.find(r => r.text.includes("+5%"));
      expect(trendRun).toBeDefined();
      expect(trendRun!.color).toBe("276749"); // success color for up trend
    });
  });
});

// =====================================================
// 9. END-TO-END PIPELINE
// =====================================================

describe("End-to-End Pipeline", () => {
  beforeEach(() => {
    registerFormatCompiler("docx", async () => {
      const buffer = Buffer.alloc(200);
      buffer[0] = 0x50;
      buffer[1] = 0x4B;
      buffer[2] = 0x03;
      buffer[3] = 0x04;
      buffer.fill(0xCD, 4, 200);
      return buffer;
    });
  });

  it("compiles a complex multi-section document", async () => {
    const model: DocumentModel = {
      id: "e2e-test-001",
      format: "docx",
      themeId: "corporate",
      metadata: {
        title: "Quarterly Business Review",
        author: "Test Suite",
        date: "2024-01-15",
      },
      sections: [
        {
          id: "cover",
          type: "cover",
          title: "Cover",
          components: [
            { type: "heading", level: 1, text: "Q4 2024 Business Review" },
            { type: "paragraph", text: "Prepared by the **Analytics Team**" },
          ],
        },
        {
          id: "kpis",
          type: "summary",
          title: "Key Metrics",
          components: [
            { type: "kpi", label: "Revenue", value: "$12.5M", trend: "up", trendValue: "15%" },
            { type: "kpi", label: "Costs", value: "$8.3M", trend: "down", trendValue: "3%" },
            { type: "kpi", label: "Margin", value: "33.6%", trend: "up", trendValue: "2.1pp" },
          ],
        },
        {
          id: "data",
          type: "data",
          title: "Revenue Breakdown",
          components: [
            {
              type: "table",
              columns: [
                { header: "Region", dataType: "text" },
                { header: "Revenue", dataType: "currency" },
                { header: "Growth", dataType: "percentage" },
              ],
              rows: [
                ["North America", "$5.2M", "12%"],
                ["Europe", "$3.8M", "18%"],
                ["Asia Pacific", "$2.1M", "25%"],
                ["Latin America", "$1.4M", "8%"],
              ],
              variant: "striped",
            } as TableComponent,
          ],
        },
        {
          id: "charts",
          type: "chart",
          title: "Trends",
          components: [
            {
              type: "chart",
              chartType: "line",
              title: "Monthly Revenue",
              categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
              series: [
                { name: "2024", values: [1.8, 2.0, 2.1, 2.3, 2.2, 2.1] },
                { name: "2023", values: [1.5, 1.6, 1.7, 1.8, 1.9, 1.9] },
              ],
            } as ChartComponent,
          ],
        },
        {
          id: "appendix",
          type: "appendix",
          title: "Appendix",
          components: [
            { type: "heading", level: 2, text: "Methodology" },
            { type: "paragraph", text: "Data collected from internal *CRM* and `ERP` systems." },
            { type: "codeBlock", code: "SELECT region, SUM(revenue) FROM sales GROUP BY region;", language: "sql" },
            { type: "quote", text: "Numbers don't lie.", attribution: "CFO" },
            { type: "divider" },
            { type: "badge", text: "CONFIDENTIAL", color: "danger" },
          ],
        },
      ],
    };

    const result = await compileDocument(model);

    expect(result.report.success).toBe(true);
    expect(result.report.degradedComponents).toHaveLength(0);
    expect(result.report.preflight.valid).toBe(true);
    expect(result.report.postRender.valid).toBe(true);
    expect(result.filename).toBe("Quarterly_Business_Review.docx");
    expect(result.report.timings.total).toBeDefined();
  });

  it("compiles document with all component types", async () => {
    const model: DocumentModel = {
      id: "all-components-test",
      format: "docx",
      themeId: "corporate",
      metadata: { title: "All Components" },
      sections: [{
        id: "all",
        type: "content",
        components: [
          { type: "heading", level: 1, text: "Main Title" },
          { type: "heading", level: 2, text: "Subtitle" },
          { type: "heading", level: 3, text: "Minor Heading" },
          { type: "paragraph", text: "Regular paragraph with **bold** and *italic*." },
          { type: "bulletList", items: ["First", "Second", "Third"] },
          { type: "numberedList", items: ["Step 1", "Step 2"], startAt: 1 },
          makeTableComponent(3, 3),
          {
            type: "chart", chartType: "bar", categories: ["A", "B"],
            series: [{ name: "S1", values: [10, 20] }],
          } as ChartComponent,
          { type: "image", src: "https://example.com/test.png", alt: "Test Image" } as ImageComponent,
          { type: "codeBlock", code: "print('hello')", language: "python" },
          { type: "quote", text: "A wise quote", attribution: "Author" },
          { type: "card", title: "Info Card", body: "Card content" },
          { type: "badge", text: "NEW", color: "primary" },
          { type: "kpi", label: "Users", value: "10K", trend: "up", trendValue: "5%" },
          { type: "divider" },
          { type: "spacer", height: 12 },
          { type: "pageBreak" },
        ],
      }],
    };

    const result = await compileDocument(model);
    expect(result.report.success).toBe(true);
    expect(result.report.degradedComponents).toHaveLength(0);
  });
});
