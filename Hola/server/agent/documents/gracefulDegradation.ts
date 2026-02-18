/**
 * Graceful Degradation — Per-component fallback and error recovery.
 *
 * Instead of failing the entire document when one component errors,
 * this module:
 *   1. Catches per-component render errors
 *   2. Walks the component's fallback chain (e.g., chart → table → paragraph)
 *   3. Renders a safe substitute
 *   4. Records the degradation in an error manifest
 *   5. Always delivers a valid, openable document
 *
 * The error manifest is returned alongside the output buffer so callers
 * can log/display which components degraded and why.
 */

import type { BlockIR } from "./documentIR";
import { COMPONENT_CONTRACTS } from "./componentRegistry";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export interface DegradationEntry {
  /** Path within the document (e.g., "sections[0].blocks[3]") */
  path: string;
  /** Original component type that failed */
  originalType: string;
  /** Type it was degraded to */
  degradedTo: string;
  /** Error message from the failed render */
  error: string;
  /** Timestamp */
  timestamp: number;
}

export interface DegradationManifest {
  /** Total degradations applied */
  count: number;
  /** Individual entries */
  entries: DegradationEntry[];
  /** Whether the document is fully intact (count === 0) */
  intact: boolean;
}

/* ================================================================== */
/*  DEGRADATION ENGINE                                                 */
/* ================================================================== */

export class DegradationEngine {
  private entries: DegradationEntry[] = [];
  private maxEntries = 1000;

  /**
   * Wrap a component render function with graceful degradation.
   *
   * @param block - The block to render
   * @param path - Document path for error reporting
   * @param renderFn - Primary render function; throws on failure
   * @param fallbackRenderFn - Fallback render for a simplified block
   * @returns Result of renderFn, or result of fallbackRenderFn on failure
   */
  async withDegradation<T>(
    block: BlockIR,
    path: string,
    renderFn: () => Promise<T> | T,
    fallbackRenderFn: (simplifiedBlock: BlockIR) => Promise<T> | T,
  ): Promise<T> {
    try {
      return await renderFn();
    } catch (primaryErr) {
      const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

      // Walk fallback chain
      const contract = COMPONENT_CONTRACTS[block.type];
      const fallbackTypes = contract?.fallbackChain || [];

      for (const fbType of fallbackTypes) {
        try {
          const simplifiedBlock = this.degradeBlock(block, fbType);
          const result = await fallbackRenderFn(simplifiedBlock);

          this.recordDegradation(path, block.type, fbType, errMsg);
          return result;
        } catch {
          // This fallback also failed, try next in chain
        }
      }

      // All fallbacks failed — try rendering as plain text paragraph
      try {
        const textBlock = this.degradeToPlainText(block);
        const result = await fallbackRenderFn(textBlock);
        this.recordDegradation(path, block.type, "paragraph", errMsg);
        return result;
      } catch (finalErr) {
        // Even plain text failed — record and re-throw
        this.recordDegradation(path, block.type, "FAILED", errMsg);
        throw finalErr;
      }
    }
  }

  /**
   * Synchronous version of withDegradation.
   */
  withDegradationSync<T>(
    block: BlockIR,
    path: string,
    renderFn: () => T,
    fallbackRenderFn: (simplifiedBlock: BlockIR) => T,
  ): T {
    try {
      return renderFn();
    } catch (primaryErr) {
      const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

      const contract = COMPONENT_CONTRACTS[block.type];
      const fallbackTypes = contract?.fallbackChain || [];

      for (const fbType of fallbackTypes) {
        try {
          const simplifiedBlock = this.degradeBlock(block, fbType);
          const result = fallbackRenderFn(simplifiedBlock);
          this.recordDegradation(path, block.type, fbType, errMsg);
          return result;
        } catch {
          // Try next fallback
        }
      }

      try {
        const textBlock = this.degradeToPlainText(block);
        const result = fallbackRenderFn(textBlock);
        this.recordDegradation(path, block.type, "paragraph", errMsg);
        return result;
      } catch (finalErr) {
        this.recordDegradation(path, block.type, "FAILED", errMsg);
        throw finalErr;
      }
    }
  }

  /**
   * Get the degradation manifest.
   */
  getManifest(): DegradationManifest {
    return {
      count: this.entries.length,
      entries: this.entries,
      intact: this.entries.length === 0,
    };
  }

  /**
   * Reset the engine for a new compilation.
   */
  reset(): void {
    this.entries = [];
  }

  /* ---------------------------------------------------------------- */
  /*  BLOCK DEGRADATION                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Transform a block to a simpler type for fallback rendering.
   */
  private degradeBlock(original: BlockIR, targetType: string): BlockIR {
    const any = original as any;

    switch (targetType) {
      case "table": {
        // Degrade chart → table
        if (original.type === "chart") {
          return {
            type: "table",
            columns: [
              { key: "label", header: "Label", type: "string" },
              ...((any.datasets || []).map((ds: any, i: number) => ({
                key: `dataset_${i}`,
                header: ds.label || `Dataset ${i + 1}`,
                type: "number",
              }))),
            ],
            rows: (any.labels || []).map((label: string, i: number) => {
              const row: Record<string, any> = { label };
              for (let d = 0; d < (any.datasets || []).length; d++) {
                row[`dataset_${d}`] = any.datasets[d]?.values?.[i] ?? "";
              }
              return row;
            }),
            showHeader: true,
            showStripes: true,
            constraints: {},
          } as any;
        }
        // kpi_card → table
        if (original.type === "kpi_card") {
          return {
            type: "table",
            columns: [
              { key: "metric", header: "Metric", type: "string" },
              { key: "value", header: "Value", type: "string" },
            ],
            rows: [{
              metric: any.title || "Metric",
              value: `${any.value || ""}${any.unit ? ` ${any.unit}` : ""}`,
            }],
            showHeader: true,
            showStripes: false,
            constraints: {},
          } as any;
        }
        return this.degradeToPlainText(original);
      }

      case "paragraph":
        return this.degradeToPlainText(original);

      case "bullets": {
        // Convert numbered → bullets
        if (original.type === "numbered") {
          return {
            type: "bullets",
            items: any.items || [],
            level: 0,
            constraints: any.constraints || {},
          } as any;
        }
        return this.degradeToPlainText(original);
      }

      case "quote": {
        // callout → quote
        if (original.type === "callout") {
          return {
            type: "quote",
            text: `${any.title ? `[${any.variant?.toUpperCase() || "NOTE"}] ${any.title}\n` : ""}${any.text || ""}`,
            constraints: any.constraints || {},
          } as any;
        }
        return this.degradeToPlainText(original);
      }

      case "spacer": {
        return { type: "spacer", height: 0.3 } as any;
      }

      default:
        return this.degradeToPlainText(original);
    }
  }

  /**
   * Convert any block to a plain text paragraph (last resort).
   */
  private degradeToPlainText(block: BlockIR): BlockIR {
    const any = block as any;
    let text: string;

    switch (block.type) {
      case "heading":
      case "paragraph":
      case "richtext":
        text = any.text || any.markdown || "";
        break;

      case "bullets":
      case "numbered":
        text = (any.items || []).map((item: string, i: number) =>
          block.type === "numbered" ? `${i + 1}. ${item}` : `- ${item}`
        ).join("\n");
        break;

      case "table": {
        const cols = any.columns || [];
        const rows = any.rows || [];
        const headerLine = cols.map((c: any) => c.header || c.key || "").join(" | ");
        const dataLines = rows.slice(0, 20).map((row: Record<string, any>) =>
          cols.map((c: any) => String(row[c.key] ?? "")).join(" | ")
        );
        text = [headerLine, ...dataLines].join("\n");
        break;
      }

      case "chart":
        text = `[Chart: ${any.title || any.chartType || "chart"}]`;
        break;

      case "image":
        text = `[Image: ${any.alt || any.caption || any.src || "image"}]`;
        break;

      case "kpi_card":
        text = `${any.title || "Metric"}: ${any.value || ""}${any.unit ? ` ${any.unit}` : ""}`;
        break;

      case "badge":
        text = `[${any.text || ""}]`;
        break;

      case "callout":
        text = `[${any.variant?.toUpperCase() || "NOTE"}] ${any.title ? any.title + ": " : ""}${any.text || ""}`;
        break;

      case "quote":
        text = `"${any.text || ""}"${any.attribution ? ` — ${any.attribution}` : ""}`;
        break;

      case "code":
        text = any.code || "";
        break;

      default:
        text = "[Component]";
    }

    return {
      type: "paragraph",
      text: text.substring(0, 10_000),
      constraints: {},
    } as any;
  }

  /* ---------------------------------------------------------------- */
  /*  INTERNAL                                                         */
  /* ---------------------------------------------------------------- */

  private recordDegradation(
    path: string,
    originalType: string,
    degradedTo: string,
    error: string,
  ): void {
    if (this.entries.length >= this.maxEntries) return;

    this.entries.push({
      path,
      originalType,
      degradedTo,
      error: error.substring(0, 500),
      timestamp: Date.now(),
    });

    console.warn(
      `[GracefulDegradation] ${path}: "${originalType}" → "${degradedTo}" (${error.substring(0, 100)})`
    );
  }
}
