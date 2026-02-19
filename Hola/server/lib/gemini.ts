import { GoogleGenAI } from "@google/genai";
import { UpstreamBadRequestError } from "../utils/errors";

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
 * Validate that contents are well-formed for the Gemini API.
 * Catches common issues before sending to the provider.
 */
function validateGeminiContents(
  contents: Array<{ role: string; parts: any[] }>,
  model: string
): void {
  if (!contents || contents.length === 0) {
    throw new UpstreamBadRequestError(
      "gemini",
      `Empty contents array for model ${model}. At least one message with role "user" or "model" is required.`
    );
  }

  for (let i = 0; i < contents.length; i++) {
    const msg = contents[i];
    if (!msg.role || (msg.role !== "user" && msg.role !== "model")) {
      throw new UpstreamBadRequestError(
        "gemini",
        `Invalid role "${msg.role}" at index ${i}. Gemini requires "user" or "model" (not "assistant" or "system").`
      );
    }
    if (!msg.parts || !Array.isArray(msg.parts) || msg.parts.length === 0) {
      throw new UpstreamBadRequestError(
        "gemini",
        `Empty parts array at index ${i} (role=${msg.role}). Each message must have at least one part.`
      );
    }
    // Ensure at least one part has content
    const hasContent = msg.parts.some(
      (p: any) => (p.text != null && p.text !== "") || p.inlineData
    );
    if (!hasContent) {
      throw new UpstreamBadRequestError(
        "gemini",
        `All parts are empty at index ${i} (role=${msg.role}). At least one part must have text or inlineData.`
      );
    }
  }
}

/**
 * Wrap Gemini SDK errors, preserving status codes and categorizing
 * upstream 400s as adapter bugs (not user errors).
 */
function wrapGeminiError(error: any, model: string, traceId?: string): Error {
  const status = error?.status ?? error?.statusCode ?? error?.code;
  const message = error?.message || String(error);

  // Log the full sanitized error for debugging
  console.error("[Gemini] API error:", {
    model,
    status,
    message: message.slice(0, 500),
    traceId,
    errorName: error?.name,
  });

  // 400 from Gemini = our adapter sent bad data → UpstreamBadRequestError (502 to client)
  if (status === 400 || (typeof message === "string" && /\b400\b/.test(message) && /invalid|bad request|malformed/i.test(message))) {
    return new UpstreamBadRequestError("gemini", message, error, traceId, 400);
  }

  // Preserve original status on the error object for retry logic
  const wrapped = new Error(`Gemini API error: ${message}`);
  (wrapped as any).status = status;
  (wrapped as any).code = error?.code;
  (wrapped as any).provider = "gemini";
  return wrapped;
}

export async function geminiChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): Promise<GeminiResponse> {
  const ai = getGeminiClientOrThrow();
  // Default to a stable, fast model. Preview models can be rate-limited or unavailable.
  const model = options.model || GEMINI_MODELS.FLASH;

  const contents = messages.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

  // Pre-flight validation: catch malformed payloads before they hit the API
  validateGeminiContents(contents, model);

  try {
    const result = await ai.models.generateContent({
      model,
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

    return {
      content: text,
      model,
    };
  } catch (error: any) {
    throw wrapGeminiError(error, model);
  }
}

export async function* geminiStreamChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
  const ai = getGeminiClientOrThrow();
  // Default to a stable, fast model. Preview models can be rate-limited or unavailable.
  const model = options.model || GEMINI_MODELS.FLASH;

  const contents = messages.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

  // Pre-flight validation: catch malformed payloads before they hit the API
  validateGeminiContents(contents, model);

  try {
    const response = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: options.systemInstruction,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        responseModalities: options.responseModalities,
      },
    });

    for await (const chunk of response) {
      const text = chunk.text ?? "";
      if (text) {
        yield { content: text, done: false };
      }
    }

    yield { content: "", done: true };
  } catch (error: any) {
    throw wrapGeminiError(error, model);
  }
}
