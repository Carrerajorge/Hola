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
      return { latex: input, isBlock: false };
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

function convertPlainMathToLatex(text: string): string {
  let result = text;
  result = result
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/⁴/g, '^4')
    .replace(/⁵/g, '^5')
    .replace(/⁶/g, '^6')
    .replace(/⁷/g, '^7')
    .replace(/⁸/g, '^8')
    .replace(/⁹/g, '^9')
    .replace(/⁰/g, '^0')
    .replace(/⁺/g, '^+')
    .replace(/⁻/g, '^-')
    .replace(/ⁿ/g, '^n');
  result = result
    .replace(/₀/g, '_0')
    .replace(/₁/g, '_1')
    .replace(/₂/g, '_2')
    .replace(/₃/g, '_3')
    .replace(/₄/g, '_4')
    .replace(/₅/g, '_5')
    .replace(/₆/g, '_6')
    .replace(/₇/g, '_7')
    .replace(/₈/g, '_8')
    .replace(/₉/g, '_9');
  result = result
    .replace(/×/g, ' \\times ')
    .replace(/÷/g, ' \\div ')
    .replace(/±/g, ' \\pm ')
    .replace(/≈/g, ' \\approx ')
    .replace(/≠/g, ' \\neq ')
    .replace(/≤/g, ' \\leq ')
    .replace(/≥/g, ' \\geq ')
    .replace(/∞/g, ' \\infty ')
    .replace(/√/g, '\\sqrt')
    .replace(/π/g, '\\pi ')
    .replace(/α/g, '\\alpha ')
    .replace(/β/g, '\\beta ')
    .replace(/γ/g, '\\gamma ')
    .replace(/δ/g, '\\delta ')
    .replace(/θ/g, '\\theta ')
    .replace(/λ/g, '\\lambda ')
    .replace(/μ/g, '\\mu ')
    .replace(/σ/g, '\\sigma ')
    .replace(/Σ/g, '\\Sigma ')
    .replace(/∑/g, '\\sum ')
    .replace(/∏/g, '\\prod ')
    .replace(/∫/g, '\\int ');
  result = result.replace(/\s*\*\s*/g, ' \\times ');
  return result;
}

function detectAndWrapMathExpressions(text: string): string {
  const mathLinePattern = /^(\s*)([a-zA-Z]+\s*=\s*[\d\.\(\)\+\-\*\/\^\s×÷±≈≠≤≥∞√πα-ωΑ-Ω²³⁴⁵⁶⁷⁸⁹⁰⁺⁻ⁿ₀-₉,]+)$/gm;
  
  let result = text.replace(mathLinePattern, (match, indent, expr) => {
    if (expr.includes('$')) return match;
    const latex = convertPlainMathToLatex(expr.trim());
    return `${indent}$${latex}$`;
  });
  const complexMathPattern = /([a-zA-Z]+\s*=\s*\([^)]+\)\s*\/\s*\([^)]+\))/g;
  result = result.replace(complexMathPattern, (match) => {
    if (match.includes('$')) return match;
    if (/^https?:\/\//.test(match)) return match;
    const latex = convertPlainMathToLatex(match);
    return `$${latex}$`;
  });

  return result;
}

export function preprocessMathInMarkdown(markdown: string): string {
  if (!markdown) return markdown;
  let processed = markdown
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
  processed = processed.replace(/am`([^`]+)`/g, (_, asciiMath) => {
    const latex = asciiMathToLatex(asciiMath);
    return `$${latex}$`;
  });
  processed = detectAndWrapMathExpressions(processed);

  return processed;
}
