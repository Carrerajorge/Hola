/**
 * Document Security Service
 *
 * Centralized security utilities for document generation:
 * - Filename sanitization (Content-Disposition injection prevention)
 * - Prompt validation and length limits
 * - Content sanitization
 * - Buffer size validation
 * - Generation tracking and audit logging
 */

// ============================================
// FILENAME SANITIZATION
// ============================================

/**
 * Maximum filename length (without extension)
 */
const MAX_FILENAME_LENGTH = 200;

/**
 * Characters allowed in filenames: alphanumeric, spaces, hyphens, underscores, dots
 * Everything else is stripped. Prevents Content-Disposition header injection.
 */
const SAFE_FILENAME_REGEX = /[^a-zA-Z0-9\s\-_.\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g;

/**
 * Sanitize a filename to prevent Content-Disposition header injection
 * and other path traversal attacks.
 */
export function sanitizeFilename(raw: string, extension: string): string {
  if (!raw || typeof raw !== "string") {
    return `document_${Date.now()}${extension}`;
  }

  let sanitized = raw
    // Remove path separators
    .replace(/[/\\]/g, "")
    // Remove null bytes
    .replace(/\0/g, "")
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, "")
    // Remove newlines and carriage returns (header injection)
    .replace(/[\r\n]/g, "")
    // Remove quotes that could break Content-Disposition
    .replace(/["']/g, "")
    // Replace unsafe characters with underscores
    .replace(SAFE_FILENAME_REGEX, "_")
    // Collapse multiple underscores
    .replace(/_+/g, "_")
    // Remove leading/trailing underscores and dots
    .replace(/^[_.]+|[_.]+$/g, "")
    .trim();

  // Enforce maximum length
  if (sanitized.length > MAX_FILENAME_LENGTH) {
    sanitized = sanitized.substring(0, MAX_FILENAME_LENGTH);
  }

  // Fallback if empty after sanitization
  if (!sanitized) {
    sanitized = `document_${Date.now()}`;
  }

  return `${sanitized}${extension}`;
}

/**
 * Build a safe Content-Disposition header value
 */
export function safeContentDisposition(filename: string): string {
  // RFC 6266: Use both filename and filename* for broad compatibility
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_");
  const encodedFilename = encodeURIComponent(filename);
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

// ============================================
// PROMPT VALIDATION
// ============================================

/**
 * Maximum prompt length (16KB)
 */
const MAX_PROMPT_LENGTH = 16 * 1024;

/**
 * Minimum prompt length
 */
const MIN_PROMPT_LENGTH = 3;

/**
 * Maximum body content size for document generation (1MB)
 */
export const MAX_DOC_BODY_SIZE = 1 * 1024 * 1024;

/**
 * Maximum HTML content size for PDF generation (10MB)
 */
export const MAX_HTML_CONTENT_SIZE = 10 * 1024 * 1024;

export interface PromptValidationResult {
  valid: boolean;
  error?: string;
  sanitizedPrompt?: string;
}

/**
 * Validate and sanitize a user prompt for document generation
 */
export function validatePrompt(prompt: unknown): PromptValidationResult {
  if (!prompt || typeof prompt !== "string") {
    return { valid: false, error: "Prompt is required and must be a string" };
  }

  const trimmed = prompt.trim();

  if (trimmed.length < MIN_PROMPT_LENGTH) {
    return { valid: false, error: `Prompt must be at least ${MIN_PROMPT_LENGTH} characters` };
  }

  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return {
      valid: false,
      error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters (got ${trimmed.length})`,
    };
  }

  // Remove null bytes and control characters from prompt
  const sanitized = trimmed
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return { valid: true, sanitizedPrompt: sanitized };
}

// ============================================
// BUFFER VALIDATION
// ============================================

/**
 * Maximum generated document size (100MB)
 */
const MAX_GENERATED_BUFFER_SIZE = 100 * 1024 * 1024;

/**
 * Validate that a generated document buffer is within acceptable limits
 */
export function validateBufferSize(buffer: Buffer, docType: string): { valid: boolean; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: `Generated ${docType} document is empty` };
  }

  if (buffer.length > MAX_GENERATED_BUFFER_SIZE) {
    return {
      valid: false,
      error: `Generated ${docType} document exceeds maximum size of ${MAX_GENERATED_BUFFER_SIZE / 1024 / 1024}MB`,
    };
  }

  return { valid: true };
}

// ============================================
// PPT VALIDATION
// ============================================

/**
 * PPT Limits for DoS protection
 */
export const PPT_LIMITS = {
  MAX_SLIDES: 200,
  MAX_TEXT_ELEMENTS_PER_SLIDE: 50,
  MAX_CONTENT_ITEMS_PER_SLIDE: 20,
  MAX_SLIDE_TITLE_LENGTH: 500,
  MAX_SLIDE_CONTENT_LENGTH: 5000,
  WARN_SLIDES: 100,
  WARN_TEXT_ELEMENTS: 30,
} as const;

export interface PptValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
}

export interface PptQualityReport {
  valid: boolean;
  errors: Array<{ code: string; message: string; path: string }>;
  warnings: Array<{ code: string; message: string; path: string }>;
}

/**
 * Validate slides data for PPT generation
 */
export function validatePptSlides(
  slides: Array<{ title: string; content: string[] }>
): PptQualityReport {
  const issues: PptValidationIssue[] = [];

  if (!Array.isArray(slides) || slides.length === 0) {
    issues.push({
      code: "PPT_E001",
      message: "Presentation must have at least one slide",
      path: "slides",
      severity: "error",
    });
    return buildPptReport(issues);
  }

  if (slides.length > PPT_LIMITS.MAX_SLIDES) {
    issues.push({
      code: "PPT_E002",
      message: `Presentation has ${slides.length} slides, maximum allowed is ${PPT_LIMITS.MAX_SLIDES}`,
      path: "slides",
      severity: "error",
    });
  } else if (slides.length > PPT_LIMITS.WARN_SLIDES) {
    issues.push({
      code: "PPT_W001",
      message: `Presentation has ${slides.length} slides, consider splitting into multiple presentations`,
      path: "slides",
      severity: "warning",
    });
  }

  slides.forEach((slide, index) => {
    const slidePath = `slides[${index}]`;

    if (!slide.title || typeof slide.title !== "string") {
      issues.push({
        code: "PPT_E003",
        message: `Slide ${index + 1} has no title`,
        path: `${slidePath}.title`,
        severity: "error",
      });
    } else if (slide.title.length > PPT_LIMITS.MAX_SLIDE_TITLE_LENGTH) {
      issues.push({
        code: "PPT_E004",
        message: `Slide ${index + 1} title exceeds ${PPT_LIMITS.MAX_SLIDE_TITLE_LENGTH} characters`,
        path: `${slidePath}.title`,
        severity: "error",
      });
    }

    if (!Array.isArray(slide.content)) {
      issues.push({
        code: "PPT_E005",
        message: `Slide ${index + 1} content must be an array`,
        path: `${slidePath}.content`,
        severity: "error",
      });
    } else {
      if (slide.content.length > PPT_LIMITS.MAX_CONTENT_ITEMS_PER_SLIDE) {
        issues.push({
          code: "PPT_E006",
          message: `Slide ${index + 1} has ${slide.content.length} content items, maximum is ${PPT_LIMITS.MAX_CONTENT_ITEMS_PER_SLIDE}`,
          path: `${slidePath}.content`,
          severity: "error",
        });
      }

      slide.content.forEach((item, itemIndex) => {
        if (typeof item === "string" && item.length > PPT_LIMITS.MAX_SLIDE_CONTENT_LENGTH) {
          issues.push({
            code: "PPT_E007",
            message: `Slide ${index + 1}, content item ${itemIndex + 1} exceeds ${PPT_LIMITS.MAX_SLIDE_CONTENT_LENGTH} characters`,
            path: `${slidePath}.content[${itemIndex}]`,
            severity: "error",
          });
        }
      });
    }
  });

  return buildPptReport(issues);
}

function buildPptReport(issues: PptValidationIssue[]): PptQualityReport {
  const errors = issues
    .filter((i) => i.severity === "error")
    .map(({ code, message, path }) => ({ code, message, path }));

  const warnings = issues
    .filter((i) => i.severity === "warning")
    .map(({ code, message, path }) => ({ code, message, path }));

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================
// PDF VALIDATION
// ============================================

/**
 * Validate a generated PDF buffer
 */
export function validatePdfBuffer(buffer: Buffer): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!buffer || buffer.length === 0) {
    errors.push("PDF buffer is empty");
    return { valid: false, errors, warnings };
  }

  // Check PDF header signature (%PDF-)
  const header = buffer.subarray(0, 5).toString("ascii");
  if (!header.startsWith("%PDF-")) {
    errors.push("Buffer does not have valid PDF signature (expected %PDF- header)");
    return { valid: false, errors, warnings };
  }

  // Check minimum reasonable size (a blank PDF is typically ~800 bytes)
  if (buffer.length < 100) {
    warnings.push("PDF is unusually small, may be incomplete");
  }

  // Check for EOF marker
  const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString("ascii");
  if (!tail.includes("%%EOF")) {
    warnings.push("PDF may be incomplete (missing %%EOF marker)");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================
// SHARED DOCUMENTS STORE WITH TTL
// ============================================

interface SharedDocument {
  blob: Buffer;
  expiresAt: Date;
  filename: string;
  createdBy?: string;
}

const MAX_SHARED_DOCUMENTS = 1000;
const SHARED_DOCUMENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class SharedDocumentStore {
  private documents = new Map<string, SharedDocument>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Allow Node.js to exit even if timer is running
    if (typeof this.cleanupTimer === "object" && this.cleanupTimer && "unref" in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  set(id: string, doc: Omit<SharedDocument, "expiresAt">, ttlMs: number = SHARED_DOCUMENT_TTL_MS): boolean {
    // Enforce maximum store size
    if (this.documents.size >= MAX_SHARED_DOCUMENTS) {
      this.cleanup();
      if (this.documents.size >= MAX_SHARED_DOCUMENTS) {
        console.warn("[SharedDocumentStore] Maximum capacity reached, rejecting new document");
        return false;
      }
    }

    this.documents.set(id, {
      ...doc,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return true;
  }

  get(id: string): SharedDocument | null {
    const doc = this.documents.get(id);
    if (!doc) return null;

    if (doc.expiresAt < new Date()) {
      this.documents.delete(id);
      return null;
    }

    return doc;
  }

  delete(id: string): void {
    this.documents.delete(id);
  }

  get size(): number {
    return this.documents.size;
  }

  private cleanup(): void {
    const now = new Date();
    let cleaned = 0;
    for (const [id, doc] of this.documents) {
      if (doc.expiresAt < now) {
        this.documents.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[SharedDocumentStore] Cleaned up ${cleaned} expired documents, ${this.documents.size} remaining`);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.documents.clear();
  }
}

// Singleton instance
export const sharedDocumentStore = new SharedDocumentStore();

// ============================================
// AUDIT LOGGING
// ============================================

export type DocumentEventType =
  | "generate_start"
  | "generate_success"
  | "generate_failure"
  | "render_start"
  | "render_success"
  | "render_failure"
  | "validation_error"
  | "security_violation"
  | "rate_limit_exceeded";

export interface DocumentAuditEvent {
  timestamp: string;
  event: DocumentEventType;
  docType: string;
  userId?: string;
  ip?: string;
  details?: Record<string, unknown>;
  durationMs?: number;
}

/**
 * Log a document generation audit event
 */
export function logDocumentEvent(event: DocumentAuditEvent): void {
  const logEntry = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  // Structured JSON logging for observability pipelines
  console.log(`[DocAudit] ${JSON.stringify(logEntry)}`);
}

// ============================================
// CONCURRENT GENERATION LIMITS
// ============================================

const MAX_CONCURRENT_PDF_GENERATIONS = 5;
const MAX_CONCURRENT_DOC_GENERATIONS = 20;

class ConcurrencyLimiter {
  private active = 0;

  constructor(private readonly maxConcurrent: number, private readonly name: string) {}

  async acquire(): Promise<boolean> {
    if (this.active >= this.maxConcurrent) {
      console.warn(`[ConcurrencyLimiter:${this.name}] Limit reached (${this.active}/${this.maxConcurrent})`);
      return false;
    }
    this.active++;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  get currentCount(): number {
    return this.active;
  }
}

export const pdfConcurrencyLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_PDF_GENERATIONS, "PDF");
export const docConcurrencyLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_DOC_GENERATIONS, "DOC");
