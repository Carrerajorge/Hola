import OpenAI from "openai";

// xAI (Grok) Client
export const openai = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY
});

// OpenAI Client (optional)
export const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================
// GROK (xAI) MODELS - Updated January 2026
// ============================================
export const MODELS = {
  // Grok 4.1 Series (Latest)
  GROK_4_1_FAST: "grok-4.1-fast",
  GROK_4_1_FAST_REASONING: "grok-4.1-fast-reasoning",

  // Grok 4 Series
  GROK_4: "grok-4",
  GROK_4_FAST: "grok-4-fast",
  GROK_4_FAST_REASONING: "grok-4-fast-reasoning",

  // Grok 3 Series (Stable)
  GROK_3: "grok-3",
  GROK_3_FAST: "grok-3-fast",
  GROK_3_MINI: "grok-3-mini",
  GROK_3_MINI_FAST: "grok-3-mini-fast",

  // Grok 2 Series (Legacy)
  GROK_2: "grok-2",
  GROK_2_VISION: "grok-2-vision-1212",

  // Specialized
  GROK_CODE: "grok-code-fast-1",
  GROK_IMAGE: "grok-2-image-1212",

  // Default aliases
  TEXT: "grok-3-fast",
  VISION: "grok-2-vision-1212",
} as const;

// ============================================
// OPENAI MODELS - Updated January 2026
// ============================================
export const OPENAI_MODELS = {
  // GPT-5 Series (Latest)
  GPT_5: "gpt-5",
  GPT_5_2: "gpt-5.2",
  GPT_5_2_CODEX: "gpt-5.2-codex",
  GPT_5_1: "gpt-5.1",
  GPT_5_MINI: "gpt-5-mini",
  GPT_5_NANO: "gpt-5-nano",

  // GPT-4.1 Series
  GPT_4_1: "gpt-4.1",
  GPT_4_1_MINI: "gpt-4.1-mini",
  GPT_4_1_NANO: "gpt-4.1-nano",

  // GPT-4o Series
  GPT_4O: "gpt-4o",
  GPT_4O_MINI: "gpt-4o-mini",

  // O-Series Reasoning
  O3: "o3",
  O3_PRO: "o3-pro",
  O3_MINI: "o3-mini",
  O4_MINI: "o4-mini",
  O1: "o1",
  O1_PRO: "o1-pro",
  O1_MINI: "o1-mini",

  // Specialized
  SORA_2: "sora-2",
  GPT_IMAGE: "gpt-image-1.5",
  DALL_E_3: "dall-e-3",
  WHISPER: "whisper-1",
  EMBEDDING: "text-embedding-3-large",
} as const;

export type ModelType = typeof MODELS[keyof typeof MODELS];
export type OpenAIModelType = typeof OPENAI_MODELS[keyof typeof OPENAI_MODELS];
