import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ExtractedContent {
  title: string;
  byline: string | null;
  content: string;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
  length: number;
  links: ExtractedLink[];
  images: ExtractedImage[];
  metadata: Record<string, string>;
}

export interface ExtractedLink {
  text: string;
  href: string;
  isInternal: boolean;
}

export interface ExtractedImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export function extractWithReadability(html: string, url: string): ExtractedContent | null {
  try {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    
    const reader = new Readability(document.cloneNode(true) as Document);
    const article = reader.parse();
    
    if (!article) return null;

    const baseUrl = new URL(url);
    const links = extractLinks(document, baseUrl);
    const images = extractImages(document, baseUrl);
    const metadata = extractMetadata(document);

    return {
      title: article.title || "",
      byline: article.byline || null,
      content: article.content || "",
      textContent: article.textContent || "",
      excerpt: article.excerpt || null,
      siteName: article.siteName || null,
      length: article.length || 0,
      links,
      images,
      metadata
    };
  } catch (error) {
    console.error("Readability extraction error:", error);
    return null;
  }
}

export function extractRawText(html: string): string {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const scripts = document.querySelectorAll("script, style, noscript");
    scripts.forEach(el => el.remove());
    
    return document.body?.textContent?.trim() || "";
  } catch {
    return "";
  }
}

function extractLinks(document: Document, baseUrl: URL): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const anchors = document.querySelectorAll("a[href]");
  
  anchors.forEach((anchor: Element) => {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    
    try {
      const absoluteUrl = new URL(href, baseUrl.origin);
      links.push({
        text: anchor.textContent?.trim() || "",
        href: absoluteUrl.href,
        isInternal: absoluteUrl.hostname === baseUrl.hostname
      });
    } catch {}
  });

  return links.slice(0, 100);
}

function extractImages(document: Document, baseUrl: URL): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const imgElements = document.querySelectorAll("img[src]");
  
  imgElements.forEach((img: Element) => {
    const src = img.getAttribute("src");
    if (!src) return;
    
    try {
      const absoluteUrl = new URL(src, baseUrl.origin);
      images.push({
        src: absoluteUrl.href,
        alt: img.getAttribute("alt") || "",
        width: parseInt(img.getAttribute("width") || "0") || undefined,
        height: parseInt(img.getAttribute("height") || "0") || undefined
      });
    } catch {}
  });

  return images.slice(0, 50);
}

function extractMetadata(document: Document): Record<string, string> {
  const metadata: Record<string, string> = {};
  
  const metaTags = document.querySelectorAll("meta[name], meta[property]");
  metaTags.forEach((meta: Element) => {
    const name = meta.getAttribute("name") || meta.getAttribute("property");
    const content = meta.getAttribute("content");
    if (name && content) {
      metadata[name] = content;
    }
  });

  const title = document.querySelector("title");
  if (title?.textContent) {
    metadata["title"] = title.textContent;
  }

  const canonical = document.querySelector("link[rel='canonical']");
  if (canonical) {
    metadata["canonical"] = canonical.getAttribute("href") || "";
  }

  return metadata;
}

export function summarizeForLLM(extracted: ExtractedContent, maxLength: number = 8000): string {
  let summary = `# ${extracted.title}\n\n`;
  
  if (extracted.byline) {
    summary += `*By: ${extracted.byline}*\n\n`;
  }
  
  if (extracted.excerpt) {
    summary += `> ${extracted.excerpt}\n\n`;
  }

  summary += "## Content\n\n";
  
  let content = extracted.textContent;
  if (content.length > maxLength - summary.length) {
    content = content.slice(0, maxLength - summary.length - 100) + "\n\n[Content truncated...]";
  }
  
  summary += content;

  return summary;
}
