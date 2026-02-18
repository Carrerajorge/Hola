/**
 * Unified Design Token System v2
 *
 * Single source of truth for all visual tokens across Word, Excel, and PowerPoint.
 * Extends the existing DesignTokensSchema with:
 *   - Strict version semver
 *   - Table style tokens (header, zebra, border patterns)
 *   - Chart palette tokens
 *   - Component-level tokens (cards, badges, buttons)
 *   - Format-specific overrides (Word styles, Excel styles, PPT master)
 *
 * All renderers MUST read from resolved tokens — never hardcode colors/fonts.
 */

import { z } from "zod";
import { DesignTokensSchema, type DesignTokens } from "./documentEngine";

/* ================================================================== */
/*  EXTENDED TOKEN SCHEMAS                                             */
/* ================================================================== */

/** Table styling tokens shared across all formats */
export const TableTokensSchema = z.object({
  headerBg: z.string().default("#1a73e8"),
  headerFg: z.string().default("#ffffff"),
  headerFontSize: z.number().min(6).max(72).default(11),
  headerBold: z.boolean().default(true),
  headerAlign: z.enum(["left", "center", "right"]).default("center"),
  zebraOdd: z.string().default("#f8f9fa"),
  zebraEven: z.string().default("#ffffff"),
  borderColor: z.string().default("#dadce0"),
  borderWidth: z.number().min(0).max(10).default(1),
  borderStyle: z.enum(["thin", "medium", "thick", "none"]).default("thin"),
  cellPaddingPt: z.number().min(0).max(36).default(4),
  bodyFontSize: z.number().min(6).max(72).default(10),
  freezeHeader: z.boolean().default(true),
  autoFilter: z.boolean().default(true),
  maxRowsPerPage: z.number().min(1).max(1000).default(40),
});
export type TableTokens = z.infer<typeof TableTokensSchema>;

/** Chart palette tokens */
export const ChartTokensSchema = z.object({
  seriesColors: z.array(z.string()).min(1).max(20).default([
    "#1a73e8", "#34a853", "#ea4335", "#fbbc04", "#4285f4",
    "#46bdc6", "#7baaf7", "#f07b72", "#fcd04f", "#71c287",
  ]),
  axisFontSize: z.number().min(6).max(48).default(10),
  labelFontSize: z.number().min(6).max(48).default(9),
  legendFontSize: z.number().min(6).max(48).default(10),
  gridLineColor: z.string().default("#e0e0e0"),
  showLegend: z.boolean().default(true),
  showDataLabels: z.boolean().default(false),
});
export type ChartTokens = z.infer<typeof ChartTokensSchema>;

/** Component tokens for cards, badges, buttons, callouts */
export const ComponentTokensSchema = z.object({
  cardBg: z.string().default("#ffffff"),
  cardBorder: z.string().default("#dadce0"),
  cardBorderRadius: z.number().min(0).max(24).default(4),
  cardShadow: z.boolean().default(true),
  cardPadding: z.number().min(0).max(48).default(12),
  badgeBg: z.string().default("#e8f0fe"),
  badgeFg: z.string().default("#1a73e8"),
  badgeFontSize: z.number().min(6).max(24).default(9),
  badgeBorderRadius: z.number().min(0).max(12).default(2),
  buttonBg: z.string().default("#1a73e8"),
  buttonFg: z.string().default("#ffffff"),
  buttonFontSize: z.number().min(8).max(24).default(12),
  buttonHeight: z.number().min(0.2).max(2).default(0.4),
  buttonBorderRadius: z.number().min(0).max(12).default(4),
  calloutBg: z.string().default("#fef7e0"),
  calloutBorder: z.string().default("#f9ab00"),
  calloutIcon: z.string().max(10).default("⚠"),
});
export type ComponentTokens = z.infer<typeof ComponentTokensSchema>;

/** Priority styling tokens (for status indicators, KPIs) */
export const PriorityTokensSchema = z.object({
  criticalBg: z.string().default("#FED7D7"),
  criticalFg: z.string().default("#C53030"),
  highBg: z.string().default("#FEEBC8"),
  highFg: z.string().default("#C05621"),
  mediumBg: z.string().default("#C6F6D5"),
  mediumFg: z.string().default("#276749"),
  lowBg: z.string().default("#E2E8F0"),
  lowFg: z.string().default("#4A5568"),
  infoBg: z.string().default("#BEE3F8"),
  infoFg: z.string().default("#2B6CB0"),
});
export type PriorityTokens = z.infer<typeof PriorityTokensSchema>;

/** PPT-specific master / layout tokens */
export const PptMasterTokensSchema = z.object({
  masterName: z.string().max(100).default("ILIAGPT_MASTER"),
  topBarHeight: z.number().min(0).max(1).default(0.08),
  topBarColor: z.string().default("#1a73e8"),
  footerHeight: z.number().min(0).max(1).default(0.28),
  footerBg: z.string().default("#ffffff"),
  footerBorder: z.string().default("#e5e7eb"),
  footerFontSize: z.number().min(6).max(18).default(9),
  brandName: z.string().max(100).default("IliaGPT"),
  brandFontSize: z.number().min(6).max(18).default(10),
  slideNumberAlign: z.enum(["left", "center", "right"]).default("right"),
  coverTitleSize: z.number().min(12).max(72).default(38),
  coverSubtitleSize: z.number().min(8).max(48).default(20),
  sectionTitleSize: z.number().min(12).max(60).default(32),
});
export type PptMasterTokens = z.infer<typeof PptMasterTokensSchema>;

/** Word-specific style tokens */
export const WordStyleTokensSchema = z.object({
  styleset: z.enum(["modern", "classic"]).default("modern"),
  pageMarginInches: z.number().min(0.25).max(3).default(1),
  lineSpacing: z.number().min(100).max(400).default(276),
  titleSize: z.number().min(12).max(100).default(56),
  heading1Size: z.number().min(12).max(80).default(32),
  heading2Size: z.number().min(10).max(60).default(26),
  heading3Size: z.number().min(8).max(48).default(22),
  bodySize: z.number().min(8).max(36).default(22),
  headerText: z.string().max(200).default(""),
  footerText: z.string().max(200).default(""),
  showPageNumbers: z.boolean().default(true),
});
export type WordStyleTokens = z.infer<typeof WordStyleTokensSchema>;

/** Excel-specific style tokens */
export const ExcelStyleTokensSchema = z.object({
  defaultColumnWidth: z.number().min(4).max(100).default(15),
  minColumnWidth: z.number().min(4).max(50).default(8),
  maxColumnWidth: z.number().min(10).max(100).default(60),
  headerRowHeight: z.number().min(12).max(80).default(25),
  dataRowHeight: z.number().min(10).max(60).default(18),
  showGridlines: z.boolean().default(true),
  defaultTableStyle: z.string().max(50).default("TableStyleMedium9"),
  alternateRows: z.boolean().default(true),
});
export type ExcelStyleTokens = z.infer<typeof ExcelStyleTokensSchema>;

/* ================================================================== */
/*  UNIFIED TOKEN SCHEMA (extends base DesignTokens)                   */
/* ================================================================== */

export const UnifiedDesignTokensSchema = z.object({
  /** Semver version for token set compatibility */
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default("2.0.0"),
  /** Human name for this token set */
  name: z.string().max(100).default("default"),

  /** Base tokens (inherited from existing DesignTokensSchema) */
  base: DesignTokensSchema.default({}),

  /** Table styling */
  table: TableTokensSchema.default({}),
  /** Chart palette */
  chart: ChartTokensSchema.default({}),
  /** UI components (cards, badges, buttons) */
  component: ComponentTokensSchema.default({}),
  /** Priority/status colors */
  priority: PriorityTokensSchema.default({}),
  /** PPT master/layout overrides */
  pptMaster: PptMasterTokensSchema.default({}),
  /** Word style overrides */
  wordStyle: WordStyleTokensSchema.default({}),
  /** Excel style overrides */
  excelStyle: ExcelStyleTokensSchema.default({}),
});

export type UnifiedDesignTokens = z.infer<typeof UnifiedDesignTokensSchema>;

/* ================================================================== */
/*  PREBUILT TOKEN SETS                                                */
/* ================================================================== */

export const UNIFIED_THEMES: Record<string, UnifiedDesignTokens> = {
  default: UnifiedDesignTokensSchema.parse({ name: "default" }),

  corporate: UnifiedDesignTokensSchema.parse({
    name: "corporate",
    base: {
      name: "corporate",
      font: { heading: "Calibri", body: "Calibri Light" },
      color: {
        primary: "#1a365d",
        secondary: "#2b6cb0",
        accent: "#ed8936",
        success: "#38a169",
        warning: "#ecc94b",
        headerBg: "#1a365d",
        headerFg: "#ffffff",
        textPrimary: "#2d3748",
        textSecondary: "#718096",
        border: "#cbd5e0",
        surface: "#edf2f7",
        zebraOdd: "#f7fafc",
      },
    },
    table: {
      headerBg: "#1a365d",
      headerFg: "#ffffff",
      zebraOdd: "#f7fafc",
      borderColor: "#cbd5e0",
    },
    chart: {
      seriesColors: ["#1a365d", "#2b6cb0", "#38a3a5", "#ed8936", "#38a169", "#805ad5"],
    },
    component: {
      cardBg: "#ffffff",
      cardBorder: "#cbd5e0",
      badgeBg: "#edf2f7",
      badgeFg: "#1a365d",
      buttonBg: "#2b6cb0",
      buttonFg: "#ffffff",
    },
    pptMaster: {
      masterName: "ILIAGPT_CORPORATE",
      topBarColor: "#1a365d",
      brandName: "IliaGPT",
    },
  }),

  modern: UnifiedDesignTokensSchema.parse({
    name: "modern",
    base: {
      name: "modern",
      font: { heading: "Segoe UI", body: "Segoe UI" },
      color: {
        primary: "#6C63FF",
        secondary: "#3F3D56",
        accent: "#FF6584",
        headerBg: "#6C63FF",
        headerFg: "#ffffff",
        textPrimary: "#2d2d2d",
        textSecondary: "#6b6b6b",
        surface: "#f5f3ff",
        zebraOdd: "#faf5ff",
      },
    },
    table: {
      headerBg: "#6C63FF",
      headerFg: "#ffffff",
      zebraOdd: "#faf5ff",
    },
    chart: {
      seriesColors: ["#6C63FF", "#FF6584", "#3F3D56", "#00C49F", "#FFBB28", "#FF8042"],
    },
    pptMaster: {
      topBarColor: "#6C63FF",
    },
  }),

  academic: UnifiedDesignTokensSchema.parse({
    name: "academic",
    base: {
      name: "academic",
      font: {
        heading: "Times New Roman",
        body: "Times New Roman",
        sizeBody: 12,
        sizeH1: 24,
        sizeH2: 20,
        sizeH3: 16,
        lineHeight: 2.0,
      },
      color: {
        primary: "#1a1a2e",
        secondary: "#16213e",
        accent: "#0f3460",
        headerBg: "#1a1a2e",
        headerFg: "#ffffff",
        textPrimary: "#1a1a1a",
        textSecondary: "#4a4a4a",
      },
      layout: { slideHeight: 7.5 },
    },
    wordStyle: {
      styleset: "classic",
      lineSpacing: 360,
    },
  }),

  minimal: UnifiedDesignTokensSchema.parse({
    name: "minimal",
    base: {
      name: "minimal",
      font: { heading: "Arial", body: "Arial" },
      color: {
        primary: "#000000",
        secondary: "#333333",
        accent: "#666666",
        headerBg: "#000000",
        headerFg: "#ffffff",
        textPrimary: "#1a1a1a",
        textSecondary: "#666666",
        border: "#e0e0e0",
        surface: "#fafafa",
      },
    },
    component: {
      cardShadow: false,
    },
  }),
};

/* ================================================================== */
/*  RESOLVER                                                           */
/* ================================================================== */

const ALLOWED_UNIFIED_THEMES = new Set(Object.keys(UNIFIED_THEMES));
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function hasDangerousKeys(obj: unknown, depth: number = 0): boolean {
  if (depth > 6 || obj === null || typeof obj !== "object") return false;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys((obj as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Resolve a unified design token set from:
 *   - A theme name string ("corporate")
 *   - A partial token override
 *   - Undefined (returns default)
 */
export function resolveUnifiedTheme(
  nameOrTokens: string | Partial<UnifiedDesignTokens> | undefined
): UnifiedDesignTokens {
  if (!nameOrTokens) return UNIFIED_THEMES.default;

  if (typeof nameOrTokens === "string") {
    if (!ALLOWED_UNIFIED_THEMES.has(nameOrTokens)) {
      console.warn(`[DesignTokens] Unknown theme "${nameOrTokens}", using default`);
      return UNIFIED_THEMES.default;
    }
    return UNIFIED_THEMES[nameOrTokens];
  }

  if (typeof nameOrTokens === "object" && nameOrTokens !== null) {
    if (hasDangerousKeys(nameOrTokens)) {
      console.warn("[DesignTokens] Rejected tokens with dangerous keys");
      return UNIFIED_THEMES.default;
    }
  }

  try {
    return UnifiedDesignTokensSchema.parse(nameOrTokens);
  } catch (err) {
    console.warn(`[DesignTokens] Parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return UNIFIED_THEMES.default;
  }
}

/**
 * Extract base DesignTokens from unified tokens (for backward compatibility
 * with existing DocumentEngine).
 */
export function extractBaseTokens(unified: UnifiedDesignTokens): DesignTokens {
  return unified.base;
}
