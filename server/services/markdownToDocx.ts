import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, convertInchesToTwip, IRunOptions } from "docx";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, Content, Text, Strong, Emphasis, InlineCode, Paragraph as MdParagraph, Heading, List, ListItem, Table as MdTable, TableRow as MdTableRow, TableCell as MdTableCell, Blockquote, Code, ThematicBreak, Link } from "mdast";

function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMarkdownToAst(markdown: string): Root {
  const normalizedMd = normalizeMarkdown(markdown);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm);
  
  return processor.parse(normalizedMd) as Root;
}

interface TextRunOptions extends Partial<IRunOptions> {
  text: string;
}

function extractTextRuns(node: Content, inherited: Partial<IRunOptions> = {}): TextRunOptions[] {
  const runs: TextRunOptions[] = [];
  
  switch (node.type) {
    case "text":
      runs.push({ text: (node as Text).value, ...inherited });
      break;
      
    case "strong":
      for (const child of (node as Strong).children) {
        runs.push(...extractTextRuns(child, { ...inherited, bold: true }));
      }
      break;
      
    case "emphasis":
      for (const child of (node as Emphasis).children) {
        runs.push(...extractTextRuns(child, { ...inherited, italics: true }));
      }
      break;
      
    case "inlineCode":
      runs.push({ 
        text: (node as InlineCode).value, 
        ...inherited,
        font: "Consolas",
        shading: { fill: "E8E8E8", type: "clear", color: "auto" }
      });
      break;
      
    case "link":
      const linkNode = node as Link;
      for (const child of linkNode.children) {
        runs.push(...extractTextRuns(child, { ...inherited, color: "0563C1", underline: { type: "single" } }));
      }
      break;
      
    case "break":
      runs.push({ text: "", break: 1, ...inherited });
      break;
      
    default:
      if ('children' in node && Array.isArray((node as any).children)) {
        for (const child of (node as any).children) {
          runs.push(...extractTextRuns(child as Content, inherited));
        }
      } else if ('value' in node) {
        runs.push({ text: String((node as any).value), ...inherited });
      }
  }
  
  return runs;
}

function createTextRuns(runOptions: TextRunOptions[]): TextRun[] {
  return runOptions.map(opt => new TextRun(opt as IRunOptions));
}

function processTableNode(tableNode: MdTable): Table {
  const rows: TableRow[] = [];
  let maxCols = 0;
  
  for (const row of tableNode.children as MdTableRow[]) {
    maxCols = Math.max(maxCols, row.children.length);
  }
  
  tableNode.children.forEach((row, rowIndex) => {
    const mdRow = row as MdTableRow;
    const cells: TableCell[] = [];
    
    for (let i = 0; i < maxCols; i++) {
      const cellNode = mdRow.children[i] as MdTableCell | undefined;
      const textRuns: TextRunOptions[] = [];
      
      if (cellNode) {
        for (const child of cellNode.children) {
          textRuns.push(...extractTextRuns(child as Content));
        }
      }
      
      cells.push(new TableCell({
        children: [new Paragraph({
          children: createTextRuns(textRuns.length > 0 ? textRuns : [{ text: "" }]),
          alignment: AlignmentType.LEFT,
        })],
        shading: rowIndex === 0 ? { fill: "E7E6E6", type: "clear", color: "auto" } : undefined,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
        },
      }));
    }
    
    rows.push(new TableRow({ children: cells }));
  });
  
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function processListNode(listNode: List, level: number = 0): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const isOrdered = listNode.ordered;
  
  for (const item of listNode.children as ListItem[]) {
    for (const child of item.children) {
      if (child.type === "paragraph") {
        const textRuns: TextRunOptions[] = [];
        for (const inlineChild of (child as MdParagraph).children) {
          textRuns.push(...extractTextRuns(inlineChild as Content));
        }
        
        const para = new Paragraph({
          children: createTextRuns(textRuns),
          ...(isOrdered 
            ? { numbering: { reference: "numbered-list", level } }
            : { bullet: { level } }
          ),
          spacing: { after: 80 },
        });
        paragraphs.push(para);
      } else if (child.type === "list") {
        paragraphs.push(...processListNode(child as List, level + 1));
      }
    }
  }
  
  return paragraphs;
}

function processBlockquote(node: Blockquote): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  for (const child of node.children) {
    if (child.type === "paragraph") {
      const textRuns: TextRunOptions[] = [];
      for (const inlineChild of (child as MdParagraph).children) {
        textRuns.push(...extractTextRuns(inlineChild as Content));
      }
      
      paragraphs.push(new Paragraph({
        children: createTextRuns(textRuns),
        indent: { left: convertInchesToTwip(0.5) },
        border: {
          left: { style: BorderStyle.SINGLE, size: 24, color: "CCCCCC" },
        },
        spacing: { after: 100 },
      }));
    }
  }
  
  return paragraphs;
}

function astToDocxElements(ast: Root): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  
  for (const node of ast.children) {
    switch (node.type) {
      case "heading": {
        const headingNode = node as Heading;
        const textRuns: TextRunOptions[] = [];
        for (const child of headingNode.children) {
          textRuns.push(...extractTextRuns(child as Content));
        }
        
        const headingLevelMap: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        
        elements.push(new Paragraph({
          children: createTextRuns(textRuns),
          heading: headingLevelMap[headingNode.depth] || HeadingLevel.HEADING_1,
          spacing: { before: headingNode.depth === 1 ? 400 : 300, after: 200 },
        }));
        break;
      }
      
      case "paragraph": {
        const paraNode = node as MdParagraph;
        const textRuns: TextRunOptions[] = [];
        for (const child of paraNode.children) {
          textRuns.push(...extractTextRuns(child as Content));
        }
        
        if (textRuns.length > 0) {
          elements.push(new Paragraph({
            children: createTextRuns(textRuns),
            spacing: { after: 200, line: 276 },
          }));
        }
        break;
      }
      
      case "list": {
        elements.push(...processListNode(node as List));
        break;
      }
      
      case "table": {
        elements.push(processTableNode(node as MdTable));
        elements.push(new Paragraph({ spacing: { after: 200 } }));
        break;
      }
      
      case "blockquote": {
        elements.push(...processBlockquote(node as Blockquote));
        break;
      }
      
      case "code": {
        const codeNode = node as Code;
        const codeLines = codeNode.value.split("\n");
        
        for (const line of codeLines) {
          elements.push(new Paragraph({
            children: [new TextRun({
              text: line || " ",
              font: "Consolas",
              size: 20,
            })],
            shading: { fill: "F5F5F5", type: "clear", color: "auto" },
            spacing: { after: 0 },
            indent: { left: convertInchesToTwip(0.25) },
          }));
        }
        elements.push(new Paragraph({ spacing: { after: 200 } }));
        break;
      }
      
      case "thematicBreak": {
        elements.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
          spacing: { before: 200, after: 200 },
        }));
        break;
      }
      
      default:
        break;
    }
  }
  
  return elements;
}

export async function generateWordFromMarkdown(title: string, content: string): Promise<Buffer> {
  const ast = parseMarkdownToAst(content);
  const bodyElements = astToDocxElements(ast);
  
  const titleParagraph = new Paragraph({
    children: [new TextRun({ text: title, bold: true, size: 48 })],
    heading: HeadingLevel.TITLE,
    spacing: { after: 400 },
    alignment: AlignmentType.CENTER,
  });
  
  const doc = new Document({
    numbering: {
      config: [{
        reference: "numbered-list",
        levels: [
          {
            level: 0,
            format: "decimal",
            text: "%1.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
          },
          {
            level: 1,
            format: "lowerLetter",
            text: "%2.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.25) } } },
          },
        ],
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
      children: [titleParagraph, ...bodyElements],
    }],
  });
  
  return await Packer.toBuffer(doc);
}

export { normalizeMarkdown, parseMarkdownToAst };
