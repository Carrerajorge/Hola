/**
 * Enterprise Document Generator Service
 * Unified professional document generation for Word, Excel, PowerPoint, and PDF
 * 
 * Features:
 * - Professional templates
 * - Web research integration
 * - Charts and tables
 * - Images and diagrams
 * - Multi-language support
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, convertInchesToTwip, Header, Footer,
  PageNumber, NumberFormat, ExternalHyperlink, ImageRun, TableOfContents,
  IStylesOptions, INumberingOptions, IDocumentOptions
} from "docx";
import ExcelJS from "exceljs";
import type { Workbook, Worksheet, Style } from "exceljs";

// ============================================
// TYPES & INTERFACES
// ============================================

export interface DocumentTheme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    muted: string;
  };
  fonts: {
    heading: string;
    body: string;
    code: string;
  };
  sizes: {
    h1: number;
    h2: number;
    h3: number;
    body: number;
    small: number;
  };
}

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  level: 1 | 2 | 3;
  subsections?: DocumentSection[];
  tables?: TableData[];
  images?: ImageData[];
  lists?: ListData[];
}

export interface TableData {
  headers: string[];
  rows: string[][];
  caption?: string;
  style?: "default" | "striped" | "bordered" | "minimal";
}

export interface ImageData {
  url?: string;
  base64?: string;
  width: number;
  height: number;
  caption?: string;
  alt: string;
}

export interface ListData {
  items: string[];
  type: "bullet" | "numbered";
  nested?: ListData[];
}

export interface ChartData {
  type: "bar" | "line" | "pie" | "area" | "scatter";
  title: string;
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}

export interface DocumentRequest {
  type: "docx" | "xlsx" | "pptx" | "pdf";
  title: string;
  subtitle?: string;
  author?: string;
  theme?: string;
  language?: string;
  sections: DocumentSection[];
  charts?: ChartData[];
  metadata?: Record<string, string>;
  options?: {
    includeTableOfContents?: boolean;
    includePageNumbers?: boolean;
    includeHeader?: boolean;
    includeFooter?: boolean;
    pageSize?: "letter" | "a4" | "legal";
    orientation?: "portrait" | "landscape";
  };
}

export interface DocumentResult {
  success: boolean;
  buffer?: Buffer;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  error?: string;
}

// ============================================
// THEMES
// ============================================

export const DOCUMENT_THEMES: Record<string, DocumentTheme> = {
  professional: {
    name: "Professional",
    colors: {
      primary: "1A365D",
      secondary: "2C5282",
      accent: "3182CE",
      background: "FFFFFF",
      text: "1A202C",
      muted: "718096",
    },
    fonts: {
      heading: "Calibri",
      body: "Calibri",
      code: "Consolas",
    },
    sizes: { h1: 28, h2: 22, h3: 16, body: 11, small: 9 },
  },
  academic: {
    name: "Academic",
    colors: {
      primary: "2D3748",
      secondary: "4A5568",
      accent: "805AD5",
      background: "FFFFFF",
      text: "1A202C",
      muted: "A0AEC0",
    },
    fonts: {
      heading: "Times New Roman",
      body: "Times New Roman",
      code: "Courier New",
    },
    sizes: { h1: 24, h2: 18, h3: 14, body: 12, small: 10 },
  },
  modern: {
    name: "Modern",
    colors: {
      primary: "1A202C",
      secondary: "2D3748",
      accent: "38B2AC",
      background: "FFFFFF",
      text: "1A202C",
      muted: "718096",
    },
    fonts: {
      heading: "Arial",
      body: "Arial",
      code: "Monaco",
    },
    sizes: { h1: 32, h2: 24, h3: 18, body: 11, small: 9 },
  },
  corporate: {
    name: "Corporate",
    colors: {
      primary: "0066CC",
      secondary: "004499",
      accent: "FF9900",
      background: "FFFFFF",
      text: "333333",
      muted: "666666",
    },
    fonts: {
      heading: "Arial",
      body: "Calibri",
      code: "Consolas",
    },
    sizes: { h1: 26, h2: 20, h3: 14, body: 11, small: 9 },
  },
  elegant: {
    name: "Elegant",
    colors: {
      primary: "2C3E50",
      secondary: "34495E",
      accent: "9B59B6",
      background: "FFFFFF",
      text: "2C3E50",
      muted: "7F8C8D",
    },
    fonts: {
      heading: "Georgia",
      body: "Georgia",
      code: "Courier New",
    },
    sizes: { h1: 28, h2: 22, h3: 16, body: 11, small: 9 },
  },
  minimal: {
    name: "Minimal",
    colors: {
      primary: "000000",
      secondary: "333333",
      accent: "666666",
      background: "FFFFFF",
      text: "000000",
      muted: "999999",
    },
    fonts: {
      heading: "Helvetica",
      body: "Helvetica",
      code: "Menlo",
    },
    sizes: { h1: 24, h2: 18, h3: 14, body: 10, small: 8 },
  },
};

// ============================================
// WORD DOCUMENT GENERATOR
// ============================================

export class WordDocumentGenerator {
  private theme: DocumentTheme;

  constructor(themeName: string = "professional") {
    this.theme = DOCUMENT_THEMES[themeName] || DOCUMENT_THEMES.professional;
  }

  async generate(request: DocumentRequest): Promise<DocumentResult> {
    try {
      const children: (Paragraph | Table | TableOfContents)[] = [];

      // Title page
      children.push(...this.createTitlePage(request));

      // Table of contents
      if (request.options?.includeTableOfContents !== false) {
        children.push(new Paragraph({ children: [], pageBreakBefore: true }));
        children.push(this.createTableOfContents());
      }

      // Sections
      for (const section of request.sections) {
        children.push(new Paragraph({ children: [], pageBreakBefore: true }));
        children.push(...this.renderSection(section));
      }

      const doc = new Document({
        styles: this.getStyles(),
        sections: [{
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(1.25),
                right: convertInchesToTwip(1),
              },
            },
          },
          headers: request.options?.includeHeader !== false ? {
            default: this.createHeader(request.title),
          } : undefined,
          footers: request.options?.includeFooter !== false ? {
            default: this.createFooter(),
          } : undefined,
          children,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      const filename = `${this.sanitizeFilename(request.title)}.docx`;

      return {
        success: true,
        buffer: Buffer.from(buffer),
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: buffer.byteLength,
      };
    } catch (error: any) {
      return {
        success: false,
        filename: "",
        mimeType: "",
        sizeBytes: 0,
        error: error.message,
      };
    }
  }

  private createTitlePage(request: DocumentRequest): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    // Spacer
    for (let i = 0; i < 8; i++) {
      paragraphs.push(new Paragraph({ children: [] }));
    }

    // Title
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: request.title,
          bold: true,
          size: this.theme.sizes.h1 * 2,
          font: this.theme.fonts.heading,
          color: this.theme.colors.primary,
        }),
      ],
    }));

    // Subtitle
    if (request.subtitle) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
        children: [
          new TextRun({
            text: request.subtitle,
            size: this.theme.sizes.h2 * 2,
            font: this.theme.fonts.heading,
            color: this.theme.colors.secondary,
          }),
        ],
      }));
    }

    // Author
    if (request.author) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 800 },
        children: [
          new TextRun({
            text: `Por: ${request.author}`,
            size: this.theme.sizes.body * 2,
            font: this.theme.fonts.body,
            color: this.theme.colors.muted,
          }),
        ],
      }));
    }

    // Date
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
      children: [
        new TextRun({
          text: new Date().toLocaleDateString("es-ES", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          size: this.theme.sizes.body * 2,
          font: this.theme.fonts.body,
          color: this.theme.colors.muted,
        }),
      ],
    }));

    return paragraphs;
  }

  private createTableOfContents(): TableOfContents {
    return new TableOfContents("Tabla de Contenidos", {
      hyperlink: true,
      headingStyleRange: "1-3",
    });
  }

  private renderSection(section: DocumentSection): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = [];

    // Heading
    const headingLevel = section.level === 1 ? HeadingLevel.HEADING_1 :
                         section.level === 2 ? HeadingLevel.HEADING_2 :
                         HeadingLevel.HEADING_3;

    elements.push(new Paragraph({
      heading: headingLevel,
      spacing: { before: 400, after: 200 },
      children: [
        new TextRun({
          text: section.title,
          bold: true,
          size: (section.level === 1 ? this.theme.sizes.h1 :
                 section.level === 2 ? this.theme.sizes.h2 :
                 this.theme.sizes.h3) * 2,
          font: this.theme.fonts.heading,
          color: this.theme.colors.primary,
        }),
      ],
    }));

    // Content paragraphs
    const paragraphs = section.content.split("\n\n");
    for (const para of paragraphs) {
      if (para.trim()) {
        elements.push(new Paragraph({
          spacing: { after: 200, line: 360 },
          children: [
            new TextRun({
              text: para.trim(),
              size: this.theme.sizes.body * 2,
              font: this.theme.fonts.body,
              color: this.theme.colors.text,
            }),
          ],
        }));
      }
    }

    // Tables
    if (section.tables) {
      for (const table of section.tables) {
        elements.push(this.createTable(table));
      }
    }

    // Lists
    if (section.lists) {
      for (const list of section.lists) {
        elements.push(...this.createList(list));
      }
    }

    // Subsections
    if (section.subsections) {
      for (const subsection of section.subsections) {
        elements.push(...this.renderSection(subsection));
      }
    }

    return elements;
  }

  private createTable(data: TableData): Table {
    const rows: TableRow[] = [];

    // Header row
    rows.push(new TableRow({
      tableHeader: true,
      children: data.headers.map(header => new TableCell({
        shading: { fill: this.theme.colors.primary },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: header,
            bold: true,
            color: "FFFFFF",
            size: this.theme.sizes.body * 2,
            font: this.theme.fonts.body,
          })],
        })],
      })),
    }));

    // Data rows
    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      const isAlternate = i % 2 === 1;
      
      rows.push(new TableRow({
        children: row.map(cell => new TableCell({
          shading: isAlternate && data.style === "striped" ? { fill: "F7FAFC" } : undefined,
          children: [new Paragraph({
            children: [new TextRun({
              text: cell,
              size: this.theme.sizes.body * 2,
              font: this.theme.fonts.body,
              color: this.theme.colors.text,
            })],
          })],
        })),
      }));
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    });
  }

  private createList(data: ListData): Paragraph[] {
    return data.items.map((item, index) => new Paragraph({
      bullet: data.type === "bullet" ? { level: 0 } : undefined,
      numbering: data.type === "numbered" ? { reference: "default-numbering", level: 0 } : undefined,
      children: [new TextRun({
        text: item,
        size: this.theme.sizes.body * 2,
        font: this.theme.fonts.body,
        color: this.theme.colors.text,
      })],
    }));
  }

  private createHeader(title: string): Header {
    return new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              text: title,
              size: this.theme.sizes.small * 2,
              font: this.theme.fonts.body,
              color: this.theme.colors.muted,
            }),
          ],
        }),
      ],
    });
  }

  private createFooter(): Footer {
    return new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES],
              size: this.theme.sizes.small * 2,
              font: this.theme.fonts.body,
              color: this.theme.colors.muted,
            }),
          ],
        }),
      ],
    });
  }

  private getStyles(): IStylesOptions {
    return {
      default: {
        document: {
          run: {
            font: this.theme.fonts.body,
            size: this.theme.sizes.body * 2,
          },
        },
        heading1: {
          run: {
            font: this.theme.fonts.heading,
            size: this.theme.sizes.h1 * 2,
            bold: true,
            color: this.theme.colors.primary,
          },
        },
        heading2: {
          run: {
            font: this.theme.fonts.heading,
            size: this.theme.sizes.h2 * 2,
            bold: true,
            color: this.theme.colors.secondary,
          },
        },
        heading3: {
          run: {
            font: this.theme.fonts.heading,
            size: this.theme.sizes.h3 * 2,
            bold: true,
            color: this.theme.colors.text,
          },
        },
      },
    };
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 50);
  }
}

// ============================================
// EXCEL DOCUMENT GENERATOR
// ============================================

export class ExcelDocumentGenerator {
  private theme: DocumentTheme;

  constructor(themeName: string = "professional") {
    this.theme = DOCUMENT_THEMES[themeName] || DOCUMENT_THEMES.professional;
  }

  async generate(request: DocumentRequest): Promise<DocumentResult> {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = request.author || "IliaGPT";
      workbook.created = new Date();
      workbook.modified = new Date();

      // Summary sheet
      const summarySheet = workbook.addWorksheet("Resumen");
      this.createSummarySheet(summarySheet, request);

      // Data sheets from sections
      for (const section of request.sections) {
        if (section.tables && section.tables.length > 0) {
          for (const table of section.tables) {
            const sheetName = this.sanitizeSheetName(section.title);
            const sheet = workbook.addWorksheet(sheetName);
            this.createDataSheet(sheet, table, section.title);
          }
        }
      }

      // Charts sheet
      if (request.charts && request.charts.length > 0) {
        const chartSheet = workbook.addWorksheet("Gráficos");
        this.createChartDataSheet(chartSheet, request.charts);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `${this.sanitizeFilename(request.title)}.xlsx`;

      return {
        success: true,
        buffer: Buffer.from(buffer),
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: buffer.byteLength,
      };
    } catch (error: any) {
      return {
        success: false,
        filename: "",
        mimeType: "",
        sizeBytes: 0,
        error: error.message,
      };
    }
  }

  private createSummarySheet(sheet: Worksheet, request: DocumentRequest): void {
    // Title
    sheet.mergeCells("A1:E1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = request.title;
    titleCell.font = {
      size: 18,
      bold: true,
      color: { argb: this.theme.colors.primary },
    };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;

    // Subtitle
    if (request.subtitle) {
      sheet.mergeCells("A2:E2");
      const subtitleCell = sheet.getCell("A2");
      subtitleCell.value = request.subtitle;
      subtitleCell.font = { size: 12, color: { argb: this.theme.colors.muted } };
      subtitleCell.alignment = { horizontal: "center" };
    }

    // Metadata
    let row = 4;
    const metadata = [
      ["Autor", request.author || "IliaGPT"],
      ["Fecha", new Date().toLocaleDateString("es-ES")],
      ["Secciones", request.sections.length.toString()],
    ];

    for (const [label, value] of metadata) {
      sheet.getCell(`A${row}`).value = label;
      sheet.getCell(`A${row}`).font = { bold: true };
      sheet.getCell(`B${row}`).value = value;
      row++;
    }

    // Table of contents
    row += 2;
    sheet.getCell(`A${row}`).value = "Contenido:";
    sheet.getCell(`A${row}`).font = { bold: true, size: 14 };
    row++;

    for (const section of request.sections) {
      sheet.getCell(`A${row}`).value = `• ${section.title}`;
      row++;
    }

    // Adjust column widths
    sheet.getColumn("A").width = 25;
    sheet.getColumn("B").width = 40;
  }

  private createDataSheet(sheet: Worksheet, table: TableData, title: string): void {
    // Title
    sheet.mergeCells(1, 1, 1, table.headers.length);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { size: 14, bold: true, color: { argb: this.theme.colors.primary } };
    titleCell.alignment = { horizontal: "center" };
    sheet.getRow(1).height = 25;

    // Headers
    const headerRow = sheet.getRow(3);
    table.headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: this.theme.colors.primary },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    });
    headerRow.height = 22;

    // Data rows
    table.rows.forEach((row, rowIndex) => {
      const excelRow = sheet.getRow(4 + rowIndex);
      const isAlternate = rowIndex % 2 === 1;
      
      row.forEach((value, colIndex) => {
        const cell = excelRow.getCell(colIndex + 1);
        
        // Try to parse as number
        const numValue = parseFloat(value);
        cell.value = isNaN(numValue) ? value : numValue;
        
        if (isAlternate) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "F7FAFC" },
          };
        }
        
        cell.border = {
          top: { style: "thin", color: { argb: "E2E8F0" } },
          bottom: { style: "thin", color: { argb: "E2E8F0" } },
          left: { style: "thin", color: { argb: "E2E8F0" } },
          right: { style: "thin", color: { argb: "E2E8F0" } },
        };
      });
    });

    // Auto-fit columns
    table.headers.forEach((_, index) => {
      const column = sheet.getColumn(index + 1);
      column.width = Math.max(12, table.headers[index].length + 4);
    });

    // Add formulas for numeric columns
    this.addSummaryFormulas(sheet, table, 4 + table.rows.length);
  }

  private addSummaryFormulas(sheet: Worksheet, table: TableData, startRow: number): void {
    const formulas = ["SUMA", "PROMEDIO", "MÁX", "MÍN"];
    const formulaNames = ["SUM", "AVERAGE", "MAX", "MIN"];
    
    // Skip a row
    const summaryStart = startRow + 2;
    
    sheet.getCell(summaryStart, 1).value = "Resumen:";
    sheet.getCell(summaryStart, 1).font = { bold: true };

    // Detect numeric columns and add formulas
    table.headers.forEach((header, colIndex) => {
      const firstValue = table.rows[0]?.[colIndex];
      if (firstValue && !isNaN(parseFloat(firstValue))) {
        formulaNames.forEach((formula, formulaIndex) => {
          const row = summaryStart + 1 + formulaIndex;
          const col = colIndex + 1;
          const colLetter = this.getColumnLetter(col);
          
          sheet.getCell(row, 1).value = formulas[formulaIndex];
          sheet.getCell(row, 1).font = { italic: true };
          
          sheet.getCell(row, col).value = {
            formula: `${formula}(${colLetter}4:${colLetter}${startRow - 1})`,
          };
          sheet.getCell(row, col).numFmt = "#,##0.00";
        });
      }
    });
  }

  private createChartDataSheet(sheet: Worksheet, charts: ChartData[]): void {
    let row = 1;
    
    for (const chart of charts) {
      // Chart title
      sheet.getCell(row, 1).value = chart.title;
      sheet.getCell(row, 1).font = { bold: true, size: 14 };
      row += 2;

      // Headers (Labels + Dataset names)
      sheet.getCell(row, 1).value = "Categoría";
      sheet.getCell(row, 1).font = { bold: true };
      chart.datasets.forEach((dataset, index) => {
        sheet.getCell(row, index + 2).value = dataset.label;
        sheet.getCell(row, index + 2).font = { bold: true };
      });
      row++;

      // Data
      chart.labels.forEach((label, labelIndex) => {
        sheet.getCell(row, 1).value = label;
        chart.datasets.forEach((dataset, datasetIndex) => {
          sheet.getCell(row, datasetIndex + 2).value = dataset.data[labelIndex];
        });
        row++;
      });

      row += 3; // Space between charts
    }
  }

  private getColumnLetter(col: number): string {
    let letter = "";
    while (col > 0) {
      const remainder = (col - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      col = Math.floor((col - 1) / 26);
    }
    return letter;
  }

  private sanitizeSheetName(name: string): string {
    return name
      .replace(/[\\/*?:\[\]]/g, "")
      .substring(0, 31);
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 50);
  }
}

// ============================================
// UNIFIED DOCUMENT SERVICE
// ============================================

export class EnterpriseDocumentService {
  private wordGenerator: WordDocumentGenerator;
  private excelGenerator: ExcelDocumentGenerator;

  constructor(themeName: string = "professional") {
    this.wordGenerator = new WordDocumentGenerator(themeName);
    this.excelGenerator = new ExcelDocumentGenerator(themeName);
  }

  async generateDocument(request: DocumentRequest): Promise<DocumentResult> {
    switch (request.type) {
      case "docx":
        return this.wordGenerator.generate(request);
      case "xlsx":
        return this.excelGenerator.generate(request);
      case "pptx":
        return this.generatePPTX(request);
      case "pdf":
        return this.generatePDF(request);
      default:
        return {
          success: false,
          filename: "",
          mimeType: "",
          sizeBytes: 0,
          error: `Unsupported document type: ${request.type}`,
        };
    }
  }

  private async generatePPTX(request: DocumentRequest): Promise<DocumentResult> {
    try {
      // Dynamic import to avoid bundling issues
      const pptxgen = await import("pptxgenjs");
      const PptxGenJS = (pptxgen as any).default || pptxgen;
      
      const pres = new PptxGenJS();
      pres.author = request.author || "IliaGPT";
      pres.title = request.title;
      pres.subject = request.subtitle || "";

      // Title slide
      const titleSlide = pres.addSlide();
      titleSlide.addText(request.title, {
        x: 0.5,
        y: 2,
        w: "90%",
        h: 1.5,
        fontSize: 44,
        bold: true,
        color: "1A365D",
        align: "center",
      });
      if (request.subtitle) {
        titleSlide.addText(request.subtitle, {
          x: 0.5,
          y: 3.8,
          w: "90%",
          h: 1,
          fontSize: 24,
          color: "4A5568",
          align: "center",
        });
      }

      // Content slides
      for (const section of request.sections) {
        const slide = pres.addSlide();
        
        // Section title
        slide.addText(section.title, {
          x: 0.5,
          y: 0.3,
          w: "90%",
          h: 0.8,
          fontSize: 32,
          bold: true,
          color: "1A365D",
        });

        // Content (truncate for slide)
        const contentPreview = section.content.substring(0, 500) + (section.content.length > 500 ? "..." : "");
        slide.addText(contentPreview, {
          x: 0.5,
          y: 1.3,
          w: "90%",
          h: 4,
          fontSize: 18,
          color: "2D3748",
          valign: "top",
        });

        // Tables (if any)
        if (section.tables && section.tables.length > 0) {
          const table = section.tables[0];
          const tableData = [table.headers, ...table.rows.slice(0, 5)];
          
          slide.addTable(tableData, {
            x: 0.5,
            y: 3.5,
            w: 9,
            colW: Array(table.headers.length).fill(9 / table.headers.length),
            fontSize: 12,
            border: { type: "solid", pt: 1, color: "E2E8F0" },
          });
        }
      }

      const buffer = await pres.write({ outputType: "nodebuffer" });
      const filename = `${this.sanitizeFilename(request.title)}.pptx`;

      return {
        success: true,
        buffer: Buffer.from(buffer),
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: buffer.length,
      };
    } catch (error: any) {
      return {
        success: false,
        filename: "",
        mimeType: "",
        sizeBytes: 0,
        error: error.message,
      };
    }
  }

  private async generatePDF(request: DocumentRequest): Promise<DocumentResult> {
    try {
      const lines: string[] = [];
      const pushWrapped = (text: string) => {
        const maxChars = 90;
        const words = text.split(/\s+/);
        let current = "";
        words.forEach(word => {
          const test = current ? `${current} ${word}` : word;
          if (test.length > maxChars && current) {
            lines.push(current);
            current = word;
          } else {
            current = test;
          }
        });
        if (current) lines.push(current);
      };

      pushWrapped(request.title);
      if (request.subtitle) {
        pushWrapped(request.subtitle);
      }

      const sections = this.flattenSections(request.sections);
      sections.forEach(section => {
        lines.push("");
        pushWrapped(section.title);
        if (section.content) {
          pushWrapped(section.content);
        }
        if (section.lists?.length) {
          section.lists.forEach(list => {
            list.items.forEach(item => pushWrapped(`• ${item}`));
          });
        }
        if (section.tables?.length) {
          section.tables.forEach(table => {
            if (table.caption) pushWrapped(`Tabla: ${table.caption}`);
            pushWrapped(table.headers.join(" | "));
            table.rows.forEach(row => pushWrapped(row.join(" | ")));
          });
        }
      });

      const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      const contentLines = lines.map((line) => `(${escapeText(line)}) Tj T*`).join("\n");
      const contentStream = `BT\n/F1 12 Tf\n14 TL\n50 750 Td\n${contentLines}\nET`;
      const contentLength = Buffer.byteLength(contentStream, "utf8");

      const objects: string[] = [];
      objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
      objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
      objects.push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>\nendobj");
      objects.push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");
      objects.push(`5 0 obj\n<< /Length ${contentLength} >>\nstream\n${contentStream}\nendstream\nendobj`);

      let offset = 0;
      const xrefOffsets = ["0000000000 65535 f "];
      const body = objects.map((obj) => {
        const entry = obj + "\n";
        xrefOffsets.push(`${offset.toString().padStart(10, "0")} 00000 n `);
        offset += Buffer.byteLength(entry, "utf8");
        return entry;
      }).join("");

      const xrefOffset = offset;
      const xref = `xref\n0 ${xrefOffsets.length}\n${xrefOffsets.join("\n")}\n`;
      const trailer = `trailer\n<< /Size ${xrefOffsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
      const pdfBuffer = Buffer.from(`%PDF-1.4\n${body}${xref}${trailer}`, "utf8");

      const buffer = Buffer.from(pdfBuffer);
      return {
        success: true,
        buffer,
        filename: `${this.sanitizeFilename(request.title)}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
      };
    } catch (error: any) {
      return {
        success: false,
        filename: "",
        mimeType: "",
        sizeBytes: 0,
        error: error.message,
      };
    }
  }

  private flattenSections(sections: DocumentSection[]): DocumentSection[] {
    const flat: DocumentSection[] = [];
    const walk = (items: DocumentSection[]) => {
      items.forEach(section => {
        flat.push(section);
        if (section.subsections?.length) {
          walk(section.subsections);
        }
      });
    };
    walk(sections);
    return flat;
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 50);
  }

  // Static factory for quick access
  static create(theme: string = "professional"): EnterpriseDocumentService {
    return new EnterpriseDocumentService(theme);
  }
}

// ============================================
// EXPORTS
// ============================================

export const documentService = new EnterpriseDocumentService();

export async function generateDocument(request: DocumentRequest): Promise<DocumentResult> {
  return documentService.generateDocument(request);
}
