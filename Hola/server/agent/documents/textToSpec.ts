/**
 * Text-to-Spec Adapters — Convert raw LLM output (markdown, CSV, JSON)
 * into DocumentEngine spec format for compilation.
 *
 * These adapters bridge the streaming chat path (which receives raw text)
 * with the spec-driven compiler pipeline.
 */

import type { DocumentSpec, WorkbookSpec, PresentationSpec } from "./documentEngine";

/* ================================================================== */
/*  SECURITY CONSTANTS                                                 */
/* ================================================================== */

const MAX_SECTIONS = 200;
const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 500;
const MAX_CELL_LENGTH = 32_767;
const MAX_SLIDES = 200;
const MAX_SLIDE_TITLE_LENGTH = 500;
const MAX_BULLET_LENGTH = 5000;
const MAX_BULLETS_PER_SLIDE = 20;

const EXCEL_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

/* ================================================================== */
/*  UTF-8 / SANITIZATION                                               */
/* ================================================================== */

function sanitizeText(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function sanitizeExcelCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  const bounded = value.length > MAX_CELL_LENGTH
    ? value.substring(0, MAX_CELL_LENGTH)
    : value;
  if (EXCEL_FORMULA_PREFIXES.some(p => trimmed.startsWith(p))) {
    return `'${bounded}`;
  }
  return bounded;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.substring(0, max - 1) + "…";
}

/* ================================================================== */
/*  MARKDOWN → DOCX SPEC                                              */
/* ================================================================== */

export function markdownToDocSpec(title: string, markdown: string): DocumentSpec {
  const safeContent = markdown.length > MAX_CONTENT_SIZE
    ? markdown.substring(0, MAX_CONTENT_SIZE)
    : markdown;

  const sections: DocumentSpec["sections"] = [];
  const lines = safeContent.split("\n");
  let currentParagraph = "";

  function flushParagraph() {
    if (currentParagraph.trim()) {
      sections.push({
        type: "paragraph",
        content: sanitizeText(currentParagraph.trim()),
      });
      currentParagraph = "";
    }
  }

  for (let i = 0; i < lines.length && sections.length < MAX_SECTIONS; i++) {
    const line = lines[i];

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      flushParagraph();
      sections.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: sanitizeText(headingMatch[2].trim()),
      });
      continue;
    }

    // Horizontal rule → page break
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      sections.push({ type: "pageBreak", content: "" });
      continue;
    }

    // Bullet list items
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      const bullets: string[] = [sanitizeText(line.replace(/^\s*[-*+]\s+/, ""))];
      while (i + 1 < lines.length && /^\s*[-*+]\s+/.test(lines[i + 1])) {
        i++;
        bullets.push(sanitizeText(lines[i].replace(/^\s*[-*+]\s+/, "")));
      }
      sections.push({ type: "bullets", content: bullets });
      continue;
    }

    // Numbered list items
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [sanitizeText(line.replace(/^\s*\d+[.)]\s+/, ""))];
      while (i + 1 < lines.length && /^\s*\d+[.)]\s+/.test(lines[i + 1])) {
        i++;
        items.push(sanitizeText(lines[i].replace(/^\s*\d+[.)]\s+/, "")));
      }
      sections.push({ type: "numberedList", content: items });
      continue;
    }

    // Blockquote
    if (/^>\s+/.test(line)) {
      flushParagraph();
      let quoteText = line.replace(/^>\s+/, "");
      while (i + 1 < lines.length && /^>\s+/.test(lines[i + 1])) {
        i++;
        quoteText += " " + lines[i].replace(/^>\s+/, "");
      }
      sections.push({ type: "quote", content: sanitizeText(quoteText) });
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      flushParagraph();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      sections.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    // Table (pipe-delimited)
    if (line.includes("|") && line.trim().startsWith("|")) {
      flushParagraph();
      const tableRows: string[][] = [];
      let j = i;
      while (j < lines.length && lines[j].includes("|")) {
        const row = lines[j]
          .split("|")
          .map(c => c.trim())
          .filter(c => c && !c.match(/^-+$/));
        if (row.length > 0) {
          tableRows.push(row.map(c => sanitizeText(c)));
        }
        j++;
      }
      i = j - 1;
      if (tableRows.length > 0) {
        sections.push({ type: "table", content: tableRows });
      }
      continue;
    }

    // Empty line → flush paragraph
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    // Regular text → accumulate into paragraph
    currentParagraph += (currentParagraph ? " " : "") + line;
  }

  flushParagraph();

  return {
    format: "docx" as const,
    title: sanitizeText(title),
    author: "IliaGPT",
    sections,
  };
}

/* ================================================================== */
/*  CSV → XLSX SPEC                                                    */
/* ================================================================== */

export function csvToWorkbookSpec(title: string, csv: string): WorkbookSpec {
  const safeText = csv.length > MAX_CONTENT_SIZE
    ? csv.substring(0, MAX_CONTENT_SIZE)
    : csv;

  const lines = safeText.trim().split("\n");
  const parsedRows: any[][] = [];

  for (const line of lines) {
    if (parsedRows.length >= MAX_ROWS) break;
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    let cells: string[];
    if (trimmedLine.includes("|")) {
      cells = trimmedLine.split("|").map(c => c.trim()).filter(c => c && !c.match(/^-+$/));
    } else if (trimmedLine.includes(",")) {
      cells = trimmedLine.split(",").map(c => c.trim());
      if (cells.length <= 1) cells = [trimmedLine];
    } else if (trimmedLine.includes("\t")) {
      cells = trimmedLine.split("\t").map(c => c.trim());
    } else if (trimmedLine.includes(";")) {
      cells = trimmedLine.split(";").map(c => c.trim());
    } else {
      cells = [trimmedLine];
    }

    if (cells.length > MAX_COLUMNS) cells = cells.slice(0, MAX_COLUMNS);
    cells = cells.map(c => String(sanitizeExcelCell(c)));
    if (cells.length > 0) parsedRows.push(cells);
  }

  if (parsedRows.length === 0) {
    parsedRows.push(["Contenido"]);
    parsedRows.push([safeText.slice(0, 500)]);
  }

  // First row = headers, rest = data
  const headers = parsedRows[0];
  const dataRows = parsedRows.slice(1);

  const columns = headers.map((h, idx) => ({
    key: `col_${idx}`,
    header: sanitizeText(String(h)),
    type: "string" as const,
    width: Math.min(Math.max(String(h).length + 4, 12), 60),
  }));

  const rows = dataRows.map(row => {
    const obj: Record<string, any> = {};
    for (let c = 0; c < columns.length; c++) {
      const val = c < row.length ? row[c] : "";
      // Auto-detect numbers
      const num = Number(val);
      obj[columns[c].key] = !isNaN(num) && val.trim() !== "" ? num : val;
    }
    return obj;
  });

  return {
    format: "xlsx" as const,
    title: sanitizeText(title),
    author: "IliaGPT",
    sheets: [{
      name: sanitizeText(title).substring(0, 31) || "Sheet1",
      columns,
      rows,
      formulas: [],
      filters: true,
      freezeRow: 1,
      freezeCol: 0,
      protection: false,
    }],
  };
}

/* ================================================================== */
/*  JSON/MARKDOWN → PPTX SPEC                                         */
/* ================================================================== */

export function jsonToPresentationSpec(
  title: string,
  input: string
): PresentationSpec {
  const safeTitle = truncate(sanitizeText(title), MAX_SLIDE_TITLE_LENGTH);

  // Try JSON parse first
  let rawSlides: Array<{ title?: string; bullets?: string[]; content?: string[] }> = [];
  try {
    const stripped = input.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(stripped);
    rawSlides = Array.isArray(parsed) ? parsed : parsed.slides || [parsed];
  } catch {
    // Fallback: parse as markdown slides
    return markdownToPresentationSpec(title, input);
  }

  if (rawSlides.length > MAX_SLIDES) rawSlides = rawSlides.slice(0, MAX_SLIDES);

  const slides: PresentationSpec["slides"] = [];

  // Title slide
  slides.push({
    type: "cover",
    components: [
      { type: "title", content: safeTitle },
      { type: "subtitle", content: `Generated by IliaGPT` },
    ],
  });

  for (const raw of rawSlides) {
    const slideTitle = truncate(sanitizeText(raw.title || ""), MAX_SLIDE_TITLE_LENGTH);
    const bullets = (raw.bullets || raw.content || [])
      .slice(0, MAX_BULLETS_PER_SLIDE)
      .map(b => truncate(sanitizeText(String(b)), MAX_BULLET_LENGTH));

    slides.push({
      type: "content",
      components: [
        { type: "title", content: slideTitle },
        ...(bullets.length > 0
          ? [{ type: "bullets" as const, content: bullets }]
          : []),
      ],
    });
  }

  return {
    format: "pptx" as const,
    title: safeTitle,
    author: "IliaGPT",
    slides,
  };
}

/**
 * Parse markdown-style slides (## headers split slides)
 */
export function markdownToPresentationSpec(
  title: string,
  markdown: string
): PresentationSpec {
  const safeTitle = truncate(sanitizeText(title), MAX_SLIDE_TITLE_LENGTH);
  const sections = markdown.split(/(?=^##?\s)/m);
  const slides: PresentationSpec["slides"] = [];

  // Title slide
  slides.push({
    type: "cover",
    components: [
      { type: "title", content: safeTitle },
      { type: "subtitle", content: "Generated by IliaGPT" },
    ],
  });

  for (const section of sections) {
    if (slides.length >= MAX_SLIDES) break;
    const lines = section.trim().split("\n");
    if (lines.length === 0) continue;

    const slideTitle = truncate(
      sanitizeText(lines[0].replace(/^#+\s*/, "").trim()),
      MAX_SLIDE_TITLE_LENGTH
    );
    if (!slideTitle) continue;

    const bullets: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const bullet = line.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "");
      if (bullet) {
        bullets.push(truncate(sanitizeText(bullet), MAX_BULLET_LENGTH));
      }
      if (bullets.length >= MAX_BULLETS_PER_SLIDE) break;
    }

    slides.push({
      type: "content",
      components: [
        { type: "title", content: slideTitle },
        ...(bullets.length > 0
          ? [{ type: "bullets" as const, content: bullets }]
          : []),
      ],
    });
  }

  // Ensure at least one content slide
  if (slides.length <= 1) {
    const chunks = markdown.match(/.{1,200}/g) || [markdown.slice(0, 200)];
    const slideChunks = chunks.slice(0, 6);
    slides.push({
      type: "content",
      components: [
        { type: "title", content: safeTitle },
        { type: "bullets", content: slideChunks.map(c => sanitizeText(c.trim())) },
      ],
    });
  }

  return {
    format: "pptx" as const,
    title: safeTitle,
    author: "IliaGPT",
    slides,
  };
}
