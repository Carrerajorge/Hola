import { z } from "zod";

const MIME_TYPE_REGEX = /^[a-z]+\/[a-z0-9\-\+\.]+$/i;

const ATTACHMENT_TYPE_VALUES = [
  // Canonical
  "document",
  "image",
  "file",
  // Legacy / client variants we canonicalize server-side (robustness)
  "pdf",
  "word",
  "excel",
  "ppt",
  "spreadsheet",
  "presentation",
  "text",
  "code",
  "archive",
  "unknown",
] as const;

export const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1, "Message content cannot be empty").max(100000, "Message content exceeds 100,000 character limit"),
});

export const AttachmentSchema = z.object({
  name: z.string().min(1, "Attachment name is required").max(255, "Attachment name exceeds 255 characters"),
  mimeType: z.string().regex(MIME_TYPE_REGEX, "Invalid mimeType format (expected: type/subtype)"),
  type: z.enum(ATTACHMENT_TYPE_VALUES, {
    errorMap: () => ({ message: `Attachment type must be one of: ${ATTACHMENT_TYPE_VALUES.join(", ")}` }),
  }),
  content: z.string().optional(),
  url: z.string().url("Invalid URL format").optional(),
  size: z.number().int("Size must be an integer").positive("Size must be positive").optional(),
  fileId: z.string().optional(),
  storagePath: z.string().optional(),
}).refine(
  (data) => data.content || data.url || data.storagePath || data.fileId,
  { message: "Attachment must have content, url, storagePath, or fileId" }
);

export const AnalyzeRequestSchema = z.object({
  messages: z.array(MessageSchema)
    .min(1, "At least one message is required")
    .max(100, "Maximum 100 messages allowed"),
  conversationId: z.string().min(1).max(100, "Conversation ID exceeds 100 characters").optional(),
  attachments: z.array(AttachmentSchema)
    .min(1, "At least one attachment is required for analysis")
    .max(20, "Maximum 20 attachments allowed per request"),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema)
    .min(1, "At least one message is required")
    .max(100, "Maximum 100 messages allowed"),
  conversationId: z.string().min(1).max(100).optional(),
  attachments: z.array(AttachmentSchema).max(20).optional(),
  useRag: z.boolean().optional(),
  images: z.array(z.string()).optional(),
  gptConfig: z.record(z.any()).optional(),
  documentMode: z.boolean().optional(),
  figmaMode: z.boolean().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export const TypeLimitsSchema = z.object({
  pdf: z.object({
    maxPages: z.number().int().positive().default(500),
    maxSizeBytes: z.number().int().positive().default(50 * 1024 * 1024),
  }).default({}),
  xlsx: z.object({
    maxRows: z.number().int().positive().default(100000),
    maxCells: z.number().int().positive().default(1000000),
    maxSheets: z.number().int().positive().default(50),
    maxSizeBytes: z.number().int().positive().default(50 * 1024 * 1024),
  }).default({}),
  csv: z.object({
    maxRows: z.number().int().positive().default(100000),
    maxColumns: z.number().int().positive().default(1000),
    maxSizeBytes: z.number().int().positive().default(50 * 1024 * 1024),
  }).default({}),
  pptx: z.object({
    maxSlides: z.number().int().positive().default(200),
    maxSizeBytes: z.number().int().positive().default(100 * 1024 * 1024),
  }).default({}),
  docx: z.object({
    maxPages: z.number().int().positive().default(500),
    maxSizeBytes: z.number().int().positive().default(50 * 1024 * 1024),
  }).default({}),
  txt: z.object({
    maxLines: z.number().int().positive().default(100000),
    maxSizeBytes: z.number().int().positive().default(10 * 1024 * 1024),
  }).default({}),
  json: z.object({
    maxSizeBytes: z.number().int().positive().default(10 * 1024 * 1024),
    maxDepth: z.number().int().positive().default(50),
  }).default({}),
});

export type Message = z.infer<typeof MessageSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type TypeLimits = z.infer<typeof TypeLimitsSchema>;

export const DEFAULT_TYPE_LIMITS: TypeLimits = TypeLimitsSchema.parse({});

export interface ValidationFieldError {
  path: string;
  message: string;
  code: string;
  received?: unknown;
  expected?: string;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationFieldError[];
}

export function formatZodErrors(error: z.ZodError): ValidationFieldError[] {
  return error.errors.map((err) => ({
    path: err.path.join("."),
    message: err.message,
    code: err.code,
    received: "received" in err ? err.received : undefined,
    expected: "expected" in err ? String(err.expected) : undefined,
  }));
}

export function validateAnalyzeRequest(body: unknown): ValidationResult<AnalyzeRequest> {
  const result = AnalyzeRequestSchema.safeParse(body);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return {
    success: false,
    errors: formatZodErrors(result.error),
  };
}

export function validateChatRequest(body: unknown): ValidationResult<ChatRequest> {
  const result = ChatRequestSchema.safeParse(body);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return {
    success: false,
    errors: formatZodErrors(result.error),
  };
}

export function canonicalizeAttachment(attachment: Attachment): Attachment {
  const canonicalizeType = (
    rawType: string,
    mimeType: string,
    name: string
  ): "document" | "image" | "file" => {
    const t = (rawType || "").toLowerCase().trim();
    const mt = (mimeType || "").toLowerCase().trim();
    const lowerName = (name || "").toLowerCase();

    // Prefer MIME detection for images.
    if (t === "image" || t.startsWith("image/") || mt.startsWith("image/")) return "image";

    // Strong document indicators (legacy "pdf/word/excel/ppt" etc).
    const docTypeSet = new Set([
      "document",
      "pdf",
      "word",
      "excel",
      "ppt",
      "spreadsheet",
      "presentation",
    ]);
    if (docTypeSet.has(t)) return "document";

    // If a client accidentally sends a MIME type string in `type`, treat it as MIME.
    if (MIME_TYPE_REGEX.test(t)) return t.startsWith("image/") ? "image" : "document";

    // If the declared mimeType looks document-like, treat as document.
    const docMimeHints = [
      "pdf",
      "word",
      "msword",
      "officedocument",
      "excel",
      "spreadsheet",
      "powerpoint",
      "presentation",
      "text/",
      "application/json",
      "application/csv",
    ];
    if (docMimeHints.some((h) => mt.includes(h))) return "document";

    // Last-resort extension check.
    const docExts = [
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".csv",
      ".txt",
      ".md",
      ".json",
      ".rtf",
      ".odt",
      ".ods",
      ".odp",
    ];
    if (docExts.some((ext) => lowerName.endsWith(ext))) return "document";

    return "file";
  };

  return {
    ...attachment,
    name: attachment.name.trim(),
    mimeType: attachment.mimeType.toLowerCase().trim(),
    type: canonicalizeType(attachment.type, attachment.mimeType, attachment.name),
    content: attachment.content?.trim(),
    url: attachment.url?.trim(),
  };
}

export function canonicalizeAnalyzeRequest(request: AnalyzeRequest): AnalyzeRequest {
  return {
    ...request,
    conversationId: request.conversationId?.trim(),
    messages: request.messages.map((msg) => ({
      ...msg,
      content: msg.content.trim(),
    })),
    attachments: request.attachments.map(canonicalizeAttachment),
  };
}

export function canonicalizeChatRequest(request: ChatRequest): ChatRequest {
  return {
    ...request,
    conversationId: request.conversationId?.trim(),
    messages: request.messages.map((msg) => ({
      ...msg,
      content: msg.content.trim(),
    })),
    attachments: request.attachments?.map(canonicalizeAttachment),
  };
}
