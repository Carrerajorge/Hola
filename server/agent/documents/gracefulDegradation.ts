/**
 * Graceful Degradation — Per-component fallback system.
 *
 * When a component fails to render, this module provides:
 *   - Safe fallback content (plain text, simple table)
 *   - Error logging with component context
 *   - Fallback document generation (minimal valid file)
 *
 * The principle: ALWAYS deliver a valid, openable file, even if
 * some components degrade to simpler representations.
 */

import type { ComponentDescriptor, ComponentType } from "./componentRegistry";
import { getSafeFallback } from "./componentRegistry";
import type { UnifiedDesignTokens } from "./designTokens";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export interface DegradationEvent {
  /** Component that failed */
  componentType: ComponentType;
  /** Original error */
  error: string;
  /** What the component was replaced with */
  fallbackType: "text" | "table" | "placeholder" | "skip";
  /** Fallback content */
  fallbackContent: string;
  /** Timestamp */
  timestamp: number;
  /** Location in the document (e.g., "slide[2].comp[3]") */
  location?: string;
}

export interface DegradationLog {
  /** Total components that degraded */
  degradedCount: number;
  /** Total components processed */
  totalComponents: number;
  /** Degradation ratio (0-1) */
  degradationRatio: number;
  /** Individual events */
  events: DegradationEvent[];
  /** Whether the entire document had to use a fallback */
  documentLevelFallback: boolean;
}

/* ================================================================== */
/*  DEGRADATION MANAGER                                                */
/* ================================================================== */

export class DegradationManager {
  private events: DegradationEvent[] = [];
  private totalComponents: number = 0;
  private documentLevelFallback: boolean = false;

  /** Maximum events to track (prevent unbounded memory) */
  private static readonly MAX_EVENTS = 200;

  /**
   * Record a component degradation event.
   */
  recordDegradation(
    componentType: ComponentType,
    error: unknown,
    location?: string
  ): string {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const fallbackContent = getSafeFallback(componentType, null);

    const event: DegradationEvent = {
      componentType,
      error: errorMsg.substring(0, 500),
      fallbackType: this.determineFallbackType(componentType),
      fallbackContent: fallbackContent.substring(0, 500),
      timestamp: Date.now(),
      location,
    };

    if (this.events.length < DegradationManager.MAX_EVENTS) {
      this.events.push(event);
    }

    console.warn(
      `[GracefulDegradation] Component "${componentType}" degraded at ${location || "unknown"}: ${errorMsg.substring(0, 200)}`
    );

    return fallbackContent;
  }

  /**
   * Try to render a component, falling back to safe content on failure.
   */
  tryRender<T>(
    component: ComponentDescriptor,
    renderFn: () => T,
    fallbackFn: (fallbackText: string) => T,
    location?: string
  ): { result: T; degraded: boolean } {
    this.totalComponents++;

    try {
      const result = renderFn();
      return { result, degraded: false };
    } catch (error) {
      const fallbackText = this.recordDegradation(component.type, error, location);
      try {
        const result = fallbackFn(fallbackText);
        return { result, degraded: true };
      } catch (fallbackError) {
        // Even the fallback failed — this is very bad
        console.error(
          `[GracefulDegradation] Even fallback render failed for "${component.type}": ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
        );
        // Return fallback anyway, let caller decide
        const result = fallbackFn(`[${component.type}]`);
        return { result, degraded: true };
      }
    }
  }

  /**
   * Record a document-level fallback (entire doc generation failed).
   */
  recordDocumentFallback(error: unknown): void {
    this.documentLevelFallback = true;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[GracefulDegradation] Document-level fallback triggered: ${errorMsg.substring(0, 300)}`);
  }

  /**
   * Get the degradation log for observability.
   */
  getLog(): DegradationLog {
    return {
      degradedCount: this.events.length,
      totalComponents: this.totalComponents,
      degradationRatio: this.totalComponents > 0 ? this.events.length / this.totalComponents : 0,
      events: this.events,
      documentLevelFallback: this.documentLevelFallback,
    };
  }

  /**
   * Reset the manager for a new compilation.
   */
  reset(): void {
    this.events = [];
    this.totalComponents = 0;
    this.documentLevelFallback = false;
  }

  private determineFallbackType(componentType: ComponentType): DegradationEvent["fallbackType"] {
    switch (componentType) {
      case "table":
        return "table";
      case "chart":
      case "image":
        return "placeholder";
      case "divider":
      case "spacer":
        return "skip";
      default:
        return "text";
    }
  }
}

/* ================================================================== */
/*  FALLBACK DOCUMENT GENERATORS                                       */
/* ================================================================== */

/**
 * Generate a minimal valid PPTX buffer when all else fails.
 */
export async function generateFallbackPptx(
  title: string,
  errorMessage: string
): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.title = title.substring(0, 200);
  pptx.author = "IliaGPT";

  const slide = pptx.addSlide();
  slide.addText(title.substring(0, 200), {
    x: 0.5, y: 1.5, w: 9, h: 1.5,
    fontSize: 32, bold: true, color: "363636",
    align: "center", fontFace: "Arial",
  });
  slide.addText("Documento generado en modo de recuperación", {
    x: 0.5, y: 3.2, w: 9, h: 0.5,
    fontSize: 14, color: "999999",
    align: "center", fontFace: "Arial", italic: true,
  });

  const data = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(data as ArrayBuffer);
}

/**
 * Generate a minimal valid DOCX buffer when all else fails.
 */
export async function generateFallbackDocx(
  title: string,
  errorMessage: string
): Promise<Buffer> {
  const { Document, Paragraph, TextRun, Packer, HeadingLevel } = await import("docx");
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          text: title.substring(0, 200),
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Este documento fue generado en modo de recuperación debido a un error de procesamiento.",
              italics: true,
              color: "999999",
            }),
          ],
        }),
      ],
    }],
  });
  return await Packer.toBuffer(doc);
}

/**
 * Generate a minimal valid XLSX buffer when all else fails.
 */
export async function generateFallbackXlsx(
  title: string,
  errorMessage: string
): Promise<Buffer> {
  const excelMod = await import("exceljs");
  const ExcelJS = (excelMod as any).default || excelMod;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IliaGPT";

  const sheet = workbook.addWorksheet("Datos");
  sheet.columns = [{ header: "Información", key: "info", width: 50 }];
  sheet.addRow({ info: title.substring(0, 200) });
  sheet.addRow({ info: "Generado en modo de recuperación" });

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 12 };
  headerRow.height = 25;

  const buf = Buffer.from(await workbook.xlsx.writeBuffer());
  return buf;
}

/**
 * Generate a fallback buffer for any format.
 */
export async function generateFallbackDocument(
  format: "pptx" | "docx" | "xlsx",
  title: string,
  error: unknown
): Promise<Buffer> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  // Sanitize error message (strip file paths)
  const safeMsg = errorMsg.replace(/\/[a-zA-Z0-9_./-]+/g, "[PATH]").substring(0, 500);

  try {
    switch (format) {
      case "pptx":
        return await generateFallbackPptx(title, safeMsg);
      case "docx":
        return await generateFallbackDocx(title, safeMsg);
      case "xlsx":
        return await generateFallbackXlsx(title, safeMsg);
    }
  } catch (fallbackError) {
    console.error(`[GracefulDegradation] Fallback generation also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
    return Buffer.from("Fallback document generation failed");
  }
}
