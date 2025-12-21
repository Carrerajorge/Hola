import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import type { Root, Element, Text } from 'hast';
import { visit } from 'unist-util-visit';

/**
 * Common LaTeX commands that indicate mathematical content
 */
const LATEX_COMMANDS = [
  'int', 'sum', 'prod', 'lim', 'frac', 'sqrt', 'sin', 'cos', 'tan', 'log', 'ln',
  'exp', 'infty', 'alpha', 'beta', 'gamma', 'delta', 'theta', 'pi', 'sigma',
  'partial', 'nabla', 'cdot', 'times', 'div', 'pm', 'mp', 'leq', 'geq', 'neq',
  'approx', 'equiv', 'subset', 'supset', 'cup', 'cap', 'in', 'notin', 'forall',
  'exists', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'vec', 'hat',
  'bar', 'dot', 'ddot', 'binom', 'matrix', 'begin', 'end', 'left', 'right',
  'over', 'to', 'mapsto', 'implies', 'iff', 'land', 'lor', 'neg', 'oplus',
  'otimes', 'mathbb', 'mathcal', 'mathbf', 'mathrm', 'text'
];

/**
 * Wrap raw LaTeX expressions in $ delimiters so remark-math can parse them.
 * Detects expressions containing LaTeX commands like \int, \frac, \sin, etc.
 */
function wrapRawLatex(text: string): string {
  // Create regex to match LaTeX command patterns not already in $ delimiters
  const latexCommandPattern = new RegExp(
    `(?<!\\$)(\\\\(?:${LATEX_COMMANDS.join('|')})(?:[^\\s$]*|\\{[^}]*\\}|\\([^)]*\\)|\\[[^\\]]*\\])*)(?!\\$)`,
    'g'
  );
  
  // Find lines or expressions containing LaTeX and wrap them appropriately
  const lines = text.split('\n');
  const processedLines = lines.map(line => {
    // Skip lines that are already properly delimited
    if (line.includes('$') || line.includes('\\[') || line.includes('\\(')) {
      return line;
    }
    
    // Check if line contains LaTeX commands
    const hasLatex = LATEX_COMMANDS.some(cmd => line.includes(`\\${cmd}`));
    if (!hasLatex) {
      return line;
    }
    
    // If the entire line is a math expression, wrap it as display math
    const trimmed = line.trim();
    if (trimmed.startsWith('\\') && !trimmed.includes(' ')) {
      // Single expression on a line - display math
      return `$$${trimmed}$$`;
    }
    
    // For inline LaTeX within text, wrap individual expressions
    // Match LaTeX expressions: starts with \ followed by command and optionally braces/content
    return line.replace(
      /(\\(?:int|sum|prod|lim|frac|sqrt|sin|cos|tan|log|ln|exp|infty|alpha|beta|gamma|delta|theta|pi|sigma|partial|nabla|cdot|times|div|pm|mp|leq|geq|neq|approx|equiv|left|right|vec|hat|bar|binom|mathbb|mathcal|mathbf|mathrm|text)(?:\{[^}]*\}|\([^)]*\)|\[[^\]]*\]|[a-zA-Z0-9_^{}()\[\]\s+\-*/=<>.,]+)*)/g,
      (match) => {
        // Don't double-wrap if already in delimiters
        return `$${match}$`;
      }
    );
  });
  
  return processedLines.join('\n');
}

function normalizeMarkdown(text: string): string {
  let normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  
  // Convert LaTeX bracket delimiters to dollar delimiters
  normalized = normalized.replace(/\\\[/g, '$$').replace(/\\\]/g, '$$');
  normalized = normalized.replace(/\\\(/g, '$').replace(/\\\)/g, '$');
  
  // Wrap any remaining raw LaTeX expressions
  normalized = wrapRawLatex(normalized);
  
  return normalized;
}

/**
 * Custom rehype plugin that converts math nodes to TipTap-compatible format.
 * Instead of rendering math with KaTeX, it creates span elements with
 * data-type="inlineMath" that TipTap's MathExtension can parse.
 */
function rehypePreserveMath() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      
      // Handle inline math: <span class="math math-inline">...</span>
      if (
        node.tagName === 'span' &&
        node.properties?.className &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes('math-inline')
      ) {
        const latex = extractTextFromNode(node);
        // Create a TipTap-compatible math span
        const mathSpan: Element = {
          type: 'element',
          tagName: 'span',
          properties: {
            'data-type': 'inlineMath',
            'data-latex': latex,
            'data-evaluate': 'no',
            'data-display': 'no'
          },
          children: [{ type: 'text', value: `$${latex}$` }]
        };
        (parent as Element).children.splice(index, 1, mathSpan);
        return;
      }
      
      // Handle display math: <div class="math math-display">...</div>
      if (
        node.tagName === 'div' &&
        node.properties?.className &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes('math-display')
      ) {
        const latex = extractTextFromNode(node);
        // Create a TipTap-compatible math span with display mode
        const mathSpan: Element = {
          type: 'element',
          tagName: 'span',
          properties: {
            'data-type': 'inlineMath',
            'data-latex': latex,
            'data-evaluate': 'no',
            'data-display': 'yes'
          },
          children: [{ type: 'text', value: `$$${latex}$$` }]
        };
        // Wrap in a paragraph
        const paragraph: Element = {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [mathSpan]
        };
        (parent as Element).children.splice(index, 1, paragraph);
        return;
      }
    });
  };
}

/**
 * Extract text content from a HAST node recursively
 */
function extractTextFromNode(node: Element | Text): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'element' && node.children) {
    return node.children.map(child => extractTextFromNode(child as Element | Text)).join('');
  }
  return '';
}

export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return '<p></p>';
  }

  const normalized = normalizeMarkdown(markdown);
  
  try {
    const result = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(normalized);
    
    return String(result) || '<p></p>';
  } catch (error) {
    console.error('[markdownToHtml] Parse error:', error);
    return `<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
  }
}

export function markdownToHtmlAsync(markdown: string): Promise<string> {
  if (!markdown || markdown.trim() === '') {
    return Promise.resolve('<p></p>');
  }

  const normalized = normalizeMarkdown(markdown);
  
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(normalized)
    .then(result => String(result) || '<p></p>')
    .catch(error => {
      console.error('[markdownToHtml] Parse error:', error);
      return `<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
    });
}

/**
 * Converts markdown to HTML suitable for TipTap editor.
 * Unlike markdownToHtml, this function preserves $...$ and $$...$$ math delimiters
 * instead of rendering them with KaTeX. This allows TipTap's MathExtension to
 * properly handle the math content and preserve the LaTeX in node.attrs.latex.
 * 
 * Use this function when loading content into TipTap editor.
 * Use markdownToHtml for display-only rendering (e.g., chat messages).
 */
export function markdownToTipTap(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return '<p></p>';
  }

  const normalized = normalizeMarkdown(markdown);
  
  try {
    const result = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypePreserveMath) // Use our custom plugin instead of rehypeKatex
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(normalized);
    
    return String(result) || '<p></p>';
  } catch (error) {
    console.error('[markdownToTipTap] Parse error:', error);
    return `<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
  }
}
