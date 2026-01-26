import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// ============================================
// GEMINI MODELS - Updated January 2026
// ============================================
export const GEMINI_MODELS = {
  // Gemini 3 Series (Latest)
  GEMINI_3_FLASH_PREVIEW: "gemini-3-flash-preview",
  GEMINI_3_PRO: "gemini-3-pro",
  GEMINI_3_PRO_IMAGE: "gemini-3-pro-image",
  GEMINI_3_DEEP_THINK: "gemini-3-deep-think",

  // Gemini 2.5 Series (Production)
  GEMINI_2_5_PRO: "gemini-2.5-pro",
  GEMINI_2_5_FLASH: "gemini-2.5-flash",
  GEMINI_2_5_FLASH_LITE: "gemini-2.5-flash-lite",
  GEMINI_2_5_FLASH_IMAGE: "gemini-2.5-flash-image",

  // Gemini 2.0 Series (Stable)
  GEMINI_2_0_FLASH: "gemini-2.0-flash",
  GEMINI_2_0_FLASH_EXP: "gemini-2.0-flash-exp",
  GEMINI_2_0_PRO: "gemini-2.0-pro",

  // Gemini 1.5 Series (Legacy)
  GEMINI_1_5_PRO: "gemini-1.5-pro",
  GEMINI_1_5_FLASH: "gemini-1.5-flash",

  // Specialized
  IMAGEN_4: "imagen-4",
  IMAGEN_3: "imagen-3",
  VEO_3: "veo-3",
  EMBEDDING: "text-embedding-004",

  // Default aliases
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

export { ai as geminiClient };
