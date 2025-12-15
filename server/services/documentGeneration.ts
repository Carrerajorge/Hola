import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, convertInchesToTwip } from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";

export interface DocumentContent {
  title: string;
  type: "word" | "excel" | "ppt";
  content: any;
}

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|`(.+?)`|([^*_`]+))/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], bold: true }));
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6], italics: true }));
    } else if (match[7]) {
      runs.push(new TextRun({ text: match[7], font: "Consolas", shading: { fill: "E8E8E8" } }));
    } else if (match[8]) {
      runs.push(new TextRun({ text: match[8] }));
    }
  }
  
  return runs.length > 0 ? runs : [new TextRun({ text })];
}

function parseMarkdownTable(lines: string[]): Table | null {
  if (lines.length < 2) return null;
  
  const headerLine = lines[0];
  if (!headerLine.includes("|")) return null;
  
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.match(/^\|?[\s-:|]+\|?$/)) continue;
    const cells = line.split("|").map(c => c.trim()).filter(c => c);
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  
  if (rows.length === 0) return null;
  
  const maxCols = Math.max(...rows.map(r => r.length));
  
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => 
      new TableRow({
        children: Array.from({ length: maxCols }, (_, i) => 
          new TableCell({
            children: [new Paragraph({
              children: parseInlineFormatting(row[i] || ""),
              alignment: AlignmentType.LEFT,
            })],
            shading: rowIndex === 0 ? { fill: "E7E6E6" } : undefined,
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          })
        ),
      })
    ),
  });
}

export async function generateWordDocument(title: string, content: string): Promise<Buffer> {
  const lines = content.split("\n");
  const children: any[] = [];
  
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 48 })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
      alignment: AlignmentType.CENTER,
    })
  );

  let i = 0;
  let numberedListCounter = 0;
  
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();
    
    if (!trimmedLine) {
      children.push(new Paragraph({ spacing: { after: 100 } }));
      i++;
      continue;
    }
    
    if (trimmedLine.includes("|") && lines[i + 1]?.match(/^\|?[\s-:|]+\|?$/)) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i].includes("|") || lines[i].match(/^\|?[\s-:|]+\|?$/))) {
        tableLines.push(lines[i]);
        i++;
      }
      const table = parseMarkdownTable(tableLines);
      if (table) {
        children.push(table);
        children.push(new Paragraph({ spacing: { after: 200 } }));
      }
      continue;
    }
    
    if (trimmedLine.startsWith("# ")) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^# /, "")),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        })
      );
      numberedListCounter = 0;
    } else if (trimmedLine.startsWith("## ")) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^## /, "")),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 },
        })
      );
      numberedListCounter = 0;
    } else if (trimmedLine.startsWith("### ")) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^### /, "")),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 150 },
        })
      );
      numberedListCounter = 0;
    } else if (trimmedLine.startsWith("#### ")) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^#### /, "")),
          heading: HeadingLevel.HEADING_4,
          spacing: { before: 200, after: 150 },
        })
      );
      numberedListCounter = 0;
    } else if (trimmedLine.match(/^[-*•]\s/)) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^[-*•]\s/, "")),
          bullet: { level: 0 },
          spacing: { after: 80 },
        })
      );
    } else if (trimmedLine.match(/^\s{2,}[-*•]\s/)) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^\s+[-*•]\s/, "")),
          bullet: { level: 1 },
          spacing: { after: 80 },
        })
      );
    } else if (trimmedLine.match(/^\d+\.\s/)) {
      numberedListCounter++;
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^\d+\.\s/, "")),
          numbering: { reference: "numbered-list", level: 0 },
          spacing: { after: 80 },
        })
      );
    } else if (trimmedLine.startsWith("> ")) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine.replace(/^>\s?/, "")),
          indent: { left: convertInchesToTwip(0.5) },
          border: {
            left: { style: BorderStyle.SINGLE, size: 24, color: "CCCCCC" },
          },
          spacing: { after: 100 },
        })
      );
      numberedListCounter = 0;
    } else if (trimmedLine.match(/^---+$/) || trimmedLine.match(/^\*\*\*+$/)) {
      children.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
          spacing: { before: 200, after: 200 },
        })
      );
      numberedListCounter = 0;
    } else {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(trimmedLine),
          spacing: { after: 200, line: 276 },
        })
      );
      numberedListCounter = 0;
    }
    
    i++;
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: "numbered-list",
        levels: [{
          level: 0,
          format: "decimal",
          text: "%1.",
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
        }],
      }],
    },
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 24 },
          paragraph: { spacing: { line: 276 } },
        },
      ],
    },
    sections: [{ 
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      children 
    }],
  });

  return await Packer.toBuffer(doc);
}

export async function generateExcelDocument(title: string, data: any[][]): Promise<Buffer> {
  const workbook = XLSX.utils.book_new();
  
  const safeData = data.length > 0 ? data : [["Contenido"], ["No hay datos disponibles"]];
  const worksheet = XLSX.utils.aoa_to_sheet(safeData);
  
  const colWidths = safeData[0]?.map((_, colIndex) => {
    const maxLength = Math.max(...safeData.map(row => String(row[colIndex] || "").length));
    return { wch: Math.min(Math.max(maxLength, 10), 50) };
  }) || [];
  worksheet["!cols"] = colWidths;

  const sheetName = title.replace(/[\\/:*?[\]]/g, "").slice(0, 31) || "Hoja1";
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export async function generatePptDocument(title: string, slides: { title: string; content: string[] }[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.title = title;
  pptx.author = "Sira GPT";

  const titleSlide = pptx.addSlide();
  titleSlide.addText(title, {
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
    
    s.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.8,
      fontSize: 32,
      bold: true,
      color: "363636",
      fontFace: "Arial",
    });

    if (slide.content.length > 0) {
      const bulletPoints = slide.content.map(text => ({
        text: text,
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
  const lines = text.trim().split("\n");
  const data: any[][] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    if (trimmedLine.includes("|")) {
      const cells = trimmedLine.split("|").map(cell => cell.trim()).filter(cell => cell && !cell.match(/^-+$/));
      if (cells.length > 0) {
        data.push(cells);
      }
    } else if (trimmedLine.includes(",")) {
      const cells = trimmedLine.split(",").map(cell => cell.trim());
      if (cells.length > 1) {
        data.push(cells);
      } else {
        data.push([trimmedLine]);
      }
    } else if (trimmedLine.includes("\t")) {
      const cells = trimmedLine.split("\t").map(cell => cell.trim());
      data.push(cells);
    } else if (trimmedLine.includes(";")) {
      const cells = trimmedLine.split(";").map(cell => cell.trim());
      data.push(cells);
    } else {
      data.push([trimmedLine]);
    }
  }
  
  if (data.length === 0) {
    data.push(["Contenido"], [text.slice(0, 500)]);
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
