import React, { memo, useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";
import { Check, Copy, Loader2 } from "lucide-react";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "math",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "mfrac",
    "mroot",
    "msqrt",
    "mtext",
    "mspace",
    "mtable",
    "mtr",
    "mtd",
    "annotation",
    "semantics",
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polygon",
    "polyline",
    "g",
    "defs",
    "use",
    "symbol",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "className", "class", "style"],
    math: ["xmlns", "display"],
    svg: ["xmlns", "viewBox", "width", "height", "fill", "stroke"],
    path: ["d", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin"],
    code: ["className", "class"],
    span: ["className", "class", "style", "aria-hidden"],
    div: ["className", "class", "style"],
    img: ["src", "alt", "title", "loading", "width", "height"],
    a: ["href", "title", "target", "rel"],
    table: ["className", "class"],
    th: ["className", "class", "scope", "colSpan", "rowSpan"],
    td: ["className", "class", "colSpan", "rowSpan"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https", "data"],
    href: ["http", "https", "mailto", "#"],
  },
};

function processLatex(text: string): string {
  if (!text) return text;
  let processed = text
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
  return processed;
}

interface LazyImageProps {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
  maxHeight?: string;
}

const LazyImage = memo(function LazyImage({ 
  src, 
  alt, 
  title, 
  className,
  maxHeight = "400px" 
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setError(true), []);

  if (!src) return null;
  if (error) {
    return (
      <div className="flex items-center justify-center bg-muted rounded-lg p-4 my-3 text-muted-foreground text-sm">
        Error loading image
      </div>
    );
  }

  return (
    <div className="relative my-3">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={src}
        alt={alt || "Image"}
        title={title}
        loading="lazy"
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "max-w-full h-auto rounded-lg transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          className
        )}
        style={{ maxHeight }}
        data-testid="img-markdown"
      />
    </div>
  );
});

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const CodeBlock = memo(function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = match?.[1] || "";
  const codeContent = String(children).replace(/\n$/, "");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [codeContent]);

  if (inline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono">
        {children}
      </code>
    );
  }

  return (
    <div className="relative group my-4">
      {language && (
        <div className="absolute top-0 left-0 px-3 py-1 text-xs font-mono text-muted-foreground bg-muted/50 rounded-tl-lg rounded-br-lg">
          {language}
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-muted/80 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={copied ? "Copied" : "Copy code"}
        data-testid="button-copy-code"
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <pre className={cn("rounded-lg overflow-x-auto p-4 pt-8 bg-muted/30", className)}>
        <code className={cn("text-sm font-mono", className)}>{children}</code>
      </pre>
    </div>
  );
});

interface TableComponents {
  table: React.ComponentType<{ children?: React.ReactNode }>;
  thead: React.ComponentType<{ children?: React.ReactNode }>;
  tbody: React.ComponentType<{ children?: React.ReactNode }>;
  tr: React.ComponentType<{ children?: React.ReactNode }>;
  th: React.ComponentType<{ children?: React.ReactNode }>;
  td: React.ComponentType<{ children?: React.ReactNode }>;
}

const tableComponents: TableComponents = {
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border-collapse border border-border rounded-lg" data-testid="table-markdown">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-2 text-left text-sm font-semibold border border-border">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2 text-sm border border-border">{children}</td>
  ),
};

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  imageMaxHeight?: string;
  enableMath?: boolean;
  enableCodeHighlight?: boolean;
  enableGfm?: boolean;
  sanitize?: boolean;
  customComponents?: Record<string, React.ComponentType<any>>;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  imageMaxHeight = "400px",
  enableMath = true,
  enableCodeHighlight = true,
  enableGfm = true,
  sanitize = true,
  customComponents = {},
}: MarkdownRendererProps) {
  const processedContent = useMemo(() => {
    if (!content) return "";
    return enableMath ? processLatex(content) : content;
  }, [content, enableMath]);

  const remarkPlugins = useMemo(() => {
    const plugins: any[] = [];
    if (enableGfm) plugins.push(remarkGfm);
    if (enableMath) plugins.push(remarkMath);
    return plugins;
  }, [enableGfm, enableMath]);

  const rehypePlugins = useMemo(() => {
    const plugins: any[] = [];
    if (enableMath) plugins.push(rehypeKatex);
    if (enableCodeHighlight) plugins.push(rehypeHighlight);
    if (sanitize) plugins.push([rehypeSanitize, sanitizeSchema]);
    return plugins;
  }, [enableMath, enableCodeHighlight, sanitize]);

  const components = useMemo(() => ({
    code: CodeBlock,
    img: (props: any) => <LazyImage {...props} maxHeight={imageMaxHeight} />,
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 leading-relaxed">{children}</p>,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
        data-testid="link-markdown"
      >
        {children}
      </a>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => <li className="ml-2">{children}</li>,
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-xl font-bold mb-3 mt-4">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-lg font-bold mb-2 mt-3">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-base font-semibold mb-2 mt-2">{children}</h3>
    ),
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="text-sm font-semibold mb-2 mt-2">{children}</h4>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    ...tableComponents,
    ...customComponents,
  }), [imageMaxHeight, customComponents]);

  if (!processedContent) {
    return null;
  }

  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)} data-testid="markdown-renderer">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
