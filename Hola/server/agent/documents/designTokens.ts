/**
 * Design Tokens v2 — Versioned, format-aware design system for document generation.
 *
 * Extends the base DesignTokensSchema with:
 *   - Strict semantic versioning (major.minor.patch)
 *   - Format-specific style mappings (Word styles, Excel table styles, PPT slide masters)
 *   - Text style presets (heading, body, caption, code, quote)
 *   - Table style presets (header, stripe, border configs)
 *   - Chart color sequences
 *   - Section variant overrides
 *   - Token inheritance resolution
 */

import { z } from "zod";

/* ================================================================== */
/*  SEMVER                                                             */
/* ================================================================== */

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

export const SemverSchema = z
  .string()
  .regex(SEMVER_REGEX, "Must be semver (e.g. 1.0.0)")
  .default("1.0.0");

export function parseSemver(v: string): { major: number; minor: number; patch: number } {
  const parts = v.split(".").map(Number);
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

export function isCompatible(required: string, actual: string): boolean {
  const req = parseSemver(required);
  const act = parseSemver(actual);
  return act.major === req.major && (act.minor > req.minor || (act.minor === req.minor && act.patch >= req.patch));
}

/* ================================================================== */
/*  TEXT STYLE PRESETS                                                  */
/* ================================================================== */

export const TextStyleSchema = z.object({
  fontFamily: z.string().max(100).default("Calibri"),
  fontSize: z.number().min(1).max(200).default(12),
  fontWeight: z.enum(["normal", "bold", "light"]).default("normal"),
  fontStyle: z.enum(["normal", "italic"]).default("normal"),
  color: z.string().default("#000000"),
  lineHeight: z.number().min(0.5).max(5).default(1.15),
  letterSpacing: z.number().min(-5).max(20).default(0),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).default("none"),
  textAlign: z.enum(["left", "center", "right", "justify"]).default("left"),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const TextStylePresetsSchema = z.object({
  title: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a73e8",
    lineHeight: 1.2,
  }),
  h1: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 24,
    fontWeight: "bold",
    color: "#202124",
    lineHeight: 1.3,
  }),
  h2: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 20,
    fontWeight: "bold",
    color: "#202124",
    lineHeight: 1.3,
  }),
  h3: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 16,
    fontWeight: "bold",
    color: "#202124",
    lineHeight: 1.4,
  }),
  h4: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 14,
    fontWeight: "bold",
    color: "#5f6368",
    lineHeight: 1.4,
  }),
  body: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 12,
    fontWeight: "normal",
    color: "#202124",
    lineHeight: 1.5,
  }),
  bodySmall: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 10,
    fontWeight: "normal",
    color: "#5f6368",
    lineHeight: 1.4,
  }),
  caption: TextStyleSchema.default({
    fontFamily: "Calibri",
    fontSize: 9,
    fontWeight: "normal",
    color: "#9aa0a6",
    lineHeight: 1.3,
  }),
  code: TextStyleSchema.default({
    fontFamily: "Consolas",
    fontSize: 11,
    fontWeight: "normal",
    color: "#37474f",
    lineHeight: 1.4,
  }),
  quote: TextStyleSchema.default({
    fontFamily: "Georgia",
    fontSize: 14,
    fontStyle: "italic",
    color: "#5f6368",
    lineHeight: 1.6,
  }),
});
export type TextStylePresets = z.infer<typeof TextStylePresetsSchema>;

/* ================================================================== */
/*  TABLE STYLE PRESETS                                                */
/* ================================================================== */

export const TableStyleSchema = z.object({
  headerBg: z.string().default("#1a73e8"),
  headerFg: z.string().default("#ffffff"),
  headerFontSize: z.number().default(11),
  headerFontWeight: z.enum(["normal", "bold"]).default("bold"),
  headerAlign: z.enum(["left", "center", "right"]).default("center"),
  bodyFontSize: z.number().default(10),
  bodyColor: z.string().default("#202124"),
  stripeOdd: z.string().default("#f8f9fa"),
  stripeEven: z.string().default("#ffffff"),
  borderColor: z.string().default("#dadce0"),
  borderWidth: z.enum(["none", "thin", "medium", "thick"]).default("thin"),
  cellPadding: z.number().default(4),
  rowHeight: z.number().default(20),
});
export type TableStyle = z.infer<typeof TableStyleSchema>;

/* ================================================================== */
/*  CHART STYLE                                                        */
/* ================================================================== */

export const ChartStyleSchema = z.object({
  colorSequence: z
    .array(z.string())
    .default(["#1a73e8", "#34a853", "#ea4335", "#fbbc04", "#4285f4", "#673ab7", "#e91e63", "#009688"]),
  fontFamily: z.string().default("Calibri"),
  fontSize: z.number().default(10),
  titleFontSize: z.number().default(14),
  legendPosition: z.enum(["bottom", "right", "top", "none"]).default("bottom"),
  gridLineColor: z.string().default("#e0e0e0"),
  backgroundColor: z.string().default("transparent"),
});
export type ChartStyle = z.infer<typeof ChartStyleSchema>;

/* ================================================================== */
/*  FORMAT-SPECIFIC MAPPINGS                                           */
/* ================================================================== */

export const DocxMappingSchema = z.object({
  /** Word paragraph style IDs mapped to our text presets */
  styleMap: z.record(z.string()).default({
    title: "Title",
    h1: "Heading1",
    h2: "Heading2",
    h3: "Heading3",
    h4: "Heading4",
    body: "Normal",
    caption: "Caption",
    quote: "IntenseQuote",
  }),
  /** Numbering reference ID */
  numberingRef: z.string().default("default-numbering"),
  /** Page margin in inches */
  margins: z.object({
    top: z.number().default(1),
    right: z.number().default(1),
    bottom: z.number().default(1),
    left: z.number().default(1),
  }).default({}),
  /** Page size */
  pageSize: z.enum(["A4", "LETTER", "LEGAL", "A3", "A5"]).default("LETTER"),
  /** Columns */
  columns: z.number().int().min(1).max(4).default(1),
  /** Header/footer text */
  headerText: z.string().optional(),
  footerText: z.string().optional(),
  showPageNumbers: z.boolean().default(true),
});
export type DocxMapping = z.infer<typeof DocxMappingSchema>;

export const XlsxMappingSchema = z.object({
  /** ExcelJS table style theme name */
  tableStyleTheme: z.string().default("TableStyleMedium9"),
  /** Default column width */
  defaultColumnWidth: z.number().default(15),
  /** Freeze first row */
  freezeHeader: z.boolean().default(true),
  /** Auto-filter */
  autoFilter: z.boolean().default(true),
  /** Show gridlines */
  showGridlines: z.boolean().default(true),
  /** Number formats per data type */
  numberFormats: z.record(z.string()).default({
    currency: "#,##0.00",
    percentage: "0.00%",
    date: "yyyy-mm-dd",
    integer: "#,##0",
    decimal: "#,##0.00",
  }),
});
export type XlsxMapping = z.infer<typeof XlsxMappingSchema>;

export const PptxMappingSchema = z.object({
  /** Slide dimensions in inches */
  slideWidth: z.number().default(10),
  slideHeight: z.number().default(5.625), // 16:9
  /** Slide margins */
  margins: z.object({
    top: z.number().default(0.5),
    right: z.number().default(0.5),
    bottom: z.number().default(0.5),
    left: z.number().default(0.5),
  }).default({}),
  /** Master slide background */
  masterBackground: z.string().default("#ffffff"),
  /** Title slide background (color or gradient) */
  titleSlideBackground: z.union([
    z.string(),
    z.object({
      gradient: z.tuple([z.string(), z.string()]),
      direction: z.enum(["horizontal", "vertical", "diagonal"]).default("diagonal"),
    }),
  ]).default("#1a73e8"),
  /** Section divider background */
  sectionBackground: z.string().default("#1a73e8"),
  /** Footer text for all slides */
  footerText: z.string().optional(),
  /** Show slide numbers */
  showSlideNumbers: z.boolean().default(true),
});
export type PptxMapping = z.infer<typeof PptxMappingSchema>;

/* ================================================================== */
/*  DESIGN TOKENS V2 — FULL SCHEMA                                     */
/* ================================================================== */

export const DesignTokensV2Schema = z.object({
  /** Strict semver version */
  version: SemverSchema,
  /** Human-readable theme name */
  name: z.string().max(100).default("default"),

  /* ---- Core Palette ---- */
  colors: z.object({
    primary: z.string().default("#1a73e8"),
    secondary: z.string().default("#34a853"),
    accent: z.string().default("#ea4335"),
    warning: z.string().default("#fbbc04"),
    info: z.string().default("#4285f4"),
    success: z.string().default("#34a853"),
    error: z.string().default("#ea4335"),
    background: z.string().default("#ffffff"),
    surface: z.string().default("#f8f9fa"),
    textPrimary: z.string().default("#202124"),
    textSecondary: z.string().default("#5f6368"),
    textMuted: z.string().default("#9aa0a6"),
    border: z.string().default("#dadce0"),
    divider: z.string().default("#e8eaed"),
  }).default({}),

  /* ---- Typography ---- */
  textStyles: TextStylePresetsSchema.default({}),

  /* ---- Spacing Scale ---- */
  spacing: z.object({
    xxs: z.number().default(2),
    xs: z.number().default(4),
    sm: z.number().default(8),
    md: z.number().default(16),
    lg: z.number().default(24),
    xl: z.number().default(32),
    xxl: z.number().default(48),
    xxxl: z.number().default(64),
  }).default({}),

  /* ---- Border Radii ---- */
  radii: z.object({
    none: z.number().default(0),
    sm: z.number().default(2),
    md: z.number().default(4),
    lg: z.number().default(8),
    xl: z.number().default(16),
    full: z.number().default(9999),
  }).default({}),

  /* ---- Shadows ---- */
  shadows: z.object({
    sm: z.string().default("0 1px 2px rgba(0,0,0,0.1)"),
    md: z.string().default("0 2px 6px rgba(0,0,0,0.15)"),
    lg: z.string().default("0 4px 12px rgba(0,0,0,0.2)"),
  }).default({}),

  /* ---- Table Style ---- */
  tableStyle: TableStyleSchema.default({}),

  /* ---- Chart Style ---- */
  chartStyle: ChartStyleSchema.default({}),

  /* ---- Format-Specific Mappings ---- */
  docx: DocxMappingSchema.default({}),
  xlsx: XlsxMappingSchema.default({}),
  pptx: PptxMappingSchema.default({}),

  /* ---- Section Variants ---- */
  sectionVariants: z.record(z.object({
    colors: z.record(z.string()).optional(),
    textStyleOverrides: z.record(z.any()).optional(),
    tableStyleOverrides: z.record(z.any()).optional(),
  })).default({}),
});

export type DesignTokensV2 = z.infer<typeof DesignTokensV2Schema>;

/* ================================================================== */
/*  PREDEFINED THEME PRESETS                                           */
/* ================================================================== */

export const THEME_PRESETS_V2: Record<string, DesignTokensV2> = {
  default: DesignTokensV2Schema.parse({ name: "default" }),

  corporate: DesignTokensV2Schema.parse({
    name: "corporate",
    version: "1.0.0",
    colors: {
      primary: "#1a365d",
      secondary: "#2b6cb0",
      accent: "#ed8936",
      success: "#38a169",
      warning: "#ecc94b",
      background: "#ffffff",
      surface: "#edf2f7",
      textPrimary: "#2d3748",
      textSecondary: "#718096",
      border: "#cbd5e0",
    },
    textStyles: {
      title: { fontFamily: "Calibri", fontSize: 32, fontWeight: "bold", color: "#1a365d" },
      h1: { fontFamily: "Calibri", fontSize: 26, fontWeight: "bold", color: "#1a365d" },
      h2: { fontFamily: "Calibri", fontSize: 22, fontWeight: "bold", color: "#2b6cb0" },
      h3: { fontFamily: "Calibri", fontSize: 18, fontWeight: "bold", color: "#2b6cb0" },
      body: { fontFamily: "Calibri Light", fontSize: 12, color: "#2d3748" },
    },
    tableStyle: {
      headerBg: "#1a365d",
      headerFg: "#ffffff",
      stripeOdd: "#f7fafc",
      borderColor: "#cbd5e0",
    },
    chartStyle: {
      colorSequence: ["#1a365d", "#2b6cb0", "#ed8936", "#38a169", "#ecc94b", "#e53e3e"],
    },
    pptx: {
      titleSlideBackground: { gradient: ["#1a365d", "#2b6cb0"], direction: "diagonal" },
      sectionBackground: "#1a365d",
    },
  }),

  academic: DesignTokensV2Schema.parse({
    name: "academic",
    version: "1.0.0",
    colors: {
      primary: "#1a1a2e",
      secondary: "#16213e",
      accent: "#0f3460",
      background: "#ffffff",
      surface: "#f8f9fa",
      textPrimary: "#1a1a1a",
      textSecondary: "#4a4a4a",
      border: "#d0d0d0",
    },
    textStyles: {
      title: { fontFamily: "Times New Roman", fontSize: 24, fontWeight: "bold", color: "#1a1a2e" },
      h1: { fontFamily: "Times New Roman", fontSize: 20, fontWeight: "bold", color: "#1a1a2e" },
      h2: { fontFamily: "Times New Roman", fontSize: 16, fontWeight: "bold", color: "#16213e" },
      body: { fontFamily: "Times New Roman", fontSize: 12, color: "#1a1a1a", lineHeight: 2.0, textAlign: "justify" },
      caption: { fontFamily: "Times New Roman", fontSize: 10, fontStyle: "italic", color: "#4a4a4a" },
    },
    tableStyle: {
      headerBg: "#1a1a2e",
      headerFg: "#ffffff",
      borderColor: "#d0d0d0",
      borderWidth: "thin",
    },
    pptx: {
      slideHeight: 7.5, // 4:3
      titleSlideBackground: "#1a1a2e",
    },
  }),

  modern: DesignTokensV2Schema.parse({
    name: "modern",
    version: "1.0.0",
    colors: {
      primary: "#6C63FF",
      secondary: "#3F3D56",
      accent: "#FF6584",
      background: "#ffffff",
      surface: "#f5f3ff",
      textPrimary: "#2d2d2d",
      textSecondary: "#6b6b6b",
      border: "#e0daf7",
    },
    textStyles: {
      title: { fontFamily: "Segoe UI", fontSize: 32, fontWeight: "bold", color: "#6C63FF" },
      h1: { fontFamily: "Segoe UI", fontSize: 26, fontWeight: "bold", color: "#3F3D56" },
      h2: { fontFamily: "Segoe UI", fontSize: 22, fontWeight: "bold", color: "#6C63FF" },
      body: { fontFamily: "Segoe UI", fontSize: 12, color: "#2d2d2d" },
    },
    tableStyle: {
      headerBg: "#6C63FF",
      headerFg: "#ffffff",
      stripeOdd: "#faf5ff",
      borderColor: "#e0daf7",
    },
    chartStyle: {
      colorSequence: ["#6C63FF", "#FF6584", "#3F3D56", "#43E97B", "#F09819", "#8E2DE2"],
    },
    pptx: {
      titleSlideBackground: { gradient: ["#667eea", "#764ba2"], direction: "diagonal" },
      sectionBackground: "#6C63FF",
    },
  }),

  minimal: DesignTokensV2Schema.parse({
    name: "minimal",
    version: "1.0.0",
    colors: {
      primary: "#000000",
      secondary: "#333333",
      accent: "#666666",
      background: "#ffffff",
      surface: "#fafafa",
      textPrimary: "#1a1a1a",
      textSecondary: "#666666",
      border: "#e0e0e0",
    },
    textStyles: {
      title: { fontFamily: "Arial", fontSize: 28, fontWeight: "bold", color: "#000000" },
      h1: { fontFamily: "Arial", fontSize: 22, fontWeight: "bold", color: "#000000" },
      body: { fontFamily: "Arial", fontSize: 12, color: "#1a1a1a" },
    },
    tableStyle: {
      headerBg: "#000000",
      headerFg: "#ffffff",
      borderColor: "#e0e0e0",
    },
  }),

  dark: DesignTokensV2Schema.parse({
    name: "dark",
    version: "1.0.0",
    colors: {
      primary: "#63b3ed",
      secondary: "#2d3748",
      accent: "#f6ad55",
      background: "#1a202c",
      surface: "#2d3748",
      textPrimary: "#e2e8f0",
      textSecondary: "#a0aec0",
      border: "#4a5568",
    },
    textStyles: {
      title: { fontFamily: "Segoe UI", fontSize: 32, fontWeight: "bold", color: "#63b3ed" },
      h1: { fontFamily: "Segoe UI", fontSize: 26, fontWeight: "bold", color: "#e2e8f0" },
      body: { fontFamily: "Segoe UI", fontSize: 12, color: "#e2e8f0" },
    },
    tableStyle: {
      headerBg: "#2d3748",
      headerFg: "#e2e8f0",
      stripeOdd: "#2d3748",
      stripeEven: "#1a202c",
      borderColor: "#4a5568",
    },
    pptx: {
      masterBackground: "#1a202c",
      titleSlideBackground: { gradient: ["#1a202c", "#2d3748"], direction: "diagonal" },
      sectionBackground: "#2d3748",
    },
  }),
};

/* ================================================================== */
/*  RESOLVER                                                           */
/* ================================================================== */

const ALLOWED_THEME_NAMES_V2 = new Set(Object.keys(THEME_PRESETS_V2));
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function hasDangerousKeys(obj: unknown, depth = 0): boolean {
  if (depth > 5 || obj === null || typeof obj !== "object") return false;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys((obj as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Resolve design tokens from a theme name, partial override, or undefined.
 * Always returns a fully validated DesignTokensV2 object.
 */
export function resolveTokens(
  input: string | Partial<DesignTokensV2> | undefined,
): DesignTokensV2 {
  if (!input) return THEME_PRESETS_V2.default;

  if (typeof input === "string") {
    if (!ALLOWED_THEME_NAMES_V2.has(input)) {
      console.warn(`[DesignTokensV2] Unknown theme "${input}", using default`);
      return THEME_PRESETS_V2.default;
    }
    return THEME_PRESETS_V2[input];
  }

  if (typeof input === "object" && hasDangerousKeys(input)) {
    console.warn("[DesignTokensV2] Rejected tokens with dangerous keys");
    return THEME_PRESETS_V2.default;
  }

  try {
    return DesignTokensV2Schema.parse(input);
  } catch (err) {
    console.warn(`[DesignTokensV2] Parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return THEME_PRESETS_V2.default;
  }
}

/**
 * Merge a section variant into base tokens, producing a new resolved set.
 */
export function applyVariant(
  base: DesignTokensV2,
  variantName: string,
): DesignTokensV2 {
  const variant = base.sectionVariants[variantName];
  if (!variant) return base;

  const merged = structuredClone(base);
  if (variant.colors) {
    Object.assign(merged.colors, variant.colors);
  }
  if (variant.textStyleOverrides) {
    for (const [key, overrides] of Object.entries(variant.textStyleOverrides)) {
      if (key in merged.textStyles) {
        Object.assign((merged.textStyles as any)[key], overrides);
      }
    }
  }
  if (variant.tableStyleOverrides) {
    Object.assign(merged.tableStyle, variant.tableStyleOverrides);
  }
  return merged;
}
