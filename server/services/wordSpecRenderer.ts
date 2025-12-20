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
} from "docx";
import { DocSpec, DocBlock } from "../../shared/documentSpecs";

const HEADING_LEVEL_MAP: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function processHeadingBlock(block: Extract<DocBlock, { type: "heading" }>): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: block.text,
        font: "Calibri",
      }),
    ],
    heading: HEADING_LEVEL_MAP[block.level] || HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
  });
}

function processParagraphBlock(block: Extract<DocBlock, { type: "paragraph" }>): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: block.text,
        font: "Calibri",
        size: 22, // 11pt = 22 half-points
      }),
    ],
    spacing: { after: 200, line: 276 },
  });
}

function processBulletsBlock(block: Extract<DocBlock, { type: "bullets" }>): Paragraph[] {
  return block.items.map(
    (item) =>
      new Paragraph({
        children: [
          new TextRun({
            text: item,
            font: "Calibri",
            size: 22,
          }),
        ],
        bullet: { level: 0 },
        spacing: { after: 80 },
      })
  );
}

function processTableBlock(block: Extract<DocBlock, { type: "table" }>): Table {
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
                  font: "Calibri",
                  size: 22,
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
                      font: "Calibri",
                      size: 22,
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

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

function processPageBreakBlock(): Paragraph {
  return new Paragraph({
    children: [new PageBreak()],
  });
}

function processBlock(block: DocBlock): (Paragraph | Table)[] {
  switch (block.type) {
    case "heading":
      return [processHeadingBlock(block)];
    case "paragraph":
      return [processParagraphBlock(block)];
    case "bullets":
      return processBulletsBlock(block);
    case "table":
      return [processTableBlock(block), new Paragraph({ spacing: { after: 200 } })];
    case "page_break":
      return [processPageBreakBlock()];
    default:
      return [];
  }
}

export async function renderWordFromSpec(spec: DocSpec): Promise<Buffer> {
  const bodyElements: (Paragraph | Table)[] = [];

  // Add table of contents if requested
  if (spec.add_toc) {
    bodyElements.push(
      new TableOfContents("Table of Contents", {
        hyperlink: true,
        headingStyleRange: "1-6",
      })
    );
    bodyElements.push(new Paragraph({ spacing: { after: 400 } }));
  }

  // Process all blocks
  for (const block of spec.blocks) {
    bodyElements.push(...processBlock(block));
  }

  const doc = new Document({
    title: spec.title,
    creator: spec.author ?? undefined,
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 22 }, // 11pt
          paragraph: { spacing: { line: 276 } },
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
