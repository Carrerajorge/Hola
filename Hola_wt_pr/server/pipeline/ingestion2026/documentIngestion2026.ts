import crypto from "crypto";

import type { DocumentSemanticModel, Section, Table, TableCell } from "../../../shared/schemas/documentSemanticModel";
import type { IngestedChunk, IngestedChunkLocation, IngestedDocumentSummary } from "./ingestionTypes";

function stableId(prefix: string, parts: string[]): string {
  const h = crypto.createHash("sha1").update(parts.join("|"), "utf8").digest("hex").slice(0, 12);
  return `${prefix}_${h}`;
}

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

function safeOneLine(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function parseSourceRefToLocation(sourceRef: string): IngestedChunkLocation {
  const ref = (sourceRef || "").trim();
  const loc: IngestedChunkLocation = {};

  const pageMatch = ref.match(/(?:^|:)page:(\d+)/i) || ref.match(/\bp(?:age)?\s*[:#]?\s*(\d+)\b/i);
  if (pageMatch) loc.page = parseInt(pageMatch[1], 10);

  const slideMatch = ref.match(/(?:^|:)slide:(\d+)/i);
  if (slideMatch) loc.slide = parseInt(slideMatch[1], 10);

  const rowMatch = ref.match(/(?:^|:)row:(\d+)/i);
  if (rowMatch) loc.row = parseInt(rowMatch[1], 10);

  const sheetMatch = ref.match(/(?:^|:)sheet:([^:]+)/i);
  if (sheetMatch) loc.sheet = sheetMatch[1].trim();

  // Word extractor uses "para:1", "list:2", "table:3", "section:4"
  if (/^(para|list|table|section):\d+$/i.test(ref)) {
    loc.sectionRef = ref;
  }

  return loc;
}

function formatHeadingPath(path: string[]): string {
  const cleaned = path.map(p => safeOneLine(p)).filter(Boolean);
  if (cleaned.length === 0) return "";
  return cleaned.join(" > ");
}

function buildSourceId(args: {
  filename: string;
  location: IngestedChunkLocation;
  headingPath: string[];
  tableTitle?: string;
}): string {
  const { filename, location, headingPath, tableTitle } = args;
  const parts: string[] = [`doc:${filename}`];

  if (location.page) parts.push(`p${location.page}`);
  if (location.slide) parts.push(`slide:${location.slide}`);
  if (location.sheet) parts.push(`sheet:${location.sheet}`);
  if (location.row) parts.push(`row:${location.row}`);
  if (location.cell) parts.push(`cell:${location.cell}`);
  if (location.sectionRef) parts.push(location.sectionRef);

  const sectionTitle = headingPath.length > 0 ? safeOneLine(headingPath[headingPath.length - 1]).slice(0, 80) : "";
  if (sectionTitle) parts.push(`sec:"${sectionTitle}"`);
  if (tableTitle) parts.push(`table:"${safeOneLine(tableTitle).slice(0, 80)}"`);

  return parts.join(" ");
}

function updateHeadingStack(stack: string[], level: number, title: string): string[] {
  const lvl = Math.max(1, Math.min(6, level || 2));
  const next = stack.slice(0, lvl - 1);
  next.push(title);
  return next;
}

function flattenSections(sections: Section[]): Section[] {
  const result: Section[] = [];
  const walk = (s: Section) => {
    result.push(s);
    if (Array.isArray(s.children)) {
      for (const c of s.children) walk(c);
    }
  };
  for (const s of sections) walk(s);
  return result;
}

function tableCellToText(cell: TableCell): string {
  if (cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "string") return cell.value;
  if (typeof cell.value === "number") return String(cell.value);
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

function tableRowsToCsv(headers: string[], rows: TableCell[][]): string {
  const csvLines: string[] = [];
  const escape = (v: string) => {
    const s = v ?? "";
    if (/[\",\n]/.test(s)) return `"${s.replace(/\"/g, '""')}"`;
    return s;
  };

  csvLines.push(headers.map(h => escape(safeOneLine(h))).join(","));
  for (const row of rows) {
    const cells = row.slice(0, headers.length).map(c => escape(safeOneLine(tableCellToText(c))));
    csvLines.push(cells.join(","));
  }
  return csvLines.join("\n");
}

function chunkTextWithContext(args: {
  filename: string;
  location: IngestedChunkLocation;
  headingPath: string[];
  rawText: string;
  kindLabel: string;
  maxTokens: number;
}): IngestedChunk[] {
  const { filename, location, headingPath, rawText, kindLabel, maxTokens } = args;

  const headingLine = formatHeadingPath(headingPath);
  const prefixLines: string[] = [];
  if (headingLine) prefixLines.push(`HeadingPath: ${headingLine}`);
  prefixLines.push(`Type: ${kindLabel}`);

  const prefix = prefixLines.join("\n");
  const raw = (rawText || "").trim();
  if (!raw) return [];

  const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: IngestedChunk[] = [];

  let buf: string[] = [];
  let bufTokens = estimateTokens(prefix) + 5;
  let partIndex = 0;

  const flush = () => {
    const body = buf.join("\n\n").trim();
    if (!body) return;
    const content = `${prefix}\n\n${body}`.trim();
    const id = stableId("chunk", [filename, JSON.stringify(location), headingLine, kindLabel, String(partIndex), content.slice(0, 200)]);
    chunks.push({
      id,
      kind: "document",
      filename,
      sourceId: buildSourceId({ filename, location, headingPath }),
      location,
      headingPath,
      content,
      rawContent: body,
      metadata: { kindLabel },
    });
    buf = [];
    bufTokens = estimateTokens(prefix) + 5;
    partIndex++;
  };

  for (const p of paragraphs) {
    const pTokens = estimateTokens(p) + 5;
    if (bufTokens + pTokens > maxTokens && buf.length > 0) {
      flush();
    }
    // If a single paragraph is huge, hard-split.
    if (pTokens > maxTokens) {
      const words = p.split(/\s+/);
      let sub: string[] = [];
      let subTokens = 0;
      for (const w of words) {
        const t = estimateTokens(w) + 1;
        if (subTokens + t > maxTokens - estimateTokens(prefix) - 10 && sub.length > 0) {
          buf.push(sub.join(" "));
          flush();
          sub = [];
          subTokens = 0;
        }
        sub.push(w);
        subTokens += t;
      }
      if (sub.length > 0) {
        buf.push(sub.join(" "));
      }
      flush();
      continue;
    }
    buf.push(p);
    bufTokens += pTokens;
  }

  flush();
  return chunks;
}

function chunkTableWithContext(args: {
  filename: string;
  location: IngestedChunkLocation;
  headingPath: string[];
  table: Table;
  maxTokens: number;
}): IngestedChunk[] {
  const { filename, location, headingPath, table, maxTokens } = args;
  const title = table.title || "Table";
  const headingLine = formatHeadingPath(headingPath);

  const prefixLines: string[] = [];
  if (headingLine) prefixLines.push(`HeadingPath: ${headingLine}`);
  prefixLines.push(`Type: table`);
  prefixLines.push(`TableTitle: ${safeOneLine(title)}`);
  const prefix = prefixLines.join("\n");

  const headers = (table.headers || []).map(h => safeOneLine(h)).filter(Boolean);
  const dataRows = (table.rows || []).slice(1); // table.rows includes header row at [0]

  if (headers.length === 0 || dataRows.length === 0) return [];

  const chunks: IngestedChunk[] = [];
  const headerBlock = `Headers: ${headers.join(" | ")}`;
  const baseTokens = estimateTokens(prefix) + estimateTokens(headerBlock) + 10;
  const budget = Math.max(200, maxTokens - baseTokens);

  let current: TableCell[][] = [];
  let currentTokens = 0;
  let partIndex = 0;

  const flush = () => {
    if (current.length === 0) return;
    const csv = tableRowsToCsv(headers, current);
    const body = `${headerBlock}\n\nCSV:\n${csv}`.trim();
    const content = `${prefix}\n\n${body}`.trim();
    const id = stableId("chunk", [filename, JSON.stringify(location), headingLine, "table", String(partIndex), content.slice(0, 200)]);
    chunks.push({
      id,
      kind: "document",
      filename,
      sourceId: buildSourceId({ filename, location, headingPath, tableTitle: title }),
      location,
      headingPath,
      content,
      rawContent: body,
      metadata: { kindLabel: "table", tableId: table.id, tableTitle: title },
    });
    current = [];
    currentTokens = 0;
    partIndex++;
  };

  for (const row of dataRows) {
    const rowText = row.slice(0, headers.length).map(c => safeOneLine(tableCellToText(c))).join(",");
    const rowTokens = estimateTokens(rowText) + 3;
    if (currentTokens + rowTokens > budget && current.length > 0) {
      flush();
    }
    current.push(row);
    currentTokens += rowTokens;
  }

  flush();
  return chunks;
}

export function ingestSemanticDocumentToChunks(args: {
  model: DocumentSemanticModel;
  mimeType: string;
  maxChunkTokens?: number;
}): { chunks: IngestedChunk[]; summary: IngestedDocumentSummary } {
  const { model, mimeType, maxChunkTokens = 650 } = args;
  const filename = model.documentMeta.fileName;
  const flattened = flattenSections(model.sections || []);

  const headingPreview = flattened
    .filter(s => s.type === "heading")
    .map(s => safeOneLine(s.title || s.content || ""))
    .filter(Boolean)
    .slice(0, 12);

  const summary: IngestedDocumentSummary = {
    docId: model.documentMeta.id,
    filename,
    mimeType,
    documentType: model.documentMeta.documentType,
    pageCount: model.documentMeta.pageCount,
    sheetCount: model.documentMeta.sheetCount,
    headingPreview,
    tableCount: model.tables?.length || 0,
    sectionCount: flattened.length,
    notes: model.extractionDiagnostics?.warnings || [],
  };

  const chunks: IngestedChunk[] = [];

  // Excel/csv: prioritize tables (sections might be empty)
  if (model.documentMeta.documentType === "excel" || model.documentMeta.documentType === "csv") {
    for (const table of model.tables || []) {
      const location: IngestedChunkLocation = {
        sheet: table.sheetName,
        page: table.pageNumber || undefined,
      };
      chunks.push(
        ...chunkTableWithContext({
          filename,
          location,
          headingPath: table.sheetName ? [table.sheetName] : [],
          table,
          maxTokens: maxChunkTokens,
        })
      );
    }
    return { chunks, summary };
  }

  // Word/pdf/text: walk sections and carry heading context
  let headingStack: string[] = [];

  for (const section of flattened) {
    const sourceRef = section.sourceRef || "";
    const location = parseSourceRefToLocation(sourceRef);

    if (section.type === "heading") {
      const title = safeOneLine(section.title || section.content || "");
      const level = section.level || 2;
      if (title) headingStack = updateHeadingStack(headingStack, level, title);

      // Keep headings as retrievable chunks (cheap anchors).
      if (title) {
        const content = `Type: heading\nHeading: ${title}\nHeadingPath: ${formatHeadingPath(headingStack)}`.trim();
        chunks.push({
          id: stableId("chunk", [filename, JSON.stringify(location), "heading", title]),
          kind: "document",
          filename,
          sourceId: buildSourceId({ filename, location, headingPath: headingStack }),
          location,
          headingPath: headingStack,
          content,
          rawContent: title,
          metadata: { kindLabel: "heading", level },
        });
      }
      continue;
    }

    if (section.type === "table" && section.tableRef) {
      const table = (model.tables || []).find(t => t.id === section.tableRef);
      if (table) {
        const loc: IngestedChunkLocation = {
          ...location,
          sheet: table.sheetName || location.sheet,
          page: table.pageNumber || location.page,
        };
        chunks.push(
          ...chunkTableWithContext({
            filename,
            location: loc,
            headingPath: headingStack,
            table,
            maxTokens: maxChunkTokens,
          })
        );
        continue;
      }
    }

    const rawText =
      section.content ||
      (Array.isArray(section.listItems) ? section.listItems.map(i => `- ${i}`).join("\n") : "") ||
      "";

    if (!rawText.trim()) continue;

    chunks.push(
      ...chunkTextWithContext({
        filename,
        location,
        headingPath: headingStack,
        rawText,
        kindLabel: section.type,
        maxTokens: maxChunkTokens,
      })
    );
  }

  // Fallback: if no chunks produced, include a minimal doc summary chunk.
  if (chunks.length === 0) {
    const content = `Type: document_summary\nFilename: ${filename}\nDocType: ${model.documentMeta.documentType}\nTables: ${model.tables?.length || 0}\nHeadings: ${headingPreview.join(" | ")}`.trim();
    chunks.push({
      id: stableId("chunk", [filename, "summary"]),
      kind: "document",
      filename,
      sourceId: `doc:${filename}`,
      location: {},
      headingPath: [],
      content,
      rawContent: content,
      metadata: { kindLabel: "document_summary" },
    });
  }

  return { chunks, summary };
}

