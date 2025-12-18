import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
