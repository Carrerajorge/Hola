import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageBreak,
  TableOfContents,
  convertInchesToTwip,
  StyleLevel,
  AlignmentType,
} from "docx";
import { DocSpec, DocBlock, TitleBlock, TocBlock, NumberedBlock } from "../../shared/documentSpecs";

interface FontConfig {
  font: string;
  size: number;
}

function getStylesetConfig(styleset: "modern" | "classic"): FontConfig {
  if (styleset === "classic") {
    return { font: "Times New Roman", size: 24 };
  }
  return { font: "Calibri", size: 22 };
}

const HEADING_LEVEL_MAP: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function processTitleBlock(block: TitleBlock, fontConfig: FontConfig): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: block.text,
        font: fontConfig.font,
        size: 56,
        bold: true,
      }),
    ],
    style: "Title",
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 400 },
  });
}

function processHeadingBlock(block: Extract<DocBlock, { type: "heading" }>, fontConfig: FontConfig): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: block.text,
        font: fontConfig.font,
      }),
    ],
    heading: HEADING_LEVEL_MAP[block.level] || HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
  });
}

function processParagraphBlock(block: Extract<DocBlock, { type: "paragraph" }>, fontConfig: FontConfig): Paragraph {
  const paragraphOptions: any = {
    children: [
      new TextRun({
        text: block.text,
        font: fontConfig.font,
        size: fontConfig.size,
      }),
    ],
    spacing: { after: 200, line: 276 },
  };

  if (block.style) {
    paragraphOptions.style = block.style;
  }

  return new Paragraph(paragraphOptions);
}

function processBulletsBlock(block: Extract<DocBlock, { type: "bullets" }>, fontConfig: FontConfig): Paragraph[] {
  return block.items.map(
    (item) =>
      new Paragraph({
        children: [
          new TextRun({
            text: item,
            font: fontConfig.font,
            size: fontConfig.size,
          }),
        ],
        bullet: { level: 0 },
        spacing: { after: 80 },
      })
  );
}

function processNumberedBlock(block: NumberedBlock, fontConfig: FontConfig): Paragraph[] {
  return block.items.map(
    (item, index) =>
      new Paragraph({
        children: [
          new TextRun({
            text: item,
            font: fontConfig.font,
            size: fontConfig.size,
          }),
        ],
        numbering: { reference: "default-numbering", level: 0 },
        spacing: { after: 80 },
      })
  );
}

function processTocBlock(block: TocBlock): TableOfContents {
  return new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: `1-${block.max_level}`,
  });
}

function processTableBlock(block: Extract<DocBlock, { type: "table" }>, fontConfig: FontConfig): Table {
  const rows: TableRow[] = [];

  if (block.header !== false) {
    const headerRow = new TableRow({
      children: block.columns.map(
        (col) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: col,
                    bold: true,
                    font: fontConfig.font,
                    size: fontConfig.size,
                  }),
                ],
              }),
            ],
            shading: { fill: "E7E6E6", type: "clear", color: "auto" },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          })
      ),
    });
    rows.push(headerRow);
  }

  const dataRows = block.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: String(cell ?? ""),
                      font: fontConfig.font,
                      size: fontConfig.size,
                    }),
                  ],
                }),
              ],
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
                right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              },
            })
        ),
      })
  );

  rows.push(...dataRows);

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function processPageBreakBlock(): Paragraph {
  return new Paragraph({
    children: [new PageBreak()],
  });
}

function processBlock(block: DocBlock, fontConfig: FontConfig): (Paragraph | Table | TableOfContents)[] {
  switch (block.type) {
    case "title":
      return [processTitleBlock(block, fontConfig)];
    case "heading":
      return [processHeadingBlock(block, fontConfig)];
    case "paragraph":
      return [processParagraphBlock(block, fontConfig)];
    case "bullets":
      return processBulletsBlock(block, fontConfig);
    case "numbered":
      return processNumberedBlock(block, fontConfig);
    case "table":
      return [processTableBlock(block, fontConfig), new Paragraph({ spacing: { after: 200 } })];
    case "page_break":
      return [processPageBreakBlock()];
    case "toc":
      return [processTocBlock(block), new Paragraph({ spacing: { after: 400 } })];
    default:
      return [];
  }
}

export async function renderWordFromSpec(spec: DocSpec): Promise<Buffer> {
  const styleset = spec.styleset || "modern";
  const fontConfig = getStylesetConfig(styleset);
  const bodyElements: (Paragraph | Table | TableOfContents)[] = [];

  if (spec.add_toc) {
    bodyElements.push(
      new TableOfContents("Table of Contents", {
        hyperlink: true,
        headingStyleRange: "1-6",
      })
    );
    bodyElements.push(new Paragraph({ spacing: { after: 400 } }));
  }

  for (const block of spec.blocks) {
    bodyElements.push(...processBlock(block, fontConfig));
  }

  const doc = new Document({
    title: spec.title,
    creator: spec.author ?? undefined,
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "start",
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 360 },
                },
              },
            },
          ],
        },
      ],
    },
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: fontConfig.font, size: fontConfig.size },
          paragraph: { spacing: { line: 276 } },
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: { font: fontConfig.font, size: 56, bold: true },
          paragraph: { spacing: { after: 400 }, alignment: AlignmentType.CENTER },
        },
      ],
    },
    sections: [
      {
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
        children: bodyElements,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
