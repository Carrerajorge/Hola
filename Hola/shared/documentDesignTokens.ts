/**
 * Centralized Design Token System for Word / Excel / PowerPoint generation.
 *
 * ALL visual properties used by any document compiler MUST be resolved through
 * these tokens.  Individual compilers translate tokens into format-specific
 * styles (docx styles.xml, ExcelJS fills, PptxGenJS master-slides) but the
 * semantic values come from here, ensuring global consistency.
 *
 * VERSION 1.0 — Token schema is append-only; existing keys are immutable once
 * released.  To evolve, add new tokens or new theme variants.
 */

// ─── Primitive Value Types ──────────────────────────────────────────

/** 6-char hex WITHOUT "#" — this is what Open XML uses natively. */
export type HexColor = string;

/** Font size in half-points (the universal Open XML unit).  11pt → 22hp. */
export type HalfPoints = number;

/** Spacing in twips (1/1440 inch). Standard A4 margin is ≈1440 twips = 1". */
export type Twips = number;

/** Percentage 0–100, used for column widths, chart sizes, etc. */
export type Percent = number;

// ─── Token Interfaces ───────────────────────────────────────────────

export interface ColorTokens {
  /** Brand/heading color */
  readonly primary: HexColor;
  /** Secondary headings, accents */
  readonly secondary: HexColor;
  /** Interactive elements, links, call-to-action */
  readonly accent: HexColor;
  /** Background / surface */
  readonly background: HexColor;
  /** Main body text */
  readonly text: HexColor;
  /** Muted/secondary text (captions, footnotes) */
  readonly textMuted: HexColor;
  /** Table header background */
  readonly tableHeaderBg: HexColor;
  /** Table header foreground */
  readonly tableHeaderFg: HexColor;
  /** Table alternate-row tint */
  readonly tableStripeBg: HexColor;
  /** Borders, dividers, gridlines */
  readonly border: HexColor;
  /** Success semantic (KPI, charts) */
  readonly success: HexColor;
  /** Warning semantic */
  readonly warning: HexColor;
  /** Error/critical semantic */
  readonly danger: HexColor;
  /** Slide title bar background (PPTX) */
  readonly slideTitleBar: HexColor;
}

export interface TypographyTokens {
  /** Primary heading font family.  MUST be a font name installed on
   *  the target system OR embedded in the document. */
  readonly headingFont: string;
  /** Body text font family */
  readonly bodyFont: string;
  /** Monospace / code font family */
  readonly codeFont: string;

  /** Half-point sizes per heading level */
  readonly sizeH1: HalfPoints;
  readonly sizeH2: HalfPoints;
  readonly sizeH3: HalfPoints;
  readonly sizeH4: HalfPoints;
  readonly sizeBody: HalfPoints;
  readonly sizeSmall: HalfPoints;
  readonly sizeCaption: HalfPoints;

  /** Line spacing multiplier × 240 (Open XML convention). 1.15 → 276. */
  readonly lineSpacing: number;
  /** Paragraph spacing after, in twips */
  readonly paragraphAfter: Twips;
}

export interface SpacingTokens {
  /** Page margins in twips (Word) */
  readonly marginTop: Twips;
  readonly marginBottom: Twips;
  readonly marginLeft: Twips;
  readonly marginRight: Twips;
  /** Gutter (extra inside margin for binding) */
  readonly gutter: Twips;

  /** Slide margin in inches (PPTX) */
  readonly slideMarginX: number;
  readonly slideMarginY: number;

  /** Cell padding in points (Excel) */
  readonly cellPaddingPt: number;
}

export interface LayoutTokens {
  /** Slide dimensions (inches) */
  readonly slideWidth: number;
  readonly slideHeight: number;

  /** Max content width in inches for PPTX body */
  readonly slideContentWidth: number;

  /** Default column width range (Excel) */
  readonly excelColMinWidth: number;
  readonly excelColMaxWidth: number;

  /** Maximum bullets per slide before overflow triggers split */
  readonly maxBulletsPerSlide: number;
  /** Maximum words per slide */
  readonly maxWordsPerSlide: number;
  /** Maximum characters per bullet */
  readonly maxCharsPerBullet: number;
  /** Maximum rows before a table splits across pages/slides */
  readonly maxTableRowsPerPage: number;
  /** Maximum Excel rows per sheet before warning */
  readonly maxExcelRowsPerSheet: number;
}

export interface BorderTokens {
  /** Border style name */
  readonly style: "thin" | "medium" | "thick" | "double" | "none";
  /** Border color (hex) */
  readonly color: HexColor;
}

// ─── Composite Design Token Set ─────────────────────────────────────

export interface DesignTokenSet {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly colors: ColorTokens;
  readonly typography: TypographyTokens;
  readonly spacing: SpacingTokens;
  readonly layout: LayoutTokens;
  readonly borders: BorderTokens;
}

// ─── Built-in Theme Catalog ─────────────────────────────────────────

const BASE_SPACING: SpacingTokens = {
  marginTop: 1440,
  marginBottom: 1440,
  marginLeft: 1440,
  marginRight: 1440,
  gutter: 0,
  slideMarginX: 0.5,
  slideMarginY: 0.4,
  cellPaddingPt: 4,
};

const BASE_LAYOUT: LayoutTokens = {
  slideWidth: 10,
  slideHeight: 5.625,
  slideContentWidth: 9,
  excelColMinWidth: 8,
  excelColMaxWidth: 60,
  maxBulletsPerSlide: 6,
  maxWordsPerSlide: 50,
  maxCharsPerBullet: 120,
  maxTableRowsPerPage: 30,
  maxExcelRowsPerSheet: 100_000,
};

const BASE_BORDERS: BorderTokens = {
  style: "thin",
  color: "CBD5E0",
};

// ── Corporate ──────────────────────────────────────────────────────

const CORPORATE: DesignTokenSet = {
  id: "corporate",
  name: "Corporate Professional",
  version: "1.0.0",
  colors: {
    primary: "1A365D",
    secondary: "2C5282",
    accent: "3182CE",
    background: "FFFFFF",
    text: "1A202C",
    textMuted: "718096",
    tableHeaderBg: "1A365D",
    tableHeaderFg: "FFFFFF",
    tableStripeBg: "F7FAFC",
    border: "CBD5E0",
    success: "38A169",
    warning: "DD6B20",
    danger: "E53E3E",
    slideTitleBar: "1A365D",
  },
  typography: {
    headingFont: "Calibri",
    bodyFont: "Calibri",
    codeFont: "Consolas",
    sizeH1: 56,
    sizeH2: 44,
    sizeH3: 36,
    sizeH4: 28,
    sizeBody: 22,
    sizeSmall: 18,
    sizeCaption: 16,
    lineSpacing: 276,
    paragraphAfter: 200,
  },
  spacing: { ...BASE_SPACING },
  layout: { ...BASE_LAYOUT },
  borders: { ...BASE_BORDERS },
};

// ── Academic ───────────────────────────────────────────────────────

const ACADEMIC: DesignTokenSet = {
  id: "academic",
  name: "Academic / Research",
  version: "1.0.0",
  colors: {
    primary: "2D3748",
    secondary: "4A5568",
    accent: "805AD5",
    background: "FFFFFF",
    text: "1A202C",
    textMuted: "718096",
    tableHeaderBg: "2D3748",
    tableHeaderFg: "FFFFFF",
    tableStripeBg: "F7FAFC",
    border: "A0AEC0",
    success: "38A169",
    warning: "DD6B20",
    danger: "E53E3E",
    slideTitleBar: "2D3748",
  },
  typography: {
    headingFont: "Times New Roman",
    bodyFont: "Times New Roman",
    codeFont: "Courier New",
    sizeH1: 48,
    sizeH2: 40,
    sizeH3: 32,
    sizeH4: 26,
    sizeBody: 24,
    sizeSmall: 20,
    sizeCaption: 18,
    lineSpacing: 480,  // double-spaced
    paragraphAfter: 240,
  },
  spacing: { ...BASE_SPACING, marginLeft: 1800, marginRight: 1800 },
  layout: { ...BASE_LAYOUT },
  borders: { ...BASE_BORDERS, color: "A0AEC0" },
};

// ── Modern ─────────────────────────────────────────────────────────

const MODERN: DesignTokenSet = {
  id: "modern",
  name: "Modern Minimal",
  version: "1.0.0",
  colors: {
    primary: "000000",
    secondary: "333333",
    accent: "FF6B6B",
    background: "FFFFFF",
    text: "2D3748",
    textMuted: "A0AEC0",
    tableHeaderBg: "000000",
    tableHeaderFg: "FFFFFF",
    tableStripeBg: "F9FAFB",
    border: "E2E8F0",
    success: "48BB78",
    warning: "ED8936",
    danger: "F56565",
    slideTitleBar: "000000",
  },
  typography: {
    headingFont: "Arial",
    bodyFont: "Arial",
    codeFont: "Consolas",
    sizeH1: 56,
    sizeH2: 44,
    sizeH3: 34,
    sizeH4: 28,
    sizeBody: 22,
    sizeSmall: 18,
    sizeCaption: 16,
    lineSpacing: 276,
    paragraphAfter: 200,
  },
  spacing: { ...BASE_SPACING },
  layout: { ...BASE_LAYOUT },
  borders: { style: "thin", color: "E2E8F0" },
};

// ── Elegant ────────────────────────────────────────────────────────

const ELEGANT: DesignTokenSet = {
  id: "elegant",
  name: "Elegant Dark",
  version: "1.0.0",
  colors: {
    primary: "C9A227",
    secondary: "D4AF37",
    accent: "F4E4BA",
    background: "FFFFFF",
    text: "1A1A1A",
    textMuted: "666666",
    tableHeaderBg: "1A1A1A",
    tableHeaderFg: "F4E4BA",
    tableStripeBg: "FAFAFA",
    border: "D4AF37",
    success: "38A169",
    warning: "DD6B20",
    danger: "C53030",
    slideTitleBar: "1A1A1A",
  },
  typography: {
    headingFont: "Georgia",
    bodyFont: "Georgia",
    codeFont: "Courier New",
    sizeH1: 52,
    sizeH2: 42,
    sizeH3: 34,
    sizeH4: 28,
    sizeBody: 22,
    sizeSmall: 18,
    sizeCaption: 16,
    lineSpacing: 300,
    paragraphAfter: 220,
  },
  spacing: { ...BASE_SPACING },
  layout: { ...BASE_LAYOUT },
  borders: { style: "thin", color: "D4AF37" },
};

// ── Vibrant ────────────────────────────────────────────────────────

const VIBRANT: DesignTokenSet = {
  id: "vibrant",
  name: "Vibrant / Creative",
  version: "1.0.0",
  colors: {
    primary: "667EEA",
    secondary: "764BA2",
    accent: "F093FB",
    background: "FFFFFF",
    text: "2D3748",
    textMuted: "718096",
    tableHeaderBg: "667EEA",
    tableHeaderFg: "FFFFFF",
    tableStripeBg: "F0F4FF",
    border: "C3DAFE",
    success: "48BB78",
    warning: "F6AD55",
    danger: "FC8181",
    slideTitleBar: "667EEA",
  },
  typography: {
    headingFont: "Calibri",
    bodyFont: "Calibri",
    codeFont: "Consolas",
    sizeH1: 56,
    sizeH2: 44,
    sizeH3: 36,
    sizeH4: 28,
    sizeBody: 22,
    sizeSmall: 18,
    sizeCaption: 16,
    lineSpacing: 276,
    paragraphAfter: 200,
  },
  spacing: { ...BASE_SPACING },
  layout: { ...BASE_LAYOUT },
  borders: { style: "thin", color: "C3DAFE" },
};

// ── Minimal ────────────────────────────────────────────────────────

const MINIMAL: DesignTokenSet = {
  id: "minimal",
  name: "Minimal Clean",
  version: "1.0.0",
  colors: {
    primary: "374151",
    secondary: "6B7280",
    accent: "3B82F6",
    background: "FFFFFF",
    text: "111827",
    textMuted: "9CA3AF",
    tableHeaderBg: "F3F4F6",
    tableHeaderFg: "111827",
    tableStripeBg: "F9FAFB",
    border: "E5E7EB",
    success: "10B981",
    warning: "F59E0B",
    danger: "EF4444",
    slideTitleBar: "374151",
  },
  typography: {
    headingFont: "Helvetica",
    bodyFont: "Helvetica",
    codeFont: "Menlo",
    sizeH1: 52,
    sizeH2: 40,
    sizeH3: 32,
    sizeH4: 26,
    sizeBody: 22,
    sizeSmall: 18,
    sizeCaption: 16,
    lineSpacing: 264,
    paragraphAfter: 180,
  },
  spacing: { ...BASE_SPACING },
  layout: { ...BASE_LAYOUT },
  borders: { style: "thin", color: "E5E7EB" },
};

// ─── Registry & Resolver ────────────────────────────────────────────

export const THEME_REGISTRY: Readonly<Record<string, DesignTokenSet>> = {
  corporate: CORPORATE,
  academic: ACADEMIC,
  modern: MODERN,
  elegant: ELEGANT,
  vibrant: VIBRANT,
  minimal: MINIMAL,
};

export const DEFAULT_THEME_ID = "corporate";

/**
 * Resolve a theme by id.  Returns the corporate theme if id is unknown.
 * Accepts partial overrides that are deep-merged on top of the base theme.
 */
export function resolveDesignTokens(
  themeId?: string | null,
  overrides?: Partial<DesignTokenSet>,
): DesignTokenSet {
  const base = THEME_REGISTRY[themeId ?? DEFAULT_THEME_ID] ?? CORPORATE;
  if (!overrides) return base;

  return {
    ...base,
    ...overrides,
    id: overrides.id ?? base.id,
    name: overrides.name ?? base.name,
    version: overrides.version ?? base.version,
    colors: { ...base.colors, ...(overrides.colors ?? {}) },
    typography: { ...base.typography, ...(overrides.typography ?? {}) },
    spacing: { ...base.spacing, ...(overrides.spacing ?? {}) },
    layout: { ...base.layout, ...(overrides.layout ?? {}) },
    borders: { ...base.borders, ...(overrides.borders ?? {}) },
  };
}

/** Utility: convert half-points to pt for display purposes */
export function hpToPt(hp: HalfPoints): number {
  return hp / 2;
}

/** Utility: convert pt to half-points */
export function ptToHp(pt: number): HalfPoints {
  return pt * 2;
}

/** Utility: convert inches to twips */
export function inToTwips(inches: number): Twips {
  return Math.round(inches * 1440);
}

/** Utility: ensure a hex color is 6 chars without "#" */
export function normalizeHex(color: string | undefined | null): HexColor {
  if (!color) return "000000";
  const stripped = color.replace(/^#/, "").replace(/^0x/i, "");
  if (/^[0-9A-Fa-f]{3}$/.test(stripped)) {
    // Expand shorthand: "ABC" → "AABBCC"
    return stripped
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (/^[0-9A-Fa-f]{6}$/.test(stripped)) return stripped;
  if (/^[0-9A-Fa-f]{8}$/.test(stripped)) return stripped.slice(2); // strip alpha
  return "000000";
}
