import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";

function normalizeMarkdown(text: string): string {
  let normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  
  normalized = normalized.replace(/\\\[/g, '$$').replace(/\\\]/g, '$$');
  normalized = normalized.replace(/\\\(/g, '$').replace(/\\\)/g, '$');
  
  return normalized;
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
