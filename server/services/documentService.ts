import { z } from "zod";
import { randomUUID } from "crypto";
import { generatePdfFromHtml, PdfOptions } from "./pdfGeneration";
import {
  generateWordDocument,
  generateExcelDocument,
  generatePptDocument,
  parseExcelFromText,
  parseSlidesFromText
} from "./documentGeneration";

// ============================================
// SECURITY: HTML entity escaping to prevent XSS
// ============================================

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#96;",
};

function escapeHtml(str: unknown): string {
  const s = String(str ?? "");
  return s.replace(/[&<>"'`/]/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

// ============================================
// SECURITY: Document store limits
// ============================================

/** Maximum number of documents stored simultaneously */
const MAX_DOCUMENT_STORE_COUNT = 200;

/** Maximum total bytes across all stored documents (500MB) */
const MAX_DOCUMENT_STORE_BYTES = 500 * 1024 * 1024;

export const DocumentTypeSchema = z.enum(["pdf", "docx", "xlsx", "pptx"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentRenderRequestSchema = z.object({
  templateId: z.string().min(1, "Template ID is required"),
  type: DocumentTypeSchema,
  data: z.record(z.any()),
  options: z.object({
    format: z.enum(["A4", "Letter", "Legal", "Tabloid", "A3", "A5"]).optional(),
    landscape: z.boolean().optional(),
    margin: z.object({
      top: z.string().optional(),
      right: z.string().optional(),
      bottom: z.string().optional(),
      left: z.string().optional(),
    }).optional(),
    printBackground: z.boolean().optional(),
    scale: z.number().min(0.1).max(2).optional(),
  }).optional(),
});

export type DocumentRenderRequest = z.infer<typeof DocumentRenderRequestSchema>;

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  type: DocumentType[];
  requiredFields: string[];
  optionalFields?: string[];
  exampleData?: Record<string, any>;
}

export interface GeneratedDocument {
  id: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  createdAt: Date;
  expiresAt: Date;
}

const documentStore: Map<string, GeneratedDocument> = new Map();

const DOCUMENT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

const builtInTemplates: DocumentTemplate[] = [
  {
    id: "report",
    name: "Report Template",
    description: "A standard report with title, sections, and content",
    type: ["pdf", "docx"],
    requiredFields: ["title", "content"],
    optionalFields: ["author", "date", "sections"],
    exampleData: {
      title: "Quarterly Report",
      content: "# Introduction\n\nThis is the report content...",
      author: "John Doe",
      date: "2024-01-01"
    }
  },
  {
    id: "invoice",
    name: "Invoice Template",
    description: "Professional invoice with line items and totals",
    type: ["pdf", "docx", "xlsx"],
    requiredFields: ["invoiceNumber", "clientName", "items"],
    optionalFields: ["companyName", "companyAddress", "clientAddress", "dueDate", "notes"],
    exampleData: {
      invoiceNumber: "INV-001",
      clientName: "Acme Corp",
      items: [
        { description: "Service A", quantity: 2, unitPrice: 100 },
        { description: "Service B", quantity: 1, unitPrice: 250 }
      ]
    }
  },
  {
    id: "spreadsheet",
    name: "Data Spreadsheet",
    description: "Tabular data export with headers",
    type: ["xlsx"],
    requiredFields: ["headers", "rows"],
    optionalFields: ["sheetName"],
    exampleData: {
      headers: ["Name", "Email", "Status"],
      rows: [
        ["John Doe", "john@example.com", "Active"],
        ["Jane Smith", "jane@example.com", "Pending"]
      ]
    }
  },
  {
    id: "presentation",
    name: "Presentation Template",
    description: "Slide deck with title and bullet points",
    type: ["pptx"],
    requiredFields: ["title", "slides"],
    optionalFields: ["author", "theme"],
    exampleData: {
      title: "Project Overview",
      slides: [
        { title: "Introduction", content: ["Overview", "Goals", "Timeline"] },
        { title: "Details", content: ["Feature 1", "Feature 2", "Feature 3"] }
      ]
    }
  },
  {
    id: "letter",
    name: "Business Letter",
    description: "Formal letter with recipient and sender details",
    type: ["pdf", "docx"],
    requiredFields: ["recipient", "subject", "body"],
    optionalFields: ["senderName", "senderAddress", "date", "closing"],
    exampleData: {
      recipient: "Dear Client",
      subject: "Re: Your Inquiry",
      body: "Thank you for reaching out...",
      senderName: "Your Company",
      closing: "Best regards"
    }
  },
  {
    id: "custom",
    name: "Custom Document",
    description: "Flexible template for custom content",
    type: ["pdf", "docx", "xlsx", "pptx"],
    requiredFields: ["content"],
    optionalFields: ["title", "format"],
    exampleData: {
      title: "Custom Document",
      content: "Your content here"
    }
  }
];

export function getTemplates(): DocumentTemplate[] {
  return builtInTemplates;
}

export function getTemplateById(id: string): DocumentTemplate | undefined {
  return builtInTemplates.find(t => t.id === id);
}

function generateDocumentId(): string {
  return `doc_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '')}`;
}

function getMimeType(type: DocumentType): string {
  switch (type) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
}

function getFileExtension(type: DocumentType): string {
  return type === "pdf" ? "pdf" : type;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 100);
}

function renderTemplateToHtml(template: DocumentTemplate, data: Record<string, any>): string {
  const title = data.title || template.name;
  
  switch (template.id) {
    case "invoice":
      return renderInvoiceHtml(data);
    case "report":
      return renderReportHtml(data);
    case "letter":
      return renderLetterHtml(data);
    default:
      return renderGenericHtml(title, data);
  }
}

function renderInvoiceHtml(data: Record<string, any>): string {
  const items = Array.isArray(data.items) ? data.items.slice(0, 1000) : [];
  const total = items.reduce((sum: number, item: any) => {
    const qty = Number(item.quantity) || 1;
    const price = Number(item.unitPrice) || 0;
    return sum + qty * price;
  }, 0);

  const itemsHtml = items.map((item: any) => {
    const qty = Number(item.quantity) || 1;
    const price = Number(item.unitPrice) || 0;
    return `
    <tr>
      <td>${escapeHtml(item.description)}</td>
      <td style="text-align: center">${escapeHtml(qty)}</td>
      <td style="text-align: right">$${escapeHtml(price.toFixed(2))}</td>
      <td style="text-align: right">$${escapeHtml((qty * price).toFixed(2))}</td>
    </tr>
  `;
  }).join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .invoice-title { font-size: 32px; color: #333; }
        .invoice-number { color: #666; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; border-bottom: 1px solid #ddd; }
        th { background: #f5f5f5; text-align: left; }
        .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; }
        .notes { margin-top: 40px; padding: 20px; background: #f9f9f9; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="invoice-title">INVOICE</div>
          <div class="invoice-number">${escapeHtml(data.invoiceNumber || "INV-001")}</div>
        </div>
        <div style="text-align: right">
          <div><strong>${escapeHtml(data.companyName)}</strong></div>
          <div>${escapeHtml(data.companyAddress)}</div>
        </div>
      </div>

      <div style="margin-bottom: 30px">
        <strong>Bill To:</strong><br>
        ${escapeHtml(data.clientName)}<br>
        ${escapeHtml(data.clientAddress)}
      </div>

      ${data.dueDate ? `<div><strong>Due Date:</strong> ${escapeHtml(data.dueDate)}</div>` : ""}

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th style="text-align: center">Quantity</th>
            <th style="text-align: right">Unit Price</th>
            <th style="text-align: right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="total">Total: $${escapeHtml(total.toFixed(2))}</div>

      ${data.notes ? `<div class="notes"><strong>Notes:</strong><br>${escapeHtml(data.notes)}</div>` : ""}
    </body>
    </html>
  `;
}

function renderReportHtml(data: Record<string, any>): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Georgia, serif; padding: 40px; line-height: 1.6; }
        h1 { color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .meta { color: #666; margin-bottom: 30px; }
        .content { white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(data.title || "Report")}</h1>
      <div class="meta">
        ${data.author ? `<div>Author: ${escapeHtml(data.author)}</div>` : ""}
        ${data.date ? `<div>Date: ${escapeHtml(data.date)}</div>` : ""}
      </div>
      <div class="content">${escapeHtml(data.content)}</div>
    </body>
    </html>
  `;
}

function renderLetterHtml(data: Record<string, any>): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Georgia, serif; padding: 60px; line-height: 1.8; }
        .sender { text-align: right; margin-bottom: 40px; }
        .date { margin-bottom: 40px; }
        .recipient { margin-bottom: 30px; }
        .subject { font-weight: bold; margin-bottom: 30px; }
        .body { margin-bottom: 40px; white-space: pre-wrap; }
        .closing { margin-top: 40px; }
      </style>
    </head>
    <body>
      <div class="sender">
        ${escapeHtml(data.senderName)}<br>
        ${escapeHtml(data.senderAddress)}
      </div>

      <div class="date">${escapeHtml(data.date || new Date().toLocaleDateString())}</div>

      <div class="recipient">${escapeHtml(data.recipient)}</div>

      ${data.subject ? `<div class="subject">Subject: ${escapeHtml(data.subject)}</div>` : ""}

      <div class="body">${escapeHtml(data.body)}</div>

      <div class="closing">
        ${escapeHtml(data.closing || "Sincerely")},<br><br>
        ${escapeHtml(data.senderName)}
      </div>
    </body>
    </html>
  `;
}

function renderGenericHtml(title: string, data: Record<string, any>): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; line-height: 1.6; }
        h1 { color: #333; }
        .content { white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <div class="content">${escapeHtml(data.content)}</div>
    </body>
    </html>
  `;
}

async function generatePdf(template: DocumentTemplate, data: Record<string, any>, options?: PdfOptions): Promise<Buffer> {
  const html = renderTemplateToHtml(template, data);
  return generatePdfFromHtml(html, options);
}

async function generateDocx(template: DocumentTemplate, data: Record<string, any>): Promise<Buffer> {
  const title = data.title || template.name;
  const content = data.content || JSON.stringify(data, null, 2);
  return generateWordDocument(title, content);
}

async function generateXlsx(template: DocumentTemplate, data: Record<string, any>): Promise<Buffer> {
  const title = data.title || data.sheetName || template.name;
  
  let excelData: any[][];
  if (data.headers && data.rows) {
    excelData = [data.headers, ...data.rows];
  } else if (data.items && Array.isArray(data.items)) {
    const headers = Object.keys(data.items[0] || {});
    const rows = data.items.map((item: any) => headers.map(h => item[h]));
    excelData = [headers, ...rows];
  } else if (typeof data.content === "string") {
    excelData = parseExcelFromText(data.content);
  } else {
    excelData = [["Content"], [JSON.stringify(data)]];
  }
  
  return generateExcelDocument(title, excelData);
}

async function generatePptx(template: DocumentTemplate, data: Record<string, any>): Promise<Buffer> {
  const title = data.title || template.name;
  
  let slides: { title: string; content: string[] }[];
  if (data.slides && Array.isArray(data.slides)) {
    slides = data.slides.map((slide: any) => ({
      title: slide.title || "Slide",
      content: Array.isArray(slide.content) ? slide.content : [slide.content || ""]
    }));
  } else if (typeof data.content === "string") {
    slides = parseSlidesFromText(data.content);
  } else {
    slides = [{ title: title, content: ["Content"] }];
  }
  
  return generatePptDocument(title, slides);
}

export async function renderDocument(request: DocumentRenderRequest): Promise<GeneratedDocument> {
  const template = getTemplateById(request.templateId);
  if (!template) {
    throw new Error(`Template not found: ${request.templateId}`);
  }
  
  if (!template.type.includes(request.type)) {
    throw new Error(`Template "${template.name}" does not support type "${request.type}". Supported types: ${template.type.join(", ")}`);
  }
  
  for (const field of template.requiredFields) {
    if (request.data[field] === undefined) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  let buffer: Buffer;
  
  switch (request.type) {
    case "pdf":
      buffer = await generatePdf(template, request.data, request.options);
      break;
    case "docx":
      buffer = await generateDocx(template, request.data);
      break;
    case "xlsx":
      buffer = await generateXlsx(template, request.data);
      break;
    case "pptx":
      buffer = await generatePptx(template, request.data);
      break;
    default:
      throw new Error(`Unsupported document type: ${request.type}`);
  }
  
  const docId = generateDocumentId();
  const title = request.data.title || template.name;
  const fileName = `${sanitizeFileName(title)}.${getFileExtension(request.type)}`;
  
  const document: GeneratedDocument = {
    id: docId,
    fileName,
    mimeType: getMimeType(request.type),
    buffer,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + DOCUMENT_EXPIRY_MS),
  };
  
  // Security: enforce document store limits
  enforceDocumentStoreLimits();
  documentStore.set(docId, document);

  return document;
}

export function getGeneratedDocument(id: string): GeneratedDocument | undefined {
  const doc = documentStore.get(id);
  if (!doc) return undefined;
  
  if (new Date() > doc.expiresAt) {
    documentStore.delete(id);
    return undefined;
  }
  
  return doc;
}

export function deleteGeneratedDocument(id: string): boolean {
  return documentStore.delete(id);
}

export function cleanupExpiredDocuments(): number {
  const now = new Date();
  let cleaned = 0;

  const entries = Array.from(documentStore.entries());
  for (const [id, doc] of entries) {
    if (now > doc.expiresAt) {
      documentStore.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Security: enforce document store size limits to prevent memory exhaustion.
 * Evicts oldest documents when count or total byte limits are exceeded.
 */
function enforceDocumentStoreLimits(): void {
  // Evict expired first
  cleanupExpiredDocuments();

  // Evict oldest if count limit exceeded
  while (documentStore.size >= MAX_DOCUMENT_STORE_COUNT) {
    let oldest: { id: string; createdAt: Date } | null = null;
    for (const [id, doc] of documentStore) {
      if (!oldest || doc.createdAt < oldest.createdAt) {
        oldest = { id, createdAt: doc.createdAt };
      }
    }
    if (oldest) {
      documentStore.delete(oldest.id);
    } else {
      break;
    }
  }

  // Evict oldest if total bytes exceeded
  let totalBytes = 0;
  for (const doc of documentStore.values()) {
    totalBytes += doc.buffer.length;
  }
  while (totalBytes > MAX_DOCUMENT_STORE_BYTES && documentStore.size > 0) {
    let oldest: { id: string; createdAt: Date; size: number } | null = null;
    for (const [id, doc] of documentStore) {
      if (!oldest || doc.createdAt < oldest.createdAt) {
        oldest = { id, createdAt: doc.createdAt, size: doc.buffer.length };
      }
    }
    if (oldest) {
      documentStore.delete(oldest.id);
      totalBytes -= oldest.size;
    } else {
      break;
    }
  }
}

// Cleanup every 2 minutes (more frequent than before)
setInterval(() => {
  const cleaned = cleanupExpiredDocuments();
  if (cleaned > 0) {
    console.log(`[documentService] Cleaned up ${cleaned} expired documents (store size: ${documentStore.size})`);
  }
}, 2 * 60 * 1000);
