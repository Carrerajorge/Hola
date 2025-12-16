import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";
import { generateWordFromMarkdown } from "./markdownToDocx";

export interface DocumentContent {
  title: string;
  type: "word" | "excel" | "ppt";
  content: any;
}

export async function generateWordDocument(title: string, content: string): Promise<Buffer> {
  return generateWordFromMarkdown(title, content);
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
