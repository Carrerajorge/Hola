/**
 * Component Registry — Reusable document components with contracts.
 *
 * Each component defines:
 *   - Input contract (what data it accepts, validated by Zod)
 *   - Size constraints (min/max width, height, character limits)
 *   - Overflow behavior (truncate, autofit, split, wrap)
 *   - Fallback chain (what to render if primary rendering fails)
 *   - Format support (which output formats can render it)
 *
 * Components do NOT render directly; they produce normalized, validated
 * component data that format-specific compilers consume.
 */

import type { BlockIR } from "./documentIR";
import type { DesignTokensV2, TextStyle, TableStyle } from "./designTokens";

/* ================================================================== */
/*  COMPONENT CONTRACT TYPES                                           */
/* ================================================================== */

export interface ComponentContract {
  /** Component type identifier (matches BlockIR.type) */
  type: string;
  /** Human-readable description */
  description: string;
  /** Supported output formats */
  formats: ("docx" | "xlsx" | "pptx")[];
  /** Default constraints */
  defaultConstraints: {
    maxChars?: number;
    maxItems?: number;
    maxRows?: number;
    maxColumns?: number;
    minFontSize?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
  /** Fallback chain: ordered list of simpler component types to try */
  fallbackChain: string[];
}

/* ================================================================== */
/*  COMPONENT REGISTRY                                                 */
/* ================================================================== */

export const COMPONENT_CONTRACTS: Record<string, ComponentContract> = {
  heading: {
    type: "heading",
    description: "Section heading (H1-H6)",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 500,
      minFontSize: 12,
    },
    fallbackChain: ["paragraph"],
  },

  paragraph: {
    type: "paragraph",
    description: "Body paragraph with plain or styled text",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 100_000,
      minFontSize: 8,
    },
    fallbackChain: [],
  },

  richtext: {
    type: "richtext",
    description: "Markdown-formatted rich text with inline formatting",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 100_000,
    },
    fallbackChain: ["paragraph"],
  },

  bullets: {
    type: "bullets",
    description: "Unordered bullet list",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxItems: 200,
      maxChars: 2000,
    },
    fallbackChain: ["paragraph"],
  },

  numbered: {
    type: "numbered",
    description: "Ordered numbered list",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxItems: 200,
      maxChars: 2000,
    },
    fallbackChain: ["bullets", "paragraph"],
  },

  table: {
    type: "table",
    description: "Data table with columns, rows, formatting",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxRows: 10_000,
      maxColumns: 200,
      maxChars: 32_767, // per cell
    },
    fallbackChain: ["paragraph"],
  },

  chart: {
    type: "chart",
    description: "Data visualization chart (bar, line, pie, etc.)",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxWidth: 8,
      maxHeight: 5,
    },
    fallbackChain: ["table", "paragraph"],
  },

  image: {
    type: "image",
    description: "Embedded image (file path, base64, or validated URL)",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxWidth: 8,
      maxHeight: 10,
    },
    fallbackChain: ["paragraph"],
  },

  kpi_card: {
    type: "kpi_card",
    description: "KPI metric card with value, change indicator, icon",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 100,
      maxWidth: 3,
      maxHeight: 2,
    },
    fallbackChain: ["table", "paragraph"],
  },

  badge: {
    type: "badge",
    description: "Status badge with text and color variant",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 50,
    },
    fallbackChain: ["paragraph"],
  },

  callout: {
    type: "callout",
    description: "Highlighted callout box (info, warning, error, tip)",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 2000,
    },
    fallbackChain: ["quote", "paragraph"],
  },

  quote: {
    type: "quote",
    description: "Block quote with optional attribution",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 2000,
    },
    fallbackChain: ["paragraph"],
  },

  code: {
    type: "code",
    description: "Code block with optional language and line numbers",
    formats: ["docx", "xlsx", "pptx"],
    defaultConstraints: {
      maxChars: 50_000,
    },
    fallbackChain: ["paragraph"],
  },

  divider: {
    type: "divider",
    description: "Horizontal divider line",
    formats: ["docx", "pptx"],
    defaultConstraints: {},
    fallbackChain: ["spacer"],
  },

  spacer: {
    type: "spacer",
    description: "Vertical spacer",
    formats: ["docx", "pptx"],
    defaultConstraints: {},
    fallbackChain: [],
  },

  page_break: {
    type: "page_break",
    description: "Page/slide break",
    formats: ["docx", "pptx"],
    defaultConstraints: {},
    fallbackChain: [],
  },

  toc: {
    type: "toc",
    description: "Table of contents",
    formats: ["docx"],
    defaultConstraints: {},
    fallbackChain: [],
  },

  columns: {
    type: "columns",
    description: "Multi-column layout container",
    formats: ["docx", "pptx"],
    defaultConstraints: {},
    fallbackChain: [], // columns degrade by rendering blocks sequentially
  },
};

/* ================================================================== */
/*  COMPONENT NORMALIZER                                               */
/* ================================================================== */

/**
 * Normalize a block according to its component contract.
 * Applies default constraints, enforces limits, and sanitizes data.
 *
 * Returns normalized block and any warnings generated.
 */
export function normalizeBlock(
  block: BlockIR,
  tokens: DesignTokensV2,
): { block: BlockIR; warnings: string[] } {
  const warnings: string[] = [];
  const contract = COMPONENT_CONTRACTS[block.type];

  if (!contract) {
    warnings.push(`Unknown component type: ${block.type}`);
    return { block, warnings };
  }

  // Deep clone to avoid mutating input
  let normalized: any;
  try {
    normalized = structuredClone(block);
  } catch {
    normalized = JSON.parse(JSON.stringify(block));
  }

  const defaults = contract.defaultConstraints;

  // Apply text length limits
  if (defaults.maxChars) {
    if ("text" in normalized && typeof normalized.text === "string") {
      if (normalized.text.length > defaults.maxChars) {
        normalized.text = normalized.text.substring(0, defaults.maxChars - 1) + "…";
        warnings.push(`${block.type}: text truncated to ${defaults.maxChars} chars`);
      }
    }
    if ("markdown" in normalized && typeof normalized.markdown === "string") {
      if (normalized.markdown.length > defaults.maxChars) {
        normalized.markdown = normalized.markdown.substring(0, defaults.maxChars - 1) + "…";
        warnings.push(`${block.type}: markdown truncated to ${defaults.maxChars} chars`);
      }
    }
    if ("code" in normalized && typeof normalized.code === "string") {
      if (normalized.code.length > defaults.maxChars) {
        normalized.code = normalized.code.substring(0, defaults.maxChars - 1) + "…";
        warnings.push(`${block.type}: code truncated to ${defaults.maxChars} chars`);
      }
    }
  }

  // Apply list item limits
  if (defaults.maxItems && "items" in normalized && Array.isArray(normalized.items)) {
    if (normalized.items.length > defaults.maxItems) {
      normalized.items = normalized.items.slice(0, defaults.maxItems);
      warnings.push(`${block.type}: items capped at ${defaults.maxItems}`);
    }
  }

  // Apply table limits
  if (block.type === "table" && "rows" in normalized) {
    if (defaults.maxRows && normalized.rows.length > defaults.maxRows) {
      normalized.rows = normalized.rows.slice(0, defaults.maxRows);
      warnings.push(`table: rows capped at ${defaults.maxRows}`);
    }
    if (defaults.maxColumns && "columns" in normalized && Array.isArray(normalized.columns)) {
      if (normalized.columns.length > defaults.maxColumns) {
        normalized.columns = normalized.columns.slice(0, defaults.maxColumns);
        warnings.push(`table: columns capped at ${defaults.maxColumns}`);
      }
    }
    // Sanitize cell values for formula injection
    if (Array.isArray(normalized.rows)) {
      for (const row of normalized.rows) {
        if (row && typeof row === "object") {
          for (const [key, val] of Object.entries(row)) {
            if (typeof val === "string") {
              const trimmed = val.trimStart();
              if (trimmed.length > 0 && ["=", "+", "-", "@", "\t", "\r", "|", "\\"].some(p => trimmed.startsWith(p))) {
                row[key] = `'${val}`;
              }
            }
          }
        }
      }
    }
  }

  // Sanitize text content: strip control chars
  const sanitizeStr = (s: string) =>
    s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");

  for (const field of ["text", "markdown", "code", "title", "caption", "attribution"]) {
    if (field in normalized && typeof normalized[field] === "string") {
      normalized[field] = sanitizeStr(normalized[field]);
    }
  }

  return { block: normalized, warnings };
}

/**
 * Get the fallback chain for a component type.
 * Returns the chain ending with the original type.
 */
export function getFallbackChain(type: string): string[] {
  const contract = COMPONENT_CONTRACTS[type];
  if (!contract) return [type];
  return [...contract.fallbackChain, type].reverse();
  // Reversed so first element is the original, then fallbacks
}

/**
 * Get the resolved text style for a block based on its type and the design tokens.
 */
export function resolveTextStyleForBlock(
  block: BlockIR,
  tokens: DesignTokensV2,
): TextStyle {
  switch (block.type) {
    case "heading": {
      const level = (block as any).level || 1;
      const styleMap: Record<number, keyof typeof tokens.textStyles> = {
        1: "h1",
        2: "h2",
        3: "h3",
        4: "h4",
        5: "bodySmall",
        6: "caption",
      };
      return tokens.textStyles[styleMap[level] || "h1"];
    }
    case "paragraph":
    case "richtext":
    case "bullets":
    case "numbered":
      return tokens.textStyles.body;
    case "quote":
      return tokens.textStyles.quote;
    case "code":
      return tokens.textStyles.code;
    case "caption":
      return tokens.textStyles.caption;
    default:
      return tokens.textStyles.body;
  }
}

/**
 * Resolve the table style from tokens for a table block.
 */
export function resolveTableStyle(tokens: DesignTokensV2): TableStyle {
  return tokens.tableStyle;
}

/**
 * Check if a component type is supported for a given output format.
 */
export function isComponentSupported(type: string, format: "docx" | "xlsx" | "pptx"): boolean {
  const contract = COMPONENT_CONTRACTS[type];
  if (!contract) return false;
  return contract.formats.includes(format);
}
