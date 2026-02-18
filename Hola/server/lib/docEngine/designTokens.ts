/**
 * DESIGN TOKENS — Single source of truth for visual design across Word, Excel, PowerPoint.
 *
 * Every color, font, spacing, border, and shadow used in generated documents
 * MUST come from this file. This ensures:
 * - Visual consistency across all output formats
 * - Theme switching is a single-line change
 * - Word uses styles.xml/theme, Excel uses styles.xml/theme/tableStyles,
 *   PowerPoint uses Theme + Slide Master
 *
 * Tokens are format-agnostic. Format-specific adapters translate them
 * to the native representation (Open XML, ExcelJS config, PptxGenJS config).
 */

// ===== Color Tokens =====

export interface ColorPalette {
  /** Primary brand color — used for titles, accents, key elements */
  primary: string;
  /** Darker shade of primary — used for headings, emphasis */
  primaryDark: string;
  /** Lighter shade of primary — backgrounds, subtle fills */
  primaryLight: string;
  /** Secondary accent — charts second series, complementary elements */
  secondary: string;
  secondaryDark: string;
  secondaryLight: string;
  /** Success / positive indicators */
  success: string;
  /** Warning / caution indicators */
  warning: string;
  /** Error / critical indicators */
  danger: string;
  /** Informational / neutral indicators */
  info: string;
  /** Text colors */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  /** Background colors */
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  /** Border/line colors */
  borderLight: string;
  borderMedium: string;
  borderDark: string;
  /** Chart series colors (10 distinct, accessible colors) */
  chartSeries: string[];
}

// ===== Typography Tokens =====

export interface FontSpec {
  family: string;
  size: number; // points
  bold: boolean;
  italic: boolean;
  color: string; // hex without #
  lineSpacing?: number; // multiplier (1.0 = single, 1.5 = 1.5x)
  letterSpacing?: number; // hundredths of a point
}

export interface TypographyTokens {
  /** Display title (cover pages) */
  display: FontSpec;
  /** Document title (h1-equivalent) */
  title: FontSpec;
  /** Section heading (h2) */
  heading1: FontSpec;
  /** Subsection heading (h3) */
  heading2: FontSpec;
  /** Minor heading (h4) */
  heading3: FontSpec;
  /** Body text */
  body: FontSpec;
  /** Small text / captions */
  caption: FontSpec;
  /** Code/monospace */
  code: FontSpec;
  /** Footnotes */
  footnote: FontSpec;
  /** Table header text */
  tableHeader: FontSpec;
  /** Table body text */
  tableBody: FontSpec;
  /** Quote/blockquote text */
  quote: FontSpec;
}

// ===== Spacing Tokens =====

export interface SpacingTokens {
  /** Page margins (inches) */
  pageMarginTop: number;
  pageMarginBottom: number;
  pageMarginLeft: number;
  pageMarginRight: number;
  /** Gutter for binding */
  gutter: number;
  /** Space between sections (points) */
  sectionGap: number;
  /** Space between paragraphs (points) */
  paragraphGap: number;
  /** Space before/after headings (points) */
  headingSpaceBefore: number;
  headingSpaceAfter: number;
  /** Table cell padding (inches) */
  cellPaddingH: number;
  cellPaddingV: number;
  /** Bullet/list indent per level (inches) */
  listIndentPerLevel: number;
  /** Slide margins (inches) */
  slideMarginH: number;
  slideMarginV: number;
}

// ===== Border Tokens =====

export interface BorderSpec {
  style: "thin" | "medium" | "thick" | "double" | "dotted" | "dashed" | "none";
  color: string;
  width: number; // points
}

export interface BorderTokens {
  tableOuterBorder: BorderSpec;
  tableInnerBorder: BorderSpec;
  tableHeaderBorder: BorderSpec;
  sectionDivider: BorderSpec;
  quoteBorder: BorderSpec;
  cardBorder: BorderSpec;
}

// ===== Shadow Tokens =====

export interface ShadowSpec {
  offsetX: number; // points
  offsetY: number;
  blur: number;
  color: string;
  opacity: number; // 0-1
}

export interface ShadowTokens {
  card: ShadowSpec;
  elevated: ShadowSpec;
  subtle: ShadowSpec;
}

// ===== Radius Tokens =====

export interface RadiusTokens {
  none: number;
  small: number;  // points
  medium: number;
  large: number;
  round: number;
}

// ===== Complete Theme =====

export interface DesignTheme {
  /** Theme identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Version for strict compatibility checks */
  version: string;
  colors: ColorPalette;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  borders: BorderTokens;
  shadows: ShadowTokens;
  radius: RadiusTokens;
}

// ===================================================================
// BUILT-IN THEMES
// ===================================================================

const CORPORATE_COLORS: ColorPalette = {
  primary: "1A365D",
  primaryDark: "0D1B2A",
  primaryLight: "E8EDF4",
  secondary: "2C7A7B",
  secondaryDark: "1A4E5A",
  secondaryLight: "E6FFFA",
  success: "276749",
  warning: "C05621",
  danger: "C53030",
  info: "2B6CB0",
  textPrimary: "1A202C",
  textSecondary: "4A5568",
  textMuted: "A0AEC0",
  textInverse: "FFFFFF",
  bgPrimary: "FFFFFF",
  bgSecondary: "F7FAFC",
  bgTertiary: "EDF2F7",
  borderLight: "E2E8F0",
  borderMedium: "CBD5E0",
  borderDark: "A0AEC0",
  chartSeries: [
    "1A365D", "2C7A7B", "D69E2E", "C53030", "6B46C1",
    "38A169", "DD6B20", "3182CE", "D53F8C", "319795",
  ],
};

const MODERN_COLORS: ColorPalette = {
  primary: "6C63FF",
  primaryDark: "4B45B2",
  primaryLight: "EDEDFF",
  secondary: "FF6584",
  secondaryDark: "CC4E6A",
  secondaryLight: "FFE0E6",
  success: "48BB78",
  warning: "ECC94B",
  danger: "FC8181",
  info: "63B3ED",
  textPrimary: "2D3748",
  textSecondary: "718096",
  textMuted: "CBD5E0",
  textInverse: "FFFFFF",
  bgPrimary: "FFFFFF",
  bgSecondary: "F8F9FD",
  bgTertiary: "EEF0F6",
  borderLight: "E2E8F0",
  borderMedium: "CBD5E0",
  borderDark: "A0AEC0",
  chartSeries: [
    "6C63FF", "FF6584", "36D399", "FBBD23", "3ABFF8",
    "F472B6", "A78BFA", "34D399", "FB923C", "22D3EE",
  ],
};

function makeTypography(
  headingFamily: string,
  bodyFamily: string,
  codeFamily: string,
  colors: ColorPalette,
): TypographyTokens {
  return {
    display: { family: headingFamily, size: 36, bold: true, italic: false, color: colors.primary, lineSpacing: 1.1 },
    title: { family: headingFamily, size: 28, bold: true, italic: false, color: colors.primaryDark, lineSpacing: 1.2 },
    heading1: { family: headingFamily, size: 22, bold: true, italic: false, color: colors.primaryDark, lineSpacing: 1.3 },
    heading2: { family: headingFamily, size: 16, bold: true, italic: false, color: colors.primary, lineSpacing: 1.3 },
    heading3: { family: headingFamily, size: 13, bold: true, italic: false, color: colors.textPrimary, lineSpacing: 1.3 },
    body: { family: bodyFamily, size: 11, bold: false, italic: false, color: colors.textPrimary, lineSpacing: 1.5 },
    caption: { family: bodyFamily, size: 9, bold: false, italic: false, color: colors.textSecondary, lineSpacing: 1.3 },
    code: { family: codeFamily, size: 10, bold: false, italic: false, color: colors.textPrimary, lineSpacing: 1.4 },
    footnote: { family: bodyFamily, size: 8, bold: false, italic: false, color: colors.textMuted, lineSpacing: 1.2 },
    tableHeader: { family: bodyFamily, size: 10, bold: true, italic: false, color: colors.textInverse, lineSpacing: 1.2 },
    tableBody: { family: bodyFamily, size: 10, bold: false, italic: false, color: colors.textPrimary, lineSpacing: 1.2 },
    quote: { family: bodyFamily, size: 12, bold: false, italic: true, color: colors.textSecondary, lineSpacing: 1.5 },
  };
}

const DEFAULT_SPACING: SpacingTokens = {
  pageMarginTop: 1.0,
  pageMarginBottom: 1.0,
  pageMarginLeft: 1.0,
  pageMarginRight: 1.0,
  gutter: 0,
  sectionGap: 24,
  paragraphGap: 8,
  headingSpaceBefore: 18,
  headingSpaceAfter: 6,
  cellPaddingH: 0.08,
  cellPaddingV: 0.04,
  listIndentPerLevel: 0.25,
  slideMarginH: 0.5,
  slideMarginV: 0.5,
};

function makeBorders(colors: ColorPalette): BorderTokens {
  return {
    tableOuterBorder: { style: "thin", color: colors.borderMedium, width: 1 },
    tableInnerBorder: { style: "thin", color: colors.borderLight, width: 0.5 },
    tableHeaderBorder: { style: "medium", color: colors.primaryDark, width: 1.5 },
    sectionDivider: { style: "thin", color: colors.borderLight, width: 0.5 },
    quoteBorder: { style: "thick", color: colors.primary, width: 3 },
    cardBorder: { style: "thin", color: colors.borderLight, width: 1 },
  };
}

const DEFAULT_SHADOWS: ShadowTokens = {
  card: { offsetX: 0, offsetY: 2, blur: 4, color: "000000", opacity: 0.1 },
  elevated: { offsetX: 0, offsetY: 4, blur: 12, color: "000000", opacity: 0.15 },
  subtle: { offsetX: 0, offsetY: 1, blur: 2, color: "000000", opacity: 0.05 },
};

const DEFAULT_RADIUS: RadiusTokens = {
  none: 0,
  small: 2,
  medium: 4,
  large: 8,
  round: 9999,
};

// ===== CORPORATE Theme =====
export const CORPORATE_THEME: DesignTheme = {
  id: "corporate",
  name: "Corporate Professional",
  version: "1.0.0",
  colors: CORPORATE_COLORS,
  typography: makeTypography("Calibri", "Calibri", "Consolas", CORPORATE_COLORS),
  spacing: DEFAULT_SPACING,
  borders: makeBorders(CORPORATE_COLORS),
  shadows: DEFAULT_SHADOWS,
  radius: DEFAULT_RADIUS,
};

// ===== MODERN Theme =====
export const MODERN_THEME: DesignTheme = {
  id: "modern",
  name: "Modern Vibrant",
  version: "1.0.0",
  colors: MODERN_COLORS,
  typography: makeTypography("Segoe UI", "Segoe UI", "Cascadia Code", MODERN_COLORS),
  spacing: DEFAULT_SPACING,
  borders: makeBorders(MODERN_COLORS),
  shadows: DEFAULT_SHADOWS,
  radius: { ...DEFAULT_RADIUS, small: 4, medium: 8, large: 12 },
};

// ===== Theme Registry =====
const THEME_REGISTRY: Record<string, DesignTheme> = {
  corporate: CORPORATE_THEME,
  modern: MODERN_THEME,
};

export function getTheme(id: string): DesignTheme {
  return THEME_REGISTRY[id] ?? CORPORATE_THEME;
}

export function getAvailableThemes(): string[] {
  return Object.keys(THEME_REGISTRY);
}

export function registerTheme(theme: DesignTheme): void {
  THEME_REGISTRY[theme.id] = theme;
}

// ===== Format-Specific Adapters =====

/** Convert hex color to Word/XML color (no #) */
export function toWordColor(hex: string): string {
  return hex.replace(/^#/, "");
}

/** Convert hex color to ExcelJS ARGB format */
export function toExcelColor(hex: string): string {
  const clean = hex.replace(/^#/, "");
  return `FF${clean}`;
}

/** Convert points to EMU (English Metric Units) for Open XML */
export function pointsToEmu(points: number): number {
  return Math.round(points * 12700);
}

/** Convert inches to EMU */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * 914400);
}

/** Convert inches to twips (for Word) */
export function inchesToTwips(inches: number): number {
  return Math.round(inches * 1440);
}

/** Convert points to half-points (for Word font sizes) */
export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

/** Apply theme to PptxGenJS master slide definition */
export function toPptxMasterDef(theme: DesignTheme): {
  bkgd: string;
  color: string;
  titleColor: string;
  bodyFontFace: string;
  titleFontFace: string;
} {
  return {
    bkgd: theme.colors.bgPrimary,
    color: theme.colors.textPrimary,
    titleColor: theme.colors.primaryDark,
    bodyFontFace: theme.typography.body.family,
    titleFontFace: theme.typography.title.family,
  };
}
