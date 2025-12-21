import {
  RichTextDocument,
  RichTextBlock,
  TextRun,
  TextStyle,
  HeadingBlock,
  ParagraphBlock,
  BulletListBlock,
  OrderedListBlock,
  BlockquoteBlock,
  CodeBlock,
  TableBlock,
  ListItem,
  normalizeRuns,
} from "@shared/richTextTypes";

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  lang?: string;
  url?: string;
  title?: string;
  alt?: string;
}

export function parseMarkdownToDocument(markdown: string): RichTextDocument {
  const blocks: RichTextBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const content = headingMatch[2];
      blocks.push({
        type: "heading",
        level,
        runs: parseInlineMarkdown(content),
      });
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const langMatch = line.match(/^```(\w+)?/);
      const language = langMatch?.[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: "code-block",
        code: codeLines.join("\n"),
        language,
      });
      i++;
      continue;
    }

    if (line.match(/^[-*]\s+/)) {
      const items: ListItem[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        const itemContent = lines[i].replace(/^[-*]\s+/, "");
        items.push({ runs: parseInlineMarkdown(itemContent) });
        i++;
      }
      blocks.push({ type: "bullet-list", items });
      continue;
    }

    if (line.match(/^\d+\.\s+/)) {
      const items: ListItem[] = [];
      const startMatch = line.match(/^(\d+)\./);
      const start = startMatch ? parseInt(startMatch[1], 10) : 1;
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        const itemContent = lines[i].replace(/^\d+\.\s+/, "");
        items.push({ runs: parseInlineMarkdown(itemContent) });
        i++;
      }
      blocks.push({ type: "ordered-list", items, start });
      continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].replace(/^>\s*/, ""));
        i++;
      }
      blocks.push({
        type: "blockquote",
        runs: parseInlineMarkdown(quoteLines.join(" ")),
      });
      continue;
    }

    if (line.match(/^[-*_]{3,}$/)) {
      blocks.push({ type: "horizontal-rule" });
      i++;
      continue;
    }

    if (line.includes("|") && lines[i + 1]?.match(/^\|?[\s:|-]+\|?$/)) {
      const tableBlock = parseMarkdownTable(lines, i);
      if (tableBlock) {
        blocks.push(tableBlock.block);
        i = tableBlock.endIndex;
        continue;
      }
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s+/) &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^[-*]\s+/) &&
      !lines[i].match(/^\d+\.\s+/) &&
      !lines[i].startsWith("> ") &&
      !lines[i].match(/^[-*_]{3,}$/)
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({
        type: "paragraph",
        runs: parseInlineMarkdown(paragraphLines.join(" ")),
      });
    }
  }

  return { blocks };
}

function parseMarkdownTable(
  lines: string[],
  startIndex: number
): { block: TableBlock; endIndex: number } | null {
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];

  if (!separatorLine?.match(/^\|?[\s:|-]+\|?$/)) {
    return null;
  }

  const parseRow = (line: string) => {
    return line
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, i, arr) => !(i === 0 && cell === "") && !(i === arr.length - 1 && cell === ""));
  };

  const headerCells = parseRow(headerLine);
  const rows = [
    {
      cells: headerCells.map((cell) => ({
        runs: parseInlineMarkdown(cell),
        isHeader: true,
      })),
    },
  ];

  let i = startIndex + 2;
  while (i < lines.length && lines[i].includes("|")) {
    const cells = parseRow(lines[i]);
    rows.push({
      cells: cells.map((cell) => ({
        runs: parseInlineMarkdown(cell),
      })),
    });
    i++;
  }

  return {
    block: { type: "table", rows, hasHeader: true },
    endIndex: i,
  };
}

export function parseInlineMarkdown(text: string): TextRun[] {
  if (!text || typeof text !== "string") {
    return text ? [{ text: String(text) }] : [];
  }

  const runs: TextRun[] = [];
  let remaining = text;

  const patterns: Array<{
    regex: RegExp;
    handler: (match: RegExpExecArray) => { run: TextRun; consumed: number };
  }> = [
    {
      regex: /\$\$(.+?)\$\$/,
      handler: (m) => ({
        run: { text: m[1], style: { code: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\$(.+?)\$/,
      handler: (m) => ({
        run: { text: m[1], style: { code: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\*\*\*(.+?)\*\*\*/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true, italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /___(.+?)___/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true, italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\*\*(.+?)\*\*/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /__(.+?)__/,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\*(.+?)\*/,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /_(.+?)_/,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /~~(.+?)~~/,
      handler: (m) => ({
        run: { text: m[1], style: { strikethrough: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<u>(.+?)<\/u>/i,
      handler: (m) => ({
        run: { text: m[1], style: { underline: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<mark>(.+?)<\/mark>/i,
      handler: (m) => ({
        run: { text: m[1], style: { backgroundColor: "#ffff00" } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<span\s+style=["']color:\s*([^"']+)["']>(.+?)<\/span>/i,
      handler: (m) => ({
        run: { text: m[2], style: { color: m[1] } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /`(.+?)`/,
      handler: (m) => ({
        run: { text: m[1], style: { code: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/,
      handler: (m) => ({
        run: { text: m[1], style: { link: m[2], underline: true, color: "#0066cc" } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<strong>(.+?)<\/strong>/i,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<b>(.+?)<\/b>/i,
      handler: (m) => ({
        run: { text: m[1], style: { bold: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<em>(.+?)<\/em>/i,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
    {
      regex: /<i>(.+?)<\/i>/i,
      handler: (m) => ({
        run: { text: m[1], style: { italic: true } },
        consumed: m[0].length,
      }),
    },
  ];

  while (remaining.length > 0) {
    let earliestMatch: {
      index: number;
      pattern: (typeof patterns)[0];
      match: RegExpExecArray;
    } | null = null;

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, pattern, match };
      }
    }

    if (earliestMatch === null) {
      if (remaining.length > 0) {
        runs.push({ text: remaining });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      runs.push({ text: remaining.slice(0, earliestMatch.index) });
    }

    const { run } = earliestMatch.pattern.handler(earliestMatch.match);
    runs.push(run);
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length);
  }

  return normalizeRuns(runs.filter((r) => r.text.length > 0));
}

export function parseHtmlToDocument(html: string): RichTextDocument {
  const blocks: RichTextBlock[] = [];

  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const blockRegex = /<(h[1-6]|p|ul|ol|blockquote|pre|table|hr)[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let match;

  while ((match = blockRegex.exec(cleanHtml)) !== null) {
    const tagName = match[1]?.toLowerCase();
    const content = match[2] || "";

    if (tagName?.startsWith("h") && tagName.length === 2) {
      const level = parseInt(tagName[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: "heading",
        level,
        runs: parseHtmlInline(content),
      });
    } else if (tagName === "p") {
      blocks.push({
        type: "paragraph",
        runs: parseHtmlInline(content),
      });
    } else if (tagName === "ul") {
      const items = parseHtmlListItems(content);
      blocks.push({ type: "bullet-list", items });
    } else if (tagName === "ol") {
      const items = parseHtmlListItems(content);
      blocks.push({ type: "ordered-list", items });
    } else if (tagName === "blockquote") {
      blocks.push({
        type: "blockquote",
        runs: parseHtmlInline(content),
      });
    } else if (tagName === "pre") {
      const codeMatch = content.match(/<code[^>]*(?:\s+class=["']language-(\w+)["'])?[^>]*>([\s\S]*?)<\/code>/i);
      blocks.push({
        type: "code-block",
        code: decodeHtmlEntities(codeMatch?.[2] || content),
        language: codeMatch?.[1],
      });
    } else if (tagName === "hr" || match[0].match(/<hr/i)) {
      blocks.push({ type: "horizontal-rule" });
    }
  }

  if (blocks.length === 0 && cleanHtml.trim()) {
    blocks.push({
      type: "paragraph",
      runs: parseHtmlInline(cleanHtml),
    });
  }

  return { blocks };
}

function parseHtmlListItems(html: string): ListItem[] {
  const items: ListItem[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = liRegex.exec(html)) !== null) {
    items.push({ runs: parseHtmlInline(match[1]) });
  }

  return items;
}

function parseHtmlInline(html: string): TextRun[] {
  const runs: TextRun[] = [];

  const patterns: Array<{
    regex: RegExp;
    handler: (match: RegExpExecArray) => TextRun;
  }> = [
    {
      regex: /<strong[^>]*>([\s\S]*?)<\/strong>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { bold: true } }),
    },
    {
      regex: /<b[^>]*>([\s\S]*?)<\/b>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { bold: true } }),
    },
    {
      regex: /<em[^>]*>([\s\S]*?)<\/em>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { italic: true } }),
    },
    {
      regex: /<i[^>]*>([\s\S]*?)<\/i>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { italic: true } }),
    },
    {
      regex: /<u[^>]*>([\s\S]*?)<\/u>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { underline: true } }),
    },
    {
      regex: /<s[^>]*>([\s\S]*?)<\/s>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { strikethrough: true } }),
    },
    {
      regex: /<del[^>]*>([\s\S]*?)<\/del>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { strikethrough: true } }),
    },
    {
      regex: /<code[^>]*>([\s\S]*?)<\/code>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { code: true } }),
    },
    {
      regex: /<mark[^>]*>([\s\S]*?)<\/mark>/i,
      handler: (m) => ({ text: stripTags(m[1]), style: { backgroundColor: "#ffff00" } }),
    },
    {
      regex: /<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
      handler: (m) => ({
        text: stripTags(m[2]),
        style: { link: m[1], underline: true, color: "#0066cc" },
      }),
    },
    {
      regex: /<span[^>]*style=["'][^"']*color:\s*([^;"']+)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      handler: (m) => ({ text: stripTags(m[2]), style: { color: m[1].trim() } }),
    },
  ];

  let remaining = html;

  while (remaining.length > 0) {
    let earliestMatch: {
      index: number;
      pattern: (typeof patterns)[0];
      match: RegExpExecArray;
    } | null = null;

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, pattern, match };
      }
    }

    if (earliestMatch === null) {
      const text = stripTags(remaining);
      if (text.length > 0) {
        runs.push({ text: decodeHtmlEntities(text) });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      const text = stripTags(remaining.slice(0, earliestMatch.index));
      if (text.length > 0) {
        runs.push({ text: decodeHtmlEntities(text) });
      }
    }

    const run = earliestMatch.pattern.handler(earliestMatch.match);
    run.text = decodeHtmlEntities(run.text);
    runs.push(run);
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length);
  }

  return normalizeRuns(runs.filter((r) => r.text.length > 0));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function detectDocumentType(
  content: string
): "cv" | "letter" | "report" | "article" | "contract" | "generic" {
  const lowerContent = content.toLowerCase();

  const cvIndicators = [
    "experience",
    "education",
    "skills",
    "work history",
    "employment",
    "resume",
    "curriculum",
    "cv",
    "experiencia",
    "educación",
    "habilidades",
  ];
  const letterIndicators = [
    "dear",
    "sincerely",
    "regards",
    "yours truly",
    "to whom it may concern",
    "estimado",
    "atentamente",
    "cordialmente",
  ];
  const reportIndicators = [
    "executive summary",
    "introduction",
    "methodology",
    "findings",
    "conclusion",
    "recommendations",
    "analysis",
    "resumen ejecutivo",
    "introducción",
    "metodología",
  ];
  const contractIndicators = [
    "agreement",
    "parties",
    "terms and conditions",
    "whereas",
    "hereby",
    "obligations",
    "contrato",
    "partes",
    "términos y condiciones",
  ];
  const articleIndicators = ["abstract", "keywords", "references", "bibliography"];

  const countMatches = (indicators: string[]) =>
    indicators.filter((ind) => lowerContent.includes(ind)).length;

  const scores = {
    cv: countMatches(cvIndicators),
    letter: countMatches(letterIndicators),
    report: countMatches(reportIndicators),
    contract: countMatches(contractIndicators),
    article: countMatches(articleIndicators),
  };

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return "generic";

  const type = (Object.entries(scores).find(([, score]) => score === maxScore)?.[0] ||
    "generic") as keyof typeof scores;
  return type;
}
