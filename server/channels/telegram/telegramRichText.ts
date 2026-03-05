import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type {
  Blockquote,
  Break,
  Code,
  Content,
  Delete,
  Emphasis,
  Heading,
  InlineCode,
  InlineMath,
  Link,
  List,
  ListItem,
  Math,
  Paragraph,
  PhrasingContent,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
} from "mdast";

const CODE_BLOCK_OPEN = "<pre><code>";
const CODE_BLOCK_CLOSE = "</code></pre>";
const TELEGRAM_CHUNK_FALLBACK_SIZE = 3900;
const MAX_TABLE_COLUMN_WIDTH = 36;
const TELEGRAM_FALLBACK_TOKEN = "@@TG_TOKEN_";
const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  "n": "ⁿ",
  "i": "ⁱ",
};
const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  "a": "ₐ",
  "e": "ₑ",
  "h": "ₕ",
  "i": "ᵢ",
  "j": "ⱼ",
  "k": "ₖ",
  "l": "ₗ",
  "m": "ₘ",
  "n": "ₙ",
  "o": "ₒ",
  "p": "ₚ",
  "r": "ᵣ",
  "s": "ₛ",
  "t": "ₜ",
  "u": "ᵤ",
  "v": "ᵥ",
  "x": "ₓ",
};
const MATH_SUPERSCRIPT_DIGIT_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

function stripTelegramHtml(text: string): string {
  const stripped = text.replace(/<[^>]+>/g, "");
  return decodeBasicEntities(stripped);
}

function mapUnicodeScript(input: string, map: Record<string, string>): string {
  let converted = "";
  for (const char of input) {
    const mapped = map[char];
    if (!mapped) return input;
    converted += mapped;
  }
  return converted;
}

function toSuperscriptDigits(input: string): string {
  let converted = "";
  for (const char of String(input || "")) {
    const mapped = MATH_SUPERSCRIPT_DIGIT_MAP[char];
    if (!mapped) return String(input || "");
    converted += mapped;
  }
  return converted || String(input || "");
}

export function latexMathToTelegramText(rawValue: string): string {
  let value = String(rawValue || "").trim();
  if (!value) return "";

  value = value
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\neq/g, "≠")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\approx/g, "≈")
    .replace(/\\pi\b/g, "π")
    .replace(/\\theta\b/g, "θ")
    .replace(/\\alpha\b/g, "α")
    .replace(/\\beta\b/g, "β")
    .replace(/\\gamma\b/g, "γ")
    .replace(/\\Delta\b/g, "Δ")
    .replace(/\\sum\b/g, "Σ")
    .replace(/\\int\b/g, "∫");

  let previous = "";
  while (value !== previous) {
    previous = value;
    value = value.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)");
  }

  value = value.replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)");

  value = value.replace(/\^\{([^{}]+)\}/g, (_full, exponent: string) => mapUnicodeScript(exponent, SUPERSCRIPT_MAP));
  value = value.replace(/\^([A-Za-z0-9+\-=()])/g, (_full, exponent: string) => mapUnicodeScript(exponent, SUPERSCRIPT_MAP));
  value = value.replace(/_\{([^{}]+)\}/g, (_full, subscript: string) => mapUnicodeScript(subscript, SUBSCRIPT_MAP));
  value = value.replace(/_([A-Za-z0-9+\-=()])/g, (_full, subscript: string) => mapUnicodeScript(subscript, SUBSCRIPT_MAP));

  value = value
    .replace(/[{}]/g, "")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return value || String(rawValue || "").trim();
}

function isEquationLikeLine(line: string): boolean {
  const text = String(line || "");
  const hasOperators = /[=+\-*/()]/.test(text);
  const hasVariablePattern = /[A-Za-z]\s*(?:\^|\d)|\d\s*[A-Za-z]/.test(text);
  const hasLatexHint = /\\(?:frac|sqrt|left|right|cdot|times|div|pm|sum|int|pi|theta|alpha|beta|gamma)/.test(text);
  return hasLatexHint || (hasOperators && hasVariablePattern);
}

function polishEquationLine(line: string): string {
  let out = String(line || "");
  if (!out) return out;

  if (/\\[A-Za-z]+/.test(out)) {
    out = latexMathToTelegramText(out);
  }

  out = out.replace(/([A-Za-z])\s*\^\s*\{(\d+)\}/g, (_full, variable: string, exponent: string) => `${variable}${toSuperscriptDigits(exponent)}`);
  out = out.replace(/([A-Za-z])\s*\^\s*(\d+)/g, (_full, variable: string, exponent: string) => `${variable}${toSuperscriptDigits(exponent)}`);
  out = out.replace(/(\d)\s*([A-Za-z])\s*([23])\b/g, (_full, coef: string, variable: string, exponent: string) => `${coef}${variable}${toSuperscriptDigits(exponent)}`);
  out = out.replace(/\b([A-Za-z])\s*([23])\b/g, (_full, variable: string, exponent: string) => `${variable}${toSuperscriptDigits(exponent)}`);

  return out;
}

function polishMathInNonCodeText(input: string): string {
  return String(input || "")
    .split("\n")
    .map((line) => (isEquationLikeLine(line) ? polishEquationLine(line) : line))
    .join("\n");
}

export function polishMathText(input: string): string {
  const source = String(input || "");
  if (!source) return "";

  const codeFenceRe = /```[\s\S]*?```/g;
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  codeFenceRe.lastIndex = 0;

  while ((match = codeFenceRe.exec(source)) !== null) {
    const start = match.index;
    const end = codeFenceRe.lastIndex;
    const nonCodePart = source.slice(cursor, start);
    result += polishMathInNonCodeText(nonCodePart);
    result += source.slice(start, end);
    cursor = end;
  }

  result += polishMathInNonCodeText(source.slice(cursor));
  return result;
}

function normalizeMathDelimiters(input: string): string {
  const normalized = polishMathText(input)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
  return normalized
    .replace(/\$\$([\s\S]+?)\$\$/g, (_full, formula: string) => `\n$$\n${String(formula || "").trim()}\n$$\n`)
    .replace(/\n{3,}/g, "\n\n");
}

function safeHref(rawHref: string): string {
  const href = String(rawHref || "").trim();
  if (!href) return "";

  try {
    const parsed = new URL(href);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
}

function renderInline(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return escapeHtml((node as Text).value);

    case "strong":
      return `<b>${renderInlineChildren((node as Strong).children)}</b>`;

    case "emphasis":
      return `<i>${renderInlineChildren((node as Emphasis).children)}</i>`;

    case "delete":
      return `<s>${renderInlineChildren((node as Delete).children)}</s>`;

    case "inlineCode":
      return `<code>${escapeHtml((node as InlineCode).value)}</code>`;

    case "inlineMath":
      return `<code>${escapeHtml(latexMathToTelegramText((node as InlineMath).value))}</code>`;

    case "link": {
      const link = node as Link;
      const href = safeHref(link.url || "");
      const label = renderInlineChildren(link.children) || escapeHtml(link.url || "link");
      if (!href) return label;
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    }

    case "break":
      return "\n";

    default: {
      const maybeChildren = (node as unknown as { children?: PhrasingContent[] }).children;
      if (Array.isArray(maybeChildren)) return renderInlineChildren(maybeChildren);
      return "";
    }
  }
}

function renderInlineChildren(children: PhrasingContent[]): string {
  return children.map((child) => renderInline(child)).join("");
}

function renderTableCellPlainText(cell: TableCell | undefined): string {
  if (!cell) return "";
  return cell.children
    .map((child) => {
      if (child.type !== "paragraph") return "";
      return renderInlineChildren((child as Paragraph).children);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimForTable(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function renderTable(node: Table): string {
  const rows = (node.children || []) as TableRow[];
  if (rows.length === 0) return "";

  const plainRows = rows.map((row) => (row.children || []).map((cell) => renderTableCellPlainText(cell as TableCell)));
  const columnCount = Math.max(...plainRows.map((row) => row.length), 0);
  const widths = Array.from({ length: columnCount }, (_, col) => {
    const maxLen = plainRows.reduce((acc, row) => Math.max(acc, (row[col] || "").length), 3);
    return Math.min(Math.max(maxLen, 3), MAX_TABLE_COLUMN_WIDTH);
  });

  const toLine = (row: string[]): string => row
    .map((cell, col) => trimForTable(cell || "", widths[col]).padEnd(widths[col], " "))
    .join(" | ");

  const header = toLine(plainRows[0] || []);
  const separator = widths.map((w) => "-".repeat(w)).join("-+-");
  const body = plainRows.slice(1).map((row) => toLine(row));

  const tableAsText = [header, separator, ...body].join("\n");
  return `${CODE_BLOCK_OPEN}${escapeHtml(tableAsText)}${CODE_BLOCK_CLOSE}`;
}

function renderListItem(item: ListItem, list: List, index: number, depth: number): string {
  const indent = "  ".repeat(depth);
  const marker = list.ordered ? `${index + 1}. ` : "• ";

  const lines: string[] = [];

  for (const child of item.children || []) {
    if (child.type === "paragraph") {
      const content = renderInlineChildren((child as Paragraph).children).trim();
      if (content) lines.push(`${indent}${marker}${content}`);
      continue;
    }

    if (child.type === "list") {
      const nested = renderList(child as List, depth + 1);
      if (nested) lines.push(nested);
      continue;
    }

    const fallback = renderBlock(child, depth + 1).trim();
    if (fallback) lines.push(`${indent}${fallback}`);
  }

  if (lines.length === 0) {
    lines.push(`${indent}${marker}`.trimEnd());
  }

  return lines.join("\n");
}

function renderList(node: List, depth = 0): string {
  return (node.children || [])
    .map((child, index) => renderListItem(child as ListItem, node, index, depth))
    .filter(Boolean)
    .join("\n");
}

function splitCodeBlockByBudget(codeBlock: string, maxLen: number): string[] {
  if (codeBlock.length <= maxLen) return [codeBlock];

  if (!codeBlock.startsWith(CODE_BLOCK_OPEN) || !codeBlock.endsWith(CODE_BLOCK_CLOSE)) {
    const plain = stripTelegramHtml(codeBlock);
    return chunkPlainText(plain, maxLen).map((part) => escapeHtml(part));
  }

  const budget = Math.max(1, maxLen - CODE_BLOCK_OPEN.length - CODE_BLOCK_CLOSE.length);
  const body = codeBlock.slice(CODE_BLOCK_OPEN.length, codeBlock.length - CODE_BLOCK_CLOSE.length);
  const lines = body.split("\n");

  const parts: string[] = [];
  let current = "";

  const flush = () => {
    if (!current) return;
    parts.push(`${CODE_BLOCK_OPEN}${current}${CODE_BLOCK_CLOSE}`);
    current = "";
  };

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= budget) {
      current = candidate;
      continue;
    }

    flush();

    if (line.length <= budget) {
      current = line;
      continue;
    }

    for (let i = 0; i < line.length; i += budget) {
      parts.push(`${CODE_BLOCK_OPEN}${line.slice(i, i + budget)}${CODE_BLOCK_CLOSE}`);
    }
  }

  flush();
  return parts;
}

function chunkPlainText(text: string, maxLen: number): string[] {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];

  const parts: string[] = [];
  let cursor = 0;

  while (cursor < cleaned.length) {
    if (cleaned.length - cursor <= maxLen) {
      parts.push(cleaned.slice(cursor));
      break;
    }

    let splitAt = cleaned.lastIndexOf("\n", cursor + maxLen);
    if (splitAt <= cursor) splitAt = cleaned.lastIndexOf(" ", cursor + maxLen);
    if (splitAt <= cursor) splitAt = cursor + maxLen;

    parts.push(cleaned.slice(cursor, splitAt).trim());
    cursor = splitAt;
    while (cleaned[cursor] === " " || cleaned[cursor] === "\n") cursor += 1;
  }

  return parts.filter(Boolean);
}

function splitRenderedSegment(segment: string, maxLen: number): string[] {
  if (!segment) return [];
  if (segment.length <= maxLen) return [segment];

  if (segment.startsWith(CODE_BLOCK_OPEN) && segment.endsWith(CODE_BLOCK_CLOSE)) {
    return splitCodeBlockByBudget(segment, maxLen);
  }

  const codeIndex = segment.indexOf(`\n${CODE_BLOCK_OPEN}`);
  if (codeIndex > 0 && segment.endsWith(CODE_BLOCK_CLOSE)) {
    const head = segment.slice(0, codeIndex).trim();
    const codeBlock = segment.slice(codeIndex + 1);
    const codeParts = splitCodeBlockByBudget(codeBlock, maxLen);
    if (!head) return codeParts;
    if (head.length + 2 + (codeParts[0]?.length || 0) <= maxLen) {
      codeParts[0] = `${head}\n\n${codeParts[0]}`;
      return codeParts;
    }
    return [head, ...codeParts];
  }

  const plain = stripTelegramHtml(segment);
  return chunkPlainText(plain, maxLen).map((part) => escapeHtml(part));
}

function renderBlock(node: Content, depth = 0): string {
  switch (node.type) {
    case "paragraph":
      return renderInlineChildren((node as Paragraph).children).trim();

    case "heading": {
      const heading = node as Heading;
      const title = renderInlineChildren(heading.children).trim();
      return title ? `<b>${title}</b>` : "";
    }

    case "code":
      {
        const code = node as Code;
        const language = String(code.lang || "").trim().slice(0, 24);
        const languageLabel = language ? `<b>${escapeHtml(language.toUpperCase())}</b>\n` : "";
        return `${languageLabel}${CODE_BLOCK_OPEN}${escapeHtml(code.value || "")}${CODE_BLOCK_CLOSE}`;
      }

    case "math": {
      const value = ((node as Math).value || "").trim();
      if (!value) return "";
      return `<b>Formula</b>\n${CODE_BLOCK_OPEN}${escapeHtml(latexMathToTelegramText(value))}${CODE_BLOCK_CLOSE}`;
    }

    case "list":
      return renderList(node as List, depth);

    case "table":
      return renderTable(node as Table);

    case "blockquote": {
      const quote = node as Blockquote;
      const content = quote.children
        .map((child) => renderBlock(child, depth + 1))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!content) return "";
      return content
        .split("\n")
        .map((line) => `&gt; ${line}`)
        .join("\n");
    }

    case "thematicBreak":
      return "────────";

    default: {
      const maybeChildren = (node as unknown as { children?: Content[] }).children;
      if (!Array.isArray(maybeChildren)) return "";
      return maybeChildren
        .map((child) => renderBlock(child, depth + 1))
        .filter(Boolean)
        .join("\n");
    }
  }
}

function parseMarkdown(markdown: string): Root {
  const normalized = normalizeMathDelimiters(markdown || "");
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(normalized) as Root;
}

function fallbackTokenAt(index: number): string {
  return `${TELEGRAM_FALLBACK_TOKEN}${index}@@`;
}

function basicMarkdownToTelegramHtml(markdown: string): string {
  const tokens: string[] = [];
  const reserve = (html: string): string => {
    const tokenIndex = tokens.push(html) - 1;
    return fallbackTokenAt(tokenIndex);
  };

  let content = normalizeMathDelimiters(String(markdown || ""));

  content = content.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_full, _lang: string, codeBody: string) =>
    reserve(`${CODE_BLOCK_OPEN}${escapeHtml(String(codeBody || "").replace(/\n+$/, ""))}${CODE_BLOCK_CLOSE}`));

  content = content.replace(/\$\$([\s\S]+?)\$\$/g, (_full, mathBody: string) =>
    reserve(`<b>Formula</b>\n${CODE_BLOCK_OPEN}${escapeHtml(latexMathToTelegramText(mathBody))}${CODE_BLOCK_CLOSE}`));

  content = content.replace(/\$([^$\n]+)\$/g, (_full, inlineMath: string) =>
    reserve(`<code>${escapeHtml(latexMathToTelegramText(inlineMath))}</code>`));

  content = content.replace(/`([^`\n]+)`/g, (_full, inlineCode: string) =>
    reserve(`<code>${escapeHtml(String(inlineCode || ""))}</code>`));

  let html = escapeHtml(content);

  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<i>$2</i>");
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_full, rawLabel: string, rawHref: string) => {
    const href = safeHref(decodeBasicEntities(rawHref));
    if (!href) return rawLabel;
    return `<a href="${escapeHtml(href)}">${rawLabel}</a>`;
  });
  html = html
    .replace(/^\s*[-*]\s+(.+)$/gm, "• $1")
    .replace(/^\s*\d+\.\s+(.+)$/gm, (_full, item: string) => `1. ${item}`)
    .replace(/^>\s*(.+)$/gm, "&gt; $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    html = html.replaceAll(fallbackTokenAt(i), tokens[i]);
  }

  return html;
}

export function markdownToTelegramHtmlChunks(
  markdown: string,
  maxLen = TELEGRAM_CHUNK_FALLBACK_SIZE,
): string[] {
  const limit = Number.isFinite(maxLen) && maxLen > 128 ? Math.floor(maxLen) : TELEGRAM_CHUNK_FALLBACK_SIZE;

  try {
    const tree = parseMarkdown(markdown || "");
    const segments = (tree.children || [])
      .map((node) => renderBlock(node as Content))
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      const fallback = basicMarkdownToTelegramHtml(markdown);
      return fallback ? splitRenderedSegment(fallback, limit) : [];
    }

    const chunks: string[] = [];
    let current = "";

    for (const segment of segments) {
      const candidate = current ? `${current}\n\n${segment}` : segment;
      if (candidate.length <= limit) {
        current = candidate;
        continue;
      }

      if (current) {
        chunks.push(current);
        current = "";
      }

      const splitParts = splitRenderedSegment(segment, limit);
      if (splitParts.length === 0) continue;

      if (splitParts.length === 1) {
        current = splitParts[0];
        continue;
      }

      chunks.push(...splitParts.slice(0, -1));
      current = splitParts[splitParts.length - 1];
    }

    if (current) chunks.push(current);
    return chunks;
  } catch {
    const fallback = basicMarkdownToTelegramHtml(markdown);
    return splitRenderedSegment(fallback, limit);
  }
}

export function markdownToTelegramHtml(markdown: string): string {
  const chunks = markdownToTelegramHtmlChunks(markdown, Number.MAX_SAFE_INTEGER);
  return chunks.join("\n\n");
}

export function telegramHtmlToPlainText(html: string): string {
  return stripTelegramHtml(html);
}
