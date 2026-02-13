
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

// Initialize JSDOM window for DOMPurify to work in Node.js
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window as any);

// Allowed tags for Markdown (GitHub Flavored + CommonMark)
const ALLOWED_TAGS = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "blockquote",
    "pre", "code",
    "strong", "em", "b", "i", "u", "s", "del", "mark",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "details", "summary",
    "div", "span" // carefully used
];

// Allowed attributes
const ALLOWED_ATTR = [
    "href", "src", "alt", "title",
    "class", "id", // Be careful with ID collisions, maybe prefix?
    "width", "height",
    "align", "target", "rel",
    "start"
];

const SANITIZE_OPTIONS = {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style", "on*"], // explicitly forbid inline styles and event handlers
    ALLOW_DATA_ATTR: false,
};

/**
 * Sanitizes a Markdown string (or HTML generated from Markdown) to prevent XSS.
 * This should be used BEFORE storing user content in the database if possible,
 * or at least before rendering it on the server if server-side rendering is used.
 */
export function sanitizeMarkdown(content: string): string {
    if (!content) return "";
    return DOMPurify.sanitize(content, SANITIZE_OPTIONS) as string;
}

/**
 * Sanitizes specific fields of an object that are known to contain markdown/html.
 */
export function sanitizeMessageContent(content: string): string {
    return sanitizeMarkdown(content);
}
