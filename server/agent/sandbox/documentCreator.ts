import PptxGenJS from "pptxgenjs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from "docx";
import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import {
  DocumentSlide,
  DocumentSection,
  ExcelSheet,
  ToolResult,
} from "./agentTypes";

export interface DocumentTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;
}

const DEFAULT_THEME: DocumentTheme = {
  primaryColor: "0066CC",
  secondaryColor: "003366",
  accentColor: "FF6600",
  fontFamily: "Calibri",
  titleFontSize: 44,
  bodyFontSize: 18,
};

const PROFESSIONAL_THEMES: Record<string, DocumentTheme> = {
  corporate: {
    primaryColor: "1A365D",
    secondaryColor: "2C5282",
    accentColor: "ED8936",
    fontFamily: "Arial",
    titleFontSize: 44,
    bodyFontSize: 18,
  },
  modern: {
    primaryColor: "2D3748",
    secondaryColor: "4A5568",
    accentColor: "38B2AC",
    fontFamily: "Segoe UI",
    titleFontSize: 40,
    bodyFontSize: 16,
  },
  elegant: {
    primaryColor: "1A202C",
    secondaryColor: "2D3748",
    accentColor: "9F7AEA",
    fontFamily: "Georgia",
    titleFontSize: 42,
    bodyFontSize: 17,
  },
  vibrant: {
    primaryColor: "E53E3E",
    secondaryColor: "C53030",
    accentColor: "38A169",
    fontFamily: "Verdana",
    titleFontSize: 44,
    bodyFontSize: 18,
  },
};

export class DocumentCreator {
  private outputDir: string;

  constructor(outputDir: string = "./sandbox_workspace/documents") {
    this.outputDir = outputDir;
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private getTheme(themeName?: string): DocumentTheme {
    if (themeName && PROFESSIONAL_THEMES[themeName.toLowerCase()]) {
      return PROFESSIONAL_THEMES[themeName.toLowerCase()];
    }
    return DEFAULT_THEME;
  }

  async createPptx(
    title: string,
    slides: DocumentSlide[],
    themeName?: string,
    filename?: string
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const theme = this.getTheme(themeName);
    const outputFilename = filename || `presentation_${Date.now()}.pptx`;
    const outputPath = path.join(this.outputDir, outputFilename);

    try {
      const pptx = new PptxGenJS();

      pptx.author = "DocumentCreator";
      pptx.title = title;
      pptx.subject = title;
      pptx.company = "Generated Document";

      pptx.defineSlideMaster({
        title: "TITLE_SLIDE",
        background: { color: theme.primaryColor },
        objects: [
          {
            placeholder: {
              options: {
                name: "title",
                type: "title",
                x: 0.5,
                y: 2.5,
                w: 9,
                h: 1.5,
              },
              text: "",
            },
          },
        ],
      });

      pptx.defineSlideMaster({
        title: "CONTENT_SLIDE",
        background: { color: "FFFFFF" },
        objects: [
          {
            rect: {
              x: 0,
              y: 0,
              w: "100%",
              h: 0.75,
              fill: { color: theme.primaryColor },
            },
          },
          {
            text: {
              text: title,
              options: {
                x: 0.5,
                y: 0.15,
                w: 8,
                h: 0.5,
                fontSize: 16,
                color: "FFFFFF",
                fontFace: theme.fontFamily,
                bold: true,
              },
            },
          },
        ],
      });

      const titleSlide = pptx.addSlide({ masterName: "TITLE_SLIDE" });
      titleSlide.addText(title, {
        x: 0.5,
        y: 2.0,
        w: 9,
        h: 1.5,
        fontSize: theme.titleFontSize,
        color: "FFFFFF",
        fontFace: theme.fontFamily,
        bold: true,
        align: "center",
        valign: "middle",
      });

      const dateStr = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      titleSlide.addText(dateStr, {
        x: 0.5,
        y: 4.0,
        w: 9,
        h: 0.5,
        fontSize: 16,
        color: "CCCCCC",
        fontFace: theme.fontFamily,
        align: "center",
      });

      for (let i = 0; i < slides.length; i++) {
        const slideData = slides[i];
        const slide = pptx.addSlide({ masterName: "CONTENT_SLIDE" });

        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 1.0,
            w: 9,
            h: 0.8,
            fontSize: 28,
            color: theme.primaryColor,
            fontFace: theme.fontFamily,
            bold: true,
          });
        }

        let yPosition = slideData.title ? 1.9 : 1.0;

        if (slideData.content) {
          slide.addText(slideData.content, {
            x: 0.5,
            y: yPosition,
            w: 9,
            h: 1.0,
            fontSize: theme.bodyFontSize,
            color: "333333",
            fontFace: theme.fontFamily,
            valign: "top",
          });
          yPosition += 1.2;
        }

        if (slideData.bullets && slideData.bullets.length > 0) {
          const bulletItems = slideData.bullets.map((bullet) => ({
            text: bullet,
            options: {
              bullet: { type: "bullet" as const, color: theme.accentColor },
              color: "333333",
              fontSize: theme.bodyFontSize,
              fontFace: theme.fontFamily,
            },
          }));

          slide.addText(bulletItems, {
            x: 0.5,
            y: yPosition,
            w: 9,
            h: 3.5,
            valign: "top",
          });
        }

        if (slideData.imageUrl) {
          try {
            if (fs.existsSync(slideData.imageUrl)) {
              slide.addImage({
                path: slideData.imageUrl,
                x: 7,
                y: 1.5,
                w: 2.5,
                h: 2,
              });
            }
          } catch {
          }
        }

        slide.addText(`${i + 2}`, {
          x: 9,
          y: 5.2,
          w: 0.5,
          h: 0.3,
          fontSize: 10,
          color: "999999",
          align: "right",
        });
      }

      await pptx.writeFile({ fileName: outputPath });

      return {
        success: true,
        toolName: "createPptx",
        data: { filePath: outputPath, slideCount: slides.length + 1 },
        message: `PowerPoint presentation created successfully with ${slides.length + 1} slides`,
        executionTimeMs: Date.now() - startTime,
        filesCreated: [outputPath],
      };
    } catch (error) {
      return {
        success: false,
        toolName: "createPptx",
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to create PowerPoint presentation",
        executionTimeMs: Date.now() - startTime,
        filesCreated: [],
      };
    }
  }

  async createDocx(
    title: string,
    sections: DocumentSection[],
    author?: string,
    filename?: string
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const outputFilename = filename || `document_${Date.now()}.docx`;
    const outputPath = path.join(this.outputDir, outputFilename);

    try {
      const children: Paragraph[] = [];

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: title,
              bold: true,
              size: 56,
              color: "1A365D",
              font: "Calibri",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          border: {
            bottom: {
              color: "1A365D",
              space: 10,
              style: BorderStyle.SINGLE,
              size: 12,
            },
          },
        })
      );

      if (author) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Author: ${author}`,
                italics: true,
                size: 24,
                color: "666666",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          })
        );
      }

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Generated on ${new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}`,
              italics: true,
              size: 20,
              color: "999999",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        })
      );

      for (const section of sections) {
        const headingLevel = this.getHeadingLevel(section.level || 1);

        if (section.title) {
          children.push(
            new Paragraph({
              text: section.title,
              heading: headingLevel,
              spacing: { before: 300, after: 150 },
            })
          );
        }

        if (section.content) {
          const paragraphs = section.content.split("\n\n");
          for (const para of paragraphs) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: para.trim(),
                    size: 24,
                    font: "Calibri",
                  }),
                ],
                spacing: { after: 200, line: 360 },
                alignment: AlignmentType.JUSTIFIED,
              })
            );
          }
        }

        if (section.bullets && section.bullets.length > 0) {
          for (const bullet of section.bullets) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: bullet,
                    size: 24,
                    font: "Calibri",
                  }),
                ],
                bullet: { level: 0 },
                spacing: { after: 100 },
              })
            );
          }
        }
      }

      const doc = new Document({
        creator: author || "DocumentCreator",
        title: title,
        description: `Document: ${title}`,
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 1440,
                  right: 1440,
                  bottom: 1440,
                  left: 1440,
                },
              },
            },
            headers: {
              default: new Header({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: title,
                        size: 18,
                        color: "999999",
                      }),
                    ],
                    alignment: AlignmentType.RIGHT,
                  }),
                ],
              }),
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
                        size: 18,
                        color: "999999",
                      }),
                    ],
                    alignment: AlignmentType.CENTER,
                  }),
                ],
              }),
            },
            children: children,
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(outputPath, buffer);

      return {
        success: true,
        toolName: "createDocx",
        data: { filePath: outputPath, sectionCount: sections.length },
        message: `Word document created successfully with ${sections.length} sections`,
        executionTimeMs: Date.now() - startTime,
        filesCreated: [outputPath],
      };
    } catch (error) {
      return {
        success: false,
        toolName: "createDocx",
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to create Word document",
        executionTimeMs: Date.now() - startTime,
        filesCreated: [],
      };
    }
  }

  private getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
    const levels = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5,
      6: HeadingLevel.HEADING_6,
    } as const;
    return levels[level as keyof typeof levels] || HeadingLevel.HEADING_1;
  }

  async createXlsx(
    title: string,
    sheets: ExcelSheet[],
    filename?: string
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const outputFilename = filename || `spreadsheet_${Date.now()}.xlsx`;
    const outputPath = path.join(this.outputDir, outputFilename);

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "DocumentCreator";
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.properties.date1904 = false;

      for (const sheetData of sheets) {
        const worksheet = workbook.addWorksheet(sheetData.name, {
          properties: { tabColor: { argb: "1A365D" } },
        });

        worksheet.mergeCells(1, 1, 1, sheetData.headers.length || 1);
        const titleCell = worksheet.getCell(1, 1);
        titleCell.value = `${title} - ${sheetData.name}`;
        titleCell.font = {
          name: "Calibri",
          size: 16,
          bold: true,
          color: { argb: "FFFFFF" },
        };
        titleCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "1A365D" },
        };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        worksheet.getRow(1).height = 30;

        if (sheetData.headers && sheetData.headers.length > 0) {
          const headerRow = worksheet.getRow(2);
          sheetData.headers.forEach((header, index) => {
            const cell = headerRow.getCell(index + 1);
            cell.value = header;
            cell.font = {
              name: "Calibri",
              size: 11,
              bold: true,
              color: { argb: "FFFFFF" },
            };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "2C5282" },
            };
            cell.alignment = { horizontal: "center", vertical: "middle" };
            cell.border = {
              top: { style: "thin", color: { argb: "1A365D" } },
              left: { style: "thin", color: { argb: "1A365D" } },
              bottom: { style: "thin", color: { argb: "1A365D" } },
              right: { style: "thin", color: { argb: "1A365D" } },
            };
          });
          headerRow.height = 25;

          sheetData.headers.forEach((_, index) => {
            worksheet.getColumn(index + 1).width = 15;
          });
        }

        if (sheetData.rows && sheetData.rows.length > 0) {
          sheetData.rows.forEach((row, rowIndex) => {
            const worksheetRow = worksheet.getRow(rowIndex + 3);
            const isEvenRow = rowIndex % 2 === 0;

            row.forEach((cellValue, colIndex) => {
              const cell = worksheetRow.getCell(colIndex + 1);
              cell.value = cellValue;
              cell.font = { name: "Calibri", size: 11 };
              cell.alignment = { vertical: "middle" };
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: isEvenRow ? "F7FAFC" : "FFFFFF" },
              };
              cell.border = {
                top: { style: "thin", color: { argb: "E2E8F0" } },
                left: { style: "thin", color: { argb: "E2E8F0" } },
                bottom: { style: "thin", color: { argb: "E2E8F0" } },
                right: { style: "thin", color: { argb: "E2E8F0" } },
              };

              if (typeof cellValue === "number") {
                cell.alignment = { horizontal: "right", vertical: "middle" };
                if (Number.isInteger(cellValue)) {
                  cell.numFmt = "#,##0";
                } else {
                  cell.numFmt = "#,##0.00";
                }
              }
            });
          });
        }

        sheetData.headers.forEach((_, index) => {
          const column = worksheet.getColumn(index + 1);
          let maxLength = sheetData.headers[index]?.length || 10;

          sheetData.rows?.forEach((row) => {
            const cellValue = row[index];
            if (cellValue !== undefined && cellValue !== null) {
              const cellLength = String(cellValue).length;
              if (cellLength > maxLength) {
                maxLength = cellLength;
              }
            }
          });

          column.width = Math.min(maxLength + 4, 50);
        });

        worksheet.views = [{ state: "frozen", ySplit: 2 }];
      }

      await workbook.xlsx.writeFile(outputPath);

      return {
        success: true,
        toolName: "createXlsx",
        data: {
          filePath: outputPath,
          sheetCount: sheets.length,
          sheets: sheets.map((s) => ({
            name: s.name,
            rowCount: s.rows?.length || 0,
            columnCount: s.headers?.length || 0,
          })),
        },
        message: `Excel workbook created successfully with ${sheets.length} sheet(s)`,
        executionTimeMs: Date.now() - startTime,
        filesCreated: [outputPath],
      };
    } catch (error) {
      return {
        success: false,
        toolName: "createXlsx",
        error: error instanceof Error ? error.message : String(error),
        message: "Failed to create Excel workbook",
        executionTimeMs: Date.now() - startTime,
        filesCreated: [],
      };
    }
  }

  setOutputDir(dir: string): void {
    this.outputDir = dir;
    this.ensureOutputDir();
  }

  getOutputDir(): string {
    return this.outputDir;
  }
}

export const documentCreator = new DocumentCreator();
