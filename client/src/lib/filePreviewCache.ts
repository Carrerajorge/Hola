/**
 * Cache de previsualizaciones de archivos en memoria
 * Evita re-extraer contenido cada vez que se hace clic en un archivo
 */

export interface CachedPreview {
  id: string;
  name: string;
  mimeType: string;
  content?: string;
  htmlContent?: string;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  extractedAt: number;
  size: number;
}

export interface ExtractionProgress {
  fileId: string;
  stage: "reading" | "extracting" | "parsing" | "ready" | "error";
  progress: number;
  message: string;
}

type ProgressCallback = (progress: ExtractionProgress) => void;

const previewCache = new Map<string, CachedPreview>();
const progressCallbacks = new Map<string, ProgressCallback>();

const MAX_CACHE_SIZE = 50 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 100;

let currentCacheSize = 0;

export function getCachedPreview(fileId: string): CachedPreview | null {
  return previewCache.get(fileId) || null;
}

export function setCachedPreview(preview: CachedPreview): void {
  const existing = previewCache.get(preview.id);
  if (existing) {
    currentCacheSize -= existing.size;
  }

  while (currentCacheSize + preview.size > MAX_CACHE_SIZE && previewCache.size > 0) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey) {
      const oldest = previewCache.get(oldestKey);
      if (oldest) {
        currentCacheSize -= oldest.size;
      }
      previewCache.delete(oldestKey);
    }
  }

  while (previewCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey) {
      const oldest = previewCache.get(oldestKey);
      if (oldest) {
        currentCacheSize -= oldest.size;
      }
      previewCache.delete(oldestKey);
    }
  }

  previewCache.set(preview.id, preview);
  currentCacheSize += preview.size;
}

export function clearCachedPreview(fileId: string): void {
  const existing = previewCache.get(fileId);
  if (existing) {
    currentCacheSize -= existing.size;
    previewCache.delete(fileId);
  }
}

export function clearAllCache(): void {
  previewCache.clear();
  currentCacheSize = 0;
}

export function getCacheStats(): { entries: number; size: number; maxSize: number } {
  return {
    entries: previewCache.size,
    size: currentCacheSize,
    maxSize: MAX_CACHE_SIZE,
  };
}

export function setExtractionProgress(fileId: string, progress: ExtractionProgress): void {
  const callback = progressCallbacks.get(fileId);
  if (callback) {
    callback(progress);
  }
}

export function subscribeToProgress(fileId: string, callback: ProgressCallback): () => void {
  progressCallbacks.set(fileId, callback);
  return () => {
    progressCallbacks.delete(fileId);
  };
}

export function extractTablesFromHtml(html: string): Array<{ headers: string[]; rows: string[][] }> {
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  
  if (!html || typeof DOMParser === "undefined") return tables;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tableElements = doc.querySelectorAll("table");

    tableElements.forEach((table) => {
      const headers: string[] = [];
      const rows: string[][] = [];

      const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
      if (headerRow) {
        headerRow.querySelectorAll("th, td").forEach((cell) => {
          headers.push(cell.textContent?.trim() || "");
        });
      }

      const bodyRows = table.querySelectorAll("tbody tr") || table.querySelectorAll("tr");
      bodyRows.forEach((row, index) => {
        if (index === 0 && headers.length === 0) return;
        
        const cells: string[] = [];
        row.querySelectorAll("td, th").forEach((cell) => {
          cells.push(cell.textContent?.trim() || "");
        });
        if (cells.length > 0) {
          rows.push(cells);
        }
      });

      if (headers.length > 0 || rows.length > 0) {
        tables.push({ headers, rows });
      }
    });
  } catch (e) {
    console.warn("Failed to extract tables from HTML:", e);
  }

  return tables;
}

export function htmlToMarkdown(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    const convertNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }

      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      const children = Array.from(element.childNodes).map(convertNode).join("");

      switch (tag) {
        case "h1":
          return `# ${children}\n\n`;
        case "h2":
          return `## ${children}\n\n`;
        case "h3":
          return `### ${children}\n\n`;
        case "h4":
          return `#### ${children}\n\n`;
        case "h5":
          return `##### ${children}\n\n`;
        case "h6":
          return `###### ${children}\n\n`;
        case "p":
          return `${children}\n\n`;
        case "br":
          return "\n";
        case "strong":
        case "b":
          return `**${children}**`;
        case "em":
        case "i":
          return `*${children}*`;
        case "code":
          return `\`${children}\``;
        case "pre":
          return `\`\`\`\n${children}\n\`\`\`\n\n`;
        case "blockquote":
          return `> ${children}\n\n`;
        case "ul":
        case "ol":
          return `${children}\n`;
        case "li":
          return `- ${children}\n`;
        case "a":
          const href = element.getAttribute("href") || "";
          return `[${children}](${href})`;
        case "img":
          const src = element.getAttribute("src") || "";
          const alt = element.getAttribute("alt") || "";
          return `![${alt}](${src})`;
        case "table":
          return `${children}\n`;
        case "tr":
          return `| ${children} |\n`;
        case "th":
        case "td":
          return children;
        default:
          return children;
      }
    };

    return convertNode(doc.body).trim();
  } catch (e) {
    console.warn("Failed to convert HTML to Markdown:", e);
    return html;
  }
}

export function exportContentAsFile(
  content: string,
  format: "txt" | "html" | "md",
  filename: string
): void {
  const mimeTypes: Record<string, string> = {
    txt: "text/plain;charset=utf-8",
    html: "text/html;charset=utf-8",
    md: "text/markdown;charset=utf-8",
  };

  const extensions: Record<string, string> = {
    txt: ".txt",
    html: ".html",
    md: ".md",
  };

  const BOM = "\uFEFF";
  const blob = new Blob([BOM + content], { type: mimeTypes[format] });
  const url = URL.createObjectURL(blob);
  
  const baseName = filename.replace(/\.[^.]+$/, "");
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}${extensions[format]}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
