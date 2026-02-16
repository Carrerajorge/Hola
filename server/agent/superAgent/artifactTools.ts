import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { promises as fs } from "fs";
import path from "path";
import { generatePptDocument } from "../../services/documentGeneration";

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

function sanitizePptText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .substring(0, maxLength);
}

function toCorporateSlides(spec: PptxSpec): { title: string; content: string[] }[] {
  const sourceSlides = (spec.slides && spec.slides.length > 0)
    ? spec.slides
    : [{ title: "Resumen", bullets: ["Contenido no disponible"] }];

  const normalized = sourceSlides.map((slideSpec, index) => {
    const title = sanitizePptText(slideSpec.title, 180) || `Diapositiva ${index + 1}`;
    const content: string[] = [];

    const safeBullets = Array.isArray(slideSpec.bullets) ? slideSpec.bullets : [];
    for (const bullet of safeBullets.slice(0, 12)) {
      const safeBullet = sanitizePptText(bullet, 260);
      if (safeBullet) {
        content.push(`• ${safeBullet}`);
      }
    }

    if (slideSpec.notes) {
      const safeNotes = sanitizePptText(slideSpec.notes, 240);
      if (safeNotes) {
        content.push(`Notas: ${safeNotes}`);
      }
    }

    if (content.length === 0) {
      content.push("Sin contenido disponible.");
    }

    return {
      title,
      content,
    };
  });

  return normalized;
}

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
  const safeTitle = sanitizePptText(spec.title, 500) || "Presentation";
  const slides = toCorporateSlides(spec).map((slide) => ({
    ...slide,
  }));

  let pptxBuffer: Buffer;
  try {
    pptxBuffer = await generatePptDocument(safeTitle, slides, {
      trace: {
        source: "superAgent",
      },
    });
  } catch (error: any) {
    console.warn("[superAgent] Fallback for createPptx:", error);
    pptxBuffer = await generatePptDocument("Presentación", [{
      title: "Fallback",
      content: [
        "No fue posible renderizar la presentación con el layout solicitado.",
        `Error: ${sanitizePptText(error?.message || error, 200)}`,
      ],
    }], {
      trace: {
        source: "superAgent",
      },
    });
  }

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
    const domain = new URL(source.url).hostname;
    
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
  
  const files = await fs.readdir(ARTIFACTS_DIR);
  const match = files.find(f => f.includes(id.substring(0, 8)));
  
  if (match) {
    const ext = path.extname(match).slice(1);
    return {
      path: path.join(ARTIFACTS_DIR, match),
      name: match,
      type: ext as "xlsx" | "docx" | "pptx",
    };
  }
  
  return null;
}

const artifactStore = new Map<string, ArtifactMeta>();

export function storeArtifactMeta(meta: ArtifactMeta): void {
  artifactStore.set(meta.id, meta);
}

export function getArtifactMeta(id: string): ArtifactMeta | undefined {
  return artifactStore.get(id);
}

export function listArtifacts(): ArtifactMeta[] {
  return Array.from(artifactStore.values());
}
