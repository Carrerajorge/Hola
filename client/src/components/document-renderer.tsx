import React, { memo, useMemo, useState, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { parseDocument, detectFormat, type DocumentFormat } from "@/lib/rstParser";
import { Loader2 } from "lucide-react";

const MarkdownRenderer = lazy(() => import("./markdown-renderer"));

const CHUNK_SIZE = 50;
const CHUNK_HEIGHT_ESTIMATE = 100;

export interface DocumentRendererProps {
  content: string;
  format?: DocumentFormat;
  filename?: string;
  className?: string;
  lazyThreshold?: number;
  enableVirtualization?: boolean;
}

interface ContentChunk {
  id: number;
  content: string;
  startLine: number;
  endLine: number;
}

function splitIntoChunks(content: string, chunkSize: number): ContentChunk[] {
  const lines = content.split('\n');
  const chunks: ContentChunk[] = [];
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    chunks.push({
      id: Math.floor(i / chunkSize),
      content: chunkLines.join('\n'),
      startLine: i,
      endLine: Math.min(i + chunkSize, lines.length),
    });
  }
  
  return chunks;
}

const RstContent = memo(function RstContent({ html, className }: { html: string; className?: string }) {
  const sanitizedHtml = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 
                   'pre', 'code', 'strong', 'em', 'a', 'br', 'span', 'div', 'table', 'thead',
                   'tbody', 'tr', 'th', 'td', 'img', 'hr', 'dl', 'dt', 'dd', 'sub', 'sup'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  }), [html]);
  
  return (
    <div 
      className={cn("rst-content", className)}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      data-testid="rst-content"
    />
  );
});

interface LazyChunkProps {
  chunk: ContentChunk;
  format: "markdown" | "rst";
  isVisible: boolean;
  estimatedHeight: number;
  className?: string;
}

const LazyChunk = memo(function LazyChunk({ 
  chunk, 
  format, 
  isVisible, 
  estimatedHeight,
  className 
}: LazyChunkProps) {
  if (!isVisible) {
    return (
      <div 
        style={{ height: estimatedHeight, minHeight: 50 }}
        className="flex items-center justify-center text-muted-foreground"
        data-testid={`chunk-placeholder-${chunk.id}`}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (format === "rst") {
    const parsed = parseDocument(chunk.content, "rst");
    return <RstContent html={parsed.html} className={className} />;
  }

  return (
    <Suspense fallback={
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading content...</span>
      </div>
    }>
      <MarkdownRenderer content={chunk.content} className={className} />
    </Suspense>
  );
});

export const DocumentRenderer = memo(function DocumentRenderer({
  content,
  format = "auto",
  filename,
  className,
  lazyThreshold = 500,
  enableVirtualization = true,
}: DocumentRendererProps) {
  const [visibleChunks, setVisibleChunks] = useState<Set<number>>(new Set([0, 1, 2]));
  const containerRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const detectedFormat = useMemo(() => {
    return format === "auto" ? detectFormat(content, filename) : format;
  }, [content, format, filename]);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const shouldVirtualize = enableVirtualization && lineCount > lazyThreshold;
  const chunks = useMemo(() => {
    if (!shouldVirtualize) return null;
    return splitIntoChunks(content, CHUNK_SIZE);
  }, [content, shouldVirtualize]);

  const registerChunkRef = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) {
      chunkRefs.current.set(id, el);
      observerRef.current?.observe(el);
    } else {
      const existing = chunkRefs.current.get(id);
      if (existing) {
        observerRef.current?.unobserve(existing);
        chunkRefs.current.delete(id);
      }
    }
  }, []);

  useEffect(() => {
    if (!shouldVirtualize) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        setVisibleChunks(prev => {
          const next = new Set(prev);
          entries.forEach(entry => {
            const id = parseInt(entry.target.getAttribute('data-chunk-id') || '0');
            if (entry.isIntersecting) {
              next.add(id);
              next.add(id - 1);
              next.add(id + 1);
            }
          });
          return next;
        });
      },
      {
        root: null,
        rootMargin: '200px 0px',
        threshold: 0,
      }
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, [shouldVirtualize]);

  if (!shouldVirtualize) {
    if (detectedFormat === "rst") {
      const parsed = parseDocument(content, "rst", filename);
      return (
        <div className={cn("document-renderer", className)} data-testid="document-renderer">
          <RstContent html={parsed.html} />
        </div>
      );
    }

    return (
      <div className={cn("document-renderer", className)} data-testid="document-renderer">
        <Suspense fallback={
          <div className="flex items-center gap-2 p-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading markdown renderer...</span>
          </div>
        }>
          <MarkdownRenderer content={content} />
        </Suspense>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={cn("document-renderer", className)} 
      data-testid="document-renderer"
    >
      {chunks?.map((chunk) => (
        <div
          key={chunk.id}
          ref={(el) => registerChunkRef(chunk.id, el)}
          data-chunk-id={chunk.id}
          data-testid={`chunk-${chunk.id}`}
        >
          <LazyChunk
            chunk={chunk}
            format={detectedFormat}
            isVisible={visibleChunks.has(chunk.id)}
            estimatedHeight={CHUNK_HEIGHT_ESTIMATE * Math.min(chunk.endLine - chunk.startLine, CHUNK_SIZE)}
          />
        </div>
      ))}
    </div>
  );
});

export default DocumentRenderer;
