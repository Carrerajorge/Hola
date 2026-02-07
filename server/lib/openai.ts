import OpenAI from "openai";
import type { ChatCompletionChunk, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { storage } from "../storage";
import type { InsertApiLog } from "@shared/schema";
import { getUserId as getCorrelationUserId } from "../middleware/correlationContext";

function clampText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function safeToString(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getLastUserMessagePreview(messages: ChatCompletionMessageParam[], maxLen = 800): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    if (typeof msg.content === "string") return clampText(msg.content, maxLen);
    if (Array.isArray(msg.content)) {
      return clampText(
        msg.content
          .map((p: any) => safeToString(p?.text ?? p))
          .join("\n"),
        maxLen
      );
    }

    if (msg.content == null) continue;
    return clampText(safeToString(msg.content), maxLen);
  }
  return null;
}

function persistApiLogSafe(apiLog: InsertApiLog): void {
  storage.createApiLog(apiLog).catch((err) => {
    const msg = (err?.message || "").toLowerCase();
    if (apiLog.userId && (msg.includes("foreign key") || msg.includes("violates foreign key"))) {
      storage.createApiLog({ ...apiLog, userId: null }).catch(() => undefined);
      return;
    }
    console.error("[OpenAI] Failed to persist API log:", err?.message || err);
  });
}

function instrumentXaiClient(client: OpenAI): void {
  // Patch chat.completions.create
  const chatCompletions: any = client.chat?.completions;
  if (chatCompletions?.create && typeof chatCompletions.create === "function") {
    const originalCreate = chatCompletions.create.bind(chatCompletions);
    chatCompletions.create = async (params: any, options?: any) => {
      const startedAt = Date.now();
      const model = String(params?.model || "");
      const messages = (params?.messages || []) as ChatCompletionMessageParam[];
      const requestPreview = getLastUserMessagePreview(messages);
      const correlationUserId = getCorrelationUserId();

      try {
        const response = await originalCreate(params, options);

        if (params?.stream) {
          // Streaming: wrap the async iterator, accumulate content, and log once completed.
          const stream = response as AsyncIterable<ChatCompletionChunk>;
          return (async function* () {
            let accumulated = "";
            try {
              for await (const chunk of stream) {
                const delta = (chunk as any)?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta) accumulated += delta;
                yield chunk;
              }

              const latencyMs = Date.now() - startedAt;
              const promptTokens = Math.ceil(JSON.stringify(messages).length / 4);
              const completionTokens = Math.ceil(accumulated.length / 4);

              persistApiLogSafe({
                userId: correlationUserId || null,
                endpoint: "/chat/completions",
                method: "POST",
                statusCode: 200,
                latencyMs,
                tokensIn: promptTokens,
                tokensOut: completionTokens,
                model: model || null,
                provider: "xai",
                requestPreview: requestPreview ? clampText(requestPreview, 2000) : null,
                responsePreview: accumulated ? clampText(accumulated, 2000) : null,
                errorMessage: null,
                ipAddress: null,
                userAgent: null,
              });
            } catch (err: any) {
              const latencyMs = Date.now() - startedAt;
              persistApiLogSafe({
                userId: correlationUserId || null,
                endpoint: "/chat/completions",
                method: "POST",
                statusCode: err?.status || err?.statusCode || 500,
                latencyMs,
                tokensIn: null,
                tokensOut: null,
                model: model || null,
                provider: "xai",
                requestPreview: requestPreview ? clampText(requestPreview, 2000) : null,
                responsePreview: accumulated ? clampText(accumulated, 2000) : null,
                errorMessage: clampText(err?.message || safeToString(err), 2000),
                ipAddress: null,
                userAgent: null,
              });
              throw err;
            }
          })();
        }

        const latencyMs = Date.now() - startedAt;
        const content = (response as any)?.choices?.[0]?.message?.content;
        const responsePreview = typeof content === "string" ? content : safeToString(content);
        const usage = (response as any)?.usage;

        persistApiLogSafe({
          userId: correlationUserId || null,
          endpoint: "/chat/completions",
          method: "POST",
          statusCode: 200,
          latencyMs,
          tokensIn: usage?.prompt_tokens ?? null,
          tokensOut: usage?.completion_tokens ?? null,
          model: model || null,
          provider: "xai",
          requestPreview: requestPreview ? clampText(requestPreview, 2000) : null,
          responsePreview: responsePreview ? clampText(responsePreview, 2000) : null,
          errorMessage: null,
          ipAddress: null,
          userAgent: null,
        });

        return response;
      } catch (err: any) {
        const latencyMs = Date.now() - startedAt;
        persistApiLogSafe({
          userId: correlationUserId || null,
          endpoint: "/chat/completions",
          method: "POST",
          statusCode: err?.status || err?.statusCode || 500,
          latencyMs,
          tokensIn: null,
          tokensOut: null,
          model: model || null,
          provider: "xai",
          requestPreview: requestPreview ? clampText(requestPreview, 2000) : null,
          responsePreview: null,
          errorMessage: clampText(err?.message || safeToString(err), 2000),
          ipAddress: null,
          userAgent: null,
        });
        throw err;
      }
    };
  }

  // Patch images.generate
  const images: any = (client as any).images;
  if (images?.generate && typeof images.generate === "function") {
    const originalGenerate = images.generate.bind(images);
    images.generate = async (params: any, options?: any) => {
      const startedAt = Date.now();
      const correlationUserId = getCorrelationUserId();
      const model = String(params?.model || "");
      const prompt = typeof params?.prompt === "string" ? params.prompt : safeToString(params?.prompt);

      try {
        const response = await originalGenerate(params, options);
        const latencyMs = Date.now() - startedAt;

        persistApiLogSafe({
          userId: correlationUserId || null,
          endpoint: "/images/generate",
          method: "POST",
          statusCode: 200,
          latencyMs,
          tokensIn: null,
          tokensOut: null,
          model: model || null,
          provider: "xai",
          requestPreview: prompt ? clampText(prompt, 2000) : null,
          responsePreview: "[image_generated]",
          errorMessage: null,
          ipAddress: null,
          userAgent: null,
        });

        return response;
      } catch (err: any) {
        const latencyMs = Date.now() - startedAt;

        persistApiLogSafe({
          userId: correlationUserId || null,
          endpoint: "/images/generate",
          method: "POST",
          statusCode: err?.status || err?.statusCode || 500,
          latencyMs,
          tokensIn: null,
          tokensOut: null,
          model: model || null,
          provider: "xai",
          requestPreview: prompt ? clampText(prompt, 2000) : null,
          responsePreview: null,
          errorMessage: clampText(err?.message || safeToString(err), 2000),
          ipAddress: null,
          userAgent: null,
        });

        throw err;
      }
    };
  }
}

const xaiApiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || "";
const _openai = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: xaiApiKey,
});

instrumentXaiClient(_openai);

export const openai = _openai;

export const MODELS = {
  TEXT: "grok-3-mini",
  VISION: "grok-2-vision-1212",
  GROK_REASONING: "grok-4-1-fast-reasoning"
} as const;

export type ModelType = typeof MODELS[keyof typeof MODELS];
