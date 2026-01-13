import AsciiMathParser from "asciimath2tex";

const asciiMathParser = new AsciiMathParser();

export type MathInputType = "latex-inline" | "latex-block" | "asciimath" | "plain";

export interface MathDetectionResult {
  type: MathInputType;
  content: string;
  original: string;
}

export interface ParsedMathContent {
  segments: Array<{
    type: "text" | "math";
    content: string;
    mathType?: "inline" | "block";
    original?: string;
  }>;
}

const UNSAFE_PATTERNS = [
  /\\input\{/gi,
  /\\include\{/gi,
  /\\write\d*\{/gi,
  /\\read\d*/gi,
  /\\openin/gi,
  /\\openout/gi,
  /\\immediate/gi,
  /\\catcode/gi,
  /\\def\\/gi,
  /\\newcommand/gi,
  /\\renewcommand/gi,
  /\\let\\/gi,
  /\\csname/gi,
  /\\endcsname/gi,
  /\\expandafter/gi,
  /\\makeatletter/gi,
  /\\makeatother/gi,
];

export function sanitizeMathInput(input: string): string {
  if (!input) return input;
  let sanitized = input;
  for (const pattern of UNSAFE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  sanitized = sanitized.replace(/<[^>]*>/g, "");
  sanitized = sanitized.replace(/javascript:/gi, "");
  sanitized = sanitized.replace(/data:/gi, "");
  return sanitized.trim();
}

export function detectMathType(input: string): MathDetectionResult {
  if (!input) {
    return { type: "plain", content: input, original: input };
  }

  const trimmed = input.trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
    const content = sanitizeMathInput(trimmed.slice(2, -2).trim());
    return { type: "latex-block", content, original: input };
  }
  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) {
    const content = sanitizeMathInput(trimmed.slice(2, -2).trim());
    return { type: "latex-block", content, original: input };
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length > 2 && !trimmed.startsWith("$$")) {
    const content = sanitizeMathInput(trimmed.slice(1, -1).trim());
    return { type: "latex-inline", content, original: input };
  }
  if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)")) {
    const content = sanitizeMathInput(trimmed.slice(2, -2).trim());
    return { type: "latex-inline", content, original: input };
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 2 && !trimmed.startsWith("``")) {
    const content = trimmed.slice(1, -1).trim();
    return { type: "asciimath", content, original: input };
  }
  if (trimmed.startsWith("am`") && trimmed.endsWith("`")) {
    const content = trimmed.slice(3, -1).trim();
    return { type: "asciimath", content, original: input };
  }

  return { type: "plain", content: input, original: input };
}

export function asciiMathToLatex(asciiMath: string): string {
  if (!asciiMath) return "";
  try {
    const latex = asciiMathParser.parse(asciiMath);
    return sanitizeMathInput(latex);
  } catch (error) {
    console.warn("[asciiMathToLatex] Parse error:", error);
    return asciiMath;
  }
}

export function convertToLatex(input: string): { latex: string; isBlock: boolean } {
  const detected = detectMathType(input);
  
  switch (detected.type) {
    case "latex-block":
      return { latex: detected.content, isBlock: true };
    case "latex-inline":
      return { latex: detected.content, isBlock: false };
    case "asciimath":
      return { latex: asciiMathToLatex(detected.content), isBlock: false };
    case "plain":
    default:
      return { latex: sanitizeMathInput(input), isBlock: false };
  }
}

export function parseMathContent(text: string): ParsedMathContent {
  if (!text) {
    return { segments: [] };
  }

  const segments: ParsedMathContent["segments"] = [];
  const mathPatterns = [
    { regex: /\$\$([^$]+)\$\$/g, type: "block" as const },
    { regex: /\\\[([^\]]+)\\\]/g, type: "block" as const },
    { regex: /\$([^$\n]+)\$/g, type: "inline" as const },
    { regex: /\\\(([^)]+)\\\)/g, type: "inline" as const },
    { regex: /am`([^`]+)`/g, type: "inline" as const, isAsciiMath: true },
  ];
  
  interface Match {
    start: number;
    end: number;
    content: string;
    mathType: "inline" | "block";
    original: string;
    isAsciiMath?: boolean;
  }
  
  const allMatches: Match[] = [];
  
  for (const pattern of mathPatterns) {
    let match;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    while ((match = regex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        mathType: pattern.type,
        original: match[0],
        isAsciiMath: (pattern as any).isAsciiMath,
      });
    }
  }
  allMatches.sort((a, b) => a.start - b.start);
  const filteredMatches: Match[] = [];
  let lastEnd = 0;
  for (const match of allMatches) {
    if (match.start >= lastEnd) {
      filteredMatches.push(match);
      lastEnd = match.end;
    }
  }
  let currentPos = 0;
  for (const match of filteredMatches) {
    if (match.start > currentPos) {
      segments.push({
        type: "text",
        content: text.slice(currentPos, match.start),
      });
    }
    const latex = match.isAsciiMath 
      ? asciiMathToLatex(match.content)
      : sanitizeMathInput(match.content);
    
    segments.push({
      type: "math",
      content: latex,
      mathType: match.mathType,
      original: match.original,
    });
    
    currentPos = match.end;
  }
  if (currentPos < text.length) {
    segments.push({
      type: "text",
      content: text.slice(currentPos),
    });
  }

  return { segments };
}

export function preprocessMathInMarkdown(markdown: string): string {
  if (!markdown) return markdown;
  try {
    let processed = markdown
      .replace(/\\\[/g, "$$")
      .replace(/\\\]/g, "$$")
      .replace(/\\\(/g, "$")
      .replace(/\\\)/g, "$");
    processed = processed.replace(/am`([^`]+)`/g, (_, asciiMath) => {
      try {
        const latex = asciiMathToLatex(asciiMath);
        return `$${latex}$`;
      } catch {
        return asciiMath;
      }
    });

    return processed;
  } catch (error) {
    console.warn('[preprocessMathInMarkdown] Error processing math:', error);
    return markdown;
  }
}
