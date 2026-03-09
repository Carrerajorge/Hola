import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OPENROUTER_IMAGE_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL?.trim() ||
  process.env.IMAGE_GENERATION_MODEL?.trim() ||
  "google/gemini-3.1-flash-image-preview";
const DEFAULT_VIDEO_IMAGE_MODEL =
  process.env.OPENROUTER_VIDEO_IMAGE_MODEL?.trim() ||
  DEFAULT_OPENROUTER_IMAGE_MODEL;
const DEFAULT_VIDEO_PLANNER_MODEL =
  process.env.OPENROUTER_VIDEO_PLANNER_MODEL?.trim() ||
  process.env.VIDEO_GENERATION_MODEL?.trim() ||
  "bytedance-seed/seed-2.0-mini";

let _ai: GoogleGenAI | null = null;
let _aiApiKey = "";
let _xaiClient: OpenAI | null = null;
let _xaiApiKey = "";
let _openrouterClient: OpenAI | null = null;
let _openrouterApiKey = "";
let _openrouterUnavailableUntil = 0;

const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_GEMINI_IMAGE_FALLBACK_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation",
];
const DEFAULT_IMAGEN_FALLBACK_MODELS = [
  "imagen-4.0-fast-generate-001",
  "imagen-4.0-generate-001",
];

function getGeminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  );
}

function getXaiApiKey(): string {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY || "";
}

function getOpenRouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || "";
}

function getGeminiClient(): GoogleGenAI | null {
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) return null;
  if (!_ai || _aiApiKey !== geminiApiKey) {
    _ai = new GoogleGenAI({ apiKey: geminiApiKey });
    _aiApiKey = geminiApiKey;
  }
  return _ai;
}

function getXaiClient(): OpenAI | null {
  const xaiApiKey = getXaiApiKey();
  if (!xaiApiKey) return null;
  if (!_xaiClient || _xaiApiKey !== xaiApiKey) {
    _xaiClient = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: xaiApiKey,
    });
    _xaiApiKey = xaiApiKey;
  }
  return _xaiClient;
}

function getOpenRouterClient(): OpenAI | null {
  const openrouterApiKey = getOpenRouterApiKey();
  if (!openrouterApiKey) return null;
  if (_openrouterApiKey && _openrouterApiKey !== openrouterApiKey) {
    _openrouterUnavailableUntil = 0;
  }
  if (_openrouterUnavailableUntil > Date.now()) {
    return null;
  }
  if (!_openrouterClient || _openrouterApiKey !== openrouterApiKey) {
    _openrouterClient = new OpenAI({
      baseURL: OPENROUTER_BASE_URL,
      apiKey: openrouterApiKey,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER?.trim() || "http://localhost:5001",
        "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "ILIAGPT",
      },
    });
    _openrouterApiKey = openrouterApiKey;
  }
  return _openrouterClient;
}

function normalizePrompt(prompt: string): string {
  const cleaned = String(prompt || "").trim();
  if (!cleaned) return "";
  return detectImageRequest(cleaned) ? extractImagePrompt(cleaned) : cleaned;
}

function normalizeVideoPrompt(prompt: string): string {
  const cleaned = String(prompt || "").trim();
  if (!cleaned) return "";
  return detectVideoRequest(cleaned) ? extractVideoPrompt(cleaned) : cleaned;
}

function safeString(value: unknown, fallback = ""): string {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(items.length || 1, concurrency));

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const currentIndex = cursor;
        cursor += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(String(url || "").trim());
  if (!match) return null;
  return {
    mimeType: match[1] || "image/png",
    data: match[2] || "",
  };
}

async function fetchImageUrlAsBase64(
  imageUrl: string,
  timeoutMs: number,
): Promise<{ mimeType: string; data: string }> {
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(imageUrl, { signal });
    if (!res.ok) {
      throw new Error(`Image fetch failed (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      mimeType: res.headers.get("content-type") || "image/png",
      data: Buffer.from(arrayBuffer).toString("base64"),
    };
  });
}

function extractOpenRouterImageUrl(payload: any): string | null {
  const images = payload?.choices?.[0]?.message?.images;
  if (!Array.isArray(images) || images.length === 0) {
    return null;
  }

  for (const image of images) {
    const candidate =
      image?.image_url?.url ||
      image?.imageUrl?.url ||
      image?.url ||
      image?.data ||
      image?.base64;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function extractJsonObject(rawText: string): Record<string, any> | null {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const direct = text.match(/\{[\s\S]*\}/);
  if (!direct) return null;
  try {
    return JSON.parse(direct[0]);
  } catch {
    return null;
  }
}

export interface ImageGenerationOptions {
  preferredModel?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";
  imageSize?: "512" | "1K" | "2K";
  timeoutMs?: number;
  preferOpenRouter?: boolean;
}

export interface ImageGenerationResult {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  model?: string;
}

function uniqueNonEmpty(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeProviderModelId(value: string | undefined | null): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  const providerAgnosticMatch = normalized.match(/(?:^|\/)(gemini-[^/]+|imagen-[^/]+)$/i);
  if (providerAgnosticMatch?.[1]) {
    return providerAgnosticMatch[1];
  }

  return normalized.replace(/^models\//i, "");
}

function normalizeGeminiModelId(value: string | undefined | null): string {
  return normalizeProviderModelId(value);
}

function normalizeOpenRouterImageModelId(value: string | undefined | null): string {
  const normalized = normalizeProviderModelId(value);
  if (!normalized) {
    return DEFAULT_OPENROUTER_IMAGE_MODEL;
  }

  if (/^[^/]+\/[^/]+$/.test(normalized)) {
    return normalized;
  }

  if (/^(gemini|imagen)-/i.test(normalized)) {
    return `google/${normalized}`;
  }

  return normalized;
}

function getGeminiImageModels(preferredModel?: string): string[] {
  return uniqueNonEmpty([
    normalizeGeminiModelId(preferredModel),
    normalizeGeminiModelId(process.env.GEMINI_IMAGE_MODEL),
    normalizeGeminiModelId(DEFAULT_GEMINI_IMAGE_MODEL),
    ...DEFAULT_GEMINI_IMAGE_FALLBACK_MODELS.map((model) => normalizeGeminiModelId(model)),
  ]);
}

function getImagenFallbackModels(): string[] {
  return uniqueNonEmpty([
    normalizeGeminiModelId(process.env.GEMINI_IMAGE_PREDICT_MODEL),
    ...DEFAULT_IMAGEN_FALLBACK_MODELS.map((model) => normalizeGeminiModelId(model)),
  ]);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isOpenRouterAuthError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return /\b401\b|user not found|invalid api key|unauthorized|incorrect api key/i.test(message);
}

function markOpenRouterUnavailable(error: unknown, durationMs = 5 * 60_000): void {
  const message = toErrorMessage(error);
  if (!isOpenRouterAuthError(message)) return;
  _openrouterUnavailableUntil = Date.now() + durationMs;
  console.warn(`[OpenRouter] Temporarily disabled for ${Math.round(durationMs / 1000)}s: ${message}`);
}

function extractInlineImageResult(
  response: any,
  prompt: string,
  model: string,
): ImageGenerationResult | null {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
        prompt,
        model,
      };
    }
  }

  return null;
}

async function tryGeminiGenerateContent(
  ai: GoogleGenAI,
  prompt: string,
  preferredModel: string | undefined,
  startTime: number,
): Promise<ImageGenerationResult> {
  const failures: string[] = [];

  for (const model of getGeminiImageModels(preferredModel)) {
    try {
      console.log(`[ImageGeneration] Trying Gemini model: ${model}`);
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Create a single high-quality image based on this prompt: ${prompt}`,
              },
            ],
          },
        ],
        config: {
          responseModalities: ["IMAGE"],
        },
      });

      const result = extractInlineImageResult(response, prompt, model);
      if (result) {
        console.log(
          `[ImageGeneration] Success with Gemini ${model} in ${Date.now() - startTime}ms`,
        );
        return result;
      }

      throw new Error(
        String(
          response?.candidates?.[0]?.finishReason ||
            response?.promptFeedback?.blockReason ||
            "No inline image returned",
        ),
      );
    } catch (error: any) {
      const message = toErrorMessage(error);
      failures.push(`${model}: ${message}`);
      console.error(`[ImageGeneration] Gemini ${model} failed:`, message);
    }
  }

  throw new Error(failures.join(" | "));
}

async function tryImagenPredict(
  ai: GoogleGenAI,
  prompt: string,
  startTime: number,
): Promise<ImageGenerationResult> {
  const failures: string[] = [];

  for (const model of getImagenFallbackModels()) {
    try {
      console.log(`[ImageGeneration] Trying Imagen model: ${model}`);
      const response = await ai.models.generateImages({
        model,
        prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: "image/png",
        },
      });

      const generatedImage = response?.generatedImages?.[0]?.image;
      if (generatedImage?.imageBytes) {
        console.log(
          `[ImageGeneration] Success with Imagen ${model} in ${Date.now() - startTime}ms`,
        );
        return {
          imageBase64: generatedImage.imageBytes,
          mimeType: generatedImage.mimeType || "image/png",
          prompt,
          model,
        };
      }

      throw new Error("No generated image bytes returned");
    } catch (error: any) {
      const message = toErrorMessage(error);
      failures.push(`${model}: ${message}`);
      console.error(`[ImageGeneration] Imagen ${model} failed:`, message);
    }
  }

  throw new Error(failures.join(" | "));
}

async function tryOpenRouterImageGeneration(
  prompt: string,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult | null> {
  const client = getOpenRouterClient();
  if (!client) return null;

  const model = normalizeOpenRouterImageModelId(
    safeString(options.preferredModel, DEFAULT_OPENROUTER_IMAGE_MODEL),
  );
  const timeoutMs = clampInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 180_000);

  const response = await withTimeout(timeoutMs, async () =>
    client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: options.aspectRatio || "1:1",
        image_size: options.imageSize || "1K",
      },
    } as any),
  );

  const imageUrl = extractOpenRouterImageUrl(response);
  if (!imageUrl) {
    throw new Error("OpenRouter image response did not include an image payload");
  }

  const parsedInline = parseDataUrl(imageUrl);
  if (parsedInline) {
    return {
      imageBase64: parsedInline.data,
      mimeType: parsedInline.mimeType,
      prompt,
      model,
    };
  }

  const fetched = await fetchImageUrlAsBase64(imageUrl, timeoutMs);
  return {
    imageBase64: fetched.data,
    mimeType: fetched.mimeType,
    prompt,
    model,
  };
}

export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {},
): Promise<ImageGenerationResult> {
  const startTime = Date.now();
  const normalizedPrompt = normalizePrompt(prompt);
  console.log(`[ImageGeneration] Generating: "${normalizedPrompt.slice(0, 80)}..."`);

  const tryOpenRouterFirst = options.preferOpenRouter === true;
  const runOpenRouter = async (): Promise<ImageGenerationResult | null> => {
    try {
      const openRouterResult = await tryOpenRouterImageGeneration(normalizedPrompt, options);
      if (openRouterResult) {
        console.log(
          `[ImageGeneration] Success with OpenRouter ${openRouterResult.model} in ${Date.now() - startTime}ms`,
        );
        return openRouterResult;
      }
    } catch (error: any) {
      markOpenRouterUnavailable(error);
      console.error(
        `[ImageGeneration] OpenRouter image generation failed:`,
        toErrorMessage(error),
      );
    }
    return null;
  };

  if (tryOpenRouterFirst) {
    const openRouterResult = await runOpenRouter();
    if (openRouterResult) {
      return openRouterResult;
    }
  }

  const ai = getGeminiClient();
  if (ai) {
    try {
      return await tryGeminiGenerateContent(
        ai,
        normalizedPrompt,
        options.preferredModel,
        startTime,
      );
    } catch (error: any) {
      console.warn(
        `[ImageGeneration] Gemini generateContent fallbacks exhausted: ${toErrorMessage(error)}`,
      );
    }

    try {
      return await tryImagenPredict(ai, normalizedPrompt, startTime);
    } catch (error: any) {
      console.warn(
        `[ImageGeneration] Imagen predict fallbacks exhausted: ${toErrorMessage(error)}`,
      );
    }
  }

  if (!tryOpenRouterFirst) {
    const openRouterResult = await runOpenRouter();
    if (openRouterResult) {
      return openRouterResult;
    }
  }

  const xaiClient = getXaiClient();
  if (xaiClient) {
    try {
      console.log(`[ImageGeneration] Trying xAI Grok Image...`);
      const response = await xaiClient.images.generate({
        model: "grok-2-image-1212",
        prompt: normalizedPrompt,
        n: 1,
        response_format: "b64_json",
      });

      if (response.data?.[0]?.b64_json) {
        console.log(`[ImageGeneration] Success with xAI Grok Image in ${Date.now() - startTime}ms`);
        return {
          imageBase64: response.data[0].b64_json,
          mimeType: "image/png",
          prompt: normalizedPrompt,
          model: "grok-2-image-1212",
        };
      }
    } catch (error: any) {
      console.error(`[ImageGeneration] xAI Grok Image failed:`, toErrorMessage(error));
    }
  }

  throw new Error("Image generation failed: No working image generation service available");
}

export interface ImageEditResult extends ImageGenerationResult {
  parentId?: string;
}

export async function editImage(
  baseImageBase64: string,
  editPrompt: string,
  baseMimeType: string = "image/png",
): Promise<ImageEditResult> {
  const startTime = Date.now();
  const normalizedPrompt = String(editPrompt || "").trim();
  console.log(`[ImageGeneration] Starting edit for prompt: "${normalizedPrompt.slice(0, 100)}..."`);

  const ai = getGeminiClient();
  if (ai) {
    const editModels = uniqueNonEmpty([
      DEFAULT_GEMINI_IMAGE_MODEL,
      "gemini-3-pro-image-preview",
      "gemini-2.5-flash-image",
      "gemini-2.5-flash",
      "gemini-2.0-flash-exp-image-generation",
      "gemini-2.0-flash",
    ]);

    for (const model of editModels) {
      try {
        console.log(`[ImageGeneration] Trying edit with model: ${model}`);
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: baseMimeType,
                    data: baseImageBase64,
                  },
                },
                {
                  text: `Edit this image according to these instructions: ${normalizedPrompt}. Return only the edited image.`,
                },
              ],
            },
          ],
          config: {
            responseModalities: ["IMAGE"],
          },
        });

        const parts = response.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data) {
              console.log(
                `[ImageGeneration] Edit success with model ${model} in ${Date.now() - startTime}ms`,
              );
              return {
                imageBase64: part.inlineData.data,
                mimeType: part.inlineData.mimeType || "image/png",
                prompt: normalizedPrompt,
                model,
              };
            }
          }
        }
      } catch (error: any) {
        console.error(`[ImageGeneration] Edit with ${model} failed:`, toErrorMessage(error));
      }
    }
  }

  throw new Error("Image editing failed: No working image editing service available");
}

export type ImageIntentMode = "generate" | "edit_last" | "edit_specific";

export function classifyImageIntent(
  prompt: string,
  hasImageContext: boolean,
): { mode: ImageIntentMode } {
  const normalized = String(prompt || "").trim().toLowerCase();
  if (!hasImageContext) {
    return { mode: "generate" };
  }

  if (
    /\b(esta|esa|última|anterior|this|that|last|previous)\b/.test(normalized) ||
    /\b(edita|modifica|cambia|ajusta|arregla|edit|modify|change|adjust|fix|add|remove|put)\b/.test(
      normalized,
    )
  ) {
    return { mode: "edit_last" };
  }

  if (/\b(imagen específica|specific image|image id)\b/.test(normalized)) {
    return { mode: "edit_specific" };
  }

  return { mode: "generate" };
}

const imageKeywords = [
  "genera", "crea", "dibuja", "haz", "hazme", "diseña",
  "generate", "create", "draw", "make", "design",
  "imagen", "image", "foto", "photo", "picture", "ilustración", "illustration",
  "dibujo", "drawing", "arte", "art", "gráfico", "graphic",
  "logo", "icono", "icon", "banner", "poster", "cartel",
];

const imagePatterns = [
  /genera(r)?\s+(una?\s+)?imagen/i,
  /crea(r)?\s+(una?\s+)?imagen/i,
  /dibuja(r)?\s+(una?|un)/i,
  /haz(me)?\s+(una?\s+)?imagen/i,
  /diseña(r)?\s+(una?|un)/i,
  /generate\s+(an?\s+)?image/i,
  /create\s+(an?\s+)?image/i,
  /draw\s+(an?\s+|a\s+)?/i,
  /make\s+(an?\s+)?image/i,
  /imagen\s+de\s+/i,
  /image\s+of\s+/i,
];

const videoPatterns = [
  /\b(crea|genera|haz|make|create|generate)\b.*\b(video|vídeo|clip|animación|animation|movie|short)\b/i,
  /\b(video|vídeo|clip|animación|animation)\s+(de|of)\b/i,
  /\b(prompt|storyboard|escena|scene)\b.*\b(video|vídeo)\b/i,
];

export function detectImageRequest(message: string): boolean {
  const lowerMessage = String(message || "").toLowerCase();

  for (const pattern of imagePatterns) {
    if (pattern.test(lowerMessage)) {
      return true;
    }
  }

  const hasActionKeyword = imageKeywords.slice(0, 12).some((kw) => lowerMessage.includes(kw));
  const hasImageKeyword = imageKeywords.slice(12).some((kw) => lowerMessage.includes(kw));
  return hasActionKeyword && hasImageKeyword;
}

export function detectVideoRequest(message: string): boolean {
  const normalized = String(message || "").trim();
  if (!normalized) return false;
  return videoPatterns.some((pattern) => pattern.test(normalized));
}

export function extractImagePrompt(message: string): string {
  let prompt = String(message || "")
    .replace(/^(genera|crea|dibuja|haz|hazme|diseña|generate|create|draw|make|design)\s*/i, "")
    .replace(
      /^(una?\s+)?(imagen|image|foto|photo|picture|ilustración|illustration|dibujo|drawing)\s*(de|of)?\s*/i,
      "",
    )
    .trim();

  if (prompt.length < 5) {
    prompt = String(message || "").trim();
  }

  return prompt;
}

export function extractVideoPrompt(message: string): string {
  let prompt = String(message || "")
    .replace(/^(genera|crea|haz|make|create|generate)\s*/i, "")
    .replace(/^(un|una|an?|the)\s+/i, "")
    .replace(/^(video|vídeo|clip|animación|animation|movie)\s*(de|of)?\s*/i, "")
    .trim();

  if (prompt.length < 5) {
    prompt = String(message || "").trim();
  }

  return prompt;
}

export interface VideoFramePlan {
  index: number;
  title: string;
  caption: string;
  prompt: string;
  seconds: number;
}

export interface VideoFrameResult extends VideoFramePlan {
  imageBase64: string;
  mimeType: string;
  model?: string;
}

export interface VideoGenerationOptions {
  frameCount?: number;
  durationSec?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3";
  planningModel?: string;
  imageModel?: string;
  timeoutMs?: number;
  frameConcurrency?: number;
}

export interface VideoGenerationResult {
  mode: "storyboard_frames";
  prompt: string;
  summary: string;
  plannerModel: string;
  frames: VideoFrameResult[];
}

function buildFallbackVideoPlan(
  prompt: string,
  frameCount: number,
  durationSec: number,
): { summary: string; frames: VideoFramePlan[] } {
  const safePrompt = safeString(prompt, "escena principal");
  const frames: VideoFramePlan[] = Array.from({ length: frameCount }, (_, idx) => {
    const labels = ["Apertura", "Desarrollo", "Pico visual", "Cierre"];
    const focus = [
      "wide establishing shot, cinematic lighting, rich detail",
      "subject motion begins, medium shot, dynamic composition",
      "peak action moment, dramatic camera angle, motion blur implied",
      "final hero frame, clean composition, memorable ending shot",
    ];
    return {
      index: idx + 1,
      title: labels[idx] || `Frame ${idx + 1}`,
      caption: `${labels[idx] || `Frame ${idx + 1}`} del video`,
      prompt: `${safePrompt}. ${focus[idx] || "cinematic storyboard frame"}, ultra detailed, no text`,
      seconds: Math.max(1, Math.round(durationSec / frameCount)),
    };
  });

  return {
    summary: `Se generó un storyboard visual de ${frameCount} fotogramas para representar el video solicitado.`,
    frames,
  };
}

async function planVideoFrames(
  prompt: string,
  options: VideoGenerationOptions,
): Promise<{ summary: string; plannerModel: string; frames: VideoFramePlan[] }> {
  const defaultFrameCount = clampInt(process.env.VIDEO_STORYBOARD_FRAME_COUNT, 3, 2, 6);
  const frameCount = clampInt(options.frameCount, defaultFrameCount, 2, 6);
  const durationSec = clampInt(options.durationSec, 8, 2, 60);
  const plannerModel = safeString(options.planningModel, DEFAULT_VIDEO_PLANNER_MODEL);
  const client = getOpenRouterClient();

  if (!client) {
    const fallback = buildFallbackVideoPlan(prompt, frameCount, durationSec);
    return { plannerModel, ...fallback };
  }

  try {
    const completion = await withTimeout(
      clampInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 180_000),
      async () =>
        client.chat.completions.create({
          model: plannerModel,
          messages: [
            {
              role: "system",
              content:
                "You are a cinematic storyboard planner. Return strict JSON with keys summary and frames. " +
                "Each frame must include title, caption, prompt, and seconds. Make prompts suitable for still-image generation.",
            },
            {
              role: "user",
              content:
                `Create a ${frameCount}-frame storyboard for this video request: ${prompt}\n` +
                `Duration: ${durationSec} seconds\nAspect ratio: ${options.aspectRatio || "16:9"}\n` +
                `Return valid JSON only.`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.6,
        } as any),
    );

    const content = safeString(completion.choices?.[0]?.message?.content, "");
    const parsed = extractJsonObject(content);
    if (!parsed || !Array.isArray(parsed.frames) || parsed.frames.length === 0) {
      throw new Error("Planner returned invalid storyboard JSON");
    }

    const frames: VideoFramePlan[] = parsed.frames
      .slice(0, frameCount)
      .map((frame: any, idx: number) => ({
        index: idx + 1,
        title: safeString(frame?.title, `Frame ${idx + 1}`),
        caption: safeString(frame?.caption, safeString(frame?.title, `Frame ${idx + 1}`)),
        prompt: safeString(frame?.prompt, `${prompt}, cinematic storyboard frame ${idx + 1}`),
        seconds: clampInt(frame?.seconds, Math.max(1, Math.round(durationSec / frameCount)), 1, durationSec),
      }));

    if (frames.length === 0) {
      throw new Error("Planner returned zero usable frames");
    }

    return {
      summary: safeString(
        parsed.summary,
        `Se generó un storyboard visual de ${frames.length} fotogramas para representar el video solicitado.`,
      ),
      plannerModel,
      frames,
    };
  } catch (error: any) {
    markOpenRouterUnavailable(error);
    console.warn(`[VideoGeneration] Planner fallback activated: ${error.message}`);
    const fallback = buildFallbackVideoPlan(prompt, frameCount, durationSec);
    return { plannerModel, ...fallback };
  }
}

export async function generateVideoStoryboardFrames(
  prompt: string,
  options: VideoGenerationOptions = {},
): Promise<VideoGenerationResult> {
  const normalizedPrompt = normalizeVideoPrompt(prompt);
  const storyboard = await planVideoFrames(normalizedPrompt, options);
  const defaultConcurrency = clampInt(process.env.VIDEO_STORYBOARD_CONCURRENCY, 2, 1, 4);
  const frameConcurrency = clampInt(
    options.frameConcurrency,
    defaultConcurrency,
    1,
    Math.max(1, storyboard.frames.length),
  );

  const frames = await mapWithConcurrency(
    storyboard.frames,
    frameConcurrency,
    async (frame): Promise<VideoFrameResult> => {
      const image = await generateImage(frame.prompt, {
        preferredModel: options.imageModel || DEFAULT_VIDEO_IMAGE_MODEL,
        aspectRatio: options.aspectRatio || "16:9",
        timeoutMs: options.timeoutMs,
        preferOpenRouter: true,
      });

      return {
        ...frame,
        imageBase64: image.imageBase64,
        mimeType: image.mimeType,
        model: image.model,
      };
    },
  );

  if (frames.length === 0) {
    throw new Error("Video generation fallback failed: no storyboard frames were rendered");
  }

  return {
    mode: "storyboard_frames",
    prompt: normalizedPrompt,
    summary: storyboard.summary,
    plannerModel: storyboard.plannerModel,
    frames,
  };
}
