import OpenAI from "openai";

export const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

export const MODELS = {
  TEXT: "grok-3-fast",
  VISION: "grok-2-vision-1212",
  EMBEDDING: "text-embedding-3-small"
} as const;

export type ModelType = typeof MODELS[keyof typeof MODELS];
