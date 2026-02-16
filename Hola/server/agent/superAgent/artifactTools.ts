import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import pptxgenImport from "pptxgenjs";
const PptxGenJS = (pptxgenImport as any).default || pptxgenImport;
import { promises as fs } from "fs";
import path from "path";
import { DocumentCompiler, type CompilerFormat } from "../documents/compiler";
import { resolveTheme } from "../documents/themes";
import type { PresentationSpec, DocumentSpec, WorkbookSpec } from "../documents/documentEngine";

export interface ArtifactMeta {
  id: string;
  type: "xlsx" | "docx" | "pptx";
  name: string;
  path: string;
  downloadUrl: string;
  size: number;
  createdAt: number;
}

export interface XlsxSpec {
  title: string;
  sheets: Array<{
    name: string;
    headers: string[];
    data: any[][];
    summary?: Record<string, any>;
  }>;
}

export interface DocxSpec {
  title: string;
  sections: Array<{
    heading: string;
    level: 1 | 2 | 3;
    paragraphs: string[];
    citations?: string[];
    table?: {
      headers: string[];
      rows: string[][];
    };
  }>;
  metadata?: {
    author?: string;
    subject?: string;
    keywords?: string[];
  };
}

export interface PptxSpec {
  title: string;
  slides: Array<{
    title: string;
    bullets: string[];
    notes?: string;
  }>;
  metadata?: {
    author?: string;
    subject?: string;
  };
}

export interface CitationsPack {
  sources: Array<{
    id: string;
    url: string;
    title: string;
    snippet: string;
    accessedAt: string;
  }>;
  claims: Array<{
    text: string;
    sourceIds: string[];
  }>;
  formatted: {
    apa: string[];
    mla: string[];
    chicago: string[];
  };
}

const ARTIFACTS_DIR = path.join(process.cwd(), "uploads", "artifacts");

async function ensureArtifactsDir(): Promise<void> {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
}

export async function createXlsx(spec: XlsxSpec): Promise<ArtifactMeta> {
  await ensureArtifactsDir();
  
  const id = randomUUID();
  const filename = `${spec.title.replace(/[^a-zA-Z0-9]/g, "_")}_${id.substring(0, 8)}.xlsx`;
  const filepath = path.join(ARTIFACTS_DIR, filename);
  
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IliaGPT Super Agent";
  workbook.created = new Date();
  
  for (const sheetSpec of spec.sheets) {
    const sheet = workbook.addWorksheet(sheetSpec.name);
    
    sheet.columns = sheetSpec.headers.map((header, idx) => ({
      header,
      key: `col_${idx}`,
      width: Math.max(header.length + 5, 15),
    }));
    
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
    
    for (const rowData of sheetSpec.data) {
      const rowObj: Record<string, any> = {};
      rowData.forEach((cell, idx) => {
        rowObj[`col_${idx}`] = cell;
      });
      sheet.addRow(rowObj);
    }
    
    if (sheetSpec.summary) {
      sheet.addRow([]);
      sheet.addRow(["Summary"]);
      for (const [key, value] of Object.entries(sheetSpec.summary)) {
        sheet.addRow([key, value]);
      }
    }
    
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheetSpec.headers.length },
    };
  }
  
  await workbook.xlsx.writeFile(filepath);
  
  const stats = await fs.stat(filepath);
  
  return {
    id,
    type: "xlsx",
    name: filename,
    path: filepath,
    downloadUrl: `/api/super/artifacts/${id}/download`,
    size: stats.size,
    createdAt: Date.now(),
  };
}

export async function createDocx(spec: DocxSpec): Promise<ArtifactMeta> {
  await ensureArtifactsDir();
  
  const id = randomUUID();
  const filename = `${spec.title.replace(/[^a-zA-Z0-9]/g, "_")}_${id.substring(0, 8)}.docx`;
  const filepath = path.join(ARTIFACTS_DIR, filename);
  
  const children: any[] = [];
  
  children.push(
    new Paragraph({
      text: spec.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
    })
  );
  
  for (const section of spec.sections) {
    const headingLevel = section.level === 1 ? HeadingLevel.HEADING_1 :
                        section.level === 2 ? HeadingLevel.HEADING_2 :
                        HeadingLevel.HEADING_3;
    
    children.push(
      new Paragraph({
        text: section.heading,
        heading: headingLevel,
        spacing: { before: 300, after: 200 },
      })
    );
    
    for (const para of section.paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun(para)],
          spacing: { after: 200 },
        })
      );
    }
    
    if (section.table) {
      const tableRows: TableRow[] = [];
      
      tableRows.push(
        new TableRow({
          children: section.table.headers.map(header =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })],
              width: { size: 100 / section.table!.headers.length, type: WidthType.PERCENTAGE },
            })
          ),
        })
      );
      
      for (const row of section.table.rows) {
        tableRows.push(
          new TableRow({
            children: row.map(cell =>
              new TableCell({
                children: [new Paragraph(cell)],
              })
            ),
          })
        );
      }
      
      children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        })
      );
    }
    
    if (section.citations && section.citations.length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "References:", italics: true })],
          spacing: { before: 200 },
        })
      );
      
      for (const citation of section.citations) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `• ${citation}`, size: 20 })],
          })
        );
      }
    }
  }
  
  const doc = new Document({
    creator: spec.metadata?.author || "IliaGPT Super Agent",
    title: spec.title,
    subject: spec.metadata?.subject,
    keywords: spec.metadata?.keywords?.join(", "),
    sections: [{
      children,
    }],
  });
  
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(filepath, buffer);
  
  const stats = await fs.stat(filepath);
  
  return {
    id,
    type: "docx",
    name: filename,
    path: filepath,
    downloadUrl: `/api/super/artifacts/${id}/download`,
    size: stats.size,
    createdAt: Date.now(),
  };
}

export async function createPptx(spec: PptxSpec): Promise<ArtifactMeta> {
  await ensureArtifactsDir();

  const id = randomUUID();
  const filename = `${spec.title.replace(/[^a-zA-Z0-9]/g, "_")}_${id.substring(0, 8)}.pptx`;
  const filepath = path.join(ARTIFACTS_DIR, filename);

  const pptx = new PptxGenJS();
  pptx.author = spec.metadata?.author || "IliaGPT Super Agent";
  pptx.subject = spec.metadata?.subject || spec.title;
  pptx.title = spec.title;

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.addText(spec.title, {
    x: 0.5, y: 1.5, w: 9, h: 2,
    fontSize: 32, bold: true, color: "1A1A2E",
    align: "center", valign: "middle",
  });
  titleSlide.addText(spec.metadata?.author || "IliaGPT Super Agent", {
    x: 0.5, y: 4, w: 9, h: 0.5,
    fontSize: 14, color: "666666",
    align: "center",
  });

  // Content slides
  for (const slideSpec of spec.slides) {
    const slide = pptx.addSlide();

    slide.addText(slideSpec.title, {
      x: 0.5, y: 0.3, w: 9, h: 0.8,
      fontSize: 24, bold: true, color: "1A1A2E",
    });

    const bulletText = slideSpec.bullets.map(b => ({
      text: b,
      options: { fontSize: 16, color: "333333", bullet: true, breakLine: true } as any,
    }));

    slide.addText(bulletText, {
      x: 0.5, y: 1.3, w: 9, h: 3.8,
      valign: "top",
    });

    if (slideSpec.notes) {
      slide.addNotes(slideSpec.notes);
    }
  }

  const pptxBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
  await fs.writeFile(filepath, pptxBuffer);

  const stats = await fs.stat(filepath);

  return {
    id,
    type: "pptx",
    name: filename,
    path: filepath,
    downloadUrl: `/api/super/artifacts/${id}/download`,
    size: stats.size,
    createdAt: Date.now(),
  };
}

/* ================================================================== */
/*  COMPILER-BASED ARTIFACT CREATION                                   */
/* ================================================================== */

const _compiler = new DocumentCompiler("corporate");

/**
 * Create any document artifact through the unified compiler.
 * Falls back to legacy creation functions on compiler error.
 */
export async function createArtifactCompiled(
  format: "xlsx" | "docx" | "pptx",
  spec: XlsxSpec | DocxSpec | PptxSpec,
  theme?: string
): Promise<ArtifactMeta> {
  await ensureArtifactsDir();

  const id = randomUUID();
  const filename = `${spec.title.replace(/[^a-zA-Z0-9]/g, "_")}_${id.substring(0, 8)}.${format}`;
  const filepath = path.join(ARTIFACTS_DIR, filename);

  try {
    // Convert legacy spec to compiler spec format
    const compilerSpec = convertLegacyToCompilerSpec(format, spec);
    const result = await _compiler.compile({
      format,
      spec: compilerSpec,
      theme: theme || "corporate",
    });

    await fs.writeFile(filepath, result.buffer);

    if (result.metrics.degraded) {
      console.warn(`[ArtifactTools] Compiled ${format} in degraded mode: ${result.validation.issues.map(i => i.message).join(", ")}`);
    }

    return {
      id,
      type: format,
      name: filename,
      path: filepath,
      downloadUrl: `/api/super/artifacts/${id}/download`,
      size: result.metrics.sizeBytes,
      createdAt: Date.now(),
    };
  } catch (err) {
    // Fallback to legacy creation
    console.warn(`[ArtifactTools] Compiler failed for ${format}, falling back to legacy: ${err instanceof Error ? err.message : String(err)}`);
    switch (format) {
      case "xlsx": return createXlsx(spec as XlsxSpec);
      case "docx": return createDocx(spec as DocxSpec);
      case "pptx": return createPptx(spec as PptxSpec);
    }
  }
}

function convertLegacyToCompilerSpec(
  format: string,
  spec: XlsxSpec | DocxSpec | PptxSpec
): PresentationSpec | DocumentSpec | WorkbookSpec {
  switch (format) {
    case "pptx": {
      const s = spec as PptxSpec;
      return {
        format: "pptx" as const,
        title: s.title,
        author: s.metadata?.author,
        slides: [
          {
            type: "cover" as const,
            components: [
              { type: "title" as const, content: s.title },
              { type: "subtitle" as const, content: s.metadata?.author || "IliaGPT" },
            ],
          },
          ...s.slides.map(slide => ({
            type: "content" as const,
            components: [
              { type: "title" as const, content: slide.title },
              ...(slide.bullets.length > 0
                ? [{ type: "bullets" as const, content: slide.bullets }]
                : []),
            ],
            notes: slide.notes,
          })),
        ],
      } satisfies PresentationSpec;
    }

    case "docx": {
      const s = spec as DocxSpec;
      const sections: DocumentSpec["sections"] = [];
      for (const sec of s.sections) {
        sections.push({
          type: "heading",
          level: sec.level,
          content: sec.heading,
        });
        for (const para of sec.paragraphs) {
          sections.push({ type: "paragraph", content: para });
        }
        if (sec.table) {
          sections.push({
            type: "table",
            content: [sec.table.headers, ...sec.table.rows],
          });
        }
        if (sec.citations?.length) {
          sections.push({
            type: "bullets",
            content: sec.citations,
          });
        }
      }
      return {
        format: "docx" as const,
        title: s.title,
        author: s.metadata?.author,
        subject: s.metadata?.subject,
        sections,
      } satisfies DocumentSpec;
    }

    case "xlsx": {
      const s = spec as XlsxSpec;
      return {
        format: "xlsx" as const,
        title: s.title,
        sheets: s.sheets.map(sheet => ({
          name: sheet.name.substring(0, 31),
          columns: sheet.headers.map((h, idx) => ({
            key: `col_${idx}`,
            header: h,
            type: "string" as const,
            width: Math.max(h.length + 5, 15),
          })),
          rows: sheet.data.map(row => {
            const obj: Record<string, any> = {};
            row.forEach((cell, idx) => { obj[`col_${idx}`] = cell; });
            return obj;
          }),
          formulas: [],
          filters: true,
          freezeRow: 1,
          freezeCol: 0,
          protection: false,
        })),
      } satisfies WorkbookSpec;
    }

    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

export function packCitations(
  sources: Array<{ id: string; url: string; title: string; snippet: string }>,
  claims: Array<{ text: string; sourceIds: string[] }>
): CitationsPack {
  const now = new Date().toISOString().split("T")[0];
  
  const formattedSources = sources.map(s => ({
    ...s,
    accessedAt: now,
  }));
  
  const apa: string[] = [];
  const mla: string[] = [];
  const chicago: string[] = [];
  
  for (const source of sources) {
    let domain = "unknown";
    try {
      domain = new URL(source.url).hostname;
    } catch {
      // Invalid URL — use fallback domain
    }

    apa.push(`${source.title}. (${new Date().getFullYear()}). Retrieved from ${source.url}`);
    mla.push(`"${source.title}." ${domain}, ${source.url}. Accessed ${now}.`);
    chicago.push(`"${source.title}." ${domain}. Accessed ${now}. ${source.url}.`);
  }
  
  return {
    sources: formattedSources,
    claims,
    formatted: { apa, mla, chicago },
  };
}

export async function getArtifact(id: string): Promise<{ path: string; name: string; type: string } | null> {
  await ensureArtifactsDir();

  // Sanitize ID to prevent path traversal (only allow alphanumeric + hyphens)
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, "");
  if (safeId.length < 8) return null;

  const files = await fs.readdir(ARTIFACTS_DIR);
  const match = files.find(f => f.includes(safeId.substring(0, 8)));

  if (match) {
    // Double-check resolved path stays within ARTIFACTS_DIR
    const resolved = path.resolve(ARTIFACTS_DIR, match);
    if (!resolved.startsWith(path.resolve(ARTIFACTS_DIR))) {
      console.warn(`[ArtifactTools] Path traversal attempt blocked: ${match}`);
      return null;
    }
    const ext = path.extname(match).slice(1);
    return {
      path: resolved,
      name: match,
      type: ext as "xlsx" | "docx" | "pptx",
    };
  }

  return null;
}

/** In-memory artifact metadata cache with LRU eviction to prevent unbounded growth. */
const ARTIFACT_STORE_MAX = 10_000;
const artifactStore = new Map<string, ArtifactMeta>();

export function storeArtifactMeta(meta: ArtifactMeta): void {
  // Evict oldest entry when at capacity (Map preserves insertion order)
  if (artifactStore.size >= ARTIFACT_STORE_MAX) {
    const oldestKey = artifactStore.keys().next().value;
    if (oldestKey) artifactStore.delete(oldestKey);
  }
  artifactStore.set(meta.id, meta);
}

export function getArtifactMeta(id: string): ArtifactMeta | undefined {
  return artifactStore.get(id);
}

export function listArtifacts(): ArtifactMeta[] {
  return Array.from(artifactStore.values());
}
