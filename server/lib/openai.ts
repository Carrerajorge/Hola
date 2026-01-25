import OpenAI from "openai";

// Lazy initialization to avoid startup errors when API key is not configured
let openaiClient: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
  if (!process.env.XAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY
    });
  }
  return openaiClient;
}

// For backwards compatibility - lazy getter
export const openai = new Proxy({} as OpenAI, {
  get(_, prop) {
    const client = getOpenAI();
    if (!client) {
      throw new Error("OpenAI/XAI API key not configured. Please set XAI_API_KEY environment variable.");
    }
    return (client as any)[prop];
  }
});

export const MODELS = {
  TEXT: "grok-3-fast",
  VISION: "grok-2-vision-1212"
} as const;

export type ModelType = typeof MODELS[keyof typeof MODELS];
