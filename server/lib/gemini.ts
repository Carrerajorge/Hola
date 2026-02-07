import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

function getGeminiApiKey(): string | undefined {
  // Support both env var names (some parts of the codebase use GOOGLE_API_KEY).
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return key?.trim() ? key.trim() : undefined;
}

function ensureClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set");
  }
  if (!_client) {
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

export function getGeminiClient(): GoogleGenAI {
  return ensureClient();
}

export const GEMINI_MODELS = {
  FLASH_PREVIEW: "gemini-3-flash-preview",
  FLASH: "gemini-2.5-flash",
  PRO: "gemini-2.5-pro",
} as const;

export type GeminiModelType = typeof GEMINI_MODELS[keyof typeof GEMINI_MODELS];

export interface GeminiChatMessage {
  role: "user" | "model";
  parts: { text: string }[];
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

export async function geminiChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): Promise<GeminiResponse> {
  const ai = ensureClient();
  const model = options.model || GEMINI_MODELS.FLASH_PREVIEW;
  
  const contents = messages.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

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
    console.error("[Gemini] Error generating content:", error.message);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

export async function* geminiStreamChat(
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
  const ai = ensureClient();
  const model = options.model || GEMINI_MODELS.FLASH_PREVIEW;
  
  const contents = messages.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

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
    console.error("[Gemini] Stream error:", error.message);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

// Intentionally no top-level exported client to avoid import-time crashes when the API key isn't configured.
