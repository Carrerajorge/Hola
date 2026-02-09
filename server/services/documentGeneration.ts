import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { JSDOM } from "jsdom";
import { generateWordFromMarkdown } from "./markdownToDocx";
import {
  ExcelStyleConfig,
  ExcelDashboardBuilder,
  type DashboardConfig
} from "../lib/excelStyles";

export interface DocumentContent {
  title: string;
  type: "word" | "excel" | "ppt";
  content: any;
}

export interface ProfessionalExcelOptions {
  useProfessionalStyles?: boolean;
  dashboard?: DashboardConfig;
  priorityColumn?: number;
  alternateRows?: boolean;
  freezeHeader?: boolean;
  autoFilter?: boolean;
}

// ============================================
// SECURITY CONSTANTS
// ============================================

/** Excel cell limits to prevent resource exhaustion */
const EXCEL_MAX_ROWS = 1_048_576; // Excel's own limit
const EXCEL_MAX_COLUMNS = 16_384; // Excel's own limit
const EXCEL_MAX_CELL_LENGTH = 32_767; // Excel's own cell char limit
const EXCEL_SAFE_MAX_ROWS = 100_000; // Practical generation limit
const EXCEL_SAFE_MAX_COLUMNS = 500;

/** Maximum content size for Word document generation (5MB) */
const WORD_MAX_CONTENT_SIZE = 5 * 1024 * 1024;

/**
 * Excel formula injection prefixes.
 * When spreadsheet applications encounter these at the start of a cell,
 * they may interpret the value as a formula, enabling DDE attacks,
 * data exfiltration via HYPERLINK(), or arbitrary command execution.
 */
const EXCEL_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

/**
 * Sanitize a cell value for safe inclusion in Excel documents.
 * Prevents formula injection / DDE attacks by prefixing dangerous
 * values with a single-quote character that Excel treats as text-prefix.
 */
function sanitizeExcelCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  // Truncate to Excel's cell character limit
  const bounded = value.length > EXCEL_MAX_CELL_LENGTH
    ? value.substring(0, EXCEL_MAX_CELL_LENGTH)
    : value;
  if (EXCEL_FORMULA_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    return `'${bounded}`;
  }
  return bounded;
}

/**
 * Sanitize all cells in a 2D data array for safe Excel generation.
 */
function sanitizeExcelData(data: any[][]): any[][] {
  return data.map(row =>
    row.map(cell => sanitizeExcelCell(cell))
  );
}

function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

function htmlToMarkdown(html: string): string {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  const katexElements = document.querySelectorAll('.katex');
  katexElements.forEach((katex) => {
    const annotation = katex.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation && annotation.textContent) {
      const latex = annotation.textContent;
      const isBlock = katex.closest('.math-display') || 
                     katex.closest('div.katex') ||
                     katex.closest('span.katex-display');
      const replacement = document.createTextNode(isBlock ? `$$${latex}$$` : `$${latex}$`);
      katex.replaceWith(replacement);
    }
  });
  
  const mathDisplays = document.querySelectorAll('.math-display, .katex-display');
  mathDisplays.forEach((el) => {
    const text = el.textContent || '';
    if (text.includes('$$')) {
      const replacement = document.createTextNode('\n\n' + text + '\n\n');
      el.replaceWith(replacement);
    }
  });
  
  function processNode(node: Node): string {
    if (node.nodeType === 3) {
      return node.textContent || '';
    }
    
    if (node.nodeType !== 1) return '';
    
    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    const children = Array.from(element.childNodes).map(processNode).join('');
    
    switch (tagName) {
      case 'p':
        return children.trim() + '\n\n';
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `**${children}**`;
      case 'em':
      case 'i':
        return `*${children}*`;
      case 'u':
        return children;
      case 'code':
        return `\`${children}\``;
      case 'h1':
        return `# ${children}\n\n`;
      case 'h2':
        return `## ${children}\n\n`;
      case 'h3':
        return `### ${children}\n\n`;
      case 'h4':
        return `#### ${children}\n\n`;
      case 'h5':
        return `##### ${children}\n\n`;
      case 'h6':
        return `###### ${children}\n\n`;
      case 'ul':
        return '\n' + Array.from(element.children)
          .map(li => `- ${processNode(li).trim()}`)
          .join('\n') + '\n\n';
      case 'ol':
        return '\n' + Array.from(element.children)
          .map((li, i) => `${i + 1}. ${processNode(li).trim()}`)
          .join('\n') + '\n\n';
      case 'li':
        return children;
      case 'blockquote':
        return children.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
      case 'pre':
        const codeEl = element.querySelector('code');
        const lang = codeEl?.className.match(/language-(\w+)/)?.[1] || '';
        return `\`\`\`${lang}\n${codeEl?.textContent || children}\n\`\`\`\n\n`;
      case 'a':
        const href = element.getAttribute('href') || '';
        return `[${children}](${href})`;
      case 'table':
        return processTable(element);
      case 'div':
      case 'span':
        return children;
      default:
        return children;
    }
  }
  
  function processTable(table: Element): string {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return '';
    
    let result = '';
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('th, td');
      const cellContents = Array.from(cells).map(cell => processNode(cell).trim());
      result += '| ' + cellContents.join(' | ') + ' |\n';
      
      if (rowIndex === 0) {
        result += '| ' + cellContents.map(() => '---').join(' | ') + ' |\n';
      }
    });
    
    return result + '\n';
  }
  
  return processNode(document.body).trim();
}

export async function generateWordDocument(title: string, content: string): Promise<Buffer> {
  // Security: enforce content size limit
  if (content.length > WORD_MAX_CONTENT_SIZE) {
    throw new Error(`Word document content exceeds maximum size of ${WORD_MAX_CONTENT_SIZE / (1024 * 1024)}MB`);
  }

  let markdownContent = content;

  if (isHtmlContent(content)) {
    markdownContent = htmlToMarkdown(content);
    console.log('[generateWordDocument] Converted HTML to Markdown for export');
  }

  return generateWordFromMarkdown(title, markdownContent);
}

export async function generateExcelDocument(
  title: string,
  data: any[][],
  options: ProfessionalExcelOptions = {}
): Promise<Buffer> {
  // Security: enforce row and column limits
  if (data.length > EXCEL_SAFE_MAX_ROWS) {
    throw new Error(`Excel data exceeds maximum row count of ${EXCEL_SAFE_MAX_ROWS}`);
  }
  const maxCols = data.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  if (maxCols > EXCEL_SAFE_MAX_COLUMNS) {
    throw new Error(`Excel data exceeds maximum column count of ${EXCEL_SAFE_MAX_COLUMNS}`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IliaGPT';
  workbook.created = new Date();
  // Security: strip potentially sensitive workbook metadata
  workbook.lastModifiedBy = '';
  workbook.company = '';
  workbook.manager = '';

  // Security: sanitize all cell data against formula injection
  const rawData = data.length > 0 ? data : [["Contenido"], ["No hay datos disponibles"]];
  const safeData = sanitizeExcelData(rawData);

  const styles = new ExcelStyleConfig();
  const dashboardBuilder = new ExcelDashboardBuilder(workbook, styles);

  if (options.dashboard) {
    dashboardBuilder.createDashboard(options.dashboard);
  }

  const sheetName = title.replace(/[\\/:*?\[\]]/g, "").slice(0, 31) || "Hoja1";
  const worksheet = workbook.addWorksheet(sheetName);

  if (options.useProfessionalStyles && safeData.length > 1) {
    const headers = safeData[0].map(h => String(h));
    const rows = safeData.slice(1);

    dashboardBuilder.applyProfessionalTableStyle(
      worksheet,
      1,
      headers,
      rows,
      {
        freezeHeader: options.freezeHeader ?? true,
        autoFilter: options.autoFilter ?? true,
        alternateRows: options.alternateRows ?? true,
        priorityColumn: options.priorityColumn,
      }
    );

    const colWidths = safeData[0]?.map((_, colIndex) => {
      const maxLength = Math.max(...safeData.map(row => String(row[colIndex] || "").length));
      return Math.min(Math.max(maxLength, 12), 60);
    }) || [];

    colWidths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });
  } else {
    worksheet.addRows(safeData);

    const colWidths = safeData[0]?.map((_, colIndex) => {
      const maxLength = Math.max(...safeData.map(row => String(row[colIndex] || "").length));
      return Math.min(Math.max(maxLength, 10), 50);
    }) || [];

    worksheet.columns = colWidths.map((width, index) => ({
      key: String.fromCharCode(65 + index),
      width: width
    }));
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function generateProfessionalDashboard(config: DashboardConfig): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IliaGPT';
  workbook.created = new Date();
  
  const styles = new ExcelStyleConfig();
  const builder = new ExcelDashboardBuilder(workbook, styles);
  builder.createDashboard(config);
  
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// PPT generation limits
const MAX_PPT_SLIDES = 200;
const MAX_PPT_TITLE_LENGTH = 500;
const MAX_PPT_CONTENT_ITEM_LENGTH = 5000;
const MAX_PPT_CONTENT_ITEMS = 20;
const MAX_PPT_TEXT_ELEMENTS_PER_SLIDE = 50;
const MAX_PPT_TOTAL_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB total text content

/**
 * Sanitize text content for PPT slides.
 * Strips control characters and null bytes that could corrupt the PPTX.
 */
function sanitizePptText(text: string): string {
  return text
    // Remove null bytes
    .replace(/\0/g, "")
    // Remove control characters except common whitespace
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export async function generatePptDocument(title: string, slides: { title: string; content: string[] }[]): Promise<Buffer> {
  // Input validation
  if (!title || typeof title !== "string") {
    throw new Error("PPT title is required");
  }
  if (title.length > MAX_PPT_TITLE_LENGTH) {
    throw new Error(`PPT title exceeds maximum length of ${MAX_PPT_TITLE_LENGTH} characters`);
  }
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error("At least one slide is required");
  }
  if (slides.length > MAX_PPT_SLIDES) {
    throw new Error(`Too many slides: ${slides.length}. Maximum is ${MAX_PPT_SLIDES}`);
  }

  // Security: enforce total content size to prevent memory exhaustion
  let totalContentSize = title.length;
  for (const slide of slides) {
    totalContentSize += (slide.title || "").length;
    if (Array.isArray(slide.content)) {
      for (const item of slide.content) {
        totalContentSize += typeof item === "string" ? item.length : String(item).length;
      }
    }
    if (totalContentSize > MAX_PPT_TOTAL_CONTENT_SIZE) {
      throw new Error(`PPT total content size exceeds maximum of ${MAX_PPT_TOTAL_CONTENT_SIZE / (1024 * 1024)}MB`);
    }
  }

  const pptx = new PptxGenJS();
  pptx.title = sanitizePptText(title.substring(0, MAX_PPT_TITLE_LENGTH));
  pptx.author = "IliaGPT";
  // Security: don't include user-identifiable info in metadata
  pptx.company = "";
  pptx.subject = "";

  const titleSlide = pptx.addSlide();
  titleSlide.addText(sanitizePptText(title.substring(0, MAX_PPT_TITLE_LENGTH)), {
    x: 0.5,
    y: 2,
    w: 9,
    h: 1.5,
    fontSize: 44,
    bold: true,
    color: "363636",
    align: "center",
    fontFace: "Arial",
  });

  for (const slide of slides) {
    const s = pptx.addSlide();

    // Sanitize and truncate slide title
    const slideTitle = sanitizePptText((slide.title || "").substring(0, MAX_PPT_TITLE_LENGTH));
    s.addText(slideTitle, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 32,
      bold: true,
      color: "363636",
      fontFace: "Arial",
    });

    // Validate and truncate content items
    const safeContent = Array.isArray(slide.content)
      ? slide.content.slice(0, MAX_PPT_CONTENT_ITEMS)
      : [];

    if (safeContent.length > 0) {
      const bulletPoints = safeContent.map(text => ({
        text: sanitizePptText(
          (typeof text === "string" ? text : String(text)).substring(0, MAX_PPT_CONTENT_ITEM_LENGTH)
        ),
        options: { bullet: true, fontSize: 18, color: "666666" },
      }));

      s.addText(bulletPoints, {
        x: 0.5,
        y: 1.3,
        w: 9,
        h: 4,
        fontFace: "Arial",
        valign: "top",
      });
    }
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  return buffer as Buffer;
}

export function parseExcelFromText(text: string): any[][] {
  // Security: limit input text size
  const safeText = text.length > WORD_MAX_CONTENT_SIZE
    ? text.substring(0, WORD_MAX_CONTENT_SIZE)
    : text;
  const lines = safeText.trim().split("\n");
  const data: any[][] = [];

  for (const line of lines) {
    // Security: enforce row limit
    if (data.length >= EXCEL_SAFE_MAX_ROWS) {
      console.warn(`[parseExcelFromText] Row limit reached (${EXCEL_SAFE_MAX_ROWS}), truncating`);
      break;
    }

    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    let cells: string[];
    if (trimmedLine.includes("|")) {
      cells = trimmedLine.split("|").map(cell => cell.trim()).filter(cell => cell && !cell.match(/^-+$/));
    } else if (trimmedLine.includes(",")) {
      cells = trimmedLine.split(",").map(cell => cell.trim());
      if (cells.length <= 1) {
        cells = [trimmedLine];
      }
    } else if (trimmedLine.includes("\t")) {
      cells = trimmedLine.split("\t").map(cell => cell.trim());
    } else if (trimmedLine.includes(";")) {
      cells = trimmedLine.split(";").map(cell => cell.trim());
    } else {
      cells = [trimmedLine];
    }

    // Security: enforce column limit and cell length limit
    if (cells.length > EXCEL_SAFE_MAX_COLUMNS) {
      cells = cells.slice(0, EXCEL_SAFE_MAX_COLUMNS);
    }
    cells = cells.map(c => c.length > EXCEL_MAX_CELL_LENGTH ? c.substring(0, EXCEL_MAX_CELL_LENGTH) : c);

    if (cells.length > 0) {
      data.push(cells);
    }
  }

  if (data.length === 0) {
    data.push(["Contenido"], [safeText.slice(0, 500)]);
  }

  return data;
}

export function parseSlidesFromText(text: string): { title: string; content: string[] }[] {
  const slides: { title: string; content: string[] }[] = [];
  const sections = text.split(/(?=^##?\s)/m);
  
  for (const section of sections) {
    const lines = section.trim().split("\n");
    if (lines.length === 0) continue;
    
    let title = lines[0].replace(/^#+\s*/, "").trim();
    if (!title) continue;
    
    const content: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.match(/^-+$/)) {
        content.push(line.replace(/^[-*•\d.)\s]+/, "").trim() || line);
      }
    }
    
    if (content.length > 0 || slides.length === 0) {
      slides.push({ title, content: content.length > 0 ? content : [""] });
    }
  }
  
  if (slides.length === 0) {
    const lines = text.split("\n").filter(l => l.trim());
    const maxSlideContent = 6;
    
    for (let i = 0; i < lines.length; i += maxSlideContent) {
      const chunk = lines.slice(i, i + maxSlideContent);
      slides.push({
        title: chunk[0]?.replace(/^[-*•\d.)\s]+/, "").trim() || `Diapositiva ${slides.length + 1}`,
        content: chunk.slice(1).map(l => l.replace(/^[-*•\d.)\s]+/, "").trim() || l),
      });
    }
    
    if (slides.length === 0) {
      slides.push({ title: "Presentación", content: [text.slice(0, 200)] });
    }
  }
  
  return slides;
}
