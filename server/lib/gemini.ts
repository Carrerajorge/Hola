import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

function getGeminiApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  if (!_client) {
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

export function getGeminiClientOrThrow(): GoogleGenAI {
  const client = getGeminiClient();
  if (!client) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return client;
}

export const GEMINI_MODELS = {
  FLASH_PREVIEW: "gemini-3-flash-preview",
  FLASH: "gemini-2.5-flash",
  PRO: "gemini-2.5-pro",
} as const;

// Fallback model chain: if the primary model returns persistent errors, try the next.
const GEMINI_MODEL_FALLBACK_CHAIN: string[] = [
  GEMINI_MODELS.FLASH,
  "gemini-2.0-flash",
  GEMINI_MODELS.PRO,
];

export type GeminiModelType = typeof GEMINI_MODELS[keyof typeof GEMINI_MODELS];

export interface GeminiChatMessage {
  role: "user" | "model";
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export interface GeminiChatOptions {
  model?: GeminiModelType;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseModalities?: ("text" | "image")[];
}

export interface GeminiResponse {
  content: string;
  model: string;
}

/**
 * Classify a Gemini error to determine if it's retryable.
 * Gemini's API can return 400 for many transient/recoverable issues:
 * - "RESOURCE_EXHAUSTED" (rate limit, sometimes returned as 400 instead of 429)
 * - "INVALID_ARGUMENT" due to content filtering edge cases
 * - Model-specific transient failures
 */
export function classifyGeminiError(error: any): {
  retryable: boolean;
  switchModel: boolean;
  status: number;
  category: string;
} {
  const status = error.status || error.httpStatusCode || 0;
  const message = String(error.message || error.details || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();

  // 429 / RESOURCE_EXHAUSTED — always retryable
  if (status === 429 || code === "RESOURCE_EXHAUSTED" || message.includes("resource_exhausted") || message.includes("rate limit") || message.includes("quota")) {
    return { retryable: true, switchModel: false, status, category: "rate_limit" };
  }

  // 503 / UNAVAILABLE — transient, retryable
  if (status === 503 || code === "UNAVAILABLE" || message.includes("unavailable") || message.includes("overloaded")) {
    return { retryable: true, switchModel: false, status, category: "unavailable" };
  }

  // 500 / INTERNAL — transient, retryable
  if (status === 500 || code === "INTERNAL" || message.includes("internal error")) {
    return { retryable: true, switchModel: false, status, category: "internal" };
  }

  // 400 errors that are retryable (Gemini often misclassifies transient issues as 400)
  if (status === 400) {
    // Safety filter triggered — retryable with modified request, or switch model
    if (message.includes("safety") || message.includes("blocked") || message.includes("harm") || message.includes("recitation")) {
      return { retryable: false, switchModel: true, status, category: "safety_filter" };
    }
    // Model not found or deprecated — switch to fallback model
    if (message.includes("not found") || message.includes("not supported") || message.includes("deprecated") || message.includes("does not exist")) {
      return { retryable: false, switchModel: true, status, category: "model_not_found" };
    }
    // Content too large — not retryable as-is but can truncate
    if (message.includes("too large") || message.includes("max_tokens") || message.includes("token limit")) {
      return { retryable: false, switchModel: false, status, category: "content_too_large" };
    }
    // Generic 400 — often transient in Gemini, retry once then switch model
    return { retryable: true, switchModel: true, status, category: "bad_request_generic" };
  }

  // 401/403 — invalid API key, not retryable
  if (status === 401 || status === 403) {
    return { retryable: false, switchModel: false, status, category: "auth" };
  }

  // Network errors — retryable
  if (message.includes("econnreset") || message.includes("etimedout") || message.includes("enotfound") || message.includes("network") || message.includes("socket") || message.includes("fetch failed")) {
    return { retryable: true, switchModel: false, status, category: "network" };
  }

  // Unknown — cautiously retryable once
  return { retryable: true, switchModel: false, status, category: "unknown" };
}

/**
 * Sanitize messages before sending to Gemini to prevent 400 errors.
 * - Ensures at least one non-empty content part
 * - Removes empty messages
 * - Ensures alternating user/model roles (Gemini requirement)
 * - Clamps overly long text parts
 */
export function sanitizeGeminiMessages(messages: GeminiChatMessage[]): GeminiChatMessage[] {
  const MAX_PART_CHARS = 500_000; // ~125K tokens; Gemini limit is ~1M tokens

  const sanitized: GeminiChatMessage[] = [];

  for (const msg of messages) {
    const cleanParts = msg.parts
      .map(part => {
        if (part.text != null) {
          const text = typeof part.text === "string" ? part.text : String(part.text);
          // Clamp extremely long parts
          const clamped = text.length > MAX_PART_CHARS ? text.slice(0, MAX_PART_CHARS) + "\n[Content truncated]" : text;
          return { text: clamped };
        }
        if (part.inlineData) {
          return { inlineData: part.inlineData };
        }
        return null;
      })
      .filter(Boolean) as GeminiChatMessage["parts"];

    // Skip completely empty messages
    if (cleanParts.length === 0) continue;

    // If all text parts are empty strings, add a placeholder
    const hasContent = cleanParts.some(p => (p.text && p.text.trim().length > 0) || p.inlineData);
    if (!hasContent) continue;

    sanitized.push({ role: msg.role, parts: cleanParts });
  }

  // Gemini requires alternating user/model roles; merge consecutive same-role messages
  const merged: GeminiChatMessage[] = [];
  for (const msg of sanitized) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      // Merge parts into previous message
      prev.parts.push(...msg.parts);
    } else {
      merged.push({ ...msg, parts: [...msg.parts] });
    }
  }

  // Gemini requires the first message to be from "user"
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", parts: [{ text: "." }] });
  }

  return merged;
}

/**
 * Get the next fallback model in the chain.
 */
function getNextFallbackModel(currentModel: string): string | null {
  const idx = GEMINI_MODEL_FALLBACK_CHAIN.indexOf(currentModel);
  if (idx >= 0 && idx < GEMINI_MODEL_FALLBACK_CHAIN.length - 1) {
    return GEMINI_MODEL_FALLBACK_CHAIN[idx + 1];
  }
  // If current model is not in the chain, try the first one
  if (idx < 0 && GEMINI_MODEL_FALLBACK_CHAIN.length > 0) {
    const first = GEMINI_MODEL_FALLBACK_CHAIN[0];
    if (first !== currentModel) return first;
    return GEMINI_MODEL_FALLBACK_CHAIN[1] || null;
  }
  return null;
}

const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 1500;

async function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function geminiChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): Promise<GeminiResponse> {
  const ai = getGeminiClientOrThrow();
  let model = options.model || GEMINI_MODELS.FLASH;
  const sanitized = sanitizeGeminiMessages(messages);

  if (sanitized.length === 0) {
    throw new Error("Gemini API error: No valid messages after sanitization");
  }

  const contents = sanitized.map(msg => ({ role: msg.role, parts: msg.parts }));

  let lastError: Error | null = null;
  let currentModel: string = model;

  // Attempt loop: retry on the same model, then try fallback models
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES + GEMINI_MODEL_FALLBACK_CHAIN.length; attempt++) {
    try {
      const result = await ai.models.generateContent({
        model: currentModel,
        contents,
        config: {
          systemInstruction: options.systemInstruction,
          temperature: options.temperature,
          topP: options.topP,
          maxOutputTokens: options.maxOutputTokens,
          responseModalities: options.responseModalities,
        },
      });

      const text = result.text ?? "";

      return { content: text, model: currentModel };
    } catch (error: any) {
      lastError = error;
      const classified = classifyGeminiError(error);
      console.error(`[Gemini] Error (attempt ${attempt + 1}, model=${currentModel}, category=${classified.category}, status=${classified.status}):`, error.message);

      // Try switching model first if classified as switchModel
      if (classified.switchModel) {
        const nextModel = getNextFallbackModel(currentModel);
        if (nextModel) {
          console.log(`[Gemini] Switching model from ${currentModel} to ${nextModel}`);
          currentModel = nextModel;
          continue;
        }
      }

      // Retry with backoff if retryable and within retry budget
      if (classified.retryable && attempt < GEMINI_MAX_RETRIES) {
        const delay = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`[Gemini] Retrying in ${Math.round(delay)}ms...`);
        await sleepMs(delay);
        continue;
      }

      // If we've exhausted retries on current model, try fallback model
      const nextModel = getNextFallbackModel(currentModel);
      if (nextModel) {
        console.log(`[Gemini] Exhausted retries on ${currentModel}, switching to ${nextModel}`);
        currentModel = nextModel;
        continue;
      }

      // All retries and fallback models exhausted
      break;
    }
  }

  const err = lastError || new Error("Gemini API error: all attempts exhausted");
  // Preserve original error properties for upstream circuit breaker / retry logic
  const wrapped = new Error(`Gemini API error: ${err.message}`);
  (wrapped as any).status = (lastError as any)?.status || (lastError as any)?.httpStatusCode || 500;
  (wrapped as any).retryable = false; // We already exhausted our own retries
  throw wrapped;
}

export async function* geminiStreamChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
  const ai = getGeminiClientOrThrow();
  let model = options.model || GEMINI_MODELS.FLASH;
  const sanitized = sanitizeGeminiMessages(messages);

  if (sanitized.length === 0) {
    throw new Error("Gemini API error: No valid messages after sanitization");
  }

  const contents = sanitized.map(msg => ({ role: msg.role, parts: msg.parts }));

  let lastError: Error | null = null;
  let currentModel: string = model;

  // Attempt loop for stream: retry on same model, then fallback models
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES + GEMINI_MODEL_FALLBACK_CHAIN.length; attempt++) {
    try {
      const response = await ai.models.generateContentStream({
        model: currentModel,
        contents,
        config: {
          systemInstruction: options.systemInstruction,
          temperature: options.temperature,
          topP: options.topP,
          maxOutputTokens: options.maxOutputTokens,
          responseModalities: options.responseModalities,
        },
      });

      let hasContent = false;
      for await (const chunk of response) {
        const text = chunk.text ?? "";
        if (text) {
          hasContent = true;
          yield { content: text, done: false };
        }
      }

      // If stream completed but produced no content, that's still a success (model decided to stop)
      yield { content: "", done: true };
      return; // Success — exit the retry loop
    } catch (error: any) {
      lastError = error;
      const classified = classifyGeminiError(error);
      console.error(`[Gemini] Stream error (attempt ${attempt + 1}, model=${currentModel}, category=${classified.category}, status=${classified.status}):`, error.message);

      // Try switching model
      if (classified.switchModel) {
        const nextModel = getNextFallbackModel(currentModel);
        if (nextModel) {
          console.log(`[Gemini] Stream: switching model from ${currentModel} to ${nextModel}`);
          currentModel = nextModel;
          continue;
        }
      }

      // Retry with backoff
      if (classified.retryable && attempt < GEMINI_MAX_RETRIES) {
        const delay = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`[Gemini] Stream: retrying in ${Math.round(delay)}ms...`);
        await sleepMs(delay);
        continue;
      }

      // Fallback model
      const nextModel = getNextFallbackModel(currentModel);
      if (nextModel) {
        console.log(`[Gemini] Stream: exhausted retries on ${currentModel}, switching to ${nextModel}`);
        currentModel = nextModel;
        continue;
      }

      break;
    }
  }

  const err = lastError || new Error("Gemini API error: all stream attempts exhausted");
  const wrapped = new Error(`Gemini API error: ${err.message}`);
  (wrapped as any).status = (lastError as any)?.status || (lastError as any)?.httpStatusCode || 500;
  (wrapped as any).retryable = false;
  throw wrapped;
}
