/**
 * LLM Request Validator - Pre-flight validation for LLM requests.
 *
 * Validates payloads BEFORE sending to providers to avoid:
 * - Requests that exceed context window limits (hangs/errors)
 * - Invalid message formats that cause silent failures
 * - Oversized attachments that timeout
 * - Missing required fields
 *
 * Fail fast with clear errors instead of getting stuck.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// ===== Provider Context Limits =====
const PROVIDER_CONTEXT_LIMITS: Record<string, number> = {
  // xAI/Grok
  "grok-4-1-fast-non-reasoning": 131_072,
  "grok-4-1-fast-reasoning": 131_072,
  "grok-4-fast-non-reasoning": 131_072,
  "grok-4-fast-reasoning": 131_072,
  "grok-4-0709": 131_072,
  "grok-code-fast-1": 131_072,
  "grok-3": 131_072,
  "grok-3-fast": 131_072,
  "grok-3-mini": 131_072,
  "grok-3-mini-fast": 131_072,
  "grok-2-vision-1212": 32_768,

  // Gemini
  "gemini-3-flash-preview": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.0-flash": 1_048_576,

  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "o1": 200_000,
  "o1-mini": 128_000,

  // Anthropic
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-latest": 200_000,
  "claude-3-opus-20240229": 200_000,

  // DeepSeek
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
};

const DEFAULT_CONTEXT_LIMIT = 32_000;

// ===== Attachment Limits =====
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_ATTACHMENTS_PER_REQUEST = 20;
const MAX_BASE64_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per image

// ===== Validation Error =====
export class LLMValidationError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "LLMValidationError";
    this.code = code;
    this.details = details;
  }
}

// ===== Validation Result =====
export interface LLMValidationResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  warnings: Array<{ code: string; message: string }>;
  estimatedTokens: number;
  contextLimit: number;
}

// ===== Token Estimation =====
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageToText(msg: ChatCompletionMessageParam): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as any[])
      .map((part: any) => {
        if (part.type === "text") return part.text || "";
        if (part.type === "image_url") return "[image]";
        return JSON.stringify(part);
      })
      .join(" ");
  }
  return msg.content ? String(msg.content) : "";
}

// ===== Validators =====

function validateMessages(messages: ChatCompletionMessageParam[]): LLMValidationResult["errors"] {
  const errors: LLMValidationResult["errors"] = [];

  if (!messages || !Array.isArray(messages)) {
    errors.push({ code: "INVALID_MESSAGES", message: "Messages must be a non-empty array" });
    return errors;
  }

  if (messages.length === 0) {
    errors.push({ code: "EMPTY_MESSAGES", message: "Messages array is empty" });
    return errors;
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (!msg || typeof msg !== "object") {
      errors.push({ code: "INVALID_MESSAGE", message: `Message at index ${i} is not a valid object` });
      continue;
    }

    if (!msg.role) {
      errors.push({ code: "MISSING_ROLE", message: `Message at index ${i} is missing a role` });
    }

    const validRoles = ["system", "user", "assistant", "function", "tool"];
    if (msg.role && !validRoles.includes(msg.role)) {
      errors.push({
        code: "INVALID_ROLE",
        message: `Message at index ${i} has invalid role: ${msg.role}`,
        details: { validRoles },
      });
    }

    if (msg.content === undefined && msg.role !== "assistant") {
      errors.push({ code: "MISSING_CONTENT", message: `Message at index ${i} (${msg.role}) is missing content` });
    }
  }

  const nonSystemMessages = messages.filter(m => m.role !== "system");
  if (nonSystemMessages.length === 0) {
    errors.push({ code: "NO_USER_MESSAGE", message: "At least one non-system message is required" });
  }

  return errors;
}

function validateContextWindow(
  messages: ChatCompletionMessageParam[],
  model: string,
  maxOutputTokens?: number,
): { errors: LLMValidationResult["errors"]; warnings: LLMValidationResult["warnings"]; estimatedTokens: number; contextLimit: number } {
  const errors: LLMValidationResult["errors"] = [];
  const warnings: LLMValidationResult["warnings"] = [];

  const contextLimit = PROVIDER_CONTEXT_LIMITS[model.toLowerCase()] ?? DEFAULT_CONTEXT_LIMIT;
  const estimatedTokens = messages.reduce((sum, msg) => sum + estimateTokens(messageToText(msg)), 0);

  const outputBudget = maxOutputTokens ?? 4096;
  const availableInput = contextLimit - outputBudget;

  if (estimatedTokens > contextLimit) {
    errors.push({
      code: "CONTEXT_OVERFLOW",
      message: `Estimated ${estimatedTokens} tokens exceeds model context limit of ${contextLimit} for ${model}`,
      details: { estimatedTokens, contextLimit, model },
    });
  } else if (estimatedTokens > availableInput) {
    warnings.push({
      code: "CONTEXT_NEAR_LIMIT",
      message: `Estimated ${estimatedTokens} tokens may leave insufficient room for ${outputBudget} output tokens (limit: ${contextLimit})`,
    });
  } else if (estimatedTokens > availableInput * 0.9) {
    warnings.push({
      code: "CONTEXT_HIGH_UTILIZATION",
      message: `Context utilization at ~${Math.round((estimatedTokens / availableInput) * 100)}%`,
    });
  }

  return { errors, warnings, estimatedTokens, contextLimit };
}

function validateAttachments(messages: ChatCompletionMessageParam[]): LLMValidationResult["errors"] {
  const errors: LLMValidationResult["errors"] = [];
  let attachmentCount = 0;
  let totalAttachmentSize = 0;

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content as any[]) {
      if (part?.type === "image_url" && part.image_url?.url) {
        attachmentCount++;
        const url = part.image_url.url as string;

        const dataUriMatch = url.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          const base64Data = dataUriMatch[2];
          const sizeBytes = Math.ceil(base64Data.length * 3 / 4);
          totalAttachmentSize += sizeBytes;

          if (sizeBytes > MAX_BASE64_IMAGE_SIZE_BYTES) {
            errors.push({
              code: "IMAGE_TOO_LARGE",
              message: `Image at position ${attachmentCount} is ${Math.round(sizeBytes / 1024 / 1024)}MB, max is ${MAX_BASE64_IMAGE_SIZE_BYTES / 1024 / 1024}MB`,
              details: { sizeBytes, maxBytes: MAX_BASE64_IMAGE_SIZE_BYTES },
            });
          }
        }
      }
    }
  }

  if (attachmentCount > MAX_ATTACHMENTS_PER_REQUEST) {
    errors.push({
      code: "TOO_MANY_ATTACHMENTS",
      message: `${attachmentCount} attachments exceeds max of ${MAX_ATTACHMENTS_PER_REQUEST}`,
      details: { count: attachmentCount, max: MAX_ATTACHMENTS_PER_REQUEST },
    });
  }

  if (totalAttachmentSize > MAX_ATTACHMENT_SIZE_BYTES) {
    errors.push({
      code: "ATTACHMENTS_TOO_LARGE",
      message: `Total attachment size ${Math.round(totalAttachmentSize / 1024 / 1024)}MB exceeds max of ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024}MB`,
      details: { totalBytes: totalAttachmentSize, maxBytes: MAX_ATTACHMENT_SIZE_BYTES },
    });
  }

  return errors;
}

function validateOptions(options: {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}): LLMValidationResult["errors"] {
  const errors: LLMValidationResult["errors"] = [];

  if (options.temperature !== undefined) {
    if (typeof options.temperature !== "number" || options.temperature < 0 || options.temperature > 2) {
      errors.push({
        code: "INVALID_TEMPERATURE",
        message: `Temperature must be between 0 and 2, got ${options.temperature}`,
      });
    }
  }

  if (options.topP !== undefined) {
    if (typeof options.topP !== "number" || options.topP < 0 || options.topP > 1) {
      errors.push({
        code: "INVALID_TOP_P",
        message: `topP must be between 0 and 1, got ${options.topP}`,
      });
    }
  }

  if (options.maxTokens !== undefined) {
    if (typeof options.maxTokens !== "number" || options.maxTokens <= 0 || !Number.isInteger(options.maxTokens)) {
      errors.push({
        code: "INVALID_MAX_TOKENS",
        message: `maxTokens must be a positive integer, got ${options.maxTokens}`,
      });
    }
  }

  return errors;
}

// ===== Main Validation Function =====

export function validateLLMRequest(
  messages: ChatCompletionMessageParam[],
  options: {
    model?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  } = {},
): LLMValidationResult {
  const allErrors: LLMValidationResult["errors"] = [];
  const allWarnings: LLMValidationResult["warnings"] = [];

  allErrors.push(...validateMessages(messages));

  const model = options.model ?? "unknown";
  const { errors: contextErrors, warnings: contextWarnings, estimatedTokens, contextLimit } =
    validateContextWindow(messages, model, options.maxTokens);
  allErrors.push(...contextErrors);
  allWarnings.push(...contextWarnings);

  allErrors.push(...validateAttachments(messages));
  allErrors.push(...validateOptions(options));

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    estimatedTokens,
    contextLimit,
  };
}

export function assertValidLLMRequest(
  messages: ChatCompletionMessageParam[],
  options: {
    model?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  } = {},
): void {
  const result = validateLLMRequest(messages, options);
  if (!result.valid) {
    const firstError = result.errors[0];
    throw new LLMValidationError(
      firstError.message,
      firstError.code,
      { allErrors: result.errors, warnings: result.warnings },
    );
  }

  if (result.warnings.length > 0) {
    console.warn(
      `[LLMRequestValidator] ${result.warnings.length} warning(s): ${result.warnings.map(w => w.message).join("; ")}`
    );
  }
}
