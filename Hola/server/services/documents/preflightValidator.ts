/**
 * Preflight Validator — validates a DocumentIR BEFORE it reaches any compiler.
 *
 * Checks:
 *  - Schema validity (Zod parsing)
 *  - Content guardrails (limits, density, sanity)
 *  - Image/URL safety (protocol allowlist)
 *  - Text encoding (Unicode normalization, invalid char stripping)
 *  - Table consistency (row widths match column count)
 *  - Section/node count limits
 *
 * Returns a normalized IR + diagnostics.  If the IR has fatal issues it will
 * still attempt to produce a "safe" IR with degraded components.
 */
import {
  DocumentIR,
  documentIRSchema,
  ContentNode,
  Section,
  RichText,
  CompilationDiagnostic,
  richTextToPlain,
  cellToString,
} from "@shared/documentIR";
import { DesignTokenSet } from "@shared/documentDesignTokens";

// ─── Limits ─────────────────────────────────────────────────────────

const LIMITS = {
  MAX_SECTIONS: 200,
  MAX_NODES_PER_SECTION: 500,
  MAX_TOTAL_NODES: 10_000,
  MAX_TEXT_LENGTH: 100_000,
  MAX_TABLE_ROWS: 5_000,
  MAX_TABLE_COLUMNS: 200,
  MAX_LIST_ITEMS: 1_000,
  MAX_IMAGE_SRC_LENGTH: 10_000_000, // 10MB for data URIs
  MAX_CODE_BLOCK_LENGTH: 500_000,
  MAX_CHART_CATEGORIES: 1_000,
  MAX_CHART_SERIES: 20,
  ALLOWED_URL_PROTOCOLS: ["https:", "http:", "data:", "mailto:"],
  EXCEL_MAX_CELL_LENGTH: 32_767,
} as const;

// ─── Result ─────────────────────────────────────────────────────────

export interface PreflightResult {
  /** Normalized, safe-to-compile IR (always provided even on warnings) */
  ir: DocumentIR;
  /** Diagnostics; fatal errors mean the IR was heavily degraded */
  diagnostics: CompilationDiagnostic[];
  /** Quick boolean: any fatal errors? */
  hasFatalErrors: boolean;
}

// ─── Public API ─────────────────────────────────────────────────────

export function preflightValidate(
  raw: unknown,
  tokens: DesignTokenSet,
): PreflightResult {
  const diagnostics: CompilationDiagnostic[] = [];
  let hasFatalErrors = false;

  // 1. Parse with Zod
  const parseResult = documentIRSchema.safeParse(raw);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      diagnostics.push({
        severity: "error",
        code: "SCHEMA_INVALID",
        message: `${issue.path.join(".")}: ${issue.message}`,
        path: issue.path.join("."),
      });
    }
    hasFatalErrors = true;
    // Attempt best-effort coercion
    const coerced = documentIRSchema.safeParse({
      version: "1.0",
      sections: [{ nodes: [{ type: "paragraph", content: [{ text: "Document could not be generated — schema validation failed." }] }] }],
    });
    return {
      ir: coerced.success ? coerced.data : ({
        version: "1.0", format: "auto", themeId: "corporate",
        metadata: { title: "Error", language: "es" },
        sections: [{ nodes: [{ type: "paragraph" as const, content: [{ text: "Schema validation failed." }] }], layout: "default" as const }],
      } as DocumentIR),
      diagnostics,
      hasFatalErrors,
    };
  }

  let ir = parseResult.data;

  // 2. Section count
  if (ir.sections.length > LIMITS.MAX_SECTIONS) {
    diagnostics.push({
      severity: "warning",
      code: "SECTIONS_TRUNCATED",
      message: `Section count ${ir.sections.length} exceeds limit ${LIMITS.MAX_SECTIONS}; truncated.`,
    });
    ir = { ...ir, sections: ir.sections.slice(0, LIMITS.MAX_SECTIONS) };
  }

  // 3. Per-section / per-node validation
  let totalNodes = 0;
  const cleanSections: Section[] = [];

  for (let si = 0; si < ir.sections.length; si++) {
    const section = ir.sections[si];
    const prefix = `sections[${si}]`;

    if (section.nodes.length > LIMITS.MAX_NODES_PER_SECTION) {
      diagnostics.push({
        severity: "warning",
        code: "NODES_TRUNCATED",
        message: `${prefix} has ${section.nodes.length} nodes (limit ${LIMITS.MAX_NODES_PER_SECTION}); truncated.`,
        path: prefix,
      });
    }

    const safeNodes: ContentNode[] = [];
    const bounded = section.nodes.slice(0, LIMITS.MAX_NODES_PER_SECTION);

    for (let ni = 0; ni < bounded.length; ni++) {
      totalNodes++;
      if (totalNodes > LIMITS.MAX_TOTAL_NODES) {
        diagnostics.push({
          severity: "warning",
          code: "TOTAL_NODES_EXCEEDED",
          message: `Total node count exceeded ${LIMITS.MAX_TOTAL_NODES}; remaining nodes discarded.`,
        });
        break;
      }

      const node = bounded[ni];
      const nPath = `${prefix}.nodes[${ni}]`;
      const validated = validateNode(node, nPath, tokens, diagnostics);
      safeNodes.push(validated);
    }

    cleanSections.push({ ...section, nodes: safeNodes });
  }

  ir = { ...ir, sections: cleanSections };

  return { ir, diagnostics, hasFatalErrors };
}

// ─── Per-Node Validation ────────────────────────────────────────────

function validateNode(
  node: ContentNode,
  path: string,
  _tokens: DesignTokenSet,
  diag: CompilationDiagnostic[],
): ContentNode {
  switch (node.type) {
    case "title":
    case "heading":
    case "paragraph":
    case "quote":
      return { ...node, content: sanitizeRichText(node.content, path, diag) } as ContentNode;

    case "bullet_list":
    case "numbered_list": {
      let items = node.items;
      if (items.length > LIMITS.MAX_LIST_ITEMS) {
        diag.push({ severity: "warning", code: "LIST_TRUNCATED", message: `${path}: list truncated to ${LIMITS.MAX_LIST_ITEMS} items`, path });
        items = items.slice(0, LIMITS.MAX_LIST_ITEMS);
      }
      items = items.map((rt, i) => sanitizeRichText(rt, `${path}.items[${i}]`, diag));
      return { ...node, items } as ContentNode;
    }

    case "table": {
      const colCount = node.columns.length;
      if (colCount > LIMITS.MAX_TABLE_COLUMNS) {
        diag.push({ severity: "warning", code: "TABLE_COLS_TRUNCATED", message: `${path}: columns truncated to ${LIMITS.MAX_TABLE_COLUMNS}`, path });
      }
      const safeCols = node.columns.slice(0, LIMITS.MAX_TABLE_COLUMNS);
      const safeColCount = safeCols.length;

      let rows = node.rows;
      if (rows.length > LIMITS.MAX_TABLE_ROWS) {
        diag.push({ severity: "warning", code: "TABLE_ROWS_TRUNCATED", message: `${path}: rows truncated to ${LIMITS.MAX_TABLE_ROWS}`, path });
        rows = rows.slice(0, LIMITS.MAX_TABLE_ROWS);
      }

      // Normalize row widths
      rows = rows.map((row) => {
        if (row.length < safeColCount) {
          return [...row, ...Array(safeColCount - row.length).fill("")];
        }
        if (row.length > safeColCount) {
          return row.slice(0, safeColCount);
        }
        return row;
      });

      // Truncate cell content for Excel safety
      rows = rows.map((row) =>
        row.map((cell) => {
          const str = cellToString(cell);
          if (str.length > LIMITS.EXCEL_MAX_CELL_LENGTH) {
            return str.slice(0, LIMITS.EXCEL_MAX_CELL_LENGTH);
          }
          return cell;
        }),
      );

      return { ...node, columns: safeCols, rows } as ContentNode;
    }

    case "image": {
      if (!isUrlSafe(node.src)) {
        diag.push({ severity: "warning", code: "IMAGE_URL_UNSAFE", message: `${path}: image src uses disallowed protocol; replaced with placeholder.`, path, fallbackUsed: true });
        return { type: "paragraph", content: [{ text: `[Image: ${node.alt || "removed"}]` }] };
      }
      if (node.src.length > LIMITS.MAX_IMAGE_SRC_LENGTH) {
        diag.push({ severity: "warning", code: "IMAGE_TOO_LARGE", message: `${path}: image data URI exceeds ${LIMITS.MAX_IMAGE_SRC_LENGTH} chars.`, path, fallbackUsed: true });
        return { type: "paragraph", content: [{ text: `[Image too large: ${node.alt || "removed"}]` }] };
      }
      return node;
    }

    case "chart": {
      if (node.categories.length > LIMITS.MAX_CHART_CATEGORIES) {
        diag.push({ severity: "warning", code: "CHART_CATEGORIES_TRUNCATED", message: `${path}: categories truncated.`, path });
        return { ...node, categories: node.categories.slice(0, LIMITS.MAX_CHART_CATEGORIES) } as ContentNode;
      }
      if (node.series.length > LIMITS.MAX_CHART_SERIES) {
        diag.push({ severity: "warning", code: "CHART_SERIES_TRUNCATED", message: `${path}: series truncated.`, path });
        return { ...node, series: node.series.slice(0, LIMITS.MAX_CHART_SERIES) } as ContentNode;
      }
      return node;
    }

    case "code_block": {
      if (node.code.length > LIMITS.MAX_CODE_BLOCK_LENGTH) {
        diag.push({ severity: "warning", code: "CODE_BLOCK_TRUNCATED", message: `${path}: code block truncated.`, path });
        return { ...node, code: node.code.slice(0, LIMITS.MAX_CODE_BLOCK_LENGTH) } as ContentNode;
      }
      return node;
    }

    default:
      return node;
  }
}

// ─── Rich-Text Sanitization ────────────────────────────────────────

function sanitizeRichText(
  spans: RichText,
  path: string,
  diag: CompilationDiagnostic[],
): RichText {
  return spans.map((span, i) => {
    let text = span.text;

    // Unicode NFC normalization
    text = text.normalize("NFC");

    // Strip XML-invalid characters (U+0000-U+0008, U+000B-U+000C, U+000E-U+001F, U+FFFE-U+FFFF)
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");

    // Truncate extremely long single spans
    if (text.length > LIMITS.MAX_TEXT_LENGTH) {
      diag.push({
        severity: "warning",
        code: "TEXT_TRUNCATED",
        message: `${path}[${i}]: text truncated from ${text.length} to ${LIMITS.MAX_TEXT_LENGTH} chars`,
        path: `${path}[${i}]`,
      });
      text = text.slice(0, LIMITS.MAX_TEXT_LENGTH);
    }

    // Validate link URL if present
    if (span.link && !isUrlSafe(span.link)) {
      diag.push({
        severity: "warning",
        code: "LINK_UNSAFE",
        message: `${path}[${i}]: link removed (disallowed protocol)`,
        path: `${path}[${i}]`,
      });
      return { ...span, text, link: undefined };
    }

    return { ...span, text };
  });
}

// ─── URL Safety ─────────────────────────────────────────────────────

function isUrlSafe(url: string): boolean {
  try {
    // Data URIs
    if (url.startsWith("data:")) return true;
    const parsed = new URL(url);
    return LIMITS.ALLOWED_URL_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}
